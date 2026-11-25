import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ErrorCode,
  RoleCode,
  JUDGE_LABELS,
  templateContentSchema,
  type InspectionDraft,
  type InspectionMode,
  type InspectionScope,
  type InspectionStatus,
  type JudgeResult,
  type Pagination,
  type TemplateContent,
} from '@fabricqc/shared';
import type { InspectionEvaluation } from '@fabricqc/quality-engine';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AppError } from '../common/app-error';
import { businessNo } from '../common/codes';
import { hasRole, MANAGE_TASKS, VIEW_QC_RECORDS, type Actor } from '../common/actor';
import type { RequestMeta } from '../common/decorators';
import { pageArgs, paged } from '../common/pagination';
import { num } from '../common/serialize.interceptor';
import { AuditService } from '../audit/audit.service';
import { MediaService } from '../media/media.service';
import { NotificationsService, OutboxEvent } from '../notifications/notifications.service';
import { QualityService, type SpecSnapshot, type StandardSnapshot } from '../quality/quality.service';
import { actualLengthOf, checkCompleteness } from './completeness';
import { InspectionAccess, ReviewRouting } from './inspection-access';
import { validateBusinessConfiguration } from '../tasks/business-configuration';
import { vcansFabricFallback, vcansSelectionAllowsInspection } from './vcans-fabric';

const person = { select: { id: true, name: true, employeeNo: true } } as const;

const detailInclude = {
  roll: {
    include: {
      fabric: true,
      vcansOrderRoll: { select: { lot: { select: { line: { select: { productCode: true, productName: true, specification: true, color: true } } } } } },
      lot: { select: { id: true, lotNo: true, dyeLotNo: true } },
    },
  },
  task: { select: { id: true, taskNo: true, title: true, departmentId: true, reviewerId: true, origin: true, vcansOrder: { select: { supervisorId: true } } } },
  inspector: { select: { id: true, name: true, employeeNo: true, departmentId: true } },
  segments: { orderBy: { seq: 'asc' } },
  measurements: { orderBy: [{ itemKey: 'asc' }, { seq: 'asc' }] },
  defects: { orderBy: { positionM: 'asc' } },
  mediaLinks: { include: { media: true }, orderBy: { createdAt: 'asc' } },
  reviews: { include: { reviewer: person }, orderBy: { createdAt: 'asc' } },
  reviewAssignments: { include: { assignee: person }, orderBy: { createdAt: 'asc' } },
  revisions: { select: { revision: true, submittedAt: true, submittedById: true }, orderBy: { revision: 'asc' } },
} satisfies Prisma.RollInspectionInclude;

