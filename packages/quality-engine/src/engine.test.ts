import { describe, expect, it } from 'vitest';
import {
  DEV_DEFAULT_FOUR_POINT_RULES,
  yongshengFormalConfig,
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
  it('formal allocation counts own length and places each whole scoring contribution only on covered yards', () => {
    const cfg = { ...FP, continuousAllocation: 'COVERED_CAPACITY_V1' } as typeof FP;
    const yard = 0.9144;
    const short = defect({ clientId: 'b', defectTypeCode: 'SHADING', positionM: 0.8 * yard, lengthCm: 0.4 * yard * 100 });
    expect(scoreDefects(cfg, [short], 10, 150)).toMatchObject({ rawPoints: 4, totalPoints: 4 });
    const near = defect({ clientId: 'a', positionM: 0.2 * yard, lengthCm: 30 });
    expect(scoreDefects(cfg, [short, near], 10, 150).totalPoints).toBe(8);
    const three = defect({ clientId: 'c', defectTypeCode: 'SHADING', positionM: 0.8 * yard, lengthCm: 1.4 * yard * 100 });
    expect(scoreDefects(cfg, [near, three], 10, 150)).toMatchObject({ rawPoints: 12, totalPoints: 12 });
    const p1 = defect({ clientId: 'p1', positionM: 0.2 * yard, lengthCm: 5 });
    const p3 = defect({ clientId: 'p3', positionM: 1.2 * yard, lengthCm: 20 });
    const partial = scoreDefects(cfg, [short, p1, p3], 10, 150);
    expect(partial).toMatchObject({ rawPoints: 8, totalPoints: 7 });
    expect(partial.defectScores.find(x => x.clientId === short.clientId)).toMatchObject({ points: 4, effectivePoints: 3 });
    expect(partial.defectScores.reduce((sum, x) => sum + (x.effectivePoints ?? 0), 0)).toBe(partial.totalPoints);
    const other = defect({ clientId: 'd', defectTypeCode: 'CONT_STREAK', positionM: 0.9 * yard, lengthCm: 0.3 * yard * 100 });
    const a = scoreDefects(cfg, [short, other, p1, p3], 10, 150);
    const b = scoreDefects(cfg, [p3, other, p1, short], 10, 150);
    expect(a.totalPoints).toBe(b.totalPoints);
    expect(a.totalPoints).toBeLessThanOrEqual(8);
    expect(Object.fromEntries(a.defectScores.map(x => [x.clientId, x.points]))).toEqual(Object.fromEntries(b.defectScores.map(x => [x.clientId, x.points])));
  });
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
  it('per 100 linear yards uses only inspected length, including missing width and zero length', () => {
    const linear = { ...DEV_DEFAULT_FOUR_POINT_RULES, fourPoint: { ...FP, areaUnit: 'PER_100_LINEAR_YD' } } as unknown as StandardRulesInput;
    const cfg = rules(linear).fourPoint!;
    const ds = Array.from({ length: 5 }, (_, i) => defect({ lengthCm: 30, positionM: i * 2 }));
    expect(scoreDefects(cfg, ds, 91.44, null).normalizedPoints).toBe(20);
    expect(scoreDefects(cfg, ds, 91.44, 40).normalizedPoints).toBe(20);
    expect(scoreDefects(cfg, ds, 91.44, 200).normalizedPoints).toBe(20);
    expect(scoreDefects(cfg, ds, 0, 100).normalizedPoints).toBeNull();
  });

  it('linear yard score rounds to two decimals before the threshold decision', () => {
    const linear = rules({ ...DEV_DEFAULT_FOUR_POINT_RULES, failOnSeverity: null, fourPoint: { ...FP, areaUnit: 'PER_100_LINEAR_YD' } } as unknown as StandardRulesInput);
    const ds = Array.from({ length: 10 }, (_, i) => defect({ lengthCm: 30, positionM: i * 2 }));
    const decide = (yards: number) => evaluateInspection(input({ spec: {}, segments: [{ startM: 0, endM: yards * 0.9144 }], defects: ds, fourPoint: { versionId: 'linear', name: '线码', rules: linear } }));
    const pass = decide(100); expect(pass.fourPoint.scoring.normalizedPoints).toBe(40); expect(pass.fourPoint.result).toBe('PASS');
    expect(pass.warnings.join()).not.toContain('缺少门幅');
    expect(pass.fourPoint.checks.map(c => c.message).join()).toContain('分/100线码');
    const fail = decide(99.9); expect(fail.fourPoint.scoring.normalizedPoints).toBeGreaterThan(40); expect(fail.fourPoint.result).toBe('FAIL');
    const boundary = (lengthM: number) => evaluateInspection(input({ spec: {}, segments: [{ startM: 0, endM: lengthM }], defects: [defect({ lengthCm: 30 })], fourPoint: { versionId: 'linear', name: '线码', rules: linear } })).fourPoint;
    expect(boundary(9.143)).toMatchObject({ result: 'PASS', scoring: { normalizedPoints: 40 } });
    expect(boundary(9.142)).toMatchObject({ result: 'FAIL', scoring: { normalizedPoints: 40.01 } });
    const missing = evaluateInspection(input({ spec: {}, segments: [], fourPoint: { versionId: 'linear', name: '线码', rules: linear } }));
    expect(missing.fourPoint.result).toBe('INCONCLUSIVE');
    expect(missing.fourPoint.checks.map(c => c.message).join()).toContain('缺少受检长度');
  });
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
  it.each(['KNIT', 'WOVEN'] as const)('approved %s config routes serious defects and incomplete surface to review', structure => {
    const { rules: config, template } = yongshengFormalConfig(structure);
    const surface = structure === 'KNIT' ? 'knit_surface' : 'woven_surface';
    const fields = template.checklist;
    const checklist = fields.filter(x => x.key !== surface).map(x => ({ key: x.key, status: 'OK' as const }));
    const base = input({ fourPoint: { versionId: 'formal', name: 'TEST正式', rules: config }, spec: {}, templateChecklist: fields, checklist, defects: [defect({ severity: 'MAJOR' })], measurements: [{ itemKey: 'effective_width', seq: 1, value: 100 }] });
    const result = evaluateInspection(base);
    expect(result.fourPoint.checks.find(c => c.code === 'SEVERITY')?.status).toBe('INCONCLUSIVE');
    expect(result.fourPoint.checks.find(c => c.code === `CHECKLIST:${surface}`)?.status).toBe('INCONCLUSIVE');
    expect(result.fourPoint.checks.find(c => c.code === 'MEASUREMENT:effective_width')).toBeUndefined();
    expect(result.overall.result).toBe('INCONCLUSIVE');
  });
  it('formal severe defect requires review and missing width specification is record only', () => {
    const formal = rules({ ...DEV, formalProfile: 'YONGSHENG_2026', measurementLimits: [{ itemKey: 'effective_width', label: '有效门幅', mode: 'RELATIVE_TO_SPEC', specField: 'cuttableWidthCm', minPct: -5, maxPct: 5, aggregate: 'EACH', required: true, onMissingSpec: 'RECORD_ONLY' }] });
    const base = input({ spec: {}, defects: [defect({ severity: 'CRITICAL' })], measurements: [{ itemKey: 'effective_width', seq: 1, value: 100 }], fourPoint: { versionId: 'formal', name: '正式', rules: formal } });
    const result = evaluateInspection(base);
    expect(result.fourPoint.checks.find(c => c.code === 'SEVERITY')?.status).toBe('INCONCLUSIVE');
    expect(result.fourPoint.checks.find(c => c.code === 'MEASUREMENT:effective_width')).toBeUndefined();
    const within = evaluateInspection({ ...base, spec: { cuttableWidthCm: 100 } });
    expect(within.fourPoint.checks.find(c => c.code === 'MEASUREMENT:effective_width')?.status).toBe('PASS');
    const outside = evaluateInspection({ ...base, spec: { cuttableWidthCm: 100 }, measurements: [{ itemKey: 'effective_width', seq: 1, value: 106 }] });
    expect(outside.fourPoint.checks.find(c => c.code === 'MEASUREMENT:effective_width')?.status).toBe('FAIL');
  });
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

describe('检查项策略', () => {
  const templateChecklist = [{key:'color_match',label:'颜色',required:true}];
  const policy = (onNg:'RECORD_ONLY'|'FAIL_ON_NG'|'REVIEW_ON_NG', onNa:'ALLOW'|'INCONCLUSIVE'='INCONCLUSIVE', onMissing:'ALLOW'|'INCONCLUSIVE'='INCONCLUSIVE') => ({checklistKey:'color_match',onNg,onNa,onMissing});
  const evaluate = (p: ReturnType<typeof policy> | null, status?: 'OK'|'NG'|'NA') => evaluateInspection(input({templateChecklist,checklist:status ? [{key:'color_match',status}] : [],fourPoint:{versionId:'fp',name:'测试标准',rules:rules({...DEV,checklistPolicies:p ? [p] : undefined})}}));
  it('NG 分别记录、不合格、人工复核，未配置明确提示', () => {
    const record=evaluate(policy('RECORD_ONLY'),'NG');
    expect(record.overall.result).toBe('PASS'); expect(record.warnings.join()).toContain('未参与判定');
    expect(evaluate(policy('FAIL_ON_NG'),'NG').overall.result).toBe('FAIL');
    expect(evaluate(policy('REVIEW_ON_NG'),'NG').overall.result).toBe('INCONCLUSIVE');
    expect(evaluate(null,'OK').warnings.join()).toContain('未配置');
  });
  it('NA 和缺失遵循配置，OK可通过', () => {
    expect(evaluate(policy('FAIL_ON_NG'),'OK').overall.result).toBe('PASS');
    expect(evaluate(policy('FAIL_ON_NG'),'NA').overall.result).toBe('INCONCLUSIVE');
    expect(evaluate(policy('FAIL_ON_NG','ALLOW'),'NA').overall.result).toBe('PASS');
    expect(evaluate(policy('FAIL_ON_NG')).overall.result).toBe('INCONCLUSIVE');
    expect(evaluate(policy('FAIL_ON_NG','ALLOW','ALLOW')).overall.result).toBe('PASS');
  });
  it('两个标准分别留存原因，FAIL 优先于人工复核', () => {
    const r=evaluateInspection(input({templateChecklist,checklist:[{key:'color_match',status:'NG'}],
      fourPoint:{versionId:'fp',name:'四分制测试',rules:rules({...DEV,checklistPolicies:[policy('REVIEW_ON_NG')]})},
      customer:{versionId:'customer',name:'客户测试',rules:rules({schemaVersion:1,checklistPolicies:[policy('FAIL_ON_NG')]})}}));
    expect(r.fourPoint.result).toBe('INCONCLUSIVE');
    expect(r.customer?.result).toBe('FAIL');
    expect(r.overall.result).toBe('FAIL');
    expect(r.overall.reasons.join()).toContain('客户测试');
    expect(r.overall.reasons.join()).toContain('四分制测试');
  });
  it('拒绝重复检查项和模板未知 key', () => {
    expect(()=>evaluateInspection(input({templateChecklist,checklist:[{key:'color_match',status:'OK'},{key:'color_match',status:'NG'}]}))).toThrow('检查项重复');
    expect(()=>evaluateInspection(input({templateChecklist:[],fourPoint:{versionId:'x',name:'x',rules:rules({...DEV,checklistPolicies:[policy('FAIL_ON_NG')]})}}))).toThrow('不在模板');
  });
});
