import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ClientType, ErrorCode } from '@fabricqc/shared';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app-error';
import { safeEqualHex, sha256 } from '../common/codes';
import type { RequestMeta } from '../common/decorators';
import type { Actor } from '../common/actor';
import { AuditService } from '../audit/audit.service';
import { WechatGateway } from '../wechat/wechat.gateway';
import { burnPasswordCheck, verifyPassword } from './password';
import { TokenService } from './token.service';

interface BindTicketPayload {
  typ: 'wx-bind';
  appId: string;
  openId: string;
  unionId?: string;
}

const BIND_INVALID = '员工编号或绑定码不正确，或绑定码已失效';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly wechat: WechatGateway,
  ) {}

  hashBindCode(code: string) {
    return sha256(`${code.toUpperCase()}:${this.config.env.BIND_CODE_PEPPER}`);
  }

  // ---------------- PC 用户名密码登录 ----------------
  async adminLogin(username: string, password: string, meta: RequestMeta) {
    const env = this.config.env;
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || !user.passwordHash) {
      await burnPasswordCheck(password);
      throw AppError.of(ErrorCode.INVALID_CREDENTIALS, '用户名或密码错误', 401);
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw AppError.of(ErrorCode.ACCOUNT_LOCKED, `登录失败次数过多，请 ${minutes} 分钟后再试`, 423);
    }
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok || user.status !== 'ACTIVE') {
      if (!ok) {
        const failed = user.failedLoginCount + 1;
        const lock = failed >= env.LOGIN_MAX_FAILURES;
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: lock ? 0 : failed,
            lockedUntil: lock ? new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60000) : user.lockedUntil,
          },
        });
        if (lock) {
          await this.audit.log(null, { action: 'auth.lock', entityType: 'User', entityId: user.id }, meta);
        }
      }
      throw AppError.of(ErrorCode.INVALID_CREDENTIALS, '用户名或密码错误', 401);
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    const tokens = await this.tokens.issue(user.id, ClientType.ADMIN_WEB, meta);
    await this.audit.log(
      { userId: user.id } as Actor,
      { action: 'auth.admin_login', entityType: 'AuthSession', entityId: tokens.sessionId },
      meta,
    );
    return tokens;
  }

  // ---------------- 微信登录与绑定 ----------------
  async wechatLogin(code: string, meta: RequestMeta) {
    const wx = await this.wechat.code2Session(code);
    const appId = this.wechat.appId!;
    const identity = await this.prisma.wechatIdentity.findUnique({
      where: { appId_openId: { appId, openId: wx.openId } },
      include: { user: true },
    });
    if (!identity) {
      const ticket: BindTicketPayload = { typ: 'wx-bind', appId, openId: wx.openId, unionId: wx.unionId };
      return { status: 'UNBOUND' as const, bindTicket: this.jwt.sign(ticket, { expiresIn: 600 }) };
    }
    if (identity.user.status !== 'ACTIVE') {
      throw AppError.forbidden('账号已停用，请联系管理员');
    }
    await this.prisma.wechatIdentity.update({ where: { id: identity.id }, data: { lastLoginAt: new Date() } });
    const tokens = await this.tokens.issue(identity.userId, ClientType.MINIAPP, meta);
    return { status: 'BOUND' as const, tokens };
  }

  async wechatBind(input: { bindTicket: string; employeeNo: string; bindCode: string }, meta: RequestMeta) {
    let ticket: BindTicketPayload;
    try {
      ticket = this.jwt.verify<BindTicketPayload>(input.bindTicket);
    } catch {
      throw AppError.of(ErrorCode.BIND_CODE_INVALID, '绑定已超时，请重新进入小程序', 400);
    }
    if (ticket.typ !== 'wx-bind' || ticket.appId !== this.wechat.appId) {
      throw AppError.of(ErrorCode.BIND_CODE_INVALID, '绑定票据无效，请重新进入小程序', 400);
    }

    const user = await this.prisma.user.findUnique({ where: { employeeNo: input.employeeNo } });
    if (!user || user.status !== 'ACTIVE') throw AppError.of(ErrorCode.BIND_CODE_INVALID, BIND_INVALID, 400);

    const code = await this.prisma.wechatBindCode.findFirst({
      where: { userId: user.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!code) throw AppError.of(ErrorCode.BIND_CODE_INVALID, BIND_INVALID, 400);

    if (!safeEqualHex(code.codeHash, this.hashBindCode(input.bindCode))) {
      const attempts = code.failedAttempts + 1;
      const max = this.config.env.BIND_CODE_MAX_ATTEMPTS;
      await this.prisma.wechatBindCode.update({
        where: { id: code.id },
        data: { failedAttempts: attempts, revokedAt: attempts >= max ? new Date() : null },
      });
      const left = max - attempts;
      throw AppError.of(
        ErrorCode.BIND_CODE_INVALID,
        left > 0 ? `${BIND_INVALID}（还可尝试 ${left} 次）` : '错误次数过多，绑定码已作废，请联系管理员重新生成',
        400,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const [openIdTaken, userBound] = await Promise.all([
        tx.wechatIdentity.findUnique({ where: { appId_openId: { appId: ticket.appId, openId: ticket.openId } } }),
        tx.wechatIdentity.findUnique({ where: { appId_userId: { appId: ticket.appId, userId: user.id } } }),
      ]);
      if (openIdTaken) throw AppError.conflict('该微信已绑定其他员工账号，请联系管理员');
      if (userBound) throw AppError.conflict('该员工已绑定微信，如需更换请联系管理员解绑');
      // 条件更新防止同一绑定码被并发使用两次
      const used = await tx.wechatBindCode.updateMany({
        where: { id: code.id, usedAt: null, revokedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1) throw AppError.of(ErrorCode.BIND_CODE_INVALID, BIND_INVALID, 400);
      const identity = await tx.wechatIdentity.create({
        data: { appId: ticket.appId, openId: ticket.openId, unionId: ticket.unionId, userId: user.id, lastLoginAt: new Date() },
      });
      await this.audit.log(
        { userId: user.id } as Actor,
        { action: 'wechat.bind', entityType: 'User', entityId: user.id, after: { identityId: identity.id } },
        meta,
        tx,
      );
      return this.tokens.issue(user.id, ClientType.MINIAPP, meta, tx);
    });
    return { status: 'BOUND' as const, tokens: result };
  }

  async logout(actor: Actor, meta: RequestMeta) {
    await this.tokens.revoke(actor.sessionId, 'LOGOUT');
    await this.audit.log(actor, { action: 'auth.logout', entityType: 'AuthSession', entityId: actor.sessionId }, meta);
  }

  async me(actor: Actor) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      include: { department: true, wechat: { select: { appId: true, boundAt: true } } },
    });
    return {
      id: u.id,
      employeeNo: u.employeeNo,
      name: u.name,
      position: u.position,
      department: u.department ? { id: u.department.id, name: u.department.name } : null,
      roles: actor.roles,
      username: u.username,
      wechatBound: u.wechat.length > 0,
      clientType: actor.clientType,
    };
  }
}
