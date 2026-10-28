import {
  JudgeResult,
  MeasurementKey,
  SCOPE_LABELS,
  SEVERITY_LABELS,
  SEVERITY_RANK,
  type MeasurementLimit,
  type StandardRules,
} from '@fabricqc/shared';
import { avg, EPS, round, sum } from './math';
import { scoreDefects } from './scoring';
import type {
  CheckStatus,
  EngineSpec,
  EngineStandard,
  EvaluationInput,
  InspectionEvaluation,
  RuleCheck,
  ScoringResult,
  StandardEvaluation,
  WidthBasis,
} from './types';

export const ENGINE_VERSION = '1.0.0';

const AREA_UNIT_LABEL = { PER_100_SQ_YD: '分/100平方码', PER_100_SQ_M: '分/100平方米' } as const;

interface Context {
  input: EvaluationInput;
  inspectedLengthM: number;
  widthCm: number | null;
}

function resolveWidth(input: EvaluationInput): { widthCm: number | null; basis: WidthBasis } {
  const readings = input.measurements
    .filter((m) => m.itemKey === MeasurementKey.EFFECTIVE_WIDTH && m.value > 0)
    .map((m) => m.value);
  if (readings.length) return { widthCm: round(avg(readings), 3), basis: 'MEASURED_EFFECTIVE' };
  if (input.spec.cuttableWidthCm) return { widthCm: input.spec.cuttableWidthCm, basis: 'SPEC_CUTTABLE' };
  if (input.spec.widthCm) return { widthCm: input.spec.widthCm, basis: 'SPEC_WIDTH' };
  return { widthCm: null, basis: 'NONE' };
}

function aggregateStatus(checks: RuleCheck[]): JudgeResult {
  if (!checks.length) return JudgeResult.NOT_APPLICABLE;
  if (checks.some((c) => c.status === 'FAIL')) return JudgeResult.FAIL;
  if (checks.some((c) => c.status === 'INCONCLUSIVE')) return JudgeResult.INCONCLUSIVE;
  return JudgeResult.PASS;
}

function check(
  code: string,
  label: string,
  status: CheckStatus,
  message: string,
  actual?: string | number | null,
  limit?: string | number | null,
): RuleCheck {
  return { code, label, status, message, actual: actual ?? null, limit: limit ?? null };
}

function measurementCheck(limit: MeasurementLimit, ctx: Context): RuleCheck | null {
  const code = `MEASUREMENT:${limit.itemKey}`;
  const label = `${limit.label}限值`;
  const readings = ctx.input.measurements.filter((m) => m.itemKey === limit.itemKey).map((m) => m.value);
  if (!readings.length) {
    return limit.required ? check(code, label, 'INCONCLUSIVE', `缺少${limit.label}测量值`) : null;
  }

  let lo: number | undefined;
  let hi: number | undefined;
  if (limit.mode === 'ABSOLUTE') {
    lo = limit.min;
    hi = limit.max;
  } else {
    const specValue = limit.specField ? ctx.input.spec[limit.specField as keyof EngineSpec] : null;
    if (specValue === null || specValue === undefined) {
      return check(code, label, 'INCONCLUSIVE', `缺少规格值（${limit.specField}），无法判定${limit.label}`);
    }
    if (limit.minPct !== undefined) lo = specValue * (1 + limit.minPct / 100);
    if (limit.maxPct !== undefined) hi = specValue * (1 + limit.maxPct / 100);
  }

  const values = limit.aggregate === 'AVG' ? [avg(readings)] : readings;
  const ok = values.every((v) => (lo === undefined || v >= lo - EPS) && (hi === undefined || v <= hi + EPS));
  const actual =
    limit.aggregate === 'AVG'
      ? `均值 ${round(values[0], 3)}`
      : readings.length === 1
        ? `${round(readings[0], 3)}`
        : `${round(Math.min(...readings), 3)} ~ ${round(Math.max(...readings), 3)}`;
  const range = `${lo === undefined ? '-∞' : round(lo, 3)} ~ ${hi === undefined ? '+∞' : round(hi, 3)}`;
  return check(
    code,
    label,
    ok ? 'PASS' : 'FAIL',
    ok ? `${limit.label}在允许范围内` : `${limit.label} ${actual} 超出允许范围 ${range}`,
    actual,
    range,
  );
}

