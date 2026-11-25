import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DECISION_LABELS, ErrorCode, RoleCode, standardRulesSchema, type ReviewDecision } from '@fabricqc/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app-error';
import { hasRole, REVIEWERS, type Actor } from '../common/actor';
import type { RequestMeta } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { InspectionAccess } from '../inspections/inspection-access';
import { NotificationsService, OutboxEvent } from '../notifications/notifications.service';
import { TasksService } from '../tasks/tasks.service';
import { formalReviewEligibility } from './formal-review';
import { scoreUnitFromSnapshot } from '../quality/score-unit';
import { AppConfig } from '../config/app-config';

const STATUS_AFTER = { APPROVE: 'APPROVED', RETURN: 'RETURNED', REJECT: 'REJECTED' } as const;
const ROLL_AFTER = { APPROVE: 'PASSED', RETURN: 'RETURNED', REJECT: 'FAILED' } as const;
const TASK_ROLL_AFTER = { APPROVE: 'DONE', RETURN: 'RETURNED', REJECT: 'DONE' } as const;

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: InspectionAccess,
    private readonly notifications: NotificationsService,
    private readonly tasks: TasksService,
    @Optional() private readonly config?: AppConfig,
  ) {}
  private get isDemo() { return this.config?.env.DEMO_RUNTIME_MODE === 'demo'; }

  private summaryInclude = {
    roll: { select: { id: true, rollNo: true, fabric: { select: { code: true, nameZh: true, purpose: true } } } },
    inspector: { select: { id: true, name: true, employeeNo: true } },
    task: { select: { id: true, taskNo: true, title: true } },
    _count: { select: { defects: true } },
  } satisfies Prisma.RollInspectionInclude;

  /** 我的审核待办（小程序审核中心） */
  async myPending(actor: Actor) {
    const rows = await this.prisma.reviewAssignment.findMany({
      where: { assigneeId: actor.userId, status: 'PENDING', inspection: { status: 'SUBMITTED', ...(this.isDemo ? {} : { task: { purpose: { not: 'TEST' }, OR: [{ vcansOrder: null }, { vcansOrder: { purpose: { not: 'TEST' } } }] } }), ...(hasRole(actor, RoleCode.QUALITY_MANAGER) ? {} : { OR: [{ task: { vcansOrder: null } }, { task: { vcansOrder: { supervisorId: actor.userId } } }] }) } },
      include: { inspection: { include: this.summaryInclude } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.summary(r.inspection));
  }

  /** 审核队列：授权范围内全部待审核记录（PC 审核中心） */
  async queue(actor: Actor) {
    if (!hasRole(actor, ...REVIEWERS)) throw AppError.forbidden();
    const isManager = hasRole(actor, RoleCode.QUALITY_MANAGER);
    const supDepts = actor.roles.filter((r) => r.role === RoleCode.QC_SUPERVISOR).map((r) => r.departmentId);
    const global = isManager || supDepts.includes(null);
    const depts = supDepts.filter((d): d is string => d !== null);
    const where: Prisma.RollInspectionWhereInput = {
      ...(this.isDemo ? {} : { task: { purpose: { not: 'TEST' }, OR: [{ vcansOrder: null }, { vcansOrder: { purpose: { not: 'TEST' } } }] } }),
      status: 'SUBMITTED',
      inspectorId: { not: actor.userId },
      ...(isManager ? {} : { AND: [{ OR: [{ task: { vcansOrder: null } }, { task: { vcansOrder: { supervisorId: actor.userId } } }] }] }),
      ...(global
        ? {}
        : {
            OR: [
              { task: { departmentId: { in: depts } } },
              { task: { departmentId: null }, inspector: { departmentId: { in: depts } } },
              { reviewAssignments: { some: { assigneeId: actor.userId, status: 'PENDING' } } },
            ],
          }),
    };
    const rows = await this.prisma.rollInspection.findMany({ where, include: this.summaryInclude, orderBy: { submittedAt: 'asc' } });
    return rows.map((r) => this.summary(r));
  }

  private summary(i: Prisma.RollInspectionGetPayload<{ include: ReviewsService['summaryInclude'] }>) {
    return {
      id: i.id,
      inspectionNo: i.inspectionNo,
      revision: i.revision,
      mode: i.mode,
      scope: i.scope,
      roll: { ...i.roll, fabric: !this.isDemo && i.roll.fabric?.purpose === 'TEST' ? null : i.roll.fabric },
      inspector: i.inspector,
      task: i.task,
      overallResult: i.overallResult,
      fourPointResult: i.fourPointResult,
      customerResult: i.customerResult,
      normalizedPoints: i.normalizedPoints,
      scoreUnit: scoreUnitFromSnapshot(i.resultSnapshot),
      totalPoints: i.totalPoints,
      defectCount: i._count.defects,
      submittedAt: i.submittedAt,
    };
  }

  /**
   * 审核决定。revision 必须与当前修订一致（防止审核过期页面）；
   * 同一修订只能有一个结论（数据库唯一约束兜底）。
   */
  async decide(
    actor: Actor,
    inspectionId: string,
    input: { decision: ReviewDecision; revision: number; comment?: string | null; finalResult?: 'PASS' | 'FAIL' | null; finalReason?: string | null },
    meta: RequestMeta,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.rollInspection.findUnique({ where: { id: inspectionId }, select: { taskId: true, task: { select: { vcansOrder: { select: { id: true, supervisorId: true } } } } } });
      if (!target) throw AppError.notFound('检验记录');
      if (target.task.vcansOrder) await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${target.task.vcansOrder.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${target.taskId}::uuid FOR UPDATE`;
      const ref = await this.access.load(inspectionId, tx);
      if (!ref) throw AppError.notFound('检验记录');
      if (ref.status !== 'SUBMITTED') throw AppError.invalidState('该检验不是待审核状态，可能已被其他主管审核');
      if (ref.revision !== input.revision) {
        throw AppError.of(ErrorCode.VERSION_CONFLICT, '检验已重新提交，请刷新后再审核', 409, { revision: ref.revision });
      }
      if (ref.inspectorId === actor.userId) throw AppError.forbidden('不能审核自己的检验');
      if (!(await this.access.canReview(actor, ref, tx))) throw AppError.forbidden('不在你的审核范围内');

      const i = await tx.rollInspection.findUniqueOrThrow({
        where: { id: inspectionId },
        include: { roll: true, task: { include: { delivery: true } } },
      });
      if (i.task.origin === 'BUSINESS' && i.task.delivery) throw AppError.invalidState('整单已交付，不能修改审核结果');
      const snapshot = i.standardSnapshot as unknown as { ruleSource?: string; fourPoint?: { rules?: unknown }; customer?: { rules?: unknown } | null };
      const rawRules = (snapshot?.ruleSource === 'CUSTOMER' ? snapshot.customer?.rules : snapshot?.fourPoint?.rules) as { formalProfile?: unknown } | undefined;
      if (snapshot?.ruleSource === 'CUSTOMER' && !rawRules) throw AppError.invalidState('客户标准冻结规则缺失');
      const parsedRules = standardRulesSchema.safeParse(rawRules);
      if (rawRules?.formalProfile === 'YONGSHENG_2026' && !parsedRules.success) throw AppError.invalidState('正式标准冻结规则不完整');
      const formal = parsedRules.success && parsedRules.data.formalProfile === 'YONGSHENG_2026';
      const frozenChecks = (i.resultSnapshot as unknown as { fourPoint?: { checks?: { code?: string; status?: string }[] } } | null)?.fourPoint?.checks;
      if (formal && (!Array.isArray(frozenChecks) || !frozenChecks.some(check => check.code === 'MAX_NORMALIZED_POINTS') || frozenChecks.some(check => !check.code || !['PASS', 'FAIL', 'INCONCLUSIVE'].includes(check.status ?? '')))) throw AppError.invalidState('正式检验冻结判定资料不完整');
      const eligibility = formal ? formalReviewEligibility(i.resultSnapshot as never) : null;
      if (input.finalResult || input.finalReason) {
        if (!formal || !target.task.vcansOrder || target.task.vcansOrder.supervisorId !== actor.userId || !hasRole(actor, RoleCode.QC_SUPERVISOR) || input.decision !== 'APPROVE' || !input.finalResult || !input.finalReason?.trim() || !eligibility?.required || (input.finalResult === 'PASS' && !eligibility.allowed)) throw AppError.forbidden('该检验不允许此质量复核结论');
      } else if (formal && input.decision === 'APPROVE' && eligibility?.required) throw AppError.badRequest('请填写主管质量复核结论和原因');
      const isConcession = i.task.origin === 'LEGACY' && input.decision === 'APPROVE' && i.overallResult !== 'PASS';
      if (isConcession && (!input.comment || input.comment.trim().length < 2)) {
        throw AppError.badRequest('系统判定不是"合格"，审核通过（让步接收）必须填写理由');
      }

      const review = await tx.qcReview.create({
        data: {
          inspectionId,
          revision: input.revision,
          reviewerId: actor.userId,
          decision: input.decision,
          comment: input.comment ?? null,
          isConcession,
          finalResult: input.finalResult ?? null,
          finalReason: input.finalReason?.trim() ?? null,
        },
      });
      const now = new Date();
      const updated = await tx.rollInspection.updateMany({
        where: { id: inspectionId, status: 'SUBMITTED', revision: input.revision },
        data: { status: STATUS_AFTER[input.decision], decidedAt: input.decision === 'RETURN' ? null : now },
      });
      if (updated.count !== 1) throw AppError.conflict('检验状态已变化，请刷新');
      if (target.task.vcansOrder && input.decision === 'APPROVE') {
        const selection = await tx.vcansSampleSelection.findUnique({ where: { inspectionId } });
        if (!selection || selection.orderId !== target.task.vcansOrder.id) throw AppError.invalidState('检验未绑定订单抽检决定');
        if (selection.kind === 'ORIGINAL' && !selection.basisInspectionId) {
          const revision = await tx.inspectionRevision.findUnique({ where: { inspectionId_revision: { inspectionId, revision: input.revision } } });
          if (!revision) throw AppError.invalidState('检验修订不存在');
          await tx.vcansSampleSelection.update({ where: { id: selection.id }, data: { basisInspectionId: inspectionId, basisRevisionId: revision.id } });
        }
      }

      await tx.reviewAssignment.updateMany({
        where: { inspectionId, revision: input.revision, status: 'PENDING', assigneeId: actor.userId },
        data: { status: 'DONE', completedAt: now, reviewId: review.id },
      });
      await tx.reviewAssignment.updateMany({
        where: { inspectionId, revision: input.revision, status: 'PENDING' },
        data: { status: 'CANCELLED', completedAt: now },
      });
      await tx.fabricRoll.update({
        where: { id: i.rollId },
        data: {
          status: formal && input.decision === 'APPROVE' && (input.finalResult ?? i.overallResult) === 'FAIL' ? 'FAILED' : ROLL_AFTER[input.decision],
          ...(input.decision !== 'RETURN' && i.actualLengthM ? { actualLengthM: i.actualLengthM } : {}),
        },
      });
      await tx.qcTaskRoll.update({ where: { id: i.taskRollId }, data: { status: TASK_ROLL_AFTER[input.decision] } });
      if (input.decision !== 'RETURN') await this.tasks.completeIfDone(tx, i.taskId);

      const label = DECISION_LABELS[input.decision];
      await this.notifications.notifyInApp(tx, {
        userIds: [i.inspectorId],
        type: 'REVIEW_RESULT',
        title: `审核结果：${label}`,
        body: `卷 ${i.roll.rollNo}：${label}${input.comment ? `，${input.comment}` : ''}`,
        entityType: 'RollInspection',
        entityId: inspectionId,
        pagePath: input.decision === 'RETURN' ? `/pages/inspect/index?id=${inspectionId}` : `/pages/review/detail?id=${inspectionId}`,
      });
      await this.notifications.enqueue(tx, OutboxEvent.REVIEW_DECIDED, `review-decided:${inspectionId}:${input.revision}`, {
        inspectionId,
        revision: input.revision,
        reviewId: review.id,
        recipientIds: [i.inspectorId],
      });
      await this.audit.log(
        actor,
        {
          action: `review.${input.decision.toLowerCase()}`,
          entityType: 'RollInspection',
          entityId: inspectionId,
          after: { revision: input.revision, decision: input.decision, comment: input.comment, isConcession },
        },
        meta,
        tx,
      );
      if (target.task.vcansOrder) await tx.vcansOrder.update({ where: { id: target.task.vcansOrder.id }, data: { version: { increment: 1 }, confirmedAt: null, confirmedById: null } });
      return { reviewId: review.id, status: STATUS_AFTER[input.decision], isConcession };
    });
  }
}
