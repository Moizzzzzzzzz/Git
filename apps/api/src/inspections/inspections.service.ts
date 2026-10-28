import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ErrorCode,
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

const person = { select: { id: true, name: true, employeeNo: true } } as const;

const detailInclude = {
  roll: {
    include: {
      fabric: true,
      lot: { select: { id: true, lotNo: true, dyeLotNo: true } },
    },
  },
  task: { select: { id: true, taskNo: true, title: true, departmentId: true, reviewerId: true } },
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

  // ------------------------------------------------------------------ 开始检验
  /**
   * 开始检验：对标准版本、模板和规格做快照。
   * 同一任务布卷已有进行中的检验时直接返回（可恢复），保证重复点击不会产生多条记录。
   */
  async start(actor: Actor, input: { taskRollId: string; mode: InspectionMode; scope: InspectionScope }, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const tr = await tx.qcTaskRoll.findUnique({
        where: { id: input.taskRollId },
        include: {
          task: { include: { template: true } },
          roll: { include: { fabric: true, lot: true } },
          inspections: { orderBy: { createdAt: 'desc' } },
        },
      });
      if (!tr) throw AppError.notFound('任务布卷');
      if (tr.task.assigneeId !== actor.userId) throw AppError.forbidden('该布卷未分配给你');
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

      const template = templateContentSchema.parse(tr.task.template.content);
      const standardSnapshot: StandardSnapshot = {
        fourPoint: { versionId: fp.id, name: fp.standard.name, version: fp.version, isDevDefault: fp.isDevDefault, rules: fp.rules },
        customer: cs
          ? { versionId: cs.id, name: cs.standard.name, version: cs.version, isDevDefault: cs.isDevDefault, rules: cs.rules }
          : null,
      };
      const f = tr.roll.fabric;
      const spec: SpecSnapshot = {
        fabricId: f.id,
        fabricCode: f.code,
        fabricName: f.nameZh,
        fabricNameEn: f.nameEn,
        composition: f.composition,
        weaveStructure: f.weaveStructure,
        coatingType: f.coatingType,
        color: f.color,
        colorCode: tr.roll.colorCode ?? f.colorCode,
        widthCm: num(f.widthCm),
        cuttableWidthCm: num(f.cuttableWidthCm),
        gsm: num(f.gsm),
        rollNo: tr.roll.rollNo,
        lotNo: tr.roll.lot?.lotNo ?? null,
        dyeLotNo: tr.roll.dyeLotNo,
        nominalLengthM: num(tr.roll.nominalLengthM),
      };
      const previous = tr.inspections.find((i) => i.status === 'APPROVED' || i.status === 'REJECTED');

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
    };
    if (!this.access.canView(actor, ref)) throw AppError.forbidden('没有权限查看该检验记录');
    return this.present(i, {
      canEdit: this.access.canEdit(actor, ref),
      canReview: await this.access.canReview(actor, ref),
    });
  }

  private async present(i: InspectionWithDetail, permissions: { canEdit: boolean; canReview: boolean }) {
    const photos = await Promise.all(
      i.mediaLinks.map(async (l) => ({
        mediaId: l.mediaId,
        kind: l.kind,
        checkpointKey: l.checkpointKey,
        defectClientId: l.defectClientId,
        status: l.media.status,
        ...(await this.media.urls(l.media)),
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
        fabric: { id: i.roll.fabric.id, code: i.roll.fabric.code, nameZh: i.roll.fabric.nameZh },
      },
      task: { id: i.task.id, taskNo: i.task.taskNo, title: i.task.title },
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
      permissions,
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
    const where: Prisma.RollInspectionWhereInput = {
      ...(hasRole(actor, ...VIEW_QC_RECORDS) ? {} : { inspectorId: actor.userId }),
      status: p.status,
      overallResult: p.overallResult,
      inspectorId: p.inspectorId,
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

  private evaluationData(scope: InspectionScope, d: Pick<InspectionDraft, 'segments' | 'defects' | 'measurements'>) {
    return {
      scope,
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
        const i = await tx.rollInspection.findUnique({ where: { id } });
        if (!i) throw AppError.notFound('检验记录');
        if (i.inspectorId !== actor.userId) throw AppError.forbidden('只能编辑自己的检验');
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
          this.evaluationData(d.scope, d),
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
      const cur = await this.prisma.rollInspection.findUniqueOrThrow({ where: { id } });
      return { id, status: cur.status, revision: replay.revision, replayed: true, overallResult: cur.overallResult };
    }

    return this.prisma.$transaction(
      async (tx) => {
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
        if (i.inspectorId !== actor.userId) throw AppError.forbidden('只能提交自己的检验');
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
        });

        const reviewers = await this.routing.resolve(tx, {
          inspectorId: i.inspectorId,
          reviewerId: i.task.reviewerId,
          departmentId: i.task.departmentId,
        });
        if (!reviewers.length) {
          throw AppError.of(ErrorCode.NO_REVIEWER, '没有可用的审核人，请联系管理员配置质检主管或质量经理', 409);
        }

        const revision = i.revision + 1;
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
                objectKey: l.media.objectKey,
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
      const i = await tx.rollInspection.findUnique({ where: { id }, include: { task: true } });
      if (!i) throw AppError.notFound('检验记录');
      if (i.status !== 'APPROVED' && i.status !== 'REJECTED') throw AppError.invalidState('只有已审核完成的检验才能发起复验');
      const newer = await tx.rollInspection.findFirst({ where: { previousInspectionId: id } });
      if (newer) throw AppError.invalidState('该检验已有复验记录');
      await tx.qcTaskRoll.update({ where: { id: i.taskRollId }, data: { status: 'PENDING' } });
      await tx.fabricRoll.update({ where: { id: i.rollId }, data: { status: 'ASSIGNED' } });
      await tx.qcTask.update({ where: { id: i.taskId }, data: { status: 'IN_PROGRESS' } });
      await this.notifications.notifyInApp(tx, {
        userIds: [i.task.assigneeId],
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
