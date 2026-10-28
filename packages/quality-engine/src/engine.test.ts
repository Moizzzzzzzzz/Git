import { describe, expect, it } from 'vitest';
import {
  DEV_DEFAULT_FOUR_POINT_RULES,
  standardRulesSchema,
  type StandardRules,
  type StandardRulesInput,
} from '@fabricqc/shared';
import { bandPoints, evaluateInspection, scoreDefects, type EngineDefect, type EvaluationInput } from './index';

const rules = (r: StandardRulesInput): StandardRules => standardRulesSchema.parse(r);
const DEV = rules(DEV_DEFAULT_FOUR_POINT_RULES);
const FP = DEV.fourPoint!;

let seq = 0;
function defect(partial: Partial<EngineDefect>): EngineDefect {
  seq += 1;
  return {
    clientId: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    defectTypeCode: 'SLUB',
    lengthCm: 5,
    widthCm: null,
    positionM: 0,
    severity: 'MINOR',
    ...partial,
  };
}

function input(partial: Partial<EvaluationInput>): EvaluationInput {
  return {
    scope: 'FULL',
    segments: [{ startM: 0, endM: 91.44 }],
    defects: [],
    measurements: [],
    spec: { widthCm: 160, cuttableWidthCm: 152.4, gsm: 200, nominalLengthM: 91.44 },
    fourPoint: { versionId: 'fp-1', name: '四分制', rules: DEV },
    customer: null,
    ...partial,
  };
}

describe('size bands', () => {
  it.each([
    [5, 1],
    [7.62, 1],
    [7.63, 2],
    [15.24, 2],
    [20, 3],
    [22.86, 3],
    [22.87, 4],
    [300, 4],
  ])('size %s cm → %s points', (size, pts) => {
    expect(bandPoints(FP.bands, size)).toBe(pts);
  });

  it('uses max dimension when configured', () => {
    const r = scoreDefects(FP, [defect({ lengthCm: 2, widthCm: 10 })], 91.44, 152.4);
    expect(r.defectScores[0].points).toBe(2);
  });

  it('uses length only when configured', () => {
    const cfg = { ...FP, dimensionBasis: 'LENGTH' as const };
    const r = scoreDefects(cfg, [defect({ lengthCm: 2, widthCm: 10 })], 91.44, 152.4);
    expect(r.defectScores[0].points).toBe(1);
  });
});

describe('special defects', () => {
  it('scores holes by hole bands', () => {
    const r = scoreDefects(
      FP,
      [defect({ defectTypeCode: 'HOLE', lengthCm: 2, positionM: 0 }), defect({ defectTypeCode: 'HOLE', lengthCm: 3, positionM: 5 })],
      91.44,
      152.4,
    );
    expect(r.defectScores.map((d) => d.points)).toEqual([2, 4]);
  });

  it('scores continuous defects per linear yard', () => {
    // 0 ~ 3.0m 跨越第 0,1,2,3 码，共 4 码 × 4 分
    const r = scoreDefects(FP, [defect({ defectTypeCode: 'SHADING', lengthCm: 300, positionM: 0 })], 91.44, 152.4);
    expect(r.defectScores[0].points).toBe(16);
    expect(r.totalPoints).toBe(16);
  });

  it('supports fixed points rule', () => {
    const cfg = {
      ...FP,
      specialRules: [{ mode: 'FIXED_POINTS' as const, defectTypeCodes: ['OIL'], points: 4 }],
    };
    const r = scoreDefects(cfg, [defect({ defectTypeCode: 'OIL', lengthCm: 1 })], 91.44, 152.4);
    expect(r.defectScores[0].points).toBe(4);
  });
});

describe('per linear unit cap', () => {
  it('caps at 4 points per yard', () => {
    const ds = [0.1, 0.3, 0.5].map((p) => defect({ lengthCm: 30, positionM: p }));
    const r = scoreDefects(FP, ds, 91.44, 152.4);
    expect(r.rawPoints).toBe(12);
    expect(r.totalPoints).toBe(4);
    expect(r.capReduction).toBe(8);
  });

  it('does not cap defects in different yards', () => {
    const ds = [0.1, 1.0].map((p) => defect({ lengthCm: 30, positionM: p }));
    expect(scoreDefects(FP, ds, 91.44, 152.4).totalPoints).toBe(8);
  });

  it('does not cap when cap is disabled', () => {
    const cfg = { ...FP, maxPointsPerLinearUnit: null };
    const ds = [0.1, 0.3, 0.5].map((p) => defect({ lengthCm: 30, positionM: p }));
    expect(scoreDefects(cfg, ds, 91.44, 152.4).totalPoints).toBe(12);
  });
});

