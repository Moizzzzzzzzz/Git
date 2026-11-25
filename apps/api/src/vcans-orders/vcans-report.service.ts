import { Injectable, Optional } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { createHash, randomUUID } from 'node:crypto';
import { RoleCode } from '@fabricqc/shared';
import type { Actor } from '../common/actor';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { StorageAdapter } from '../media/storage.adapter';
import { businessDepartments } from '../tasks/business-access';
import { prepareReportPhoto } from './report-photo';
import { renderOrderReport, type OrderReportInput, type ReportInspectionHistoryEntry } from './document-renderer';

type FrozenInspection = {
  inspectionId: string | null; inspectionNumber?: string | null; result: string | null;
  submittedAt: string | null; reviewedAt: string | null; inspectorName?: string | null; reviewerName?: string | null;
  standardSnapshot?: { fourPoint?: { name?: string } } | null;
  templateSnapshot?: { photoCheckpoints?: { key?: string; label?: string }[] } | null;
  resultSnapshot?: { fourPoint?: { scoring?: { areaUnit?: string } } } | null;
  totalPoints?: string | null; normalizedScore?: string | null; measuredLengthM?: string | null;
  inspection?: { defects?: { clientId?: string; defectTypeCode?: string; positionM?: number; lengthCm?: number; widthCm?: number; points?: number }[]; photos?: { objectKey?: string; kind?: string | null; checkpointKey?: string | null; defectClientId?: string | null }[]; remarks?: string | null } | null;
};
type FrozenRoll = {
  id: string; lineId: string; lotNo: string; rollNo: string; originalSample: boolean; additionalSample: boolean;
  result: 'PASS' | 'FAIL' | 'UNINSPECTED' | 'INCOMPLETE' | string; nominalLengthM: string | null; nominalWeightKg: string | null;
  measuredLengthM: string | null; measuredWeightKg: string | null; totalPoints: string | null; normalizedScore: string | null;
  pendingAdditional?: boolean; resultSnapshot?: { fourPoint?: { scoring?: { areaUnit?: string } } } | null;
  inspection?: FrozenInspection['inspection']; basisHistory?: FrozenInspection | null; additionalHistory?: FrozenInspection[];
};
type FrozenReport = Omit<OrderReportInput, 'reportNumber' | 'rolls' | 'inspectionPlanDescription'> & {
  plan: { mode: string; fixedRolls?: number | null; percent?: string | null }; rolls: FrozenRoll[]; defectNames?: Record<string, string>;
};
@Injectable()
export class VcansReportService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageAdapter, @Optional() private readonly config?:AppConfig) {}
  private async authorized(actor: Actor, id: string) {
    const order = await this.prisma.vcansOrder.findUnique({ where: { id }, select: { businessDepartmentId: true, supervisorId: true, assignedInspectorId: true } });
    const permitted = order && (businessDepartments(actor).includes(order.businessDepartmentId) || (order.supervisorId === actor.userId && actor.roles.some((r) => r.role === RoleCode.QC_SUPERVISOR)) || (order.assignedInspectorId === actor.userId && actor.roles.some((r) => r.role === RoleCode.INSPECTOR)) || actor.roles.some((r) => r.role === RoleCode.ADMIN || r.role === RoleCode.QUALITY_MANAGER));
    if (!permitted) throw AppError.forbidden('没有该订单报告权限');
  }
  async list(actor: Actor, orderId: string) {
    await this.authorized(actor, orderId);
    const reports = await this.prisma.vcansReportVersion.findMany({ where: { orderId }, orderBy: { version: 'desc' }, include: { files: { select: { outputType: true } } } });
    return { items: reports.map((report) => ({ version: report.version, confirmedAt: report.confirmedAt, confirmedById: report.confirmedById, pdfStatus: report.files.some((file) => file.outputType === 'PDF') ? 'READY' : 'NOT_GENERATED' })) };
  }
  async pdf(actor: Actor, orderId: string, version: number) {
    await this.authorized(actor, orderId);
    const report = await this.prisma.vcansReportVersion.findUnique({ where: { orderId_version: { orderId, version } }, include: { files: true } });
    if (!report) throw AppError.notFound('报告版本');
    const existing = report.files.find((file) => file.outputType === 'PDF');
    if (existing) return this.readVerified(existing.objectKey, existing.sha256);
    if (this.config?.env.REVIEW_MODE) throw AppError.invalidState('审核示例报告尚未准备');
    const snapshot = report.snapshot as unknown as FrozenReport;
    const rolls: OrderReportInput['rolls'] = [];
    let photoBytes = 0;
    const scoreUnit = (unit?: string) => unit === 'PER_100_SQ_YD' ? '分/100平方码' : unit === 'PER_100_SQ_M' ? '分/100平方米' : null;
    const photosFor = async (inspection: FrozenInspection['inspection'], template?: FrozenInspection['templateSnapshot']) => {
      const photos = [];
      for (const photo of inspection?.photos ?? []) {
        if (!photo.objectKey?.startsWith('frozen-inspections/')) throw AppError.invalidState('报告照片未冻结');
        const bytes = await this.storage.readBytes(photo.objectKey, 20 * 1024 * 1024);
        const derivative = await prepareReportPhoto(bytes, photo, inspection?.defects ?? [], snapshot.defectNames ?? {}, template);
        photoBytes += derivative.bytes.length;
        if (photoBytes > 64 * 1024 * 1024) throw AppError.invalidState('报告照片派生图总量过大');
        photos.push(derivative);
      }
      return photos;
    };
    const defectsFor = (inspection: FrozenInspection['inspection']) => (inspection?.defects ?? []).map((defect) => ({ name: defect.defectTypeCode ? snapshot.defectNames?.[defect.defectTypeCode] ?? defect.defectTypeCode : '', positionM: defect.positionM, lengthCm: defect.lengthCm, widthCm: defect.widthCm, points: defect.points }));
    for (const roll of snapshot.rolls) {
      const events: { kind: 'ORIGINAL' | 'ADDITIONAL'; event: FrozenInspection }[] = [];
      if (roll.basisHistory) events.push({ kind: 'ORIGINAL', event: roll.basisHistory });
      for (const event of roll.additionalHistory ?? []) if (event.result === 'PASS' || event.result === 'FAIL') events.push({ kind: 'ADDITIONAL', event });
      const history: ReportInspectionHistoryEntry[] = [];
      for (const { kind, event } of events) {
        if (!event.inspectionId || !event.submittedAt || !event.reviewedAt || (event.result !== 'PASS' && event.result !== 'FAIL') || !event.inspection) throw AppError.invalidState('已审核检验历史资料不完整');
        history.push({ id: event.inspectionId, inspectionNumber: event.inspectionNumber, kind, inspectedAt: event.submittedAt, reviewedAt: event.reviewedAt, result: event.result, inspectorName: event.inspectorName, reviewerName: event.reviewerName, standardName: event.standardSnapshot?.fourPoint?.name ?? null, measuredLengthM: event.measuredLengthM, totalPoints: event.totalPoints, normalizedScore: event.normalizedScore, scoreUnit: scoreUnit(event.resultSnapshot?.fourPoint?.scoring?.areaUnit), conclusionNote: event.inspection.remarks ?? null, defects: defectsFor(event.inspection), photos: await photosFor(event.inspection, event.templateSnapshot) });
      }
      history.sort((a, b) => Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt));
      const latest = history.at(-1);
      const legacyPhotos = history.length ? [] : await photosFor(roll.inspection);
      rolls.push({ ...roll, result: latest?.result ?? (roll.result === 'PASS' || roll.result === 'FAIL' || roll.result === 'UNINSPECTED' ? roll.result : 'INCOMPLETE'), scoreUnit: scoreUnit(roll.resultSnapshot?.fourPoint?.scoring?.areaUnit), defects: history.length ? [] : defectsFor(roll.inspection), photos: legacyPhotos, conclusionNote: roll.inspection?.remarks ?? null, ...(history.length ? { inspectionHistory: history, latestReviewedInspectionId: latest!.id } : {}), pendingAdditionalInspectionCount: (roll.additionalHistory ?? []).filter((event) => event.result !== 'PASS' && event.result !== 'FAIL').length });
    }
    const plan = snapshot.plan;
    const inspectionPlanDescription = plan.mode === 'FULL' ? '全检' : plan.mode === 'FIXED_PER_LOT' ? `每缸固定抽检 ${plan.fixedRolls} 卷（不足时按实有卷数）` : `每缸按 ${plan.percent}% 抽检`;
    const bytes = await renderOrderReport({ ...snapshot, reportNumber: `${snapshot.hNo}-V${version}`, inspectionPlanDescription, rolls, pendingActions: snapshot.rolls.filter((roll) => roll.pendingAdditional).map((roll) => `${roll.rollNo}：追加检验待处理`) });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vcans_report_versions WHERE id = ${report.id}::uuid FOR UPDATE`;
      const saved = await tx.vcansReportFile.findUnique({ where: { reportVersionId_outputType: { reportVersionId: report.id, outputType: 'PDF' } } });
      if (saved) return this.readVerified(saved.objectKey, saved.sha256);
      const key = `vcans-reports/${report.id}/${randomUUID()}.pdf`;
      await this.storage.putBytesIfAbsent(key, bytes, 'application/pdf');
      await tx.vcansReportFile.create({ data: { reportVersionId: report.id, outputType: 'PDF', objectKey: key, sha256 } });
      return bytes;
    }, { timeout: 60000 });
  }
  private async readVerified(key: string, expected: string) {
    const bytes = await this.storage.readBytes(key, 100 * 1024 * 1024);
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw AppError.invalidState('报告文件校验失败');
    return bytes;
  }
}
