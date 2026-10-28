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
  return config.areaUnit === 'PER_100_SQ_YD' ? METERS_PER_YARD : 1;
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
  if (widthCm && widthCm > 0 && inspectedLengthM > 0) {
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