function ruleChecks(rules: StandardRules, scoring: ScoringResult, ctx: Context): RuleCheck[] {
  const checks: RuleCheck[] = [];
  const { input } = ctx;
  const defects = input.defects;

  if (rules.requiredScope && input.scope !== rules.requiredScope) {
    checks.push(
      check(
        'SCOPE',
        '检验范围',
        'INCONCLUSIVE',
        `标准要求${SCOPE_LABELS[rules.requiredScope]}，本次为${SCOPE_LABELS[input.scope]}，不能据此判定整卷合格`,
        SCOPE_LABELS[input.scope],
        SCOPE_LABELS[rules.requiredScope],
      ),
    );
  }

  const t = rules.thresholds;
  if (t.maxNormalizedPoints !== undefined) {
    const unit = AREA_UNIT_LABEL[scoring.areaUnit];
    if (scoring.normalizedPoints === null) {
      checks.push(
        check(
          'MAX_NORMALIZED_POINTS',
          '标准化得分',
          'INCONCLUSIVE',
          '缺少受检长度或门幅，无法计算标准化得分',
          null,
          `≤ ${t.maxNormalizedPoints} ${unit}`,
        ),
      );
    } else {
      const ok = scoring.normalizedPoints <= t.maxNormalizedPoints + EPS;
      checks.push(
        check(
          'MAX_NORMALIZED_POINTS',
          '标准化得分',
          ok ? 'PASS' : 'FAIL',
          ok
            ? `标准化得分 ${scoring.normalizedPoints} ${unit}，未超过阈值`
            : `标准化得分 ${scoring.normalizedPoints} ${unit} 超过阈值 ${t.maxNormalizedPoints}`,
          scoring.normalizedPoints,
          `≤ ${t.maxNormalizedPoints}`,
        ),
      );
    }
  }
  if (t.maxTotalPoints !== undefined) {
    const ok = scoring.totalPoints <= t.maxTotalPoints + EPS;
    checks.push(
      check(
        'MAX_TOTAL_POINTS',
        '单卷总扣分',
        ok ? 'PASS' : 'FAIL',
        ok ? `总扣分 ${scoring.totalPoints} 未超过上限` : `总扣分 ${scoring.totalPoints} 超过上限 ${t.maxTotalPoints}`,
        scoring.totalPoints,
        `≤ ${t.maxTotalPoints}`,
      ),
    );
  }
  if (t.maxDefectCount !== undefined) {
    const ok = defects.length <= t.maxDefectCount;
    checks.push(
      check(
        'MAX_DEFECT_COUNT',
        '疵点总数',
        ok ? 'PASS' : 'FAIL',
        ok ? `疵点 ${defects.length} 个，未超过上限` : `疵点 ${defects.length} 个，超过上限 ${t.maxDefectCount}`,
        defects.length,
        `≤ ${t.maxDefectCount}`,
      ),
    );
  }

  if (rules.forbiddenDefectTypes.length) {
    const found = [...new Set(defects.map((d) => d.defectTypeCode))].filter((c) =>
      rules.forbiddenDefectTypes.includes(c),
    );
    checks.push(
      check(
        'FORBIDDEN_DEFECT',
        '禁止疵点',
        found.length ? 'FAIL' : 'PASS',
        found.length ? `出现禁止疵点：${found.join('、')}` : '未出现禁止疵点',
        found.join(',') || null,
        rules.forbiddenDefectTypes.join(','),
      ),
    );
  }

  for (const [code, max] of Object.entries(rules.maxDefectCountByType)) {
    const n = defects.filter((d) => d.defectTypeCode === code).length;
    checks.push(
      check(
        `MAX_DEFECT_TYPE:${code}`,
        `${code} 数量`,
        n <= max ? 'PASS' : 'FAIL',
        n <= max ? `${code} ${n} 个，未超过上限` : `${code} ${n} 个，超过上限 ${max}`,
        n,
        `≤ ${max}`,
      ),
    );
  }

  if (rules.failOnSeverity) {
    const threshold = SEVERITY_RANK[rules.failOnSeverity];
    const severe = defects.filter((d) => SEVERITY_RANK[d.severity] >= threshold);
    checks.push(
      check(
        'SEVERITY',
        '严重缺陷否决',
        severe.length ? 'FAIL' : 'PASS',
        severe.length
          ? `存在 ${severe.length} 个${SEVERITY_LABELS[rules.failOnSeverity]}及以上疵点，直接判定不合格`
          : `无${SEVERITY_LABELS[rules.failOnSeverity]}及以上疵点`,
        severe.length,
        0,
      ),
    );
  }

  for (const limit of rules.measurementLimits) {
    const c = measurementCheck(limit, ctx);
    if (c) checks.push(c);
  }
  return checks;
}

