import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RoleCode, type Pagination, type TaskStatus } from '@fabricqc/shared';
import type { z } from 'zod';
import type { createTaskSchema, updateTaskSchema } from '@fabricqc/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AppError } from '../common/app-error';
import { businessNo } from '../common/codes';
import { hasRole, MANAGE_TASKS, type Actor } from '../common/actor';
import type { RequestMeta } from '../common/decorators';
import { pageArgs, paged } from '../common/pagination';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StandardsService } from '../standards/standards.service';

type CreateTask = z.infer<typeof createTaskSchema>;
type UpdateTask = z.infer<typeof updateTaskSchema>;

const person = { select: { id: true, name: true, employeeNo: true } } as const;
const taskInclude = {
  assignee: person,
  reviewer: person,
  createdBy: person,
  department: { select: { id: true, name: true } },
  customer: { select: { id: true, code: true, name: true } },
  fourPointStandard: { select: { id: true, code: true, name: true } },
  customerStandard: { select: { id: true, code: true, name: true } },
  template: { select: { id: true, code: true, name: true } },
} satisfies Prisma.QcTaskInclude;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly standards: StandardsService,
  ) {}

  private async userWithRoles(tx: Tx, id: string) {
    return tx.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
  }

  private async validate(tx: Tx, d: CreateTask) {
    const assignee = await this.userWithRoles(tx, d.assigneeId);
    if (!assignee || assignee.status !== 'ACTIVE' || !assignee.roles.some((r) => r.role.code === RoleCode.INSPECTOR)) {
      throw AppError.badRequest('质检员不存在、已停用或没有质检员角色');
    }
    if (d.reviewerId) {
      const reviewer = await this.userWithRoles(tx, d.reviewerId);
      const ok = reviewer?.roles.some((r) => r.role.code === RoleCode.QC_SUPERVISOR || r.role.code === RoleCode.QUALITY_MANAGER);
      if (!reviewer || reviewer.status !== 'ACTIVE' || !ok) throw AppError.badRequest('审核人不存在、已停用或没有审核权限');
      if (reviewer.id === assignee.id) throw AppError.badRequest('审核人不能与质检员相同');
    }
    const fp = await this.standards.currentVersion(tx, d.fourPointStandardId);
    if (!fp || fp.standard.kind !== 'FOUR_POINT' || !fp.standard.isActive) {
      throw AppError.badRequest('四分制标准不存在、未启用或没有已发布版本');
    }
    if (d.customerStandardId) {
      const cs = await this.standards.currentVersion(tx, d.customerStandardId);
      if (!cs || cs.standard.kind !== 'CUSTOMER' || !cs.standard.isActive) {
        throw AppError.badRequest('客户标准不存在、未启用或没有已发布版本');
      }
    }
    const tpl = await tx.inspectionTemplate.findUnique({ where: { id: d.templateId } });
    if (!tpl || !tpl.isActive) throw AppError.badRequest('检验模板不存在或已停用');
    if (d.departmentId && !(await tx.department.findUnique({ where: { id: d.departmentId } }))) {
      throw AppError.badRequest('部门不存在');
    }
    if (d.customerId && !(await tx.customer.findUnique({ where: { id: d.customerId } }))) {
      throw AppError.badRequest('客户不存在');
    }
    return assignee;
  }

  /** 只有待分配的布卷可以加入任务；同一卷不能同时存在于两个进行中的任务 */
  private async attachRolls(tx: Tx, taskId: string, rollIds: string[]) {
    const unique = [...new Set(rollIds)];
    const rolls = await tx.fabricRoll.findMany({ where: { id: { in: unique } } });
    if (rolls.length !== unique.length) throw AppError.badRequest('部分布卷不存在');
    const busy = rolls.filter((r) => r.status !== 'PENDING');
    if (busy.length) {
      throw AppError.invalidState(`以下布卷不是待分配状态：${busy.map((r) => r.rollNo).join('、')}`, {
        rollNos: busy.map((r) => r.rollNo),
      });
    }
    await tx.qcTaskRoll.createMany({ data: unique.map((rollId) => ({ taskId, rollId })) });
    const r = await tx.fabricRoll.updateMany({ where: { id: { in: unique }, status: 'PENDING' }, data: { status: 'ASSIGNED' } });
    if (r.count !== unique.length) throw AppError.conflict('布卷状态已变化，请刷新后重试');
  }

  async create(actor: Actor, d: CreateTask, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const assignee = await this.validate(tx, d);
      const task = await tx.qcTask.create({
        data: {
          taskNo: businessNo('T'),
          title: d.title,
          departmentId: d.departmentId ?? assignee.departmentId ?? null,
          customerId: d.customerId ?? null,
          assigneeId: d.assigneeId,
          reviewerId: d.reviewerId ?? null,
          defaultMode: d.defaultMode ?? null,
          defaultScope: d.defaultScope,
          fourPointStandardId: d.fourPointStandardId,
          customerStandardId: d.customerStandardId ?? null,
          templateId: d.templateId,
          dueAt: d.dueAt ?? null,
          notes: d.notes,
          createdById: actor.userId,
        },
      });
      await this.attachRolls(tx, task.id, d.rollIds);
      await this.notifications.notifyInApp(tx, {
        userIds: [d.assigneeId],
        type: 'TASK_ASSIGNED',
        title: '新的验布任务',
        body: `${task.title}（${d.rollIds.length} 卷）`,
        entityType: 'QcTask',
        entityId: task.id,
        pagePath: `/pages/task/index?id=${task.id}`,
      });
      await this.audit.log(actor, { action: 'task.create', entityType: 'QcTask', entityId: task.id, after: { ...task, rollIds: d.rollIds } }, meta, tx);
      return task;
    });
  }

  private scopeWhere(actor: Actor): Prisma.QcTaskWhereInput {
    // 只有质检员角色的用户只能看到分配给自己的任务
    return hasRole(actor, ...MANAGE_TASKS, RoleCode.SALES) ? {} : { assigneeId: actor.userId };
  }

  async list(actor: Actor, p: Pagination & { status?: TaskStatus; assigneeId?: string }) {
    const where: Prisma.QcTaskWhereInput = {
      ...this.scopeWhere(actor),
      ...(p.status ? { status: p.status } : {}),
      ...(p.assigneeId ? { assigneeId: p.assigneeId } : {}),
      ...(p.q
        ? { OR: [{ taskNo: { contains: p.q, mode: 'insensitive' } }, { title: { contains: p.q, mode: 'insensitive' } }] }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.qcTask.findMany({
        where,
        include: { ...taskInclude, rolls: { select: { status: true } } },
        orderBy: { createdAt: 'desc' },
        ...pageArgs(p),
      }),
      this.prisma.qcTask.count({ where }),
    ]);
    return paged(
      items.map(({ rolls, ...t }) => ({
        ...t,
        rollCount: rolls.length,
        doneCount: rolls.filter((r) => r.status === 'DONE').length,
        submittedCount: rolls.filter((r) => r.status === 'SUBMITTED').length,
      })),
      total,
      p,
    );
  }

  /** 小程序首页：我的进行中任务 */
  async mine(actor: Actor) {
    const tasks = await this.prisma.qcTask.findMany({
      where: { assigneeId: actor.userId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      include: { ...taskInclude, rolls: { select: { status: true } } },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    return tasks.map(({ rolls, ...t }) => ({
      ...t,
      rollCount: rolls.length,
      doneCount: rolls.filter((r) => r.status === 'DONE').length,
      pendingCount: rolls.filter((r) => r.status === 'PENDING' || r.status === 'IN_PROGRESS' || r.status === 'RETURNED').length,
    }));
  }

  async get(actor: Actor, id: string) {
    const t = await this.prisma.qcTask.findUnique({
      where: { id },
      include: {
        ...taskInclude,
        rolls: {
          orderBy: { createdAt: 'asc' },
          include: {
            roll: {
              include: { fabric: { select: { id: true, code: true, nameZh: true } }, lot: { select: { lotNo: true } } },
            },
            inspections: {
              where: { status: { not: 'VOIDED' } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { id: true, inspectionNo: true, status: true, overallResult: true, revision: true, submittedAt: true },
            },
          },
        },
      },
    });
    if (!t) throw AppError.notFound('任务');
    if (!hasRole(actor, ...MANAGE_TASKS, RoleCode.SALES) && t.assigneeId !== actor.userId) throw AppError.forbidden();
    return {
      ...t,
      rolls: t.rolls.map((tr) => ({
        taskRollId: tr.id,
        status: tr.status,
        roll: tr.roll,
        latestInspection: tr.inspections[0] ?? null,
      })),
    };
  }

  async update(actor: Actor, id: string, d: UpdateTask, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.qcTask.findUnique({ where: { id }, include: { rolls: true } });
      if (!before) throw AppError.notFound('任务');
      if (before.status === 'COMPLETED' || before.status === 'CANCELLED') throw AppError.invalidState('任务已结束，不能修改');

      if (d.assigneeId && d.assigneeId !== before.assigneeId) {
        const a = await this.userWithRoles(tx, d.assigneeId);
        if (!a || a.status !== 'ACTIVE' || !a.roles.some((r) => r.role.code === RoleCode.INSPECTOR)) {
          throw AppError.badRequest('质检员不存在、已停用或没有质检员角色');
        }
        const active = await tx.rollInspection.count({ where: { taskId: id, status: { in: ['DRAFT', 'RETURNED'] } } });
        if (active) throw AppError.invalidState('任务中有正在进行的检验草稿，不能更换质检员');
      }

      if (d.status === 'CANCELLED') {
        const submitted = before.rolls.filter((r) => r.status === 'SUBMITTED');
        if (submitted.length) throw AppError.invalidState('任务中有待审核的检验，不能取消');
        // 未完成的检验作废，布卷回到待分配
        await tx.rollInspection.updateMany({ where: { taskId: id, status: { in: ['DRAFT', 'RETURNED'] } }, data: { status: 'VOIDED' } });
        const openRollIds = before.rolls.filter((r) => r.status !== 'DONE').map((r) => r.rollId);
        await tx.fabricRoll.updateMany({ where: { id: { in: openRollIds } }, data: { status: 'PENDING' } });
      }

      const task = await tx.qcTask.update({
        where: { id },
        data: {
          title: d.title,
          assigneeId: d.assigneeId,
          reviewerId: d.reviewerId === undefined ? undefined : d.reviewerId,
          dueAt: d.dueAt === undefined ? undefined : d.dueAt,
          notes: d.notes === undefined ? undefined : d.notes,
          status: d.status,
        },
      });
      if (d.assigneeId && d.assigneeId !== before.assigneeId) {
        await this.notifications.notifyInApp(tx, {
          userIds: [d.assigneeId],
          type: 'TASK_ASSIGNED',
          title: '新的验布任务',
          body: task.title,
          entityType: 'QcTask',
          entityId: id,
          pagePath: `/pages/task/index?id=${id}`,
        });
      }
      await this.audit.log(actor, { action: 'task.update', entityType: 'QcTask', entityId: id, before, after: task }, meta, tx);
      return task;
    });
  }

  async addRolls(actor: Actor, id: string, rollIds: string[], meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.qcTask.findUnique({ where: { id } });
      if (!t) throw AppError.notFound('任务');
      if (t.status === 'COMPLETED' || t.status === 'CANCELLED') throw AppError.invalidState('任务已结束');
      await this.attachRolls(tx, id, rollIds);
      await this.audit.log(actor, { action: 'task.add_rolls', entityType: 'QcTask', entityId: id, after: { rollIds } }, meta, tx);
      return { ok: true };
    });
  }

  /** 任务内全部布卷完成时自动完成任务 */
  async completeIfDone(tx: Tx, taskId: string) {
    const open = await tx.qcTaskRoll.count({ where: { taskId, status: { not: 'DONE' } } });
    if (open === 0) await tx.qcTask.updateMany({ where: { id: taskId, status: { in: ['OPEN', 'IN_PROGRESS'] } }, data: { status: 'COMPLETED' } });
  }
}
