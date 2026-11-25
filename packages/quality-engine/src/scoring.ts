import type { FourPointConfig, SizeBand, SpecialDefectRule } from '@fabricqc/shared';
import { CM_PER_INCH, EPS, METERS_PER_YARD, round, sum } from './math';
import type { DefectScore, EngineDefect, ScoringResult } from './types';

export function bandPoints(bands: SizeBand[], sizeCm: number): number {
  for (const band of bands) {
    if (band.maxCm === null || sizeCm <= band.maxCm + EPS) return band.points;
  }
  // 校验保证最后一档无上限，这里只是防御
  return bands[bands.length - 1].points;
}

export function linearUnitLength(config: FourPointConfig): number {
  if (config.maxPointsPerLinearUnit) return config.maxPointsPerLinearUnit.unitLengthM;
  return config.areaUnit === 'PER_100_SQ_YD' || config.areaUnit === 'PER_100_LINEAR_YD' ? METERS_PER_YARD : 1;
}

function unitIndex(positionM: number, unitM: number): number {
  return Math.floor(positionM / unitM + EPS);
}

function findSpecialRule(config: FourPointConfig, code: string): SpecialDefectRule | undefined {
  return config.specialRules.find((r) => r.defectTypeCodes.includes(code));
}

interface Contribution {
  unit: number;
  points: number;
}

function scoreDefect(
  config: FourPointConfig,
  defect: EngineDefect,
  unitM: number,
): { contributions: Contribution[]; rule: string } {
  const size =
    config.dimensionBasis === 'MAX_DIMENSION'
      ? Math.max(defect.lengthCm, defect.widthCm ?? 0)
      : defect.lengthCm;
  const startUnit = unitIndex(defect.positionM, unitM);
  const special = findSpecialRule(config, defect.defectTypeCode);

  if (special?.mode === 'FIXED_POINTS') {
    return {
      contributions: [{ unit: startUnit, points: special.points }],
      rule: `特殊疵点固定 ${special.points} 分`,
    };
  }
  if (special?.mode === 'BY_SIZE') {
    const p = bandPoints(special.bands, size);
    return { contributions: [{ unit: startUnit, points: p }], rule: `特殊疵点按尺寸 ${round(size)}cm → ${p} 分` };
  }
  if (special?.mode === 'PER_LINEAR_UNIT') {
    // 连续性疵点沿布长方向延伸 lengthCm，所跨每个线性单位计分
    const endM = defect.positionM + defect.lengthCm / 100;
    const endUnit = Math.max(startUnit, unitIndex(endM - EPS * 10, unitM));
    const contributions: Contribution[] = [];
    for (let u = startUnit; u <= endUnit; u++) contributions.push({ unit: u, points: special.points });
    return {
      contributions,
      rule: `连续性疵点 ${contributions.length} 个线性单位 × ${special.points} 分`,
    };
  }
  const p = bandPoints(config.bands, size);
  return { contributions: [{ unit: startUnit, points: p }], rule: `尺寸 ${round(size)}cm → ${p} 分` };
}

/**
 * 计算四分制得分。
 * @param inspectedLengthM 实际受检长度（米）
 * @param widthCm 面积计算宽度（厘米），为空时无法标准化
 */
export function scoreDefects(
  config: FourPointConfig,
  defects: EngineDefect[],
  inspectedLengthM: number,
  widthCm: number | null,
): ScoringResult {
  const unitM = linearUnitLength(config);
  if (config.continuousAllocation === 'COVERED_CAPACITY_V1') return scoreWithCoveredCapacity(config, defects, inspectedLengthM, widthCm, unitM);
  const perUnit = new Map<number, number>();
  const defectScores: DefectScore[] = [];

  for (const d of defects) {
    const { contributions, rule } = scoreDefect(config, d, unitM);
    for (const c of contributions) perUnit.set(c.unit, (perUnit.get(c.unit) ?? 0) + c.points);
    defectScores.push({
      clientId: d.clientId,
      defectTypeCode: d.defectTypeCode,
      points: sum(contributions.map((c) => c.points)),
      rule,
    });
  }

  const rawPoints = sum([...perUnit.values()]);
  const cap = config.maxPointsPerLinearUnit?.maxPoints;
  const totalPoints = cap === undefined ? rawPoints : sum([...perUnit.values()].map((p) => Math.min(p, cap)));

  let normalizedPoints: number | null = null;
  if (config.areaUnit === 'PER_100_LINEAR_YD' && inspectedLengthM > 0) {
    normalizedPoints = round((totalPoints * 100 * METERS_PER_YARD) / inspectedLengthM);
  } else if (widthCm && widthCm > 0 && inspectedLengthM > 0 && config.areaUnit !== 'PER_100_LINEAR_YD') {
    if (config.areaUnit === 'PER_100_SQ_YD') {
      const yards = inspectedLengthM / METERS_PER_YARD;
      const inches = widthCm / CM_PER_INCH;
      normalizedPoints = round((totalPoints * 3600) / (yards * inches));
    } else {
      const areaM2 = inspectedLengthM * (widthCm / 100);
      normalizedPoints = round((totalPoints * 100) / areaM2);
    }
  }

  return {
    areaUnit: config.areaUnit,
    linearUnitM: unitM,
    defectScores,
    rawPoints: round(rawPoints, 3),
    totalPoints: round(totalPoints, 3),
    capReduction: round(rawPoints - totalPoints, 3),
    normalizedPoints,
  };
}

