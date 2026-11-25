import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RoleCode, businessProgress, standardRulesSchema, templateContentSchema, type Pagination, type TaskStatus } from '@fabricqc/shared';
import type { z } from 'zod';
import type { createBusinessTaskSchema, createTaskSchema, updateTaskSchema, externalTaskSchema } from '@fabricqc/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AppError } from '../common/app-error';
import { businessNo, randomCode } from '../common/codes';
import { hasRole, MANAGE_TASKS, type Actor } from '../common/actor';
import type { RequestMeta } from '../common/decorators';
import { pageArgs, paged } from '../common/pagination';
import { AuditService } from '../audit/audit.service';
import { NotificationsService, OutboxEvent } from '../notifications/notifications.service';
import { MediaService } from '../media/media.service';
import { StandardsService } from '../standards/standards.service';
import { businessDepartments } from './business-access';
import { businessHomeFlags } from './business-home';
import { validateBusinessConfiguration } from './business-configuration';
import { AppConfig } from '../config/app-config';

type CreateTask = z.infer<typeof createTaskSchema>;
type UpdateTask = z.infer<typeof updateTaskSchema>;

const person = { select: { id: true, name: true, employeeNo: true } } as const;
const taskInclude = {
  assignee: person,
  reviewer: person,
  delivery: { select: { id: true, confirmedAt: true } },
  createdBy: person,
  department: { select: { id: true, name: true } },
  customer: { select: { id: true, code: true, name: true } },
  fourPointStandard: { select: { id: true, code: true, name: true, versions: { where: { status: 'PUBLISHED' }, select: { purpose: true, isDevDefault: true } } } },
  customerStandard: { select: { id: true, code: true, name: true, versions: { where: { status: 'PUBLISHED' }, select: { purpose: true, isDevDefault: true } } } },
  template: { select: { id: true, code: true, name: true, purpose: true } },
} satisfies Prisma.QcTaskInclude;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly standards: StandardsService,
    private readonly media: MediaService,
    @Optional() private readonly config?: AppConfig,
  ) {}
  private get isDemo() { return this.config?.env.DEMO_RUNTIME_MODE === 'demo'; }
  private presentTask<T extends Prisma.QcTaskGetPayload<{ include: typeof taskInclude }>>(task: T) {
    const standard = (s: typeof task.fourPointStandard | typeof task.customerStandard) => {
      if (!s || (!this.isDemo && s.versions.some(v => v.purpose === 'TEST' || v.isDevDefault))) return null;
      const { versions: _versions, ...rest } = s; return rest;
    };
    const fourPointStandard = standard(task.fourPointStandard), customerStandard = standard(task.customerStandard);
    const template = task.template && (this.isDemo || task.template.purpose !== 'TEST') ? { id: task.template.id, code: task.template.code, name: task.template.name } : null;
    return { ...task, fourPointStandardId: fourPointStandard?.id ?? null, customerStandardId: customerStandard?.id ?? null, templateId: template?.id ?? null, fourPointStandard, customerStandard, template };
  }

  private canManageTask(actor: Actor, task: { departmentId: string | null; supervisorId: string | null; reviewerId: string | null }): boolean {
    if (hasRole(actor, RoleCode.ADMIN, RoleCode.QUALITY_MANAGER)) return true;
    return actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR && (r.departmentId === null || (task.departmentId !== null && r.departmentId === task.departmentId) || task.supervisorId === actor.userId || task.reviewerId === actor.userId));
  }

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
    if (standardRulesSchema.parse(fp.rules).formalProfile === 'YONGSHENG_2026') throw AppError.badRequest('正式验布规则仅支持H订单流程');
    if (!this.isDemo && (fp.purpose !== 'FORMAL' || fp.isDevDefault)) throw AppError.badRequest('不能选择未确认的标准');
    if (d.customerStandardId) {
      const cs = await this.standards.currentVersion(tx, d.customerStandardId);
      if (!cs || cs.standard.kind !== 'CUSTOMER' || !cs.standard.isActive) {
        throw AppError.badRequest('客户标准不存在、未启用或没有已发布版本');
      }
      if (!this.isDemo && (cs.purpose !== 'FORMAL' || cs.isDevDefault)) throw AppError.badRequest('不能选择未确认的客户标准');
    }
    const tpl = await tx.inspectionTemplate.findUnique({ where: { id: d.templateId } });
    if (!tpl || !tpl.isActive) throw AppError.badRequest('检验模板不存在或已停用');
    if (!this.isDemo && tpl.purpose !== 'FORMAL') throw AppError.badRequest('不能选择未确认的模板');
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
    if (await tx.vcansOrderRoll.count({ where: { rollId: { in: unique } } })) throw AppError.invalidState('H订单布卷不能加入普通任务');
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

  async businessOptions(actor: Actor) {
    const departments = businessDepartments(actor);
    if (!departments.length) throw AppError.forbidden('没有明确业务部门授权');
    const [departmentRows, supervisors, standards, templates, fabrics] = await Promise.all([
      this.prisma.department.findMany({ where: { id: { in: departments } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.user.findMany({ where: { status: 'ACTIVE', roles: { some: { role: { code: RoleCode.QC_SUPERVISOR } } } }, select: { id: true, name: true, employeeNo: true }, orderBy: { name: 'asc' } }),
      this.prisma.qualityStandard.findMany({ where: { isActive: true, versions: { some: { status: 'PUBLISHED', ...(this.isDemo ? {} : { purpose: 'FORMAL', isDevDefault: false }) } } }, select: { id: true, name: true, code: true, kind: true, versions: { where: { status: 'PUBLISHED' }, orderBy: { version: 'desc' }, take: 1, select: { isDevDefault: true, rules: true, purpose: true } } }, orderBy: { name: 'asc' } }),
      this.prisma.inspectionTemplate.findMany({ where: { isActive: true, ...(this.isDemo ? {} : { purpose: 'FORMAL' }) }, select: { id: true, name: true, code: true, isActive: true, content: true }, orderBy: { name: 'asc' } }),
      this.prisma.fabric.findMany({ where: { isActive: true, ...(this.isDemo ? {} : { purpose: 'FORMAL' }) }, select: { id: true, code: true, nameZh: true }, orderBy: { code: 'asc' } }),
    ]);
    return { departments: departmentRows, supervisors, standards: standards.filter(({ versions }) => this.isDemo || (versions[0]?.purpose === 'FORMAL' && !versions[0].isDevDefault)).map(({ versions, ...standard }) => ({ ...standard, currentVersion: versions[0] ? { isDevDefault: versions[0].isDevDefault, applicability: standardRulesSchema.parse(versions[0].rules).applicability ?? null } : null })), templates: templates.map(({ content, ...template }) => ({ ...template, applicability: templateContentSchema.parse(content).applicability ?? null })), fabrics };
  }

  async confirmDelivery(actor: Actor, id: string, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${id}::uuid FOR UPDATE`;
      const task = await tx.qcTask.findUnique({ where: { id }, include: { vcansOrder: { select: { id: true } }, delivery: true, rolls: { include: { roll: { include: { fabric: true, lot: true } }, inspections: { where: { status: { not: 'VOIDED' } }, orderBy: { createdAt: 'desc' }, take: 1, include: { revisions: true, reviews: true, inspector: { select: { id: true, name: true, employeeNo: true } } } } } } } });
      if (!task || task.origin !== 'BUSINESS') throw AppError.notFound('业务任务');
      if (task.vcansOrder) throw AppError.invalidState('H订单请通过整单确认入口完成');
      if (task.supervisorId !== actor.userId || !hasRole(actor, RoleCode.QC_SUPERVISOR)) throw AppError.forbidden('仅指定主管可确认整单');
      if (task.delivery) return { id: task.delivery.id, taskId: id, confirmedAt: task.delivery.confirmedAt, replayed: true };
      if (task.status === 'CANCELLED' || !task.assigneeId || !task.plannedRollCount || task.rolls.length !== task.plannedRollCount) throw AppError.invalidState('登记卷数未达到计划数或任务未分发');
      const checked = task.rolls.map((tr) => {
        const i = tr.inspections[0];
        if (!i || i.status !== 'APPROVED' || i.inspectorId === actor.userId) throw AppError.invalidState('存在未审核或本人检验的布卷，不能确认');
        const revision = i.revisions.find((r) => r.revision === i.revision);
        const review = i.reviews.find((r) => r.revision === i.revision && r.decision === 'APPROVE' && r.reviewerId !== i.inspectorId);
        if (!revision || !review) throw AppError.invalidState('检验修订或审核记录不完整');
        const snapshot = revision.snapshot as { photos?: { objectKey?: string; thumbKey?: string | null }[] };
        if (!Array.isArray(snapshot.photos) || snapshot.photos.some((p) => !p.objectKey?.startsWith('frozen-inspections/') || (p.thumbKey && !p.thumbKey.startsWith('frozen-inspections/')))) throw AppError.invalidState('检验照片未冻结');
        return { tr, i, revision, review };
      });
      const safeJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
      const delivery = await tx.qcTaskDelivery.create({ data: { taskId: id, confirmedById: actor.userId, plannedRollCount: task.plannedRollCount,
        snapshot: safeJson({ taskNo: task.taskNo, title: task.title, plannedRollCount: task.plannedRollCount, businessDepartmentId: task.businessDepartmentId }),
        items: { create: checked.map(({ tr, i, revision, review }) => ({ taskRollId: tr.id, rollId: tr.rollId, inspectionId: i.id, revision: i.revision, inspectionRevisionId: revision.id, reviewId: review.id,
          snapshot: safeJson({ roll: tr.roll, inspector: i.inspector, spec: i.specSnapshot, standards: i.standardSnapshot, template: i.templateSnapshot, inspection: revision.snapshot, review: { decision: review.decision, comment: review.comment, isConcession: review.isConcession }, overallResult: i.overallResult }) })) } } });
      await tx.qcTask.update({ where: { id }, data: { status: 'COMPLETED' } });
      await this.notifications.notifyInApp(tx, { userIds: [task.createdById], type: 'TASK_DELIVERED', title: '验布任务结果已确认', body: task.title, entityType: 'QcTask', entityId: id });
      await this.notifications.enqueue(tx, OutboxEvent.TASK_DELIVERED, `task-delivered:${delivery.id}`, { deliveryId: delivery.id, recipientIds: [task.createdById] });
      await this.audit.log(actor, { action: 'task.business_deliver', entityType: 'QcTask', entityId: id, after: { deliveryId: delivery.id } }, meta, tx);
      return { id: delivery.id, taskId: id, confirmedAt: delivery.confirmedAt, replayed: false };
    });
  }

  async businessNotificationStatus(actor: Actor, id: string) {
    const task = await this.prisma.qcTask.findUnique({ where: { id }, include: { delivery: true } });
    if (!task || task.origin !== 'BUSINESS' || task.createdById !== actor.userId || !task.businessDepartmentId || !actor.roles.some((r) => r.role === RoleCode.SALES && r.departmentId === task.businessDepartmentId)) throw AppError.forbidden('无权查看该通知状态');
    if (!task.delivery) return { status: 'NOT_TRIGGERED', reason: null };
    const outbox = await this.prisma.notificationOutbox.findUnique({ where: { dedupeKey: `task-delivered:${task.delivery.id}` }, include: { deliveries: { where: { userId: actor.userId }, orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!outbox) return { status: 'UNKNOWN', reason: null };
    const result = outbox.deliveries[0];
    return result ? { status: result.status, reason: result.errorCode } : { status: outbox.status === 'FAILED' ? 'FAILED' : 'PENDING', reason: outbox.status === 'FAILED' ? 'DELIVERY_FAILED' : null };
  }

  async getDelivery(actor: Actor, id: string) {
    const task = await this.prisma.qcTask.findUnique({ where: { id }, include: { delivery: { include: { items: true } } } });
    if (!task || task.origin !== 'BUSINESS' || !task.businessDepartmentId || !businessDepartments(actor).includes(task.businessDepartmentId)) throw AppError.forbidden('没有该任务业务部门权限');
    if (!task.delivery) throw AppError.invalidState('整单尚未确认');
    const items = await Promise.all(task.delivery.items.map(async (item) => {
      const snapshot = item.snapshot as unknown as { inspection: { photos: { objectKey: string; thumbKey?: string | null; [key: string]: unknown }[] }; [key: string]: unknown };
      const photos = await Promise.all(snapshot.inspection.photos.map(async ({ objectKey, thumbKey, ...p }) => ({ ...p, ...(await this.media.urls({ objectKey, thumbKey: thumbKey ?? null })) })));
      return { ...snapshot, inspection: { ...snapshot.inspection, photos } };
    }));
    return { id: task.delivery.id, taskId: id, confirmedAt: task.delivery.confirmedAt, task: task.delivery.snapshot, items };
  }

  async remindBusiness(actor: Actor, id: string, idempotencyKey: string, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${id}::uuid FOR UPDATE`;
      const task = await tx.qcTask.findUnique({ where: { id }, include: { vcansOrder: { select: { id: true } }, delivery: true, rolls: { select: { inspections: { where: { status: { not: 'VOIDED' } }, orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } } } } } });
      if (!task || task.origin !== 'BUSINESS') throw AppError.notFound('业务任务');
      if (task.vcansOrder) throw AppError.invalidState('H订单请通过订单催审入口操作');
      if (!actor.roles.some((r) => r.role === RoleCode.SALES && r.departmentId !== null && r.departmentId === task.businessDepartmentId)) throw AppError.forbidden('无本部门催审权限');
      const dedupeKey = `reminder:${idempotencyKey}`;
      const existing = await tx.qcReviewReminder.findUnique({ where: { dedupeKey } });
      if (existing) {
        if (existing.taskId !== id || existing.requesterId !== actor.userId) throw AppError.conflict('幂等键已使用');
        return { accepted: true, reminderId: existing.id };
      }
      if (task.delivery || !task.supervisorId || task.status === 'CANCELLED') throw AppError.invalidState('任务已结束，不能催审');
      const statuses = task.rolls.map((r) => r.inspections[0]?.status ?? null);
      const pending = statuses.includes('SUBMITTED');
      const finalPending = task.plannedRollCount !== null && statuses.length === task.plannedRollCount && statuses.every((s) => s === 'APPROVED');
      if (!pending && !finalPending) throw AppError.invalidState('暂无待审核或待整单确认记录');
      const last = await tx.qcReviewReminder.findFirst({ where: { taskId: id }, orderBy: { createdAt: 'desc' } });
      if (last && Date.now() - last.createdAt.getTime() < 300000) throw AppError.conflict('催审过于频繁，请稍后再试');
      const reminder = await tx.qcReviewReminder.create({ data: { taskId: id, requesterId: actor.userId, supervisorId: task.supervisorId, dedupeKey } });
      await this.notifications.notifyInApp(tx, { userIds: [task.supervisorId], type: 'BUSINESS_REVIEW_REMINDER', title: '验布任务待审核', body: task.title, entityType: 'QcTask', entityId: id, pagePath: `/pages/task/index?id=${id}` });
      await this.audit.log(actor, { action: 'task.business_remind', entityType: 'QcTask', entityId: id, after: { reminderId: reminder.id } }, meta, tx);
      return { accepted: true, reminderId: reminder.id };
    });
  }

  async registerBusinessRolls(actor: Actor, id: string, input: { fabricId: string; rolls: { rollNo: string; nominalLengthM?: number | null }[] }, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${id}::uuid FOR UPDATE`;
      const task = await tx.qcTask.findUnique({ where: { id }, include: { vcansOrder: { select: { id: true } }, delivery: true, _count: { select: { rolls: true } } } });
      if (!task || task.origin !== 'BUSINESS') throw AppError.notFound('业务任务');
      if (task.vcansOrder) throw AppError.invalidState('H订单请通过缸卷登记入口操作');
      if (task.assigneeId !== actor.userId) throw AppError.forbidden('只能为分配给自己的任务登记卷号');
      if (task.delivery || task.status === 'CANCELLED' || task.status === 'COMPLETED') throw AppError.invalidState('任务已结束或交付');
      if (!task.plannedRollCount || task._count.rolls + input.rolls.length > task.plannedRollCount) throw AppError.conflict('登记卷数超过计划数');
      const numbers = input.rolls.map((r) => r.rollNo);
      if (new Set(numbers).size !== numbers.length || await tx.fabricRoll.count({ where: { rollNo: { in: numbers } } })) throw AppError.conflict('卷号重复或已存在');
      const fabric = await tx.fabric.findUnique({ where: { id: input.fabricId } });
      if (!fabric?.isActive) throw AppError.badRequest('面料不存在或未启用');
      if (!this.isDemo && fabric.purpose !== 'FORMAL') throw AppError.badRequest('不能选择未确认的面料');
      const items: { taskRollId: string; rollId: string; rollNo: string }[] = [];
      for (const r of input.rolls) {
        let code = '';
        for (let n = 0; n < 10; n++) { const candidate = randomCode(10); if (!(await tx.fabricRoll.findUnique({ where: { qrCode: candidate } }))) { code = candidate; break; } }
        if (!code) throw AppError.conflict('无法生成布卷标识');
        const roll = await tx.fabricRoll.create({ data: { rollNo: r.rollNo, qrCode: code, fabricId: input.fabricId, nominalLengthM: r.nominalLengthM ?? null, createdById: actor.userId, status: 'ASSIGNED' } });
        const tr = await tx.qcTaskRoll.create({ data: { taskId: id, rollId: roll.id } });
        items.push({ taskRollId: tr.id, rollId: roll.id, rollNo: roll.rollNo });
      }
      await this.audit.log(actor, { action: 'task.business_register_rolls', entityType: 'QcTask', entityId: id, after: { items } }, meta, tx);
      return { items };
    });
  }

  async businessProgress(actor: Actor, id: string) {
    const { items } = await this.listBusiness(actor);
    const item = items.find((task) => task.id === id);
    if (!item) throw AppError.forbidden('没有该任务业务部门权限');
    return item;
  }

  async listBusiness(actor: Actor) {
    const departments = businessDepartments(actor);
    if (!departments.length) return { items: [] };
    const tasks = await this.prisma.qcTask.findMany({
      where: { origin: 'BUSINESS', businessDepartmentId: { in: departments }, vcansOrder: null, ...(this.isDemo ? {} : { purpose: { not: 'TEST' } }) },
      select: { id: true, taskNo: true, title: true, businessDepartmentId: true, plannedRollCount: true, assigneeId: true, supervisorId: true, createdById: true, status: true, createdAt: true, supervisor: { select: { id: true, name: true } },
        delivery: { select: { id: true } }, rolls: { select: { inspections: { where: { status: { not: 'VOIDED' } }, orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, revision: true } } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return { items: tasks.map((t) => {
      if (!t.plannedRollCount) throw AppError.invalidState('任务计划卷数缺失');
      const statuses = t.rolls.map((r) => {
        const i = r.inspections[0];
        if (!i) return null;
        if (['SUBMITTED', 'APPROVED', 'REJECTED'].includes(i.status) && i.revision <= 0) throw AppError.invalidState('检验提交修订异常');
        return i.status as 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RETURNED';
      });
      const counts = businessProgress(t.plannedRollCount, statuses);
      const flags = businessHomeFlags({ status: t.status, delivered: Boolean(t.delivery), assigned: Boolean(t.assigneeId), hasSupervisor: Boolean(t.supervisorId), planned: t.plannedRollCount, statuses });
      return { id: t.id, taskNo: t.taskNo, title: t.title, businessDepartmentId: t.businessDepartmentId, plannedRollCount: t.plannedRollCount,
        assigned: Boolean(t.assigneeId), supervisorId: t.supervisorId, supervisor: t.supervisor, createdById: t.createdById, status: t.status, createdAt: t.createdAt, delivered: Boolean(t.delivery), ...counts, ...flags };
    }) };
  }

  async assignBusiness(actor: Actor, id: string, input: { assigneeId: string; reason?: string }, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${id}::uuid FOR UPDATE`;
      const task = await tx.qcTask.findUnique({ where: { id }, include: { delivery: true, vcansOrder: { select: { id: true } } } });
      if (!task || task.origin !== 'BUSINESS') throw AppError.notFound('业务任务');
      if (task.vcansOrder) throw AppError.invalidState('H订单请通过订单分发入口改派');
      if (task.supervisorId !== actor.userId || !hasRole(actor, RoleCode.QC_SUPERVISOR)) throw AppError.forbidden('仅指定质检主管可分发');
      if (task.delivery || task.status === 'CANCELLED') throw AppError.invalidState('任务已交付或取消，不能分发');
      if (input.assigneeId === task.supervisorId) throw AppError.badRequest('指定主管不能兼任跟单员');
      const assignee = await this.userWithRoles(tx, input.assigneeId);
      if (!assignee || assignee.status !== 'ACTIVE' || !assignee.roles.some((r) => r.role.code === RoleCode.INSPECTOR)) throw AppError.badRequest('跟单员不存在、已停用或没有质检员权限');
      if (task.assigneeId === input.assigneeId) return { id, assigneeId: input.assigneeId };
      const drafts = await tx.rollInspection.count({ where: { taskId: id, status: { in: ['DRAFT', 'RETURNED'] } } });
      if (drafts) throw AppError.invalidState('存在进行中或退回的草稿，请先处理后改派');
      await tx.qcTask.update({ where: { id }, data: { assigneeId: input.assigneeId } });
      await tx.qcTaskAssignmentEvent.create({ data: { taskId: id, actorId: actor.userId, fromAssigneeId: task.assigneeId, toAssigneeId: input.assigneeId, reason: input.reason } });
      await this.notifications.notifyInApp(tx, { userIds: [input.assigneeId], type: 'TASK_ASSIGNED', title: '新的验布任务', body: task.title, entityType: 'QcTask', entityId: id, pagePath: `/pages/task/index?id=${id}` });
      await this.audit.log(actor, { action: 'task.business_assign', entityType: 'QcTask', entityId: id, after: { from: task.assigneeId, to: input.assigneeId } }, meta, tx);
      return { id, assigneeId: input.assigneeId };
    });
  }

  async createBusiness(actor: Actor, d: z.infer<typeof createBusinessTaskSchema>, meta: RequestMeta) {
    if (!businessDepartments(actor).includes(d.businessDepartmentId)) throw AppError.forbidden('没有该业务部门的建单权限');
    return this.prisma.$transaction(async (tx) => {
      const supervisor = await this.userWithRoles(tx, d.supervisorId);
      if (!supervisor || supervisor.status !== 'ACTIVE' || !supervisor.roles.some((r) => r.role.code === RoleCode.QC_SUPERVISOR)) throw AppError.badRequest('质检主管不存在、已停用或无主管权限');
      const fp = await this.standards.currentVersion(tx, d.fourPointStandardId);
      if (!fp || fp.standard.kind !== 'FOUR_POINT' || !fp.standard.isActive) throw AppError.badRequest('四分制标准不可用');
      if (standardRulesSchema.parse(fp.rules).formalProfile === 'YONGSHENG_2026') throw AppError.badRequest('正式验布规则仅支持H订单流程');
      if (!this.isDemo && (fp.purpose !== 'FORMAL' || fp.isDevDefault)) throw AppError.badRequest('不能选择未确认的标准');
      const cs = d.customerStandardId ? await this.standards.currentVersion(tx, d.customerStandardId) : null;
      if (d.customerStandardId) {
        if (!cs || cs.standard.kind !== 'CUSTOMER' || !cs.standard.isActive) throw AppError.badRequest('客户标准不可用');
        if (!this.isDemo && (cs.purpose !== 'FORMAL' || cs.isDevDefault)) throw AppError.badRequest('不能选择未确认的客户标准');
      }
      const template = await tx.inspectionTemplate.findUnique({ where: { id: d.templateId } });
      if (!template?.isActive) throw AppError.badRequest('检验模板不存在或未启用');
      if (!this.isDemo && template.purpose !== 'FORMAL') throw AppError.badRequest('不能选择未确认的模板');
      validateBusinessConfiguration(template.content, [fp.rules, ...(cs ? [cs.rules] : [])]);
      if (d.customerId && !(await tx.customer.findUnique({ where: { id: d.customerId } }))) throw AppError.badRequest('客户不存在');
      const task = await tx.qcTask.create({ data: {
        taskNo: businessNo('T'), title: d.title, origin: 'BUSINESS', businessDepartmentId: d.businessDepartmentId,
        supervisorId: d.supervisorId, plannedRollCount: d.plannedRollCount, assigneeId: null, reviewerId: d.supervisorId,
        customerId: d.customerId ?? null, fourPointStandardId: d.fourPointStandardId, customerStandardId: d.customerStandardId ?? null,
        templateId: d.templateId, defaultMode: d.defaultMode ?? null, defaultScope: d.defaultScope,
        dueAt: d.dueAt ?? null, notes: d.notes, createdById: actor.userId,
      } });
      await this.notifications.notifyInApp(tx, { userIds: [d.supervisorId], type: 'BUSINESS_TASK', title: '待分发验布任务', body: task.title, entityType: 'QcTask', entityId: task.id, pagePath: `/pages/task/index?id=${task.id}` });
      await this.audit.log(actor, { action: 'task.business_create', entityType: 'QcTask', entityId: task.id, after: task }, meta, tx);
      return { id: task.id, taskNo: task.taskNo };
    });
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

  async externalReviewers(actor: Actor) {
    return this.prisma.user.findMany({
      where: { id: { not: actor.userId }, status: 'ACTIVE', roles: { some: { OR: [{ role: { code: 'QUALITY_MANAGER' } }, { role: { code: 'QC_SUPERVISOR' }, OR: [{ departmentId: null }, ...(actor.departmentId ? [{ departmentId: actor.departmentId }] : [])] }] } } },
      select: { id: true, name: true, employeeNo: true }, orderBy: { name: 'asc' },
    });
  }

  async createExternal(actor: Actor, d: z.infer<typeof externalTaskSchema>, meta: RequestMeta) {
    if (!hasRole(actor, RoleCode.INSPECTOR)) throw AppError.forbidden('需要质检员权限');
    return this.prisma.$transaction(async tx => {
      const existing = await tx.fabricRoll.findMany({ where: { rollNo: { in: d.rolls.map(r => r.rollNo) } }, select: { rollNo: true } });
      if (existing.length) throw AppError.conflict(`卷号已存在，请联系管理员核对：${existing.map(r => r.rollNo).join('、')}`);
      const fabric = await tx.fabric.findUnique({ where: { id: d.fabricId } });
      if (!fabric || !fabric.isActive) throw AppError.badRequest('面料不存在或已停用');
      if (!this.isDemo && fabric.purpose !== 'FORMAL') throw AppError.badRequest('不能选择未确认的面料');
      const taskData: CreateTask = { title: d.title, assigneeId: actor.userId, reviewerId: d.reviewerId,
        fourPointStandardId: d.fourPointStandardId, customerStandardId: d.customerStandardId,
        templateId: d.templateId, defaultScope: 'FULL', rollIds: [], notes: `外厂：${d.factoryName}${d.notes ? `\n${d.notes}` : ''}` };
      const assignee = await this.validate(tx, taskData);
      const reviewer = await this.userWithRoles(tx, d.reviewerId);
      const inScope = reviewer?.roles.some(r => r.role.code === RoleCode.QUALITY_MANAGER || (r.role.code === RoleCode.QC_SUPERVISOR && (r.departmentId === null || r.departmentId === assignee.departmentId)));
      if (!inScope) throw AppError.forbidden('审核主管不在你的部门范围内');
      const ids: string[] = [];
      for (const roll of d.rolls) {
        let code = '';
        for (let i = 0; i < 10; i++) { const candidate = randomCode(10); if (!(await tx.fabricRoll.findUnique({ where: { qrCode: candidate } }))) { code = candidate; break; } }
        if (!code) throw AppError.conflict('无法生成布卷标识，请重试');
        const created = await tx.fabricRoll.create({ data: { rollNo: roll.rollNo, qrCode: code, fabricId: d.fabricId, nominalLengthM: roll.nominalLengthM ?? null, notes: `外厂：${d.factoryName}`, createdById: actor.userId } });
        ids.push(created.id);
        await this.audit.log(actor, { action: 'roll.external_create', entityType: 'FabricRoll', entityId: created.id, after: created }, meta, tx);
      }
      const task = await tx.qcTask.create({ data: { taskNo: businessNo('T'), title: d.title, departmentId: assignee.departmentId, assigneeId: actor.userId, reviewerId: d.reviewerId, defaultScope: 'FULL', fourPointStandardId: d.fourPointStandardId, customerStandardId: d.customerStandardId, templateId: d.templateId, notes: taskData.notes, createdById: actor.userId } });
      await this.attachRolls(tx, task.id, ids);
      await this.audit.log(actor, { action: 'task.external_create', entityType: 'QcTask', entityId: task.id, after: { task, rollIds: ids, factoryName: d.factoryName } }, meta, tx);
      return { id: task.id, taskNo: task.taskNo };
    });
  }

  private scopeWhere(actor: Actor): Prisma.QcTaskWhereInput {
    if (hasRole(actor, RoleCode.ADMIN, RoleCode.QUALITY_MANAGER)) return {};
    const roles = actor.roles.filter((role) => role.role === RoleCode.QC_SUPERVISOR);
    const globalSupervisor = roles.some((role) => role.departmentId === null);
    const departments = roles.flatMap((role) => role.departmentId ? [role.departmentId] : []);
    const legacy: Prisma.QcTaskWhereInput = globalSupervisor ? { vcansOrder: null } : { AND: [
      { vcansOrder: null },
      { OR: [{ assigneeId: actor.userId }, ...(roles.length ? [{ supervisorId: actor.userId }, { reviewerId: actor.userId }, { departmentId: { in: departments } }] : [])] },
    ] };
    return { OR: [
      legacy,
      ...(roles.length ? [{ vcansOrder: { supervisorId: actor.userId } }] : []),
      ...(hasRole(actor, RoleCode.INSPECTOR) ? [{ vcansOrder: { assignedInspectorId: actor.userId } }] : []),
    ] };
  }

  async list(actor: Actor, p: Pagination & { status?: TaskStatus; assigneeId?: string }) {
    if (!hasRole(actor, ...MANAGE_TASKS, RoleCode.INSPECTOR)) throw AppError.forbidden('没有质检任务权限');
    const where: Prisma.QcTaskWhereInput = {
      ...(this.isDemo ? {} : { purpose: { not: 'TEST' }, OR: [{ vcansOrder: null }, { vcansOrder: { purpose: { not: 'TEST' } } }] }),
      AND: [this.scopeWhere(actor), ...(p.q ? [{ OR: [{ taskNo: { contains: p.q, mode: 'insensitive' as const } }, { title: { contains: p.q, mode: 'insensitive' as const } }] }] : [])],
      ...(p.status ? { status: p.status } : {}),
      ...(p.assigneeId ? { assigneeId: p.assigneeId } : {}),
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
        ...this.presentTask(t),
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
      where: { assigneeId: actor.userId, status: { in: ['OPEN', 'IN_PROGRESS'] }, ...(this.isDemo ? {} : { purpose: { not: 'TEST' }, OR: [{ vcansOrder: null }, { vcansOrder: { purpose: { not: 'TEST' } } }] }) },
      include: { ...taskInclude, rolls: { select: { status: true } } },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    return tasks.map(({ rolls, ...t }) => ({
      ...this.presentTask(t),
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
        vcansOrder: { select: { supervisorId: true } },
        rolls: {
          orderBy: { createdAt: 'asc' },
          include: {
            roll: {
              include: { fabric: { select: { id: true, code: true, nameZh: true, purpose: true } }, lot: { select: { lotNo: true } }, vcansOrderRoll: { select: { lot: { select: { line: { select: { productCode: true, productName: true, specification: true, color: true } } } } } } },
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
    const admin = hasRole(actor, RoleCode.ADMIN, RoleCode.QUALITY_MANAGER);
    const supervisor = actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR && (r.departmentId === null || r.departmentId === t.departmentId || t.supervisorId === actor.userId || t.reviewerId === actor.userId));
    if (t.vcansOrder && !admin && !(t.vcansOrder.supervisorId === actor.userId && hasRole(actor, RoleCode.QC_SUPERVISOR)) && t.assigneeId !== actor.userId) throw AppError.forbidden();
    if (!t.vcansOrder && !admin && !supervisor && t.assigneeId !== actor.userId) throw AppError.forbidden();
    return {
      ...this.presentTask(t),
      rolls: t.rolls.map((tr) => ({
        taskRollId: tr.id,
        status: tr.status,
        roll: { ...tr.roll, ...(!this.isDemo && tr.roll.fabric?.purpose === 'TEST' ? { fabric: null, fabricId: null } : {}), orderLine: tr.roll.vcansOrderRoll?.lot.line ?? null },
        latestInspection: tr.inspections[0] ?? null,
      })),
    };
  }

  async update(actor: Actor, id: string, d: UpdateTask, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${id}::uuid FOR UPDATE`;
      const before = await tx.qcTask.findUnique({ where: { id }, include: { rolls: true } });
      if (!before) throw AppError.notFound('任务');
      if (!this.canManageTask(actor, before)) throw AppError.forbidden('不在你的任务管理范围');
      if (before.origin === 'BUSINESS') throw AppError.invalidState('业务任务请使用专用分发接口，已交付任务不能修改');
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
      await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${id}::uuid FOR UPDATE`;
      const t = await tx.qcTask.findUnique({ where: { id } });
      if (!t) throw AppError.notFound('任务');
      if (!this.canManageTask(actor, t)) throw AppError.forbidden('不在你的任务管理范围');
      if (t.origin === 'BUSINESS') throw AppError.invalidState('业务任务请使用专用补卷接口，已交付任务不能增卷');
      if (t.status === 'COMPLETED' || t.status === 'CANCELLED') throw AppError.invalidState('任务已结束');
      await this.attachRolls(tx, id, rollIds);
      await this.audit.log(actor, { action: 'task.add_rolls', entityType: 'QcTask', entityId: id, after: { rollIds } }, meta, tx);
      return { ok: true };
    });
  }

  /** 任务内全部布卷完成时自动完成任务 */
  async completeIfDone(tx: Tx, taskId: string) {
    const task = await tx.qcTask.findUniqueOrThrow({ where: { id: taskId }, select: { origin: true, plannedRollCount: true, _count: { select: { rolls: true } } } });
    if (task.origin === 'BUSINESS') return;
    const open = await tx.qcTaskRoll.count({ where: { taskId, status: { not: 'DONE' } } });
    if (open === 0) await tx.qcTask.updateMany({ where: { id: taskId, status: { in: ['OPEN', 'IN_PROGRESS'] } }, data: { status: 'COMPLETED' } });
  }
}