function evaluateStandard(
  std: EngineStandard,
  fallbackScoring: ScoringResult | null,
  ctx: Context,
): StandardEvaluation {
  let scoring: ScoringResult;
  if (std.rules.fourPoint) {
    scoring = scoreDefects(std.rules.fourPoint, ctx.input.defects, ctx.inspectedLengthM, ctx.widthCm);
  } else if (fallbackScoring) {
    scoring = fallbackScoring;
  } else {
    throw new Error(`四分制标准「${std.name}」缺少 fourPoint 计分配置`);
  }
  const checks = ruleChecks(std.rules, scoring, ctx);
  return { versionId: std.versionId, name: std.name, result: aggregateStatus(checks), scoring, checks };
}

/**
 * 评估一次检验。纯函数：相同输入永远得到相同输出。
 * 四分制标准与客户标准分别判定，再综合：任一不合格即不合格。
 */
export function evaluateInspection(input: EvaluationInput): InspectionEvaluation {
  const inspectedLengthM = round(sum(input.segments.map((s) => s.endM - s.startM)), 3);
  const { widthCm, basis } = resolveWidth(input);
  const ctx: Context = { input, inspectedLengthM, widthCm };
  const warnings: string[] = [];

  if (input.scope !== 'FULL') {
    warnings.push(
      `本结论仅基于${SCOPE_LABELS[input.scope]}（受检 ${inspectedLengthM} m），不代表整卷质量`,
    );
  }
  if (inspectedLengthM <= 0) warnings.push('未记录检验区段，受检长度为 0');
  if (basis === 'SPEC_CUTTABLE') warnings.push('未测量有效门幅，面积按规格可裁门幅计算');
  if (basis === 'SPEC_WIDTH') warnings.push('未测量有效门幅且无可裁门幅规格，面积按规格门幅计算');
  if (basis === 'NONE') warnings.push('缺少门幅数据，无法计算标准化得分');

  const outside = input.defects.filter(
    (d) => !input.segments.some((s) => d.positionM >= s.startM - EPS && d.positionM <= s.endM + EPS),
  );
  if (outside.length) warnings.push(`${outside.length} 个疵点米位不在已记录的检验区段内`);

  const fourPoint = evaluateStandard(input.fourPoint, null, ctx);
  const customer = input.customer ? evaluateStandard(input.customer, fourPoint.scoring, ctx) : null;

  const parts: StandardEvaluation[] = [fourPoint, ...(customer ? [customer] : [])];
  const effective = parts.filter((p) => p.result !== JudgeResult.NOT_APPLICABLE);
  let result: JudgeResult;
  if (!effective.length) result = JudgeResult.INCONCLUSIVE;
  else if (effective.some((p) => p.result === JudgeResult.FAIL)) result = JudgeResult.FAIL;
  else if (effective.some((p) => p.result === JudgeResult.INCONCLUSIVE)) result = JudgeResult.INCONCLUSIVE;
  else result = JudgeResult.PASS;

  const reasons: string[] = [];
  if (!effective.length) reasons.push('所选标准没有任何判定规则');
  for (const p of parts) {
    for (const c of p.checks) {
      if (c.status !== 'PASS') reasons.push(`[${p.name}] ${c.message}`);
    }
  }

  return {
    engineVersion: ENGINE_VERSION,
    scope: input.scope,
    inspectedLengthM,
    widthUsedCm: widthCm,
    widthBasis: basis,
    inspectedAreaM2: widthCm ? round(inspectedLengthM * (widthCm / 100), 3) : null,
    defectCount: input.defects.length,
    fourPoint,
    customer,
    overall: { result, reasons },
    warnings,
  };
}
