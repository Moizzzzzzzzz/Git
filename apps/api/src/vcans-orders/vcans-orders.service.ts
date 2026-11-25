import { Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { RoleCode, requiredSampleCount, standardRulesSchema, type selectVcansSampleSchema, type registerVcansRollsSchema, type additionalVcansSampleSchema, type assignVcansOrderSchema, type createVcansLotSchema, type createVcansOrderSchema, type vcansVersionSchema, type updateVcansOrderSchema, type vcansReminderSchema, type vcansMeasurementsSchema } from '@fabricqc/shared';
import type { z } from 'zod';
import type { Actor } from '../common/actor';
import { businessDepartments } from '../tasks/business-access';
import { AppError } from '../common/app-error';
import { businessNo, randomCode } from '../common/codes';
import { chooseMeasuredLength } from './measurement-choice';
import { OutboxEvent } from '../notifications/notifications.service';
import { validateBusinessConfiguration } from '../tasks/business-configuration';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/app-config';

function allLinesArrived(lines: { lots: { actualRollCount: number; rolls?: unknown[]; _count?: { rolls: number } }[] }[]): boolean {
  return lines.length > 0 && lines.every((line) => line.lots.length > 0 && line.lots.every((lot) => lot.actualRollCount > 0 && (lot._count?.rolls ?? lot.rolls?.length) === lot.actualRollCount));
}

@Injectable()
export class VcansOrdersService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly config?: AppConfig) {}
  private get isDemo() { return this.config?.env.DEMO_RUNTIME_MODE === 'demo'; }
  private customerAuthority(actor: Actor, order: { supervisorId: string | null }) {
    return actor.roles.some(r => r.role === RoleCode.QUALITY_MANAGER || (r.role === RoleCode.QC_SUPERVISOR && order.supervisorId === actor.userId));
  }
  private completeCustomerRules(rules: unknown): boolean {
    const parsed = standardRulesSchema.safeParse(rules);
    const raw = rules && typeof rules === 'object' && !Array.isArray(rules) ? rules as Record<string, unknown> : {};
    return parsed.success && parsed.data.formalProfile === 'YONGSHENG_2026' && Boolean(parsed.data.fourPoint) && parsed.data.thresholds.maxNormalizedPoints !== undefined && parsed.data.requiredScope === 'FULL' && Boolean(parsed.data.applicability) && Array.isArray(raw.checklistPolicies) && Array.isArray(raw.measurementLimits) && typeof raw.requireDefectPhoto === 'boolean';
  }
  async customerOptions(actor: Actor, id: string) {
    const order = await this.prisma.vcansOrder.findUnique({ where: { id }, select: { supervisorId: true } });
    if (!order || !this.customerAuthority(actor, order)) throw AppError.forbidden('没有客户标准配置权限');
    const standards = await this.prisma.qualityStandard.findMany({ where: { kind: 'CUSTOMER', isActive: true, customer: { isActive: true }, versions: { some: { status: 'PUBLISHED', purpose: 'FORMAL', isDevDefault: false } } }, include: { customer: { select: { id: true, code: true, name: true } }, versions: { where: { status: 'PUBLISHED', purpose: 'FORMAL', isDevDefault: false }, orderBy: { version: 'desc' }, take: 1 } } });
    const customerStandards = standards.filter(s => s.customer && s.versions[0] && this.completeCustomerRules(s.versions[0].rules)).map(s => ({ id: s.id, code: s.code, name: s.name, customer: s.customer!, currentVersion: { id: s.versions[0].id, version: s.versions[0].version } }));
    const customers = [...new Map(customerStandards.map(s => [s.customer.id, s.customer])).values()];
    return { customers, customerStandards };
  }
  async configureCustomerStandard(actor: Actor, id: string, input: { version: number; customerId: string | null; customerStandardId: string | null }) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${id}::uuid FOR UPDATE`;
      const order = await tx.vcansOrder.findUnique({ where: { id } });
      if (!order || !this.customerAuthority(actor, order)) throw AppError.forbidden('没有客户标准配置权限');
      if (order.version !== input.version) throw AppError.conflict('订单已变更，请刷新后重试');
      if (order.taskId) throw AppError.invalidState('已激活订单不能更改客户标准');
      if (input.customerStandardId && order.purpose === 'FORMAL' && order.requiredStandardMode !== 'CUSTOMER_REQUIRED') throw AppError.badRequest('请先明确选择客户书面标准');
      if (Boolean(input.customerId) !== Boolean(input.customerStandardId)) throw AppError.badRequest('客户与客户标准必须同时设置或同时清除');
      if (input.customerStandardId) {
        const standard = await tx.qualityStandard.findUnique({ where: { id: input.customerStandardId }, include: { customer: true, versions: { where: { status: 'PUBLISHED' }, orderBy: { version: 'desc' }, take: 1 } } });
        const current = standard?.versions[0];
        if (!standard?.isActive || standard.kind !== 'CUSTOMER' || !standard.customer?.isActive || standard.customerId !== input.customerId || !current || current.purpose !== 'FORMAL' || current.isDevDefault || !this.completeCustomerRules(current.rules)) throw AppError.badRequest('客户标准不属于该客户、未正式发布或规则不完整');
      }
      const updated = await tx.vcansOrder.update({ where: { id }, data: { customerId: input.customerId, customerStandardId: input.customerStandardId, version: { increment: 1 } }, select: { version: true } });
      await tx.vcansOrderChange.create({ data: { orderId: id, actorId: actor.userId, targetType: 'CUSTOMER_STANDARD', targetId: id, before: { customerId: order.customerId, customerStandardId: order.customerStandardId }, after: { customerId: input.customerId, customerStandardId: input.customerStandardId } } });
      return { id, ...updated, customerId: input.customerId, customerStandardId: input.customerStandardId };
    });
  }
  async changeRequiredStandardMode(actor: Actor, id: string, input: { version: number; requiredStandardMode: 'FACTORY' | 'CUSTOMER_REQUIRED' }) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${id}::uuid FOR UPDATE`;
      const order = await tx.vcansOrder.findUnique({ where: { id } });
      if (!order || !this.customerAuthority(actor, order)) throw AppError.forbidden('没有标准模式配置权限');
      if (order.version !== input.version) throw AppError.conflict('订单已变更，请刷新后重试');
      if (order.taskId || order.frozenRuleSource) throw AppError.invalidState('已激活订单不能更改标准模式');
      if (order.purpose !== 'FORMAL') throw AppError.invalidState('该订单不支持正式标准模式');
      if (order.requiredStandardMode === input.requiredStandardMode) return { id, version: order.version, requiredStandardMode: order.requiredStandardMode };
      const updated = await tx.vcansOrder.update({ where: { id }, data: { requiredStandardMode: input.requiredStandardMode, ...(input.requiredStandardMode === 'FACTORY' ? { customerId: null, customerStandardId: null } : {}), version: { increment: 1 } }, select: { version: true } });
      await tx.vcansOrderChange.create({ data: { orderId: id, actorId: actor.userId, targetType: 'STANDARD_MODE', targetId: id, before: { requiredStandardMode: order.requiredStandardMode, customerId: order.customerId, customerStandardId: order.customerStandardId }, after: { requiredStandardMode: input.requiredStandardMode, customerId: input.requiredStandardMode === 'FACTORY' ? null : order.customerId, customerStandardId: input.requiredStandardMode === 'FACTORY' ? null : order.customerStandardId } } });
      return { id, ...updated, requiredStandardMode: input.requiredStandardMode };
    });
  }
  async updateMeasurements(actor: Actor, lotId: string, orderRollId: string, input: z.infer<typeof vcansMeasurementsSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const ref = await tx.vcansDyeLot.findUnique({ where: { id: lotId }, select: { orderId: true } });
      if (!ref) throw AppError.notFound('到货缸');
      await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${ref.orderId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM vcans_dye_lots WHERE id = ${lotId}::uuid FOR UPDATE`;
      const order = await tx.vcansOrder.findUniqueOrThrow({ where: { id: ref.orderId } });
      const allowed = (order.supervisorId === actor.userId && actor.roles.some((role) => role.role === RoleCode.QC_SUPERVISOR)) || (order.assignedInspectorId === actor.userId && actor.roles.some((role) => role.role === RoleCode.INSPECTOR));
      if (!allowed) throw AppError.forbidden('仅指定主管或跟单质检员可录入实测');
      if (order.version !== input.version) throw AppError.conflict('订单已变更，请刷新后重试');
      const roll = await tx.vcansOrderRoll.findFirst({ where: { id: orderRollId, lotId, orderId: order.id } });
      if (!roll) throw AppError.notFound('订单布卷');
      const now = new Date();
      const data: Prisma.VcansOrderRollUpdateInput = { version: { increment: 1 } };
      if (input.measuredLengthM !== undefined) { data.measuredLengthM = input.measuredLengthM; data.measuredLengthSource = input.measuredLengthM === null ? null : '现场录入'; data.measuredLengthAt = input.measuredLengthM === null ? null : now; data.measuredLengthBy = input.measuredLengthM === null ? { disconnect: true } : { connect: { id: actor.userId } }; }
      if (input.measuredWeightKg !== undefined) { data.measuredWeightKg = input.measuredWeightKg; data.measuredWeightSource = input.measuredWeightKg === null ? null : '现场录入'; data.measuredWeightAt = input.measuredWeightKg === null ? null : now; data.measuredWeightBy = input.measuredWeightKg === null ? { disconnect: true } : { connect: { id: actor.userId } }; }
      const updatedRoll = await tx.vcansOrderRoll.update({ where: { id: orderRollId }, data });
      const updatedOrder = await tx.vcansOrder.update({ where: { id: order.id }, data: { version: { increment: 1 }, confirmedAt: null, confirmedById: null }, select: { version: true } });
      await tx.vcansOrderChange.create({ data: { orderId: order.id, lineId: roll.lineId, actorId: actor.userId, targetType: 'MEASUREMENTS', targetId: orderRollId, before: { measuredLengthM: roll.measuredLengthM?.toString() ?? null, measuredWeightKg: roll.measuredWeightKg?.toString() ?? null }, after: { measuredLengthM: updatedRoll.measuredLengthM?.toString() ?? null, measuredWeightKg: updatedRoll.measuredWeightKg?.toString() ?? null } } });
      return { orderRollId, version: updatedOrder.version };
    });
  }
  async remind(actor: Actor, id: string, input: z.infer<typeof vcansReminderSchema>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${id}::uuid FOR UPDATE`;
      const order = await tx.vcansOrder.findUnique({ where: { id }, include: { lines: { include: { lots: { include: { rolls: { include: { selections: true, taskRoll: { include: { inspections: { where: { status: { not: 'VOIDED' } }, orderBy: { createdAt: 'desc' } } } } } } } } } } } });
      if (!order || !actor.roles.some((role) => role.role === RoleCode.SALES && role.departmentId === order.businessDepartmentId)) throw AppError.forbidden('无本部门催审权限');
      if (!order.taskId || !order.supervisorId) throw AppError.invalidState('订单尚未进入审核流程');
      await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${order.taskId}::uuid FOR UPDATE`;
      const dedupeKey = `vcans-reminder:${input.idempotencyKey}`;
      const existing = await tx.qcReviewReminder.findUnique({ where: { dedupeKey } });
      if (existing) {
        if (existing.taskId !== order.taskId || existing.requesterId !== actor.userId) throw AppError.conflict('催审请求冲突');
        return { accepted: true, reminderId: existing.id };
      }
      if (order.confirmedAt) throw AppError.invalidState('订单已确认');
      const lots = order.lines.flatMap((line) => line.lots), rolls = lots.flatMap((lot) => lot.rolls);
      const pending = rolls.some((roll) => roll.taskRoll?.inspections[0]?.status === 'SUBMITTED');
      const plan = order.planMode === 'FULL' ? { mode: 'FULL' as const } : order.planMode === 'FIXED_PER_LOT' ? { mode: 'FIXED_PER_LOT' as const, fixedRolls: order.fixedRolls! } : { mode: 'PERCENT_PER_LOT' as const, percent: order.percent!.toString() };
      const required = lots.reduce((sum, lot) => sum + requiredSampleCount(lot.actualRollCount, plan), 0);
      const original = rolls.filter((roll) => roll.selections.some((selection) => selection.kind === 'ORIGINAL'));
      const ready = order.arrivalComplete && required > 0 && original.length === required && original.every((roll) => roll.selections.some((selection) => selection.kind === 'ORIGINAL' && selection.basisInspectionId && selection.basisRevisionId));
      if (!pending && !ready) throw AppError.invalidState('暂无待审核或待整单确认记录');
      const last = await tx.qcReviewReminder.findFirst({ where: { taskId: order.taskId }, orderBy: { createdAt: 'desc' } });
      if (last && Date.now() - last.createdAt.getTime() < 300000) throw AppError.conflict('催审过于频繁，请稍后再试');
      const notification = await tx.notification.create({ data: { userId: order.supervisorId, type: 'BUSINESS_REVIEW_REMINDER', title: '验布订单待审核', body: order.hNo, entityType: 'VcansOrder', entityId: id, pagePath: `/pages/orders/detail?id=${id}` } });
      const reminder = await tx.qcReviewReminder.create({ data: { taskId: order.taskId, requesterId: actor.userId, supervisorId: order.supervisorId, dedupeKey, notificationId: notification.id } });
      await tx.vcansOrderChange.create({ data: { orderId: id, actorId: actor.userId, targetType: 'REMINDER', targetId: reminder.id, after: { reminderId: reminder.id } } });
      return { accepted: true, reminderId: reminder.id };
    });
  }
  async confirm(actor: Actor, id: string, input: z.infer<typeof vcansVersionSchema>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${id}::uuid FOR UPDATE`;
      const base = await tx.vcansOrder.findUnique({ where: { id } });
      if (!base || base.supervisorId !== actor.userId || !actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR)) throw AppError.forbidden('仅指定质检主管可确认整单');
      if (base.version !== input.version) throw AppError.conflict('订单已变更，请刷新后重试');
      if (base.confirmedAt) {
        const report = await tx.vcansReportVersion.findFirst({ where: { orderId: id }, orderBy: { version: 'desc' }, select: { id: true, version: true, confirmedAt: true } });
        if (!report) throw AppError.invalidState('订单确认状态异常');
        return { report, version: base.version };
      }
      if (!base.arrivalComplete || !base.taskId) throw AppError.invalidState('请先确认到齐并完成验布任务');
      await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${base.taskId}::uuid FOR UPDATE`;
      const order = await tx.vcansOrder.findUniqueOrThrow({
        where: { id },
        include: {
          supervisor: { select: { name: true } }, assignedInspector: { select: { name: true } },
          fourPointStandard: { select: { name: true, description: true } },
          customerStandard: { select: { name: true, description: true } },
          lines: { orderBy: { lineNo: 'asc' }, include: { lots: { orderBy: { id: 'asc' }, include: {
            rolls: { orderBy: { id: 'asc' }, include: {
              roll: true, selections: true,
              taskRoll: { include: { inspections: { where: { status: { not: 'VOIDED' } }, orderBy: { createdAt: 'desc' }, include: { revisions: true, reviews: { include: { reviewer: { select: { name: true } } } }, inspector: { select: { id: true, name: true } } } } } },
            } },
          } } } },
        },
      });
      const lots = order.lines.flatMap((line) => line.lots);
      const plan = order.planMode === 'FULL' ? { mode: 'FULL' as const } : order.planMode === 'FIXED_PER_LOT' ? { mode: 'FIXED_PER_LOT' as const, fixedRolls: order.fixedRolls! } : { mode: 'PERCENT_PER_LOT' as const, percent: order.percent!.toString() };
      if (!allLinesArrived(order.lines)) throw AppError.invalidState('现场缸卷尚未完整登记');
      const rolls: unknown[] = [];
      let originalRequired = 0;
      for (const lot of lots) {
        const required = requiredSampleCount(lot.actualRollCount, plan); originalRequired += required;
        const originals = lot.rolls.filter((roll) => roll.selections.some((selection) => selection.kind === 'ORIGINAL'));
        if (originals.length !== required) throw AppError.invalidState('原定应检卷未选齐');
        for (const roll of lot.rolls) {
          const originalSelection = roll.selections.find((selection) => selection.kind === 'ORIGINAL');
          const original = Boolean(originalSelection);
          const additionalSelections = roll.selections.filter((selection) => selection.kind === 'ADDITIONAL');
          const additional = additionalSelections.length > 0;
          const inspections = roll.taskRoll?.inspections ?? [];
          const basis = originalSelection?.basisInspectionId ? inspections.find((inspection) => inspection.id === originalSelection.basisInspectionId) : undefined;
          const basisRevision = basis?.revisions.find((revision) => revision.id === originalSelection?.basisRevisionId && revision.inspectionId === basis.id);
          const basisReview = basis?.reviews.find((review) => review.revision === basisRevision?.revision && review.decision === 'APPROVE' && review.reviewerId !== basis.inspectorId);
          const basisResult = basisReview?.finalResult ?? basis?.overallResult;
          if (original && (!basis || !basisRevision || !basisReview || basis.inspectorId === actor.userId || !['PASS', 'FAIL'].includes(basisResult ?? ''))) throw AppError.invalidState('原定应检卷尚未完成独立审核');
          const latestApproved = inspections.find((inspection) => inspection.status === 'APPROVED');
          const approved = original ? basis : latestApproved;
          const revision = approved?.revisions.find((r) => r.revision === approved.revision);
          const review = approved?.reviews.find((r) => r.revision === approved.revision && r.decision === 'APPROVE' && r.reviewerId !== approved.inspectorId);
          if (approved && (!revision || !review)) throw AppError.invalidState('已审核检验缺少修订或审核记录');
          const frozen = revision?.snapshot as { photos?: { objectKey?: string; thumbKey?: string | null }[] } | undefined;
          if (revision && (!Array.isArray(frozen?.photos) || frozen!.photos!.some((photo) => !photo.objectKey?.startsWith('frozen-inspections/') || (photo.thumbKey && !photo.thumbKey.startsWith('frozen-inspections/'))))) throw AppError.invalidState('检验照片未冻结');
          const history = additionalSelections.map((selection) => {
            const extra = selection.inspectionId ? inspections.find((item) => item.id === selection.inspectionId) : undefined;
            const extraRevision = extra?.status === 'APPROVED' ? extra.revisions.find((revision) => revision.revision === extra.revision) : undefined;
            const extraReview = extraRevision && extra?.reviews.find((review) => review.revision === extraRevision.revision && review.decision === 'APPROVE' && review.reviewerId !== extra.inspectorId);
            if (extra?.status === 'APPROVED' && (!extraRevision || !extraReview)) throw AppError.invalidState('追加检验缺少审核或修订记录');
            const extraSnapshot = extraRevision?.snapshot as { photos?: { objectKey?: string; thumbKey?: string | null }[] } | undefined;
            if (extraRevision && (!Array.isArray(extraSnapshot?.photos) || extraSnapshot!.photos!.some((photo) => !photo.objectKey?.startsWith('frozen-inspections/') || (photo.thumbKey && !photo.thumbKey.startsWith('frozen-inspections/'))))) throw AppError.invalidState('追加检验照片未冻结');
            return { selectionId: selection.id, reason: selection.reason, inspectionId: extra?.id ?? null, inspectionNumber: extra?.inspectionNo ?? null, status: extra?.status ?? 'PENDING', result: extra?.status === 'APPROVED' ? extraReview?.finalResult ?? extra.overallResult : 'INCOMPLETE', systemResult: extra?.overallResult ?? null, finalResult: extraReview?.finalResult ?? null, finalReason: extraReview?.finalReason ?? null, inspection: extraRevision?.snapshot ?? null, resultSnapshot: extra?.resultSnapshot ?? null, standardSnapshot: extra?.standardSnapshot ?? null, templateSnapshot: extra?.templateSnapshot ?? null, totalPoints: extra?.totalPoints ?? null, normalizedScore: extra?.normalizedPoints ?? null, measuredLengthM: extra?.actualLengthM ?? null, submittedAt: extra?.submittedAt ?? null, reviewedAt: extraReview?.createdAt ?? null, inspectorName: extra?.inspector.name ?? null, reviewerName: extraReview?.reviewer.name ?? null };
          });
          const measured = chooseMeasuredLength({ value: roll.measuredLengthM?.toString() ?? null, at: roll.measuredLengthAt }, { value: latestApproved?.actualLengthM?.toString() ?? null, at: latestApproved?.submittedAt ?? null });
          rolls.push({ id: roll.id, lineId: lot.lineId, lotNo: lot.dyeLotNo, rollNo: roll.roll.rollNo, qrCode: roll.roll.qrCode, originalSample: original, additionalSample: additional, nominalLengthM: roll.nominalLengthM, nominalWeightKg: roll.nominalWeightKg, measuredLengthM: measured.value, measuredLengthSource: measured.source, measuredLengthAt: measured.at, measuredWeightKg: roll.measuredWeightKg, measuredWeightSource: roll.measuredWeightSource, measuredWeightAt: roll.measuredWeightAt, result: (original ? basisResult : review?.finalResult ?? approved?.overallResult) ?? (original || additional ? 'INCOMPLETE' : 'UNINSPECTED'), inspectionId: approved?.id ?? null, basisInspectionId: basis?.id ?? null, basisRevisionId: basisRevision?.id ?? null, basisHistory: basis && basisRevision && basisReview ? { inspectionId: basis.id, inspectionNumber: basis.inspectionNo, result: basisResult, systemResult: basis.overallResult, finalResult: basisReview.finalResult, finalReason: basisReview.finalReason, inspection: basisRevision.snapshot, resultSnapshot: basis.resultSnapshot, standardSnapshot: basis.standardSnapshot, templateSnapshot: basis.templateSnapshot, totalPoints: basis.totalPoints, normalizedScore: basis.normalizedPoints, measuredLengthM: basis.actualLengthM, submittedAt: basis.submittedAt, reviewedAt: basisReview.createdAt, inspectorName: basis.inspector.name, reviewerName: basisReview.reviewer.name } : null, inspector: approved?.inspector ?? null, spec: approved?.specSnapshot ?? null, standards: approved?.standardSnapshot ?? null, resultSnapshot: approved?.resultSnapshot ?? null, totalPoints: approved?.totalPoints ?? null, normalizedScore: approved?.normalizedPoints ?? null, inspection: revision?.snapshot ?? null, review: review ? { id: review.id, decision: review.decision, comment: review.comment } : null, pendingAdditional: history.some((event) => event.result === 'INCOMPLETE'), additionalHistory: history });
        }
      }
      const latest = await tx.vcansReportVersion.aggregate({ where: { orderId: id }, _max: { version: true } });
      const reportVersion = (latest._max.version ?? 0) + 1;
      const now = new Date();
      const defectTypes = await tx.defectType.findMany({ select: { code: true, nameZh: true } });
      const defectNames = Object.fromEntries(defectTypes.map((type) => [type.code, type.nameZh]));
      const frozenNames = (order.frozenTemplateSnapshot as { frozenStandards?: { factory?: { name?: string; description?: string | null }; customer?: { name?: string; description?: string | null } | null } } | null)?.frozenStandards;
      const reportStandard = order.frozenRuleSource ? (order.frozenRuleSource === 'CUSTOMER' ? frozenNames?.customer : frozenNames?.factory) : order.fourPointStandard;
      if (order.frozenRuleSource && !reportStandard?.name) throw AppError.invalidState('正式订单标准名称未冻结');
      const snapshot = JSON.parse(JSON.stringify({ defectNames, hNo: order.hNo, version: reportVersion, confirmedAt: now, confirmedByName: order.supervisor?.name ?? '', inspectorNames: order.assignedInspector ? [order.assignedInspector.name] : [], plan, originalRequiredRolls: originalRequired, standardName: reportStandard?.name ?? null, standardDescription: reportStandard?.description ?? null, lines: order.lines.map(({ lots: _lots, sourceSnapshot: _source, ...line }) => line), rolls }));
      const report = await tx.vcansReportVersion.create({ data: { orderId: id, version: reportVersion, confirmedById: actor.userId, confirmedAt: now, snapshot }, select: { id: true, version: true, confirmedAt: true } });
      const updated = await tx.vcansOrder.update({ where: { id }, data: { confirmedAt: now, confirmedById: actor.userId, version: { increment: 1 } }, select: { version: true } });
      await tx.vcansOrderChange.create({ data: { orderId: id, actorId: actor.userId, targetType: 'CONFIRM', targetId: report.id, after: { reportVersion } } });
      await tx.notification.create({ data: { userId: order.createdById, type: 'VCANS_ORDER_DELIVERED', title: '验布订单结果已确认', body: order.hNo, entityType: 'VcansOrder', entityId: id, pagePath: `/pages/orders/detail?id=${id}` } });
      await tx.notificationOutbox.create({ data: { eventType: OutboxEvent.VCANS_ORDER_DELIVERED, dedupeKey: `vcans-delivery:${report.id}`, payload: { reportVersionId: report.id, recipientIds: [order.createdById] } } });
      return { report, version: updated.version };
    });
  }
  async activate(actor: Actor, id: string, input: z.infer<typeof vcansVersionSchema>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${id}::uuid FOR UPDATE`;
      const order = await tx.vcansOrder.findUnique({ where: { id }, include: { lines: { include: { lots: { include: { rolls: true } } } } } });
      const allowed = order && ((order.supervisorId === actor.userId && actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR)) || (order.assignedInspectorId === actor.userId && actor.roles.some((r) => r.role === RoleCode.INSPECTOR)));
      if (!order || !allowed) throw AppError.forbidden('没有启动该订单验布的权限');
      if (order.version !== input.version) throw AppError.conflict('订单已变更，请刷新后重试');
      if (order.taskId) return { taskId: order.taskId, version: order.version };
      if (order.purpose === 'FORMAL' && !order.requiredStandardMode) throw AppError.invalidState('请先明确选择订单标准模式');
      if (order.requiredStandardMode === 'CUSTOMER_REQUIRED' && (!order.customerId || !order.customerStandardId)) throw AppError.invalidState('客户标准待确认，不能开始验布');
      if (order.requiredStandardMode === 'FACTORY' && (order.customerId || order.customerStandardId)) throw AppError.invalidState('订单标准模式与客户配置不一致');
      if (!order.supervisorId || !order.assignedInspectorId || !order.fourPointStandardId || !order.templateId) throw AppError.invalidState('请先分发跟单员并选择可用的标准和模板');
      for (const standardId of [order.fourPointStandardId, ...(order.customerStandardId ? [order.customerStandardId] : [])].sort()) await tx.$queryRaw`SELECT id FROM quality_standards WHERE id = ${standardId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM inspection_templates WHERE id = ${order.templateId}::uuid FOR UPDATE`;
      const lots = order.lines.flatMap((line) => line.lots);
      const rolls = lots.flatMap((lot) => lot.rolls);
      const planned = lots.reduce((sum, lot) => sum + lot.actualRollCount, 0);
      if (!planned || !rolls.length) throw AppError.invalidState('请先登记现场缸卷');
      const [standard, template, inspector] = await Promise.all([
        tx.standardVersion.findFirst({ where: { standardId: order.fourPointStandardId, status: 'PUBLISHED', standard: { isActive: true, kind: 'FOUR_POINT' } }, include: { standard: { select: { name: true, description: true } } }, orderBy: { version: 'desc' } }),
        tx.inspectionTemplate.findUnique({ where: { id: order.templateId } }),
        tx.user.findUnique({ where: { id: order.assignedInspectorId }, include: { roles: { include: { role: true } } } }),
      ]);
      if (!standard || !template?.isActive || !inspector || inspector.status !== 'ACTIVE' || !inspector.roles.some((r) => r.role.code === RoleCode.INSPECTOR)) throw AppError.invalidState('标准、模板或跟单员不可用');
      const formal = standardRulesSchema.parse(standard.rules).formalProfile === 'YONGSHENG_2026';
      if (order.purpose === 'FORMAL' && !formal) throw AppError.invalidState('正式订单必须使用完整的正式规则配置');
      const customerVersion = order.customerStandardId ? await tx.standardVersion.findFirst({ where: { standardId: order.customerStandardId, status: 'PUBLISHED', purpose: 'FORMAL', isDevDefault: false, standard: { kind: 'CUSTOMER', isActive: true, customerId: order.customerId } }, include: { standard: { select: { name: true, description: true } } }, orderBy: { version: 'desc' } }) : null;
      if (order.customerStandardId && (!formal || !order.customerId || !customerVersion || !this.completeCustomerRules(customerVersion.rules))) throw AppError.invalidState('客户标准不完整或不属于该订单客户');
      if (formal && (order.purpose !== 'FORMAL' || standard.purpose !== 'FORMAL' || standard.isDevDefault || template.purpose !== 'FORMAL')) throw AppError.invalidState('正式订单必须使用已确认的正式标准和模板');
      validateBusinessConfiguration(template.content, [customerVersion?.rules ?? standard.rules]);
      const task = await tx.qcTask.create({ data: { taskNo: businessNo('T'), title: order.hNo, origin: 'BUSINESS', purpose: order.purpose, businessDepartmentId: order.businessDepartmentId, departmentId: inspector.departmentId, supervisorId: order.supervisorId, assigneeId: order.assignedInspectorId, reviewerId: order.supervisorId, plannedRollCount: planned, fourPointStandardId: order.fourPointStandardId, customerId: order.customerId, customerStandardId: order.customerStandardId, templateId: order.templateId, createdById: order.createdById, dueAt: order.dueAt } });
      for (const roll of rolls) {
        const taskRoll = await tx.qcTaskRoll.create({ data: { taskId: task.id, rollId: roll.rollId } });
        await tx.vcansOrderRoll.update({ where: { id: roll.id }, data: { taskRollId: taskRoll.id } });
        await tx.fabricRoll.update({ where: { id: roll.rollId }, data: { status: 'ASSIGNED' } });
      }
      const updated = await tx.vcansOrder.update({ where: { id }, data: { taskId: task.id, version: { increment: 1 }, ...(formal ? { factoryVersionId: standard.id, customerVersionId: customerVersion?.id ?? null, frozenRuleSource: customerVersion ? 'CUSTOMER' as const : 'FACTORY' as const, frozenTemplateSnapshot: { ...(template.content as object), templateId: template.id, templateVersion: template.version, frozenStandards: { factory: standard.standard, customer: customerVersion?.standard ?? null } } as Prisma.InputJsonValue, frozenTemplateVersion: template.version } : {}) }, select: { version: true } });
      await tx.vcansOrderChange.create({ data: { orderId: id, actorId: actor.userId, targetType: 'TASK', targetId: task.id, after: { taskId: task.id } } });
      return { taskId: task.id, version: updated.version };
    });
  }
  async addAdditional(actor: Actor, lotId: string, input: z.infer<typeof additionalVcansSampleSchema>) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const ref = await tx.vcansDyeLot.findUnique({ where: { id: lotId }, select: { orderId: true } });
        if (!ref) throw AppError.notFound('到货缸');
        await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${ref.orderId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM vcans_dye_lots WHERE id = ${lotId}::uuid FOR UPDATE`;
        const order = await tx.vcansOrder.findUniqueOrThrow({ where: { id: ref.orderId } });
        if (order.supervisorId !== actor.userId || !actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR)) throw AppError.forbidden('仅指定主管可决定追加检验');
        const requestHash = createHash('sha256').update(JSON.stringify({ lotId, orderRollIds: [...input.orderRollIds].sort(), reason: input.reason, version: input.version })).digest('hex');
        const existing = await tx.vcansAdditionalRequest.findUnique({ where: { orderId_requestKey: { orderId: order.id, requestKey: input.requestKey } } });
        if (existing) {
          if (existing.actorId !== actor.userId || existing.requestHash !== requestHash || !existing.result) throw AppError.conflict('追加请求与已有记录不一致');
          return existing.result as { lotId: string; version: number };
        }
        if (order.version !== input.version) throw AppError.conflict('订单已变更，请刷新后重试');
        const count = await tx.vcansOrderRoll.count({ where: { lotId, id: { in: input.orderRollIds } } });
        if (count !== input.orderRollIds.length) throw AppError.badRequest('所选卷不属于该缸');
        const request = await tx.vcansAdditionalRequest.create({ data: { orderId: order.id, requestKey: input.requestKey, requestHash, actorId: actor.userId } });
        await tx.vcansSampleSelection.createMany({ data: input.orderRollIds.map((orderRollId) => ({ orderId: order.id, lotId, orderRollId, kind: 'ADDITIONAL' as const, selectedById: actor.userId, reason: input.reason, requestId: request.id })) });
        const updated = await tx.vcansOrder.update({ where: { id: order.id }, data: { version: { increment: 1 }, confirmedAt: null, confirmedById: null }, select: { version: true } });
        await tx.vcansOrderChange.create({ data: { orderId: order.id, actorId: actor.userId, targetType: 'ADDITIONAL_SAMPLES', targetId: lotId, after: { orderRollIds: input.orderRollIds }, reason: input.reason } });
        const result = { lotId, version: updated.version };
        await tx.vcansAdditionalRequest.update({ where: { id: request.id }, data: { result } });
        return result;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw AppError.conflict('追加请求冲突，请刷新后重试');
      throw error;
    }
  }
  async registerRolls(actor: Actor, lotId: string, input: z.infer<typeof registerVcansRollsSchema>) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const ref = await tx.vcansDyeLot.findUnique({ where: { id: lotId }, select: { orderId: true } });
        if (!ref) throw AppError.notFound('到货缸');
        await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${ref.orderId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM vcans_dye_lots WHERE id = ${lotId}::uuid FOR UPDATE`;
        const order = await tx.vcansOrder.findUniqueOrThrow({ where: { id: ref.orderId } });
        const allowed = (order.supervisorId === actor.userId && actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR)) || (order.assignedInspectorId === actor.userId && actor.roles.some((r) => r.role === RoleCode.INSPECTOR));
        if (!allowed) throw AppError.forbidden('仅指定主管或跟单质检员可登记卷');
        if (order.version !== input.version) throw AppError.conflict('订单已变更，请刷新后重试');
        const lot = await tx.vcansDyeLot.findUniqueOrThrow({ where: { id: lotId }, include: { _count: { select: { rolls: true } } } });
        if (lot._count.rolls + input.rolls.length > lot.actualRollCount) throw AppError.badRequest('登记卷数超过本缸实际卷数');
        if (new Set(input.rolls.map((roll) => roll.rollNo)).size !== input.rolls.length) throw AppError.badRequest('卷号重复');
        if (input.fabricId) {
          const fabric = await tx.fabric.findUnique({ where: { id: input.fabricId } });
          if (!fabric?.isActive) throw AppError.badRequest('面料不存在或未启用');
          if (!this.isDemo && order.purpose === 'FORMAL' && fabric.purpose !== 'FORMAL') throw AppError.badRequest('正式订单不能选择未确认的面料');
        }
        const items = [];
        for (const row of input.rolls) {
          let qrCode = '';
          for (let n = 0; n < 10; n++) { const candidate = randomCode(10); if (!await tx.fabricRoll.findUnique({ where: { qrCode: candidate } })) { qrCode = candidate; break; } }
          if (!qrCode) throw AppError.conflict('无法生成布卷标识');
          const roll = await tx.fabricRoll.create({ data: { rollNo: row.rollNo, qrCode, fabricId: input.fabricId ?? null, dyeLotNo: lot.dyeLotNo, nominalLengthM: row.nominalLengthM ?? null, createdById: actor.userId, status: order.taskId ? 'ASSIGNED' : 'PENDING' } });
          const taskRoll = order.taskId ? await tx.qcTaskRoll.create({ data: { taskId: order.taskId, rollId: roll.id } }) : null;
          const orderRoll = await tx.vcansOrderRoll.create({ data: { orderId: order.id, lineId: lot.lineId, lotId, rollId: roll.id, taskRollId: taskRoll?.id ?? null, nominalLengthM: row.nominalLengthM ?? null, nominalWeightKg: row.nominalWeightKg ?? null, nominalSource: '现场登记' } });
          items.push({ id: orderRoll.id, rollId: roll.id, rollNo: roll.rollNo, qrCode: roll.qrCode, taskRollId: taskRoll?.id ?? null });
        }
        const updated = await tx.vcansOrder.update({ where: { id: order.id }, data: { version: { increment: 1 }, arrivalComplete: false, arrivalConfirmedById: null, arrivalConfirmedAt: null, confirmedAt: null, confirmedById: null }, select: { version: true } });
        await tx.vcansOrderChange.create({ data: { orderId: order.id, actorId: actor.userId, targetType: 'ROLLS', targetId: lotId, after: { rollIds: items.map((item) => item.rollId) } } });
        return { items, version: updated.version };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw AppError.conflict('卷号或二维码冲突，请核对后重试');
      throw error;
    }
  }
  async selectOriginal(actor: Actor, lotId: string, input: z.infer<typeof selectVcansSampleSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const ref = await tx.vcansDyeLot.findUnique({ where: { id: lotId }, select: { orderId: true } });
      if (!ref) throw AppError.notFound('到货缸');
      await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${ref.orderId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM vcans_dye_lots WHERE id = ${lotId}::uuid FOR UPDATE`;
      const order = await tx.vcansOrder.findUniqueOrThrow({ where: { id: ref.orderId } });
      const allowed = (order.supervisorId === actor.userId && actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR)) || (order.assignedInspectorId === actor.userId && actor.roles.some((r) => r.role === RoleCode.INSPECTOR));
      if (!allowed) throw AppError.forbidden('仅指定主管或跟单质检员可选卷');
      if (order.version !== input.version) throw AppError.conflict('订单已变更，请刷新后重试');
      const lot = await tx.vcansDyeLot.findUniqueOrThrow({ where: { id: lotId }, include: { rolls: { include: { selections: true } } } });
      const plan = order.planMode === 'FULL' ? { mode: 'FULL' as const } : order.planMode === 'FIXED_PER_LOT' ? { mode: 'FIXED_PER_LOT' as const, fixedRolls: order.fixedRolls! } : { mode: 'PERCENT_PER_LOT' as const, percent: order.percent!.toString() };
      const required = requiredSampleCount(lot.actualRollCount, plan);
      if (input.orderRollIds.length !== required) throw AppError.badRequest(`本缸应检 ${required} 卷，请选择对应卷数`);
      const previous = lot.rolls.flatMap((roll) => roll.selections.filter((selection) => selection.kind === 'ORIGINAL'));
      if (previous.some((selection) => selection.inspectionId || selection.basisInspectionId)) throw AppError.invalidState('已开始原定检验，不能直接更换抽检卷');
      const ids = new Set(lot.rolls.map((roll) => roll.id));
      if (input.orderRollIds.some((id) => !ids.has(id))) throw AppError.badRequest('所选卷不属于该缸');
      if (previous.length) await tx.vcansSampleSelection.deleteMany({ where: { id: { in: previous.map((selection) => selection.id) } } });
      await tx.vcansSampleSelection.createMany({ data: input.orderRollIds.map((orderRollId) => ({ orderId: order.id, lotId, orderRollId, kind: 'ORIGINAL' as const, selectedById: actor.userId })) });
      const updated = await tx.vcansOrder.update({ where: { id: order.id }, data: { version: { increment: 1 } }, select: { version: true } });
      await tx.vcansOrderChange.create({ data: { orderId: order.id, actorId: actor.userId, targetType: 'ORIGINAL_SAMPLES', targetId: lotId, before: { orderRollIds: previous.map((selection) => selection.orderRollId) }, after: { orderRollIds: input.orderRollIds } } });
      return { lotId, required, version: updated.version };
    });
  }
  async update(actor: Actor, id: string, input: z.infer<typeof updateVcansOrderSchema>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${id}::uuid FOR UPDATE`;
      const order = await tx.vcansOrder.findUnique({ where: { id } });
      const business = order && businessDepartments(actor).includes(order.businessDepartmentId);
      const supervisor = order && order.supervisorId === actor.userId && actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR);
      const inspector = order && order.assignedInspectorId === actor.userId && actor.roles.some((r) => r.role === RoleCode.INSPECTOR);
      if (!order || (!business && !supervisor && !inspector)) throw AppError.forbidden('没有该订单修改权限');
      if (inspector && !business && !supervisor && (input.supervisorId !== undefined || input.dueAt !== undefined || input.lines !== undefined || input.plan !== undefined)) throw AppError.forbidden('跟单质检员只能补充标准和模板');
      if (order.version !== input.version) throw AppError.conflict('订单已变更，请刷新后重试');
      if (order.taskId) {
        await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${order.taskId}::uuid FOR UPDATE`;
        if (input.fourPointStandardId !== undefined || input.templateId !== undefined) {
          const unfinished = await tx.rollInspection.count({ where: { taskId: order.taskId, status: { in: ['DRAFT', 'SUBMITTED', 'RETURNED'] } } });
          if (unfinished) throw AppError.invalidState('存在进行中或待审核检验，不能更换标准或模板');
        }
        const nextStandardId = input.fourPointStandardId === undefined ? order.fourPointStandardId : input.fourPointStandardId;
        const nextTemplateId = input.templateId === undefined ? order.templateId : input.templateId;
        if (!nextStandardId || !nextTemplateId) throw AppError.invalidState('已启动的验布任务须保留标准和模板');
        const standard = await tx.standardVersion.findFirst({ where: { standardId: nextStandardId, status: 'PUBLISHED', standard: { isActive: true, kind: 'FOUR_POINT' } }, orderBy: { version: 'desc' } });
        const template = await tx.inspectionTemplate.findUnique({ where: { id: nextTemplateId } });
        if (!standard || !template?.isActive) throw AppError.badRequest('标准或模板不可用');
        validateBusinessConfiguration(template.content, [standard.rules]);
        await tx.qcTask.update({ where: { id: order.taskId }, data: { fourPointStandardId: nextStandardId, templateId: nextTemplateId, dueAt: input.dueAt === undefined ? undefined : input.dueAt === null ? null : new Date(input.dueAt) } });
      }
      if (input.supervisorId && input.supervisorId !== order.supervisorId) {
        if (!business || order.assignedInspectorId) throw AppError.invalidState('已分发订单不能直接更换主管');
        const next = await tx.user.findUnique({ where: { id: input.supervisorId }, include: { roles: { include: { role: true } } } });
        if (!next || next.status !== 'ACTIVE' || !next.roles.some((r) => r.role.code === RoleCode.QC_SUPERVISOR)) throw AppError.badRequest('质检主管不可用');
      }
      if (input.fourPointStandardId) {
        const standard = await tx.qualityStandard.findUnique({ where: { id: input.fourPointStandardId }, include: { versions: { where: { status: 'PUBLISHED' }, take: 1 } } });
        if (!standard?.isActive || standard.kind !== 'FOUR_POINT' || !standard.versions.length) throw AppError.badRequest('四分制标准不可用');
        if (!this.isDemo && (standard.versions[0].purpose !== 'FORMAL' || standard.versions[0].isDevDefault)) throw AppError.badRequest('正式订单不能选择未确认的标准');
      }
      if (input.templateId) {
        const template = await tx.inspectionTemplate.findUnique({ where: { id: input.templateId } });
        if (!template?.isActive) throw AppError.badRequest('检验模板不可用');
        if (!this.isDemo && template.purpose !== 'FORMAL') throw AppError.badRequest('正式订单不能选择未确认的模板');
      }
      if (input.plan) {
        const count = await tx.vcansSampleSelection.count({ where: { orderId: id, kind: 'ORIGINAL' } });
        if (count) throw AppError.invalidState('已选择原定抽检卷，请先处理抽检计划变更');
      }
      if (input.lines) {
        const existing = await tx.vcansOrderLine.findMany({ where: { orderId: id, id: { in: input.lines.map((line) => line.id) } } });
        if (existing.length !== input.lines.length) throw AppError.badRequest('明细不属于该订单');
        for (const line of input.lines) {
          const previous = existing.find((item) => item.id === line.id)!;
          const { id: lineId, ...changes } = line;
          const next = await tx.vcansOrderLine.update({ where: { id: lineId }, data: { ...changes, revision: { increment: 1 } } });
          const { sourceSnapshot: _oldSource, ...beforeFields } = previous;
          const { sourceSnapshot: _newSource, ...afterFields } = next;
          await tx.vcansOrderChange.create({ data: { orderId: id, lineId, actorId: actor.userId, targetType: 'LINE', targetId: lineId, before: JSON.parse(JSON.stringify(beforeFields)), after: JSON.parse(JSON.stringify(afterFields)) } });
        }
      }
      const planData = input.plan ? { planMode: input.plan.mode, fixedRolls: input.plan.mode === 'FIXED_PER_LOT' ? input.plan.fixedRolls : null, percent: input.plan.mode === 'PERCENT_PER_LOT' ? input.plan.percent : null } : {};
      const data = { ...planData, confirmedAt: null, confirmedById: null, supervisorId: input.supervisorId, fourPointStandardId: input.fourPointStandardId, templateId: input.templateId, dueAt: input.dueAt === undefined ? undefined : input.dueAt === null ? null : new Date(input.dueAt), version: { increment: 1 } };
      const updated = await tx.vcansOrder.update({ where: { id }, data, select: { id: true, version: true } });
      await tx.vcansOrderChange.create({ data: { orderId: id, actorId: actor.userId, targetType: 'ORDER', targetId: id, before: { planMode: order.planMode, fixedRolls: order.fixedRolls, percent: order.percent?.toString() ?? null, supervisorId: order.supervisorId, fourPointStandardId: order.fourPointStandardId, templateId: order.templateId, dueAt: order.dueAt?.toISOString() ?? null }, after: { plan: input.plan ?? null, supervisorId: input.supervisorId ?? order.supervisorId, fourPointStandardId: input.fourPointStandardId === undefined ? order.fourPointStandardId : input.fourPointStandardId, templateId: input.templateId === undefined ? order.templateId : input.templateId, dueAt: input.dueAt === undefined ? order.dueAt?.toISOString() ?? null : input.dueAt } } });
      return updated;
    });
  }
  async confirmArrival(actor: Actor, id: string, input: z.infer<typeof vcansVersionSchema>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${id}::uuid FOR UPDATE`;
      const order = await tx.vcansOrder.findUnique({ where: { id }, include: { lines: { include: { lots: { include: { _count: { select: { rolls: true } } } } } } } });
      const supervisor = order && order.supervisorId === actor.userId && actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR);
      const inspector = order && order.assignedInspectorId === actor.userId && actor.roles.some((r) => r.role === RoleCode.INSPECTOR);
      if (!order || (!supervisor && !inspector)) throw AppError.forbidden('仅指定主管或跟单质检员可确认到齐');
      if (order.version !== input.version) throw AppError.conflict('订单已变更，请刷新后重试');
      if (!allLinesArrived(order.lines)) throw AppError.invalidState('现场缸卷尚未完整登记，不能确认到齐');
      if (order.arrivalComplete) return { id, version: order.version, arrivalComplete: true };
      const updated = await tx.vcansOrder.update({ where: { id }, data: { arrivalComplete: true, arrivalConfirmedById: actor.userId, arrivalConfirmedAt: new Date(), version: { increment: 1 } }, select: { version: true } });
      await tx.vcansOrderChange.create({ data: { orderId: id, actorId: actor.userId, targetType: 'ARRIVAL', targetId: id, after: { arrivalComplete: true } } });
      return { id, version: updated.version, arrivalComplete: true };
    });
  }
  async assignmentOptions(actor: Actor, id: string) {
    const order = await this.prisma.vcansOrder.findUnique({ where: { id }, select: { supervisorId: true } });
    if (!order || order.supervisorId !== actor.userId || !actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR)) throw AppError.forbidden('仅指定质检主管可查看分发候选');
    const inspectors = await this.prisma.user.findMany({ where: { status: 'ACTIVE', id: { not: actor.userId }, roles: { some: { role: { code: RoleCode.INSPECTOR } } } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    return { inspectors };
  }
  async addLot(actor: Actor, id: string, input: z.infer<typeof createVcansLotSchema>) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${id}::uuid FOR UPDATE`;
        const order = await tx.vcansOrder.findUnique({ where: { id } });
        const supervisor = order && order.supervisorId === actor.userId && actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR);
        const inspector = order && order.assignedInspectorId === actor.userId && actor.roles.some((r) => r.role === RoleCode.INSPECTOR);
        if (!order || (!supervisor && !inspector)) throw AppError.forbidden('仅指定主管或跟单质检员可登记缸');
        if (order.version !== input.version) throw AppError.conflict('订单已变更，请刷新后重试');
        const line = await tx.vcansOrderLine.findFirst({ where: { id: input.lineId, orderId: id }, select: { id: true } });
        if (!line) throw AppError.badRequest('明细不属于该订单');
        const lot = await tx.vcansDyeLot.create({ data: { orderId: id, lineId: input.lineId, dyeLotNo: input.dyeLotNo, actualRollCount: input.actualRollCount, createdById: actor.userId } });
        if (order.taskId) {
          await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${order.taskId}::uuid FOR UPDATE`;
          await tx.qcTask.update({ where: { id: order.taskId }, data: { plannedRollCount: { increment: input.actualRollCount } } });
        }
        const updated = await tx.vcansOrder.update({ where: { id }, data: { version: { increment: 1 }, arrivalComplete: false, arrivalConfirmedById: null, arrivalConfirmedAt: null, confirmedAt: null, confirmedById: null }, select: { version: true } });
        await tx.vcansOrderChange.create({ data: { orderId: id, lineId: input.lineId, actorId: actor.userId, targetType: 'LOT', targetId: lot.id, after: { dyeLotNo: lot.dyeLotNo, actualRollCount: lot.actualRollCount } } });
        return { lot, version: updated.version };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw AppError.conflict('该明细中缸号已存在');
      throw error;
    }
  }
  async assign(actor: Actor, id: string, input: z.infer<typeof assignVcansOrderSchema>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${id}::uuid FOR UPDATE`;
      const order = await tx.vcansOrder.findUnique({ where: { id } });
      if (!order || order.supervisorId !== actor.userId || !actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR)) throw AppError.forbidden('仅指定质检主管可分发');
      if (order.version !== input.version) throw AppError.conflict('订单已变更，请刷新后重试');
      if (input.assigneeId === order.supervisorId) throw AppError.badRequest('指定主管不能兼任跟单员');
      const assignee = await tx.user.findUnique({ where: { id: input.assigneeId }, include: { roles: { include: { role: true } } } });
      if (!assignee || assignee.status !== 'ACTIVE' || !assignee.roles.some((r) => r.role.code === RoleCode.INSPECTOR)) throw AppError.badRequest('跟单员不存在、已停用或无质检员权限');
      if (order.assignedInspectorId === input.assigneeId) return { id, assigneeId: input.assigneeId, version: order.version };
      if (order.taskId) {
        await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${order.taskId}::uuid FOR UPDATE`;
        const drafts = await tx.rollInspection.count({ where: { taskId: order.taskId, status: { in: ['DRAFT', 'RETURNED'] } } });
        if (drafts) throw AppError.invalidState('存在进行中或退回的草稿，请先处理后改派');
        await tx.qcTask.update({ where: { id: order.taskId }, data: { assigneeId: input.assigneeId, departmentId: assignee.departmentId } });
        await tx.qcTaskAssignmentEvent.create({ data: { taskId: order.taskId, actorId: actor.userId, fromAssigneeId: order.assignedInspectorId, toAssigneeId: input.assigneeId, reason: input.reason } });
      }
      const updated = await tx.vcansOrder.update({ where: { id }, data: { assignedInspectorId: input.assigneeId, version: { increment: 1 }, confirmedAt: null, confirmedById: null }, select: { version: true } });
      await tx.vcansOrderChange.create({ data: { orderId: id, actorId: actor.userId, targetType: 'ASSIGNMENT', targetId: id, before: { assigneeId: order.assignedInspectorId }, after: { assigneeId: input.assigneeId }, reason: input.reason } });
      await tx.notification.create({ data: { userId: input.assigneeId, type: 'VCANS_ASSIGNED', title: '新的验布订单', body: order.hNo, entityType: 'VcansOrder', entityId: id, pagePath: `/pages/orders/detail?id=${id}` } });
      return { id, assigneeId: input.assigneeId, version: updated.version };
    });
  }
  async detail(actor: Actor, id: string) {
    const order = await this.prisma.vcansOrder.findUnique({ where: { id }, include: {
      reports: { select: { id: true, confirmedAt: true }, orderBy: { version: 'desc' }, take: 1 },
      task: { select: { status: true, reminders: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } } } },
      lines: { orderBy: { lineNo: 'asc' }, include: { lots: { include: { rolls: { include: {
        roll: { select: { rollNo: true, qrCode: true } }, selections: { select: { id: true, kind: true, reason: true, createdAt: true, inspectionId: true, basisInspectionId: true, basisRevisionId: true } },
        taskRoll: { select: { id: true, inspections: { where: { status: { not: 'VOIDED' } }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true } } } },
      } } } } } },
    } });
    const business = order && businessDepartments(actor).includes(order.businessDepartmentId);
    const supervisor = order && actor.userId === order.supervisorId && actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR);
    const inspector = order && actor.userId === order.assignedInspectorId && actor.roles.some((r) => r.role === RoleCode.INSPECTOR);
    const privileged = actor.roles.some((role) => role.role === RoleCode.ADMIN || role.role === RoleCode.QUALITY_MANAGER);
    if (!order || (!business && !supervisor && !inspector && !privileged)) throw AppError.forbidden('没有该订单权限');
    const { lines: storedLines, reports, task, ...header } = order;
    const qc = Boolean(supervisor || inspector);
    const lines = storedLines.map(({ sourceSnapshot: _sourceSnapshot, lots, ...line }) => ({ ...line, lots: lots.map(({ rolls, ...lot }) => ({ ...lot, rolls: qc || privileged || order.confirmedAt ? rolls : [] })) }));
    const allLots = storedLines.flatMap((line) => line.lots);
    const allRolls = allLots.flatMap((lot) => lot.rolls);
    const plan = order.planMode === 'FULL' ? { mode: 'FULL' as const } : order.planMode === 'FIXED_PER_LOT' ? { mode: 'FIXED_PER_LOT' as const, fixedRolls: order.fixedRolls! } : { mode: 'PERCENT_PER_LOT' as const, percent: order.percent!.toString() };
    const totalRolls = allLots.reduce((sum, lot) => sum + lot.actualRollCount, 0);
    const originalRequired = allLots.reduce((sum, lot) => sum + requiredSampleCount(lot.actualRollCount, plan), 0);
    const original = allRolls.filter((roll) => roll.selections.some((selection) => selection.kind === 'ORIGINAL'));
    const originalReviewed = original.filter((roll) => roll.selections.some((selection) => selection.kind === 'ORIGINAL' && selection.basisInspectionId && selection.basisRevisionId)).length;
    const originalInspected = original.filter((roll) => roll.selections.some((selection) => selection.kind === 'ORIGINAL' && selection.inspectionId && roll.taskRoll?.inspections.some((inspection) => inspection.id === selection.inspectionId && ['SUBMITTED', 'APPROVED', 'REJECTED'].includes(inspection.status)))).length;
    const originalPending = Math.max(0, originalRequired - originalInspected);
    const additionalCount = allRolls.filter((roll) => roll.selections.some((selection) => selection.kind === 'ADDITIONAL')).length;
    const ready = order.arrivalComplete && allLinesArrived(storedLines) && originalRequired > 0 && original.length === originalRequired && originalReviewed === originalRequired;
    const pendingReview = allRolls.some((roll) => roll.taskRoll?.inspections[0]?.status === 'SUBMITTED');
    const sales = actor.roles.some((role) => role.role === RoleCode.SALES && role.departmentId === order.businessDepartmentId);
    const shareManager = actor.roles.some((role) => role.role === RoleCode.ADMIN || role.role === RoleCode.QUALITY_MANAGER);
    const manageableShare = this.isDemo ? null : await this.prisma.vcansReportShare.findFirst({ where: { reportVersion: { orderId: order.id }, ...(!shareManager ? { issuedById: actor.userId } : {}) }, select: { id: true } });
    const lastReminder = task?.reminders[0]?.createdAt;
    const arrivalReady = allLinesArrived(storedLines);
    const blockers = [!order.assignedInspectorId && '未分发跟单员', !order.fourPointStandardId && '未选择四分制标准', !order.templateId && '未选择检验模板', order.purpose === 'FORMAL' && !order.requiredStandardMode && '未选择订单标准模式', order.requiredStandardMode === 'CUSTOMER_REQUIRED' && (!order.customerId || !order.customerStandardId) && '客户标准待确认', allRolls.length === 0 && '未登记布卷'].filter((value): value is string => Boolean(value));
    return { order: { ...header, standardSource: order.requiredStandardMode === 'CUSTOMER_REQUIRED' && !order.customerStandardId ? null : order.customerStandardId ? 'CUSTOMER' : 'FACTORY' }, lines, lots: lines.flatMap((line) => line.lots), rolls: lines.flatMap((line) => line.lots.flatMap((lot) => lot.rolls)), progress: { totalRolls, originalRequired, originalReviewed, originalInspected, originalPending, additionalCount }, activationBlockers: blockers, capabilities: {
      canEdit: Boolean(business || supervisor), canRegister: qc, canSelectSamples: qc,
      canConfirmArrival: qc && arrivalReady && !order.arrivalComplete, canAssign: Boolean(supervisor && !allRolls.some((roll) => roll.taskRoll?.inspections.some((inspection) => inspection.status === 'DRAFT' || inspection.status === 'RETURNED'))),
      canConfirm: Boolean(supervisor && ready && !order.confirmedAt), canRemind: Boolean(sales && order.taskId && !order.confirmedAt && (pendingReview || ready) && (!lastReminder || Date.now() - lastReminder.getTime() >= 300000)),
      canExport: reports.length > 0, canShareCustomer: Boolean(!this.isDemo && order.purpose === 'FORMAL' && order.confirmedAt && task?.status !== 'CANCELLED' && reports[0]?.confirmedAt.getTime() === order.confirmedAt.getTime()), canManageCustomerShares: Boolean(manageableShare), canPrintLabels: qc || privileged, canConfigure: qc, canConfigureCustomerStandard: !order.taskId && this.customerAuthority(actor, order), canChangeRequiredStandardMode: !order.taskId && order.purpose === 'FORMAL' && this.customerAuthority(actor, order), canInspect: Boolean(inspector && blockers.length === 0), canAddAdditional: Boolean(supervisor),
    } };
  }
  async list(actor: Actor, query?: string) {
    const departments = businessDepartments(actor);
    const filters: Prisma.VcansOrderWhereInput[] = [];
    const privileged = actor.roles.some((role) => role.role === RoleCode.ADMIN || role.role === RoleCode.QUALITY_MANAGER);
    if (departments.length) filters.push({ businessDepartmentId: { in: departments } });
    if (actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR)) filters.push({ supervisorId: actor.userId });
    if (actor.roles.some((r) => r.role === RoleCode.INSPECTOR)) filters.push({ assignedInspectorId: actor.userId });
    if (!privileged && !filters.length) return { items: [] };
    const scope: Prisma.VcansOrderWhereInput = { ...(privileged ? {} : { OR: filters }), ...(this.isDemo ? {} : { purpose: { not: 'TEST' } }) };
    const items = await this.prisma.vcansOrder.findMany({
      where: query ? { AND: [scope, { OR: [{ hNo: { contains: query, mode: 'insensitive' } }, { lines: { some: { customerOrderNo: { contains: query, mode: 'insensitive' } } } }] }] } : scope,
      select: { id: true, hNo: true, requiredStandardMode: true, businessDepartmentId: true, taskId: true, version: true, arrivalComplete: true, planMode: true, fixedRolls: true, percent: true, assignedInspectorId: true, supervisorId: true, confirmedAt: true, createdAt: true, task: { select: { reminders: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } } } }, lines: { select: { lots: { select: { actualRollCount: true, rolls: { select: { selections: { select: { kind: true, inspectionId: true, basisInspectionId: true, basisRevisionId: true } }, taskRoll: { select: { inspections: { where: { status: { not: 'VOIDED' } }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true } } } } } } } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return { items: items.map(({ lines, task, ...order }) => {
      const lots = lines.flatMap((line) => line.lots);
      const plan = order.planMode === 'FULL' ? { mode: 'FULL' as const } : order.planMode === 'FIXED_PER_LOT' ? { mode: 'FIXED_PER_LOT' as const, fixedRolls: order.fixedRolls! } : { mode: 'PERCENT_PER_LOT' as const, percent: order.percent!.toString() };
      const totalRolls = lots.reduce((sum, lot) => sum + lot.actualRollCount, 0);
      const originalRequired = lots.reduce((sum, lot) => sum + requiredSampleCount(lot.actualRollCount, plan), 0);
      const rolls = lots.flatMap((lot) => lot.rolls);
      const original = rolls.filter((roll) => roll.selections.some((selection) => selection.kind === 'ORIGINAL'));
      const originalReviewed = original.filter((roll) => roll.selections.some((selection) => selection.kind === 'ORIGINAL' && selection.basisInspectionId && selection.basisRevisionId)).length;
    const originalInspected = original.filter((roll) => roll.selections.some((selection) => selection.kind === 'ORIGINAL' && selection.inspectionId && roll.taskRoll?.inspections.some((inspection) => inspection.id === selection.inspectionId && ['SUBMITTED', 'APPROVED', 'REJECTED'].includes(inspection.status)))).length;
    const originalPending = Math.max(0, originalRequired - originalInspected);
      const additionalCount = rolls.filter((roll) => roll.selections.some((selection) => selection.kind === 'ADDITIONAL')).length;
      const ready = order.arrivalComplete && originalRequired > 0 && original.length === originalRequired && originalReviewed === originalRequired;
      const status = order.confirmedAt ? 'COMPLETED' : !order.assignedInspectorId ? 'UNASSIGNED' : ready ? 'PENDING_CONFIRMATION' : 'INSPECTING';
      const sales = actor.roles.some((role) => role.role === RoleCode.SALES && role.departmentId === order.businessDepartmentId);
      const pendingReview = rolls.some((roll) => roll.taskRoll?.inspections[0]?.status === 'SUBMITTED');
      const lastReminder = task?.reminders[0]?.createdAt;
      const canRemind = Boolean(sales && order.taskId && !order.confirmedAt && (pendingReview || ready) && (!lastReminder || Date.now() - lastReminder.getTime() >= 300000));
      return { ...order, status, capabilities: { canRemind }, progress: { totalRolls, originalRequired, originalReviewed, originalInspected, originalPending, additionalCount } };
    }) };
  }
  async orderOptions(actor: Actor, id: string) {
    const order = await this.prisma.vcansOrder.findUnique({ where: { id }, select: { businessDepartmentId: true, supervisorId: true, assignedInspectorId: true } });
    const allowed = order && (businessDepartments(actor).includes(order.businessDepartmentId) || (actor.userId === order.supervisorId && actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR)) || (actor.userId === order.assignedInspectorId && actor.roles.some((r) => r.role === RoleCode.INSPECTOR)));  
    if (!order || !allowed) throw AppError.forbidden('没有该订单配置权限');
    return this.optionsForDepartments([order.businessDepartmentId]);
  }
  async options(actor: Actor) {
    const departments = businessDepartments(actor);
    if (!departments.length) throw AppError.forbidden('没有明确业务部门授权');
    return this.optionsForDepartments(departments);
  }
  private async optionsForDepartments(departments: string[]) {
    const [departmentRows, supervisors, standards, templates] = await Promise.all([
      this.prisma.department.findMany({ where: { id: { in: departments } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.user.findMany({ where: { status: 'ACTIVE', roles: { some: { role: { code: RoleCode.QC_SUPERVISOR } } } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.qualityStandard.findMany({ where: { kind: 'FOUR_POINT', isActive: true, versions: { some: { status: 'PUBLISHED', ...(this.isDemo ? {} : { purpose: 'FORMAL', isDevDefault: false }) } } }, select: { id: true, name: true, code: true, versions: { where: { status: 'PUBLISHED' }, orderBy: { version: 'desc' }, take: 1, select: { isDevDefault: true, purpose: true } } }, orderBy: { name: 'asc' } }),
      this.prisma.inspectionTemplate.findMany({ where: { isActive: true, ...(this.isDemo ? {} : { purpose: 'FORMAL' }) }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    ]);
    return { departments: departmentRows, supervisors, standards: standards.filter(({ versions }) => this.isDemo || (versions[0]?.purpose === 'FORMAL' && !versions[0].isDevDefault)).map(({ versions, ...standard }) => ({ ...standard, isDevDefault: versions[0]?.isDevDefault ?? false })), templates, plans: ['FULL', 'FIXED_PER_LOT', 'PERCENT_PER_LOT'] };
  }
  async create(actor: Actor, input: z.infer<typeof createVcansOrderSchema>) {
    if (!businessDepartments(actor).includes(input.businessDepartmentId)) throw AppError.forbidden('没有该业务部门的建单权限');
    if (!this.isDemo && !input.requiredStandardMode) throw AppError.badRequest('请明确选择订单标准模式');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const supervisor = await tx.user.findUnique({ where: { id: input.supervisorId }, include: { roles: { include: { role: true } } } });
        if (!supervisor || supervisor.status !== 'ACTIVE' || !supervisor.roles.some((r) => r.role.code === RoleCode.QC_SUPERVISOR)) throw AppError.badRequest('质检主管不存在、已停用或无主管权限');
        if (input.fourPointStandardId) {
          const standard = await tx.qualityStandard.findUnique({ where: { id: input.fourPointStandardId }, include: { versions: { where: { status: 'PUBLISHED' }, take: 1 } } });
          if (!standard?.isActive || standard.kind !== 'FOUR_POINT' || !standard.versions.length) throw AppError.badRequest('四分制标准不可用');
          if (!this.isDemo && (standard.versions[0].purpose !== 'FORMAL' || standard.versions[0].isDevDefault)) throw AppError.badRequest('正式订单不能选择未确认的标准');
        }
        if (input.templateId) {
          const template = await tx.inspectionTemplate.findUnique({ where: { id: input.templateId } });
          if (!template?.isActive) throw AppError.badRequest('检验模板不可用');
          if (!this.isDemo && template.purpose !== 'FORMAL') throw AppError.badRequest('正式订单不能选择未确认的模板');
        }
        const order = await tx.vcansOrder.create({ data: {
          hNo: input.hNo.trim().toUpperCase(), businessDepartmentId: input.businessDepartmentId,
          supervisorId: input.supervisorId, createdById: actor.userId, source: 'MANUAL', purpose: this.isDemo ? 'TEST' : 'FORMAL', requiredStandardMode: input.requiredStandardMode ?? null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          fourPointStandardId: input.fourPointStandardId ?? null, templateId: input.templateId ?? null,
          planMode: input.plan.mode,
          fixedRolls: input.plan.mode === 'FIXED_PER_LOT' ? input.plan.fixedRolls : null,
          percent: input.plan.mode === 'PERCENT_PER_LOT' ? input.plan.percent : null,
          lines: { create: input.lines.map((line, i) => ({ ...line, lineNo: i + 1 })) },
        }, select: { id: true, hNo: true, version: true } });
        await tx.vcansOrderChange.create({ data: { orderId: order.id, actorId: actor.userId, targetType: 'ORDER', targetId: order.id, after: { action: 'CREATE', hNo: order.hNo } } });
        await tx.notification.create({ data: { userId: input.supervisorId, type: 'VCANS_NEW_ORDER', title: '待分发验布订单', body: order.hNo, entityType: 'VcansOrder', entityId: order.id, pagePath: `/pages/orders/detail?id=${order.id}` } });
        return order;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw AppError.conflict('该编号无法使用，请核对');
      throw error;
    }
  }
}
