import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClientType, type Pagination, RoleCode, type UserStatus } from '@fabricqc/shared';
import type { z } from 'zod';
import type { createUserSchema, departmentSchema, updateUserSchema } from '@fabricqc/shared';
import { AppConfig } from '../config/app-config';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AppError } from '../common/app-error';
import { randomCode } from '../common/codes';
import type { Actor } from '../common/actor';
import type { RequestMeta } from '../common/decorators';
import { pageArgs, paged } from '../common/pagination';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { hashPassword } from '../auth/password';
import { TokenService } from '../auth/token.service';
import { WechatGateway } from '../wechat/wechat.gateway';

type CreateUser = z.infer<typeof createUserSchema>;
type UpdateUser = z.infer<typeof updateUserSchema>;

const userInclude = {
  department: { select: { id: true, code: true, name: true } },
  supervisor: { select: { id: true, name: true, employeeNo: true } },
  roles: { include: { role: true, department: { select: { id: true, name: true } } } },
  wechat: { select: { appId: true, boundAt: true, lastLoginAt: true } },
} satisfies Prisma.UserInclude;

type UserWithRelations = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function present(u: UserWithRelations, activeSessions?: number) {
  return {
    id: u.id,
    employeeNo: u.employeeNo,
    name: u.name,
    position: u.position,
    phone: u.phone,
    status: u.status,
    username: u.username,
    hasPassword: Boolean(u.passwordHash),
    lockedUntil: u.lockedUntil,
    department: u.department,
    supervisor: u.supervisor,
    roles: u.roles.map((r) => ({ role: r.role.code, departmentId: r.departmentId, department: r.department })),
    wechatBound: u.wechat.length > 0,
    wechatBoundAt: u.wechat[0]?.boundAt ?? null,
    wechatLastLoginAt: u.wechat[0]?.lastLoginAt ?? null,
    activeSessions,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly authService: AuthService,
    private readonly config: AppConfig,
    private readonly wechat: WechatGateway,
  ) {}

  // ---------- 部门 ----------
  listDepartments() {
    return this.prisma.department.findMany({
      orderBy: { code: 'asc' },
      include: { _count: { select: { users: true } } },
    });
  }

  async createDepartment(actor: Actor, data: z.infer<typeof departmentSchema>, meta: RequestMeta) {
    const d = await this.prisma.department.create({ data });
    await this.audit.log(actor, { action: 'department.create', entityType: 'Department', entityId: d.id, after: d }, meta);
    return d;
  }

  async updateDepartment(actor: Actor, id: string, data: z.infer<typeof departmentSchema>, meta: RequestMeta) {
    const before = await this.prisma.department.findUnique({ where: { id } });
    if (!before) throw AppError.notFound('部门');
    const d = await this.prisma.department.update({ where: { id }, data });
    await this.audit.log(actor, { action: 'department.update', entityType: 'Department', entityId: id, before, after: d }, meta);
    return d;
  }

  // ---------- 员工 ----------
  async list(p: Pagination & { role?: RoleCode; status?: UserStatus; departmentId?: string }) {
    const where: Prisma.UserWhereInput = {
      status: p.status,
      departmentId: p.departmentId,
      ...(p.role ? { roles: { some: { role: { code: p.role } } } } : {}),
      ...(p.q
        ? {
            OR: [
              { name: { contains: p.q, mode: 'insensitive' } },
              { employeeNo: { contains: p.q, mode: 'insensitive' } },
              { username: { contains: p.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, include: userInclude, orderBy: { employeeNo: 'asc' }, ...pageArgs(p) }),
      this.prisma.user.count({ where }),
    ]);
    return paged(items.map((u) => present(u)), total, p);
  }

  /** 供下拉选择：按角色列出启用员工 */
  async options(role?: RoleCode) {
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', ...(role ? { roles: { some: { role: { code: role } } } } : {}) },
      select: { id: true, name: true, employeeNo: true, departmentId: true },
      orderBy: { employeeNo: 'asc' },
    });
    return users;
  }

  async get(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, include: userInclude });
    if (!u) throw AppError.notFound('员工');
    const activeSessions = await this.prisma.authSession.count({
      where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    return present(u, activeSessions);
  }

  private async replaceRoles(tx: Tx, userId: string, roles: CreateUser['roles']) {
    const seen = new Set<string>();
    for (const r of roles) {
      const k = `${r.role}:${r.departmentId ?? '*'}`;
      if (seen.has(k)) throw AppError.badRequest(`角色重复：${r.role}`);
      seen.add(k);
    }
    const roleRows = await tx.role.findMany();
    const byCode = new Map(roleRows.map((r) => [r.code, r.id]));
    await tx.userRole.deleteMany({ where: { userId } });
    await tx.userRole.createMany({
      data: roles.map((r) => ({ userId, roleId: byCode.get(r.role)!, departmentId: r.departmentId ?? null })),
    });
  }

  private async validateRefs(tx: Tx, data: { departmentId?: string | null; supervisorId?: string | null }, selfId?: string) {
    if (data.departmentId && !(await tx.department.findUnique({ where: { id: data.departmentId } }))) {
      throw AppError.badRequest('部门不存在');
    }
    if (data.supervisorId) {
      if (data.supervisorId === selfId) throw AppError.badRequest('直属主管不能是本人');
      const s = await tx.user.findUnique({ where: { id: data.supervisorId } });
      if (!s || s.status !== 'ACTIVE') throw AppError.badRequest('直属主管不存在或已停用');
    }
  }

  async create(actor: Actor, data: CreateUser, meta: RequestMeta) {
    if (data.password && !data.username) throw AppError.badRequest('设置密码时必须同时设置 PC 登录用户名');
    const passwordHash = data.password ? await hashPassword(data.password) : null;
    const user = await this.prisma.$transaction(async (tx) => {
      await this.validateRefs(tx, data);
      const u = await tx.user.create({
        data: {
          employeeNo: data.employeeNo,
          name: data.name,
          departmentId: data.departmentId ?? null,
          position: data.position,
          phone: data.phone,
          supervisorId: data.supervisorId ?? null,
          username: data.username,
          passwordHash,
        },
      });
      await this.replaceRoles(tx, u.id, data.roles);
      const full = await tx.user.findUniqueOrThrow({ where: { id: u.id }, include: userInclude });
      await this.audit.log(actor, { action: 'user.create', entityType: 'User', entityId: u.id, after: present(full) }, meta, tx);
      return full;
    });
    return present(user);
  }

  async update(actor: Actor, id: string, data: UpdateUser, meta: RequestMeta) {
    const before = await this.prisma.user.findUnique({ where: { id }, include: userInclude });
    if (!before) throw AppError.notFound('员工');
    if (id === actor.userId && data.status === 'DISABLED') throw AppError.badRequest('不能停用自己的账号');
    if (id === actor.userId && !data.roles.some((r) => r.role === RoleCode.ADMIN)) {
      throw AppError.badRequest('不能移除自己的管理员角色');
    }
    const user = await this.prisma.$transaction(async (tx) => {
      await this.validateRefs(tx, data, id);
      await tx.user.update({
        where: { id },
        data: {
          name: data.name,
          departmentId: data.departmentId ?? null,
          position: data.position,
          phone: data.phone,
          supervisorId: data.supervisorId ?? null,
          username: data.username,
          status: data.status,
          disabledAt: data.status === 'DISABLED' ? (before.disabledAt ?? new Date()) : null,
        },
      });
      await this.replaceRoles(tx, id, data.roles);
      if (data.status === 'DISABLED' && before.status !== 'DISABLED') {
        // 停用即撤销全部会话和未使用绑定码
        await this.tokens.revokeAllForUser(id, 'USER_DISABLED', tx);
        await tx.wechatBindCode.updateMany({ where: { userId: id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      const full = await tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
      await this.audit.log(
        actor,
        { action: 'user.update', entityType: 'User', entityId: id, before: present(before), after: present(full) },
        meta,
        tx,
      );
      return full;
    });
    return present(user);
  }

  async resetPassword(actor: Actor, id: string, password: string, meta: RequestMeta) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw AppError.notFound('员工');
    if (!u.username) throw AppError.badRequest('该员工没有 PC 登录用户名，请先设置用户名');
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
      await this.tokens.revokeAllForUser(id, 'PASSWORD_RESET', tx, ClientType.ADMIN_WEB);
      await this.audit.log(actor, { action: 'user.reset_password', entityType: 'User', entityId: id }, meta, tx);
    });
    return { ok: true };
  }

  // ---------- 微信绑定码 ----------
  /** 生成一次性绑定码。旧的未使用绑定码全部作废。明文只返回这一次。 */
  async generateBindCode(actor: Actor, userId: string, meta: RequestMeta) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, include: { wechat: true } });
    if (!u) throw AppError.notFound('员工');
    if (u.status !== 'ACTIVE') throw AppError.invalidState('员工账号已停用');
    if (u.wechat.length) throw AppError.conflict('该员工已绑定微信，如需重新绑定请先解绑');
    const code = randomCode(8);
    const ttl = await this.bindCodeTtlHours();
    const expiresAt = new Date(Date.now() + ttl * 3600_000);
    await this.prisma.$transaction(async (tx) => {
      await tx.wechatBindCode.updateMany({
        where: { userId, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const row = await tx.wechatBindCode.create({
        data: { userId, codeHash: this.authService.hashBindCode(code), expiresAt, createdById: actor.userId },
      });
      await this.audit.log(
        actor,
        { action: 'wechat.bind_code.generate', entityType: 'User', entityId: userId, after: { bindCodeId: row.id, expiresAt } },
        meta,
        tx,
      );
    });
    return { employeeNo: u.employeeNo, name: u.name, bindCode: code, expiresAt };
  }

  private async bindCodeTtlHours(): Promise<number> {
    const s = await this.prisma.systemSetting.findUnique({ where: { key: 'bindCodeTtlHours' } });
    const v = typeof s?.value === 'number' ? s.value : null;
    return v ?? this.config.env.BIND_CODE_TTL_HOURS;
  }

  async unbindWechat(actor: Actor, userId: string, meta: RequestMeta) {
    const ids = await this.prisma.wechatIdentity.findMany({ where: { userId } });
    if (!ids.length) throw AppError.invalidState('该员工未绑定微信');
    await this.prisma.$transaction(async (tx) => {
      await tx.wechatIdentity.deleteMany({ where: { userId } });
      await this.tokens.revokeAllForUser(userId, 'WECHAT_UNBOUND', tx, ClientType.MINIAPP);
      await tx.wechatSubscription.deleteMany({ where: { userId } });
      await this.audit.log(
        actor,
        { action: 'wechat.unbind', entityType: 'User', entityId: userId, before: ids.map((i) => ({ appId: i.appId, boundAt: i.boundAt })) },
        meta,
        tx,
      );
    });
    return { ok: true };
  }

  async forceLogout(actor: Actor, userId: string, meta: RequestMeta) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw AppError.notFound('员工');
    const count = await this.prisma.$transaction(async (tx) => {
      const n = await this.tokens.revokeAllForUser(userId, 'FORCED_LOGOUT', tx);
      await this.audit.log(actor, { action: 'user.force_logout', entityType: 'User', entityId: userId, after: { revoked: n } }, meta, tx);
      return n;
    });
    return { revoked: count };
  }

  bindStatus() {
    return { wechatConfigured: this.wechat.configured };
  }
}