type InspectionWithDetail = Prisma.RollInspectionGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly quality: QualityService,
    private readonly media: MediaService,
    private readonly notifications: NotificationsService,
    private readonly access: InspectionAccess,
    private readonly routing: ReviewRouting,
  ) {}

  // 按北京时间统计本人今天提交过的不同布卷，重复提交同一卷只计一次。
  async today(actor: Actor) {
    const day = 24 * 60 * 60 * 1000;
    const offset = 8 * 60 * 60 * 1000;
    const start = new Date(Math.floor((Date.now() + offset) / day) * day - offset);
    const revisions = await this.prisma.inspectionRevision.findMany({
      where: { submittedById: actor.userId, submittedAt: { gte: start, lt: new Date(start.getTime() + day) } },
      select: { inspection: { select: { rollId: true } } },
    });
    return { rolls: new Set(revisions.map((revision) => revision.inspection.rollId)).size };
  }

  // ------------------------------------------------------------------ 开始检验
  /**
   * 开始检验：对标准版本、模板和规格做快照。
   * 同一任务布卷已有进行中的检验时直接返回（可恢复），保证重复点击不会产生多条记录。
   */
  async start(actor: Actor, input: { taskRollId: string; mode: InspectionMode; scope: InspectionScope }, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.qcTaskRoll.findUnique({ where: { id: input.taskRollId }, select: { taskId: true, vcansOrderRoll: { select: { orderId: true } } } });
      if (!target) throw AppError.notFound('任务布卷');
      if (target.vcansOrderRoll) await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${target.vcansOrderRoll.orderId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${target.taskId}::uuid FOR UPDATE`;
      const tr = await tx.qcTaskRoll.findUnique({
        where: { id: input.taskRollId },
        include: {
          task: { include: { template: true, delivery: true } },
          roll: { include: { fabric: true, lot: true, vcansOrderRoll: { include: { lot: { include: { line: true } }, selections: true } } } },
          inspections: { orderBy: { createdAt: 'desc' } },
        },
      });
      if (!tr) throw AppError.notFound('任务布卷');
      if (tr.roll.vcansOrderRoll) {
        const vcansOrder = await tx.vcansOrder.findUniqueOrThrow({ where: { id: tr.roll.vcansOrderRoll.orderId }, select: { taskId: true } });
        if (!target.vcansOrderRoll || target.vcansOrderRoll.orderId !== tr.roll.vcansOrderRoll.orderId || vcansOrder.taskId !== tr.taskId || tr.roll.vcansOrderRoll.taskRollId !== tr.id) throw AppError.invalidState('H订单布卷与任务关联不一致');
      }
      if (!vcansSelectionAllowsInspection(tr.roll.vcansOrderRoll?.selections.map((selection) => selection.kind) ?? null)) throw AppError.invalidState('该卷未列入原定或主管批准的追加检验');
      if (tr.task.assigneeId !== actor.userId) throw AppError.forbidden('该布卷未分配给你');
      if (tr.task.origin === 'BUSINESS' && tr.task.delivery) throw AppError.invalidState('整单已交付，不能修改');
      if (tr.task.status === 'CANCELLED' || tr.task.status === 'COMPLETED') throw AppError.invalidState('任务已结束');

      const active = tr.inspections.find((i) => ['DRAFT', 'SUBMITTED', 'RETURNED'].includes(i.status));
      if (active) return { id: active.id, resumed: true };
      if (tr.status !== 'PENDING') throw AppError.invalidState('该布卷已完成检验；如需复验请由主管发起');

      const fp = await tx.standardVersion.findFirst({
        where: { standardId: tr.task.fourPointStandardId, status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        include: { standard: true },
      });
      if (!fp) throw AppError.invalidState('任务的四分制标准没有已发布版本');
      const cs = tr.task.customerStandardId
        ? await tx.standardVersion.findFirst({
            where: { standardId: tr.task.customerStandardId, status: 'PUBLISHED' },
            orderBy: { version: 'desc' },
            include: { standard: true },
          })
        : null;
      if (tr.task.customerStandardId && !cs) throw AppError.invalidState('任务的客户标准没有已发布版本');

      validateBusinessConfiguration(tr.task.template.content, [fp.rules, ...(cs ? [cs.rules] : [])]);
      const template = templateContentSchema.parse(tr.task.template.content);
      const standardSnapshot: StandardSnapshot = {
        fourPoint: { versionId: fp.id, name: fp.standard.name, version: fp.version, isDevDefault: fp.isDevDefault, rules: fp.rules },
        customer: cs
          ? { versionId: cs.id, name: cs.standard.name, version: cs.version, isDevDefault: cs.isDevDefault, rules: cs.rules }
          : null,
      };
      const f = tr.roll.fabric;
      const source = vcansFabricFallback(tr.roll.vcansOrderRoll?.lot.line ?? null);
      if (!f && !tr.roll.vcansOrderRoll) throw AppError.invalidState('布卷缺少面料及关联订单资料');
      const spec: SpecSnapshot = {
        fabricId: f?.id ?? null,
        fabricCode: f?.code ?? source.fabricCode,
        fabricName: f?.nameZh ?? source.fabricName,
        fabricNameEn: f?.nameEn ?? null,
        specification: source.specification,
        composition: f?.composition ?? null,
        weaveStructure: f?.weaveStructure ?? null,
        coatingType: f?.coatingType ?? null,
        color: source.color ?? f?.color ?? null,
        colorCode: tr.roll.colorCode ?? f?.colorCode ?? null,
        widthCm: f ? num(f.widthCm) : null,
        cuttableWidthCm: f ? num(f.cuttableWidthCm) : null,
        gsm: f ? num(f.gsm) : null,
        rollNo: tr.roll.rollNo,
        lotNo: tr.roll.lot?.lotNo ?? null,
        dyeLotNo: tr.roll.dyeLotNo,
        nominalLengthM: num(tr.roll.nominalLengthM),
      };
      const previous = tr.inspections.find((i) => i.status === 'APPROVED' || i.status === 'REJECTED');
      const selected = tr.roll.vcansOrderRoll?.selections ?? null;
      const pendingSelection = selected ? (!previous ? selected.find((selection) => selection.kind === 'ORIGINAL' && !selection.inspectionId) : null) ?? [...selected].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).find((selection) => selection.kind === 'ADDITIONAL' && !selection.inspectionId) : null;
      if (selected && !pendingSelection) throw AppError.invalidState('该卷没有待执行的原定或追加检验决定');

      const created = await tx.rollInspection.create({
        data: {
          inspectionNo: businessNo('QC'),
          taskId: tr.taskId,
          taskRollId: tr.id,
          rollId: tr.rollId,
          inspectorId: actor.userId,
          mode: input.mode,
          scope: input.scope,
          previousInspectionId: previous?.id ?? null,
          fourPointVersionId: fp.id,
          customerVersionId: cs?.id ?? null,
          standardSnapshot: standardSnapshot as unknown as Prisma.InputJsonValue,
          templateSnapshot: { ...template, templateId: tr.task.template.id, templateVersion: tr.task.template.version } as Prisma.InputJsonValue,
          specSnapshot: spec as Prisma.InputJsonValue,
        },
      });
      if (pendingSelection) {
        await tx.vcansSampleSelection.update({ where: { id: pendingSelection.id }, data: { inspectionId: created.id } });
        await tx.vcansOrder.update({ where: { id: pendingSelection.orderId }, data: { version: { increment: 1 }, confirmedAt: null, confirmedById: null } });
      }
      await tx.qcTaskRoll.update({ where: { id: tr.id }, data: { status: 'IN_PROGRESS' } });
      await tx.fabricRoll.update({ where: { id: tr.rollId }, data: { status: 'IN_INSPECTION' } });
      await tx.qcTask.updateMany({ where: { id: tr.taskId, status: 'OPEN' }, data: { status: 'IN_PROGRESS' } });
      await this.audit.log(
        actor,
        {
          action: 'inspection.start',
          entityType: 'RollInspection',
          entityId: created.id,
          after: { inspectionNo: created.inspectionNo, mode: input.mode, scope: input.scope, fourPointVersionId: fp.id, customerVersionId: cs?.id },
        },
        meta,
        tx,
      );
      return { id: created.id, resumed: false };
    });
  }

  // ------------------------------------------------------------------ 查询
  private async loadDetail(id: string) {
    const i = await this.prisma.rollInspection.findUnique({ where: { id }, include: detailInclude });
    if (!i) throw AppError.notFound('检验记录');
    return i;
  }

  async get(actor: Actor, id: string) {
    const i = await this.loadDetail(id);
    const ref = {
      id: i.id,
      inspectorId: i.inspectorId,
      status: i.status,
      revision: i.revision,
      taskDepartmentId: i.task.departmentId,
      inspectorDepartmentId: i.inspector.departmentId,
      taskReviewerId: i.task.reviewerId,
      isVcans: Boolean(i.task.vcansOrder),
      vcansSupervisorId: i.task.vcansOrder?.supervisorId ?? null,
    };
    if (!this.access.canView(actor, ref)) throw AppError.forbidden('没有权限查看该检验记录');
    const revision = i.taskId && ['SUBMITTED', 'APPROVED', 'REJECTED'].includes(i.status) && i.revision > 0
      ? await this.prisma.inspectionRevision.findUnique({ where: { inspectionId_revision: { inspectionId: i.id, revision: i.revision } }, select: { snapshot: true } }) : null;
    const frozen = (revision?.snapshot as { photos?: { mediaId: string; objectKey: string; thumbKey?: string | null }[] } | undefined)?.photos;
    if (i.task.origin === 'BUSINESS' && ['SUBMITTED', 'APPROVED', 'REJECTED'].includes(i.status) && (!revision || !frozen || i.mediaLinks.some((l) => !frozen.some((f) => f.mediaId === l.mediaId && f.objectKey.startsWith('frozen-inspections/'))))) throw AppError.invalidState('提交照片快照不完整');
    return this.present(i, {
      frozen,
      canEdit: this.access.canEdit(actor, ref),
      canReview: await this.access.canReview(actor, ref),
    });
  }

  private async present(i: InspectionWithDetail, permissions: { canEdit: boolean; canReview: boolean; frozen?: { mediaId: string; objectKey: string; thumbKey?: string | null }[] }) {
    const photos = await Promise.all(
      i.mediaLinks.map(async (l) => ({
        mediaId: l.mediaId,
        kind: l.kind,
        checkpointKey: l.checkpointKey,
        defectClientId: l.defectClientId,
        status: l.media.status,
        ...(await this.media.urls((() => {
          const f = permissions.frozen?.find((p) => p.mediaId === l.mediaId);
          return f ? { objectKey: f.objectKey, thumbKey: f.thumbKey ?? null } : l.media;
        })())),
      })),
    );
    const standards = i.standardSnapshot as unknown as StandardSnapshot;
    const unit = (key: string) =>
      (i.templateSnapshot as unknown as TemplateContent).measurements.find((m) => m.key === key)?.unit ?? '';
    return {
      id: i.id,
      inspectionNo: i.inspectionNo,
      status: i.status,
      mode: i.mode,
      scope: i.scope,
      revision: i.revision,
      draftVersion: i.draftVersion,
      previousInspectionId: i.previousInspectionId,
      roll: {
        id: i.roll.id,
        rollNo: i.roll.rollNo,
        qrCode: i.roll.qrCode,
        status: i.roll.status,
        dyeLotNo: i.roll.dyeLotNo,
        colorCode: i.roll.colorCode,
        nominalLengthM: i.roll.nominalLengthM,
        actualLengthM: i.roll.actualLengthM,
        lot: i.roll.lot,
        fabric: i.roll.fabric ? { id: i.roll.fabric.id, code: i.roll.fabric.code, nameZh: i.roll.fabric.nameZh } : null,
        orderLine: i.roll.vcansOrderRoll?.lot.line ?? null,
      },
      task: { id: i.task.id, taskNo: i.task.taskNo, title: i.task.title, origin: i.task.origin },
      inspector: { id: i.inspector.id, name: i.inspector.name, employeeNo: i.inspector.employeeNo },
      spec: i.specSnapshot,
      template: i.templateSnapshot,
      standards,
      segments: i.segments.map((s) => ({ startM: num(s.startM)!, endM: num(s.endM)! })),
      measurements: i.measurements.map((m) => ({
        itemKey: m.itemKey,
        seq: m.seq,
        value: num(m.value)!,
        unit: m.unit || unit(m.itemKey),
        positionM: num(m.positionM),
      })),
      checklist: i.checklistResults,
      defects: i.defects.map((d) => ({
        clientId: d.clientId,
        defectTypeCode: d.defectTypeCode,
        lengthCm: num(d.lengthCm)!,
        widthCm: num(d.widthCm),
        positionM: num(d.positionM)!,
        widthPositionCm: num(d.widthPositionCm),
        severity: d.severity,
        points: num(d.points),
        remark: d.remark,
      })),
      photos,
      remarks: i.remarks,
      result: i.resultSnapshot,
      fourPointResult: i.fourPointResult,
      customerResult: i.customerResult,
      overallResult: i.overallResult,
      totalPoints: i.totalPoints,
      normalizedPoints: i.normalizedPoints,
      inspectedLengthM: i.inspectedLengthM,
      actualLengthM: i.actualLengthM,
      widthUsedCm: i.widthUsedCm,
      startedAt: i.startedAt,
      submittedAt: i.submittedAt,
      decidedAt: i.decidedAt,
      reviews: i.reviews,
      assignments: i.reviewAssignments.map((a) => ({
        revision: a.revision,
        status: a.status,
        assignee: a.assignee,
        createdAt: a.createdAt,
        completedAt: a.completedAt,
      })),
      revisions: i.revisions,
      permissions: { canEdit: permissions.canEdit, canReview: permissions.canReview },
    };
  }

  /** PC 质检记录查询 */
  async list(
    actor: Actor,
    p: Pagination & {
      status?: InspectionStatus;
      overallResult?: JudgeResult;
      inspectorId?: string;
      from?: Date;
      to?: Date;
    },
  ) {
    const privileged = hasRole(actor, RoleCode.ADMIN, RoleCode.QUALITY_MANAGER);
    const supervisorRoles = actor.roles.filter((r) => r.role === RoleCode.QC_SUPERVISOR);
    const globalSupervisor = supervisorRoles.some((r) => r.departmentId === null);
    const departments = supervisorRoles.flatMap((r) => r.departmentId ? [r.departmentId] : []);
    const qcScope: Prisma.RollInspectionWhereInput = privileged || globalSupervisor ? {} : { OR: [{ inspectorId: actor.userId }, ...(supervisorRoles.length ? [{ task: { departmentId: { in: departments } } }, { task: { reviewerId: actor.userId } }] : [])] };
    if (!privileged && !supervisorRoles.length && !hasRole(actor, RoleCode.INSPECTOR)) throw AppError.forbidden('没有质检记录权限');
    const vcansScope: Prisma.RollInspectionWhereInput = privileged ? {} : { OR: [
      { task: { vcansOrder: null } },
      ...(supervisorRoles.length ? [{ task: { vcansOrder: { supervisorId: actor.userId } } }] : []),
      ...(hasRole(actor, RoleCode.INSPECTOR) ? [{ inspectorId: actor.userId }] : []),
    ] };
    const where: Prisma.RollInspectionWhereInput = {
      AND: [qcScope, vcansScope, ...(p.inspectorId ? [{ inspectorId: p.inspectorId }] : [])],
      status: p.status,
      overallResult: p.overallResult,
      ...(p.from || p.to ? { startedAt: { gte: p.from, lte: p.to } } : {}),
      ...(p.q
        ? {
            OR: [
              { inspectionNo: { contains: p.q, mode: 'insensitive' } },
              { roll: { rollNo: { contains: p.q, mode: 'insensitive' } } },
              { roll: { fabric: { code: { contains: p.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.rollInspection.findMany({
        where,
        include: {
          roll: { select: { id: true, rollNo: true, fabric: { select: { code: true, nameZh: true } } } },
          inspector: person,
          task: { select: { id: true, taskNo: true } },
          _count: { select: { defects: true } },
        },
        orderBy: { startedAt: 'desc' },
        ...pageArgs(p),
      }),
      this.prisma.rollInspection.count({ where }),
    ]);
    return paged(
      items.map(({ standardSnapshot: _s, templateSnapshot: _t, specSnapshot: _p, resultSnapshot: _r, checklistResults: _c, ...rest }) => rest),
      total,
      p,
    );
  }

  // ------------------------------------------------------------------ 草稿同步
  private async validateDraftRefs(tx: Tx, inspectionId: string, template: TemplateContent, d: InspectionDraft) {
    const codes = [...new Set(d.defects.map((x) => x.defectTypeCode))];
    if (codes.length) {
      const found = await tx.defectType.findMany({ where: { code: { in: codes }, isActive: true }, select: { code: true } });
      const missing = codes.filter((c) => !found.some((f) => f.code === c));
      if (missing.length) throw AppError.badRequest(`疵点类型不存在或已停用：${missing.join('、')}`);
    }
    const mKeys = new Set(template.measurements.map((m) => m.key));
    const badM = d.measurements.filter((m) => !mKeys.has(m.itemKey));
    if (badM.length) throw AppError.badRequest(`模板中没有测量项：${[...new Set(badM.map((m) => m.itemKey))].join('、')}`);
    const cKeys = new Set(template.checklist.map((c) => c.key));
    const badC = d.checklist.filter((c) => !cKeys.has(c.key));
    if (badC.length) throw AppError.badRequest(`模板中没有检查项：${badC.map((c) => c.key).join('、')}`);
    const pKeys = new Set(template.photoCheckpoints.map((c) => c.key));
    const badP = d.photos.filter((p) => p.kind === 'CHECKPOINT' && !pKeys.has(p.checkpointKey ?? ''));
    if (badP.length) throw AppError.badRequest('照片关联了模板中不存在的拍照点');
    const mediaIds = [...new Set(d.photos.map((p) => p.mediaId))];
    if (mediaIds.length !== d.photos.length) throw AppError.badRequest('同一张照片不能重复关联');
    if (mediaIds.length) {
      const media = await tx.mediaAsset.findMany({ where: { id: { in: mediaIds } } });
      const invalid = mediaIds.filter((id) => {
        const m = media.find((x) => x.id === id);
        return !m || m.inspectionId !== inspectionId || m.status !== 'UPLOADED';
      });
      if (invalid.length) throw AppError.badRequest(`有 ${invalid.length} 张照片不存在、未上传成功或不属于本次检验`);
    }
  }

  private evaluationData(scope: InspectionScope, d: Pick<InspectionDraft, 'segments' | 'defects' | 'measurements' | 'checklist'>, template: TemplateContent) {
    return {
      scope,
      checklist: d.checklist,
      templateChecklist: template.checklist,
      segments: d.segments.map((s) => ({ startM: s.startM, endM: s.endM })),
      defects: d.defects.map((x) => ({
        clientId: x.clientId,
        defectTypeCode: x.defectTypeCode,
        lengthCm: x.lengthCm,
        widthCm: x.widthCm ?? null,
        positionM: x.positionM,
        severity: x.severity,
      })),
      measurements: d.measurements.map((m) => ({ itemKey: m.itemKey, seq: m.seq, value: m.value })),
    };
  }

  /**
   * 整体同步草稿（乐观锁）。疵点以 clientId upsert，保持服务端 ID 稳定。
   * 返回服务端计算的预览结果。
   */
  async saveDraft(actor: Actor, id: string, d: InspectionDraft, meta: RequestMeta) {
    return this.prisma.$transaction(
      async (tx) => {
        const target = await tx.rollInspection.findUnique({ where: { id }, select: { taskId: true, task: { select: { vcansOrder: { select: { id: true } } } } } });
        if (!target) throw AppError.notFound('检验记录');
        if (target.task.vcansOrder) await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${target.task.vcansOrder.id}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${target.taskId}::uuid FOR UPDATE`;
        const i = await tx.rollInspection.findUnique({ where: { id }, include: { task: { include: { delivery: true } } } });
        if (!i) throw AppError.notFound('检验记录');
        if (i.inspectorId !== actor.userId || (i.task.origin === 'BUSINESS' && i.task.assigneeId !== actor.userId)) throw AppError.forbidden('只能编辑当前分配给自己的检验');
        if (i.task.origin === 'BUSINESS' && i.task.delivery) throw AppError.invalidState('整单已交付，不能修改');
        if (i.status !== 'DRAFT' && i.status !== 'RETURNED') throw AppError.invalidState('检验已提交或已审核，不能修改');
        if (d.baseVersion !== i.draftVersion) {
          throw AppError.of(ErrorCode.VERSION_CONFLICT, '草稿已在其他设备更新，请先加载最新数据', 409, {
            serverVersion: i.draftVersion,
          });
        }
        const template = templateContentSchema.parse(i.templateSnapshot);
        await this.validateDraftRefs(tx, id, template, d);

        const evaluation = this.quality.evaluate(
          i.standardSnapshot as unknown as StandardSnapshot,
          i.specSnapshot as unknown as SpecSnapshot,
          this.evaluationData(d.scope, d, template),
        );
        const points = new Map(evaluation.fourPoint.scoring.defectScores.map((s) => [s.clientId, s.points]));
        const unitOf = new Map(template.measurements.map((m) => [m.key, m.unit]));

        const bumped = await tx.rollInspection.updateMany({
          where: { id, draftVersion: d.baseVersion, status: { in: ['DRAFT', 'RETURNED'] } },
          data: {
            mode: d.mode,
            scope: d.scope,
            remarks: d.remarks ?? null,
            checklistResults: d.checklist as Prisma.InputJsonValue,
            draftVersion: { increment: 1 },
            resultSnapshot: evaluation as unknown as Prisma.InputJsonValue,
            fourPointResult: evaluation.fourPoint.result,
            customerResult: evaluation.customer?.result ?? null,
            overallResult: evaluation.overall.result,
            totalPoints: evaluation.fourPoint.scoring.totalPoints,
            normalizedPoints: evaluation.fourPoint.scoring.normalizedPoints,
            inspectedLengthM: evaluation.inspectedLengthM,
            actualLengthM: actualLengthOf(d.measurements),
            widthUsedCm: evaluation.widthUsedCm,
          },
        });
        if (bumped.count !== 1) throw AppError.of(ErrorCode.VERSION_CONFLICT, '草稿已被更新，请刷新', 409);

        await tx.inspectionSegment.deleteMany({ where: { inspectionId: id } });
        const segs = [...d.segments].sort((a, b) => a.startM - b.startM);
        if (segs.length) {
          await tx.inspectionSegment.createMany({
            data: segs.map((s, k) => ({ inspectionId: id, seq: k + 1, startM: s.startM, endM: s.endM })),
          });
        }
        await tx.measurement.deleteMany({ where: { inspectionId: id } });
        if (d.measurements.length) {
          await tx.measurement.createMany({
            data: d.measurements.map((m) => ({
              inspectionId: id,
              itemKey: m.itemKey,
              seq: m.seq,
              value: m.value,
              unit: unitOf.get(m.itemKey) ?? '',
              positionM: m.positionM ?? null,
            })),
          });
        }
        const keep = d.defects.map((x) => x.clientId);
        await tx.defect.deleteMany({ where: { inspectionId: id, clientId: { notIn: keep } } });
        for (const x of d.defects) {
          const data = {
            defectTypeCode: x.defectTypeCode,
            lengthCm: x.lengthCm,
            widthCm: x.widthCm ?? null,
            positionM: x.positionM,
            widthPositionCm: x.widthPositionCm ?? null,
            severity: x.severity,
            points: points.get(x.clientId) ?? null,
            remark: x.remark ?? null,
          };
          await tx.defect.upsert({
            where: { inspectionId_clientId: { inspectionId: id, clientId: x.clientId } },
            create: { inspectionId: id, clientId: x.clientId, ...data },
            update: data,
          });
        }
        await tx.mediaLink.deleteMany({ where: { inspectionId: id } });
        if (d.photos.length) {
          await tx.mediaLink.createMany({
            data: d.photos.map((p) => ({
              mediaId: p.mediaId,
              inspectionId: id,
              kind: p.kind,
              checkpointKey: p.kind === 'CHECKPOINT' ? (p.checkpointKey ?? null) : null,
              defectClientId: p.kind === 'DEFECT' ? (p.defectClientId ?? null) : null,
            })),
          });
        }
        void meta;
        return { draftVersion: i.draftVersion + 1, evaluation, savedAt: new Date() };
      },
      { timeout: 20_000 },
    );
  }

  // ------------------------------------------------------------------ 提交
  /**
   * 提交审核。完整性校验 → 引擎重新计算 → 锁定 → 修订快照 → 审核待办 + 站内通知 + outbox，
   * 全部在一个数据库事务内完成。相同幂等键重复提交返回第一次的结果。
   */
  async submit(actor: Actor, id: string, input: { idempotencyKey: string; draftVersion: number }, meta: RequestMeta) {
    const replay = await this.prisma.inspectionRevision.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) {
      if (replay.inspectionId !== id) throw AppError.conflict('幂等键已被其他检验使用');
      const cur = await this.prisma.rollInspection.findUniqueOrThrow({ where: { id }, include: { task: true } });
      if (cur.inspectorId !== actor.userId || (cur.task.origin === 'BUSINESS' && cur.task.assigneeId !== actor.userId)) throw AppError.forbidden('无权提交此检验');
      return { id, status: cur.status, revision: replay.revision, replayed: true, overallResult: cur.overallResult };
    }

    return this.prisma.$transaction(
      async (tx) => {
        const taskRef = await tx.rollInspection.findUnique({ where: { id }, select: { taskId: true, task: { select: { vcansOrder: { select: { id: true } } } } } });
        if (!taskRef) throw AppError.notFound('检验记录');
        if (taskRef.task.vcansOrder) await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${taskRef.task.vcansOrder.id}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${taskRef.taskId}::uuid FOR UPDATE`;
        const i = await tx.rollInspection.findUnique({
          where: { id },
          include: {
            segments: { orderBy: { seq: 'asc' } },
            measurements: true,
            defects: true,
            mediaLinks: { include: { media: true } },
            task: true,
            roll: true,
          },
        });
        if (!i) throw AppError.notFound('检验记录');
        if (i.inspectorId !== actor.userId || (i.task.origin === 'BUSINESS' && i.task.assigneeId !== actor.userId)) throw AppError.forbidden('只能提交当前分配给自己的检验');
        if (i.status !== 'DRAFT' && i.status !== 'RETURNED') throw AppError.invalidState('检验已提交或已审核');
        if (input.draftVersion !== i.draftVersion) {
          throw AppError.of(ErrorCode.VERSION_CONFLICT, '本地草稿未同步到最新版本，请先同步再提交', 409, {
            serverVersion: i.draftVersion,
          });
        }

        const template = templateContentSchema.parse(i.templateSnapshot);
        const standards = i.standardSnapshot as unknown as StandardSnapshot;
        const spec = i.specSnapshot as unknown as SpecSnapshot;
        const segments = i.segments.map((s) => ({ startM: num(s.startM)!, endM: num(s.endM)! }));
        const measurements = i.measurements.map((m) => ({ itemKey: m.itemKey, seq: m.seq, value: num(m.value)! }));
        const defects = i.defects.map((x) => ({
          clientId: x.clientId,
          defectTypeCode: x.defectTypeCode,
          lengthCm: num(x.lengthCm)!,
          widthCm: num(x.widthCm),
          positionM: num(x.positionM)!,
          severity: x.severity,
        }));

        const problems = checkCompleteness({
          scope: i.scope,
          template,
          nominalLengthM: spec.nominalLengthM ?? null,
          segments,
          measurements,
          checklist: (i.checklistResults as { key: string; status: string }[]) ?? [],
          defects,
          photos: i.mediaLinks.map((l) => ({
            kind: l.kind,
            checkpointKey: l.checkpointKey,
            defectClientId: l.defectClientId,
            uploaded: l.media.status === 'UPLOADED',
          })),
          requireDefectPhoto: this.quality.requireDefectPhoto(standards),
        });
        if (problems.length) {
          throw AppError.of(ErrorCode.INCOMPLETE_INSPECTION, `检验记录不完整（${problems.length} 项）`, 422, { problems });
        }

        const evaluation: InspectionEvaluation = this.quality.evaluate(standards, spec, {
          scope: i.scope,
          segments,
          defects,
          measurements,
          checklist: (i.checklistResults as InspectionDraft['checklist']) ?? [],
          templateChecklist: template.checklist,
        });

        let reviewers = await this.routing.resolve(tx, {
          inspectorId: i.inspectorId,
          reviewerId: i.task.reviewerId,
          departmentId: i.task.departmentId,
        });
        if (taskRef.task.vcansOrder && reviewers.length) {
          const order = await tx.vcansOrder.findUniqueOrThrow({ where: { id: taskRef.task.vcansOrder.id }, select: { supervisorId: true } });
          const managers = await tx.user.findMany({ where: { id: { in: reviewers }, status: 'ACTIVE', roles: { some: { role: { code: RoleCode.QUALITY_MANAGER } } } }, select: { id: true } });
          const managerIds = new Set(managers.map((manager) => manager.id));
          reviewers = reviewers.filter((reviewerId) => reviewerId === order.supervisorId || managerIds.has(reviewerId));
        }
        if (!reviewers.length) {
          throw AppError.of(ErrorCode.NO_REVIEWER, '没有可用的审核人，请联系管理员配置质检主管或质量经理', 409);
        }

        const revision = i.revision + 1;
        const frozenPhotos = i.task.origin === 'BUSINESS' ? await this.media.freezeForRevision(id, revision, i.mediaLinks.map((l) => ({ mediaId: l.mediaId, objectKey: l.media.objectKey, thumbKey: l.media.thumbKey }))) : null;
        const now = new Date();
        const locked = await tx.rollInspection.updateMany({
          where: { id, draftVersion: input.draftVersion, status: { in: ['DRAFT', 'RETURNED'] } },
          data: {
            status: 'SUBMITTED',
            revision,
            submittedAt: now,
            resultSnapshot: evaluation as unknown as Prisma.InputJsonValue,
            fourPointResult: evaluation.fourPoint.result,
            customerResult: evaluation.customer?.result ?? null,
            overallResult: evaluation.overall.result,
            totalPoints: evaluation.fourPoint.scoring.totalPoints,
            normalizedPoints: evaluation.fourPoint.scoring.normalizedPoints,
            inspectedLengthM: evaluation.inspectedLengthM,
            actualLengthM: actualLengthOf(measurements),
            widthUsedCm: evaluation.widthUsedCm,
          },
        });
        if (locked.count !== 1) throw AppError.conflict('检验状态已变化，请刷新后重试');

        const points = new Map(evaluation.fourPoint.scoring.defectScores.map((s) => [s.clientId, s.points]));
        for (const x of i.defects) {
          await tx.defect.update({ where: { id: x.id }, data: { points: points.get(x.clientId) ?? null } });
        }

        await tx.inspectionRevision.create({
          data: {
            inspectionId: id,
            revision,
            idempotencyKey: input.idempotencyKey,
            submittedById: actor.userId,
            submittedAt: now,
            snapshot: {
              mode: i.mode,
              scope: i.scope,
              remarks: i.remarks,
              segments,
              measurements,
              checklist: i.checklistResults,
              defects: defects.map((x) => ({ ...x, points: points.get(x.clientId) ?? null })),
              photos: i.mediaLinks.map((l) => ({
                mediaId: l.mediaId,
                kind: l.kind,
                checkpointKey: l.checkpointKey,
                defectClientId: l.defectClientId,
                objectKey: frozenPhotos?.find((p) => p.mediaId === l.mediaId)?.objectKey ?? l.media.objectKey,
                thumbKey: frozenPhotos?.find((p) => p.mediaId === l.mediaId)?.thumbKey ?? l.media.thumbKey,
              })),
              standardVersionIds: { fourPoint: standards.fourPoint.versionId, customer: standards.customer?.versionId ?? null },
              evaluation,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        await tx.reviewAssignment.updateMany({ where: { inspectionId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
        await tx.reviewAssignment.createMany({
          data: reviewers.map((assigneeId) => ({ inspectionId: id, revision, assigneeId })),
        });
        await tx.qcTaskRoll.update({ where: { id: i.taskRollId }, data: { status: 'SUBMITTED' } });
        await tx.fabricRoll.update({ where: { id: i.rollId }, data: { status: 'SUBMITTED' } });

        const resultLabel = JUDGE_LABELS[evaluation.overall.result];
        await this.notifications.notifyInApp(tx, {
          userIds: reviewers,
          type: 'REVIEW_REQUEST',
          title: `待审核：${i.roll.rollNo}`,
          body: `${actor.name} 提交了 ${spec.fabricCode} 卷 ${i.roll.rollNo} 的检验，系统判定：${resultLabel}`,
          entityType: 'RollInspection',
          entityId: id,
          pagePath: `/pages/review/detail?id=${id}`,
        });
        await this.notifications.enqueue(tx, OutboxEvent.REVIEW_REQUESTED, `review-request:${id}:${revision}`, {
          inspectionId: id,
          revision,
          recipientIds: reviewers,
        });
        await this.audit.log(
          actor,
          {
            action: revision > 1 ? 'inspection.resubmit' : 'inspection.submit',
            entityType: 'RollInspection',
            entityId: id,
            after: { revision, overallResult: evaluation.overall.result, reviewers },
          },
          meta,
          tx,
        );
        if (taskRef.task.vcansOrder) await tx.vcansOrder.update({ where: { id: taskRef.task.vcansOrder.id }, data: { version: { increment: 1 }, confirmedAt: null, confirmedById: null } });
        return { id, status: 'SUBMITTED' as const, revision, replayed: false, overallResult: evaluation.overall.result, evaluation };
      },
      { timeout: 30_000 },
    );
  }

  // ------------------------------------------------------------------ 复验
  /** 对已审核完成的布卷发起复验：重新打开任务布卷，质检员开始新检验时自动关联上一条记录 */
  async reopen(actor: Actor, id: string, reason: string, meta: RequestMeta) {
    if (!hasRole(actor, ...MANAGE_TASKS)) throw AppError.forbidden();
    return this.prisma.$transaction(async (tx) => {
      const ref = await tx.rollInspection.findUnique({ where: { id }, select: { taskId: true, task: { select: { vcansOrder: { select: { id: true } } } } } });
      if (!ref) throw AppError.notFound('检验记录');
      if (ref.task.vcansOrder) await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${ref.task.vcansOrder.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${ref.taskId}::uuid FOR UPDATE`;
      const i = await tx.rollInspection.findUnique({ where: { id }, include: { task: { include: { delivery: true } }, inspector: { select: { departmentId: true } } } });
      if (!i) throw AppError.notFound('检验记录');
      const privileged = hasRole(actor, RoleCode.ADMIN, RoleCode.QUALITY_MANAGER);
      const dept = i.task.departmentId ?? i.inspector.departmentId;
      const supervisor = actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR && (r.departmentId === null || r.departmentId === dept || i.task.supervisorId === actor.userId || i.task.reviewerId === actor.userId));
      if (!privileged && !supervisor) throw AppError.forbidden('不在你的质检职责范围');
      if (i.task.origin === 'BUSINESS' && i.task.delivery) throw AppError.invalidState('整单已交付，当前不支持对原任务复验');
      if (i.status !== 'APPROVED' && i.status !== 'REJECTED') throw AppError.invalidState('只有已审核完成的检验才能发起复验');
      if (ref.task.vcansOrder) {
        const order = await tx.vcansOrder.findUniqueOrThrow({ where: { id: ref.task.vcansOrder.id }, select: { supervisorId: true } });
        if (order.supervisorId !== actor.userId || !hasRole(actor, RoleCode.QC_SUPERVISOR)) throw AppError.forbidden('仅指定主管可发起H订单复验');
        const extra = await tx.vcansSampleSelection.findFirst({ where: { orderId: ref.task.vcansOrder.id, kind: 'ADDITIONAL', inspectionId: null, orderRoll: { rollId: i.rollId } } });
        if (!extra) throw AppError.invalidState('请先由指定主管记录追加检验决定');
      }
      const newer = await tx.rollInspection.findFirst({ where: { previousInspectionId: id } });
      if (newer) throw AppError.invalidState('该检验已有复验记录');
      await tx.qcTaskRoll.update({ where: { id: i.taskRollId }, data: { status: 'PENDING' } });
      await tx.fabricRoll.update({ where: { id: i.rollId }, data: { status: 'ASSIGNED' } });
      await tx.qcTask.update({ where: { id: i.taskId }, data: { status: 'IN_PROGRESS' } });
      await this.notifications.notifyInApp(tx, {
        userIds: i.task.assigneeId ? [i.task.assigneeId] : [],
        type: 'REINSPECTION',
        title: '需要复验',
        body: reason,
        entityType: 'QcTask',
        entityId: i.taskId,
        pagePath: `/pages/task/index?id=${i.taskId}`,
      });
      await this.audit.log(actor, { action: 'inspection.reopen', entityType: 'RollInspection', entityId: id, after: { reason } }, meta, tx);
      return { ok: true };
    });
  }
}