function scoreWithCoveredCapacity(config: FourPointConfig, defects: EngineDefect[], inspectedLengthM: number, widthCm: number | null, unitM: number): ScoringResult {
  if (!config.maxPointsPerLinearUnit) throw new Error('正式连续疵点计分必须配置每码封顶');
  const cap = config.maxPointsPerLinearUnit.maxPoints;
  const perUnit = new Map<number, number>();
  const scores = new Map<string, DefectScore>();
  let raw = 0;
  const continuous: EngineDefect[] = [];
  const ordered = [...defects].sort((a, b) => a.positionM - b.positionM || (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0));
  for (const defect of ordered) {
    const special = findSpecialRule(config, defect.defectTypeCode);
    if (special?.mode === 'PER_LINEAR_UNIT') { continuous.push(defect); continue; }
    const result = scoreDefect(config, defect, unitM);
    const points = sum(result.contributions.map(c => c.points));
    raw += points;
    let effectivePoints = 0;
    for (const c of result.contributions) { const previous = perUnit.get(c.unit) ?? 0; const applied = Math.min(c.points, Math.max(0, cap - previous)); effectivePoints += applied; perUnit.set(c.unit, previous + applied); }
    scores.set(defect.clientId, { clientId: defect.clientId, defectTypeCode: defect.defectTypeCode, points, effectivePoints, rule: result.rule });
  }
  continuous.sort((a, b) => a.positionM - b.positionM || (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0));
  for (const defect of continuous) {
    const rule = findSpecialRule(config, defect.defectTypeCode)!;
    if (rule.mode !== 'PER_LINEAR_UNIT') throw new Error('连续疵点规则无效');
    const start = unitIndex(defect.positionM, unitM);
    const end = Math.max(start, unitIndex(defect.positionM + defect.lengthCm / 100 - EPS * 10, unitM));
    const count = Math.max(1, Math.ceil(defect.lengthCm / 100 / unitM - EPS));
    const points = count * rule.points;
    raw += points;
    // Max-heap bounds worst-case work for long continuous defects; ties favour the roll head.
    const heap: { unit: number; remaining: number }[] = [];
    const better = (a: typeof heap[number], b: typeof heap[number]) => a.remaining > b.remaining || (a.remaining === b.remaining && a.unit < b.unit);
    const push = (item: typeof heap[number]) => {
      heap.push(item);
      for (let i = heap.length - 1; i > 0;) { const p = Math.floor((i - 1) / 2); if (!better(heap[i], heap[p])) break; [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], tail = heap.pop()!;
      if (heap.length) { heap[0] = tail; for (let i = 0;;) { let best = i; const left = i * 2 + 1, right = left + 1; if (left < heap.length && better(heap[left], heap[best])) best = left; if (right < heap.length && better(heap[right], heap[best])) best = right; if (best === i) break; [heap[i], heap[best]] = [heap[best], heap[i]]; i = best; } }
      return top;
    };
    for (let unit = start; unit <= end; unit++) { const remaining = Math.max(0, cap - (perUnit.get(unit) ?? 0)); if (remaining > 0) push({ unit, remaining }); }
    let effectivePoints = 0;
    for (let i = 0; i < count && heap.length; i++) {
      const best = pop(), applied = Math.min(rule.points, best.remaining);
      effectivePoints += applied;
      perUnit.set(best.unit, (perUnit.get(best.unit) ?? 0) + applied);
      if (best.remaining > applied) push({ unit: best.unit, remaining: best.remaining - applied });
    }
    scores.set(defect.clientId, { clientId: defect.clientId, defectTypeCode: defect.defectTypeCode, points, effectivePoints, rule: `连续性疵点自身长度 ${count} 码 × ${rule.points} 分，按覆盖码段封顶` });
  }
  const total = sum([...perUnit.values()].map(points => Math.min(points, cap)));
  let normalizedPoints: number | null = null;
  if (config.areaUnit === 'PER_100_LINEAR_YD' && inspectedLengthM > 0) normalizedPoints = round(total * 100 * METERS_PER_YARD / inspectedLengthM);
  else if (widthCm && widthCm > 0 && inspectedLengthM > 0 && config.areaUnit !== 'PER_100_LINEAR_YD') {
    normalizedPoints = config.areaUnit === 'PER_100_SQ_YD' ? round(total * 3600 / ((inspectedLengthM / METERS_PER_YARD) * (widthCm / CM_PER_INCH))) : round(total * 100 / (inspectedLengthM * widthCm / 100));
  }
  return { areaUnit: config.areaUnit, linearUnitM: unitM, defectScores: defects.map(d => scores.get(d.clientId)!), rawPoints: round(raw, 3), totalPoints: round(total, 3), capReduction: round(raw - total, 3), normalizedPoints };
}