describe('normalization', () => {
  it('per 100 sq yd: 20 points on 100 yd × 60 in = 12', () => {
    const ds = Array.from({ length: 5 }, (_, i) => defect({ lengthCm: 30, positionM: i * 2 }));
    const r = scoreDefects(FP, ds, 91.44, 152.4);
    expect(r.totalPoints).toBe(20);
    expect(r.normalizedPoints).toBe(12);
  });

  it('per 100 m²: 30 points on 100 m × 1.5 m = 20', () => {
    const cfg = { ...FP, areaUnit: 'PER_100_SQ_M' as const, maxPointsPerLinearUnit: null };
    const ds = Array.from({ length: 10 }, (_, i) => defect({ lengthCm: 20, positionM: i * 3 }));
    const r = scoreDefects(cfg, ds, 100, 150);
    expect(r.totalPoints).toBe(30);
    expect(r.normalizedPoints).toBe(20);
  });

  it('returns null without width', () => {
    expect(scoreDefects(FP, [defect({})], 91.44, null).normalizedPoints).toBeNull();
  });
});

describe('evaluateInspection', () => {
  it('passes a clean full inspection', () => {
    const r = evaluateInspection(input({}));
    expect(r.overall.result).toBe('PASS');
    expect(r.fourPoint.result).toBe('PASS');
    expect(r.widthBasis).toBe('SPEC_CUTTABLE');
    expect(r.warnings).toContain('未测量有效门幅，面积按规格可裁门幅计算');
  });

  it('fails when normalized points exceed threshold', () => {
    // 50 码 × 60 英寸，40 分 → 48 分/100 平方码 > 40
    const ds = Array.from({ length: 10 }, (_, i) => defect({ lengthCm: 30, positionM: i }));
    const r = evaluateInspection(input({ segments: [{ startM: 0, endM: 45.72 }], defects: ds }));
    expect(r.fourPoint.scoring.normalizedPoints).toBe(48);
    expect(r.overall.result).toBe('FAIL');
  });

  it('fails on a critical defect even when the score passes', () => {
    const r = evaluateInspection(input({ defects: [defect({ lengthCm: 1, severity: 'CRITICAL' })] }));
    expect(r.fourPoint.scoring.normalizedPoints).toBeLessThan(40);
    expect(r.fourPoint.result).toBe('FAIL');
    expect(r.overall.result).toBe('FAIL');
    expect(r.overall.reasons.join()).toContain('致命');
  });

  it('judges four-point and customer standards separately', () => {
    const ds = Array.from({ length: 5 }, (_, i) => defect({ lengthCm: 30, positionM: i * 2 }));
    const customer = { versionId: 'c-1', name: '客户A', rules: rules({ schemaVersion: 1, thresholds: { maxNormalizedPoints: 10 } }) };
    const r = evaluateInspection(input({ defects: ds, customer }));
    expect(r.fourPoint.result).toBe('PASS');
    expect(r.customer?.result).toBe('FAIL');
    expect(r.overall.result).toBe('FAIL');
  });

  it('fails on forbidden defect types for the customer', () => {
    const customer = {
      versionId: 'c-1',
      name: '客户A',
      rules: rules({ schemaVersion: 1, forbiddenDefectTypes: ['OIL'] }),
    };
    const r = evaluateInspection(input({ defects: [defect({ defectTypeCode: 'OIL', lengthCm: 1 })], customer }));
    expect(r.fourPoint.result).toBe('PASS');
    expect(r.customer?.result).toBe('FAIL');
  });

  it('checks measurements relative to spec', () => {
    const customer = {
      versionId: 'c-1',
      name: '客户A',
      rules: rules({
        schemaVersion: 1,
        measurementLimits: [
          { itemKey: 'gsm', label: '克重', mode: 'RELATIVE_TO_SPEC', specField: 'gsm', minPct: -5, maxPct: 5 },
        ],
      }),
    };
    const low = evaluateInspection(input({ customer, measurements: [{ itemKey: 'gsm', seq: 1, value: 185 }] }));
    expect(low.customer?.result).toBe('FAIL');
    const ok = evaluateInspection(input({ customer, measurements: [{ itemKey: 'gsm', seq: 1, value: 198 }] }));
    expect(ok.customer?.result).toBe('PASS');
    const missing = evaluateInspection(input({ customer }));
    expect(missing.customer?.result).toBe('INCONCLUSIVE');
    expect(missing.overall.result).toBe('INCONCLUSIVE');
  });

  it('checks average measurement against absolute limits', () => {
    const customer = {
      versionId: 'c-1',
      name: '客户A',
      rules: rules({
        schemaVersion: 1,
        measurementLimits: [{ itemKey: 'width', label: '门幅', mode: 'ABSOLUTE', min: 150, aggregate: 'AVG' }],
      }),
    };
    const m = [149, 152, 152].map((value, i) => ({ itemKey: 'width', seq: i + 1, value }));
    expect(evaluateInspection(input({ customer, measurements: m })).customer?.result).toBe('PASS');
  });

  it('never reports partial inspection as full and flags required scope', () => {
    const customer = { versionId: 'c-1', name: '客户A', rules: rules({ schemaVersion: 1, requiredScope: 'FULL' }) };
    const r = evaluateInspection(
      input({ scope: 'PARTIAL', segments: [{ startM: 0, endM: 30 }], customer }),
    );
    expect(r.scope).toBe('PARTIAL');
    expect(r.inspectedLengthM).toBe(30);
    expect(r.warnings[0]).toContain('部分检验');
    expect(r.customer?.result).toBe('INCONCLUSIVE');
    expect(r.overall.result).toBe('INCONCLUSIVE');
  });

  it('prefers measured effective width', () => {
    const m = [150, 151, 152].map((value, i) => ({ itemKey: 'effective_width', seq: i + 1, value }));
    const r = evaluateInspection(input({ measurements: m }));
    expect(r.widthBasis).toBe('MEASURED_EFFECTIVE');
    expect(r.widthUsedCm).toBe(151);
  });

  it('is inconclusive without any width data', () => {
    const r = evaluateInspection(input({ spec: {} }));
    expect(r.fourPoint.result).toBe('INCONCLUSIVE');
    expect(r.overall.result).toBe('INCONCLUSIVE');
  });

  it('warns about defects outside the inspected segments', () => {
    const r = evaluateInspection(
      input({ scope: 'PARTIAL', segments: [{ startM: 0, endM: 10 }], defects: [defect({ positionM: 50 })] }),
    );
    expect(r.warnings.some((w) => w.includes('不在已记录的检验区段内'))).toBe(true);
  });

  it('uses customer-specific scoring when customer provides its own config', () => {
    const customer = {
      versionId: 'c-1',
      name: '客户B',
      rules: rules({
        schemaVersion: 1,
        fourPoint: { ...FP, maxPointsPerLinearUnit: null },
        thresholds: { maxTotalPoints: 10 },
      }),
    };
    const ds = [0.1, 0.3, 0.5].map((p) => defect({ lengthCm: 30, positionM: p }));
    const r = evaluateInspection(input({ defects: ds, customer }));
    expect(r.fourPoint.scoring.totalPoints).toBe(4);
    expect(r.customer?.scoring.totalPoints).toBe(12);
    expect(r.customer?.result).toBe('FAIL');
  });

  it('is inconclusive when no standard defines any judgement rule', () => {
    const fp = rules({ schemaVersion: 1, fourPoint: FP });
    const r = evaluateInspection(input({ fourPoint: { versionId: 'x', name: 'x', rules: fp } }));
    expect(r.fourPoint.result).toBe('NOT_APPLICABLE');
    expect(r.overall.result).toBe('INCONCLUSIVE');
  });

  it('throws when the four-point standard has no scoring config', () => {
    expect(() =>
      evaluateInspection(input({ fourPoint: { versionId: 'x', name: '空', rules: rules({ schemaVersion: 1 }) } })),
    ).toThrow(/fourPoint/);
  });
});
