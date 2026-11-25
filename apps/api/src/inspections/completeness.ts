import { MeasurementKey, type InspectionScope, type TemplateContent } from '@fabricqc/shared';

export interface CompletenessInput {
  formalFull?: boolean;
  continuousDefectCodes?: string[];
  scope: InspectionScope;
  template: TemplateContent;
  nominalLengthM: number | null;
  segments: { startM: number; endM: number }[];
  measurements: { itemKey: string; seq: number; value: number }[];
  checklist: { key: string; status: string; note?: string | null }[];
  defects: { clientId: string; positionM: number; defectTypeCode: string; lengthCm?: number }[];
  photos: { kind: string; checkpointKey: string | null; defectClientId: string | null; uploaded: boolean }[];
  requireDefectPhoto: boolean;
}

/** 全检覆盖容差：端点允许 max(0.2m, 0.5%) 误差；区段之间不允许超过 0.05m 的空隙 */
export const FULL_COVERAGE_END_TOLERANCE_M = 0.2;
export const FULL_COVERAGE_END_TOLERANCE_PCT = 0.005;
export const FULL_COVERAGE_GAP_M = 0.05;

/** 实际卷长：取卷长测量最后一个读数 */
export function actualLengthOf(measurements: CompletenessInput['measurements']): number | null {
  const readings = measurements
    .filter((m) => m.itemKey === MeasurementKey.ROLL_LENGTH)
    .sort((a, b) => a.seq - b.seq);
  return readings.length ? readings[readings.length - 1].value : null;
}

/**
 * 提交前完整性校验。返回问题列表，空列表表示可以提交。
 * 规则来自检验模板（必填检查项 / 测量 / 拍照点）与标准（疵点照片）。
 */
export function checkCompleteness(i: CompletenessInput): string[] {
  const problems: string[] = [];
  const segments = [...i.segments].sort((a, b) => a.startM - b.startM);

  if (!segments.length) problems.push('请记录检验区段（起止米数）');

  for (const c of i.template.checklist.filter((c) => c.required)) {
    if (!i.checklist.some((x) => x.key === c.key)) problems.push(`检查项未填写：${c.label}`);
  }
  const label = i.checklist.find((item) => item.key === 'label_match');
  if (i.formalFull && label?.status === 'NA' && !label.note?.trim()) problems.push('卷标无法核对时请填写实际原因');

  for (const m of i.template.measurements.filter((m) => m.required)) {
    const n = i.measurements.filter((x) => x.itemKey === m.key).length;
    if (n < m.minReadings) problems.push(`${m.label}至少需要 ${m.minReadings} 个读数（当前 ${n} 个）`);
  }

  const actual = actualLengthOf(i.measurements) ?? null;
  if (i.formalFull) {
    if (i.scope !== 'FULL') problems.push('正式订单入选卷必须整卷全检');
    if (actual !== null && segments.length && (Math.round(segments[0].startM * 1000) !== 0 || Math.round(segments[segments.length - 1].endM * 1000) !== Math.round(actual * 1000) || segments.some((segment, index) => index > 0 && Math.round(segment.startM * 1000) !== Math.round(segments[index - 1].endM * 1000)))) problems.push('正式整卷全检必须完整覆盖卷头至卷尾');
  }
  const lastEnd = segments.length ? segments[segments.length - 1].endM : 0;
  if (actual !== null && segments.length) {
    const tol = Math.max(FULL_COVERAGE_END_TOLERANCE_M, actual * FULL_COVERAGE_END_TOLERANCE_PCT);
    if (lastEnd > actual + tol) problems.push(`检验区段结束于 ${lastEnd} m，超过实测卷长 ${actual} m`);
  }

  if (i.scope === 'FULL') {
    if (actual === null) {
      problems.push('整卷全检必须记录实测卷长');
    } else if (segments.length) {
      const tol = Math.max(FULL_COVERAGE_END_TOLERANCE_M, actual * FULL_COVERAGE_END_TOLERANCE_PCT);
      let covered = segments[0].startM <= tol;
      for (let k = 1; k < segments.length && covered; k++) {
        if (segments[k].startM - segments[k - 1].endM > FULL_COVERAGE_GAP_M) covered = false;
      }
      if (covered && lastEnd < actual - tol) covered = false;
      if (!covered) {
        problems.push(`整卷全检的检验区段必须连续覆盖 0 ~ ${actual} m；如未检完整卷，请改为"部分检验"或"抽检"`);
      }
    }
  }

  for (const d of i.defects) {
    const inside = segments.some((s) => d.positionM >= s.startM - 1e-9 && d.positionM <= s.endM + 1e-9);
    if (!inside) problems.push(`疵点（${d.defectTypeCode} @ ${d.positionM} m）不在检验区段内`);
    if (i.formalFull && i.continuousDefectCodes?.includes(d.defectTypeCode) && (d.lengthCm === undefined || d.lengthCm <= 0 || actual === null || d.positionM + d.lengthCm / 100 > actual + 1e-9)) problems.push(`连续疵点（${d.defectTypeCode} @ ${d.positionM} m）超出实测卷长`);
  }

  const uploaded = i.photos.filter((p) => p.uploaded);
  if (i.photos.length !== uploaded.length) problems.push(`有 ${i.photos.length - uploaded.length} 张照片尚未上传成功`);

  for (const cp of i.template.photoCheckpoints.filter((c) => c.required)) {
    const n = uploaded.filter((p) => p.kind === 'CHECKPOINT' && p.checkpointKey === cp.key).length;
    if (n < cp.minPhotos) problems.push(`拍照点「${cp.label}」至少需要 ${cp.minPhotos} 张照片`);
  }

  if (i.requireDefectPhoto) {
    const missing = i.defects.filter(
      (d) => !uploaded.some((p) => p.kind === 'DEFECT' && p.defectClientId === d.clientId),
    );
    if (missing.length) problems.push(`${missing.length} 个疵点缺少照片`);
  }

  return problems;
}
