import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATE_CONTENT,
  DEV_DEFAULT_FOUR_POINT_RULES,
  inspectionDraftSchema,
  parseRollQr,
  standardRulesSchema,
  templateContentSchema,
  wechatBindSchema,
} from './index';

describe('standardRulesSchema', () => {
  it('accepts the dev default four-point rules', () => {
    expect(standardRulesSchema.safeParse(DEV_DEFAULT_FOUR_POINT_RULES).success).toBe(true);
  });
  it('rejects unordered bands', () => {
    const bad = {
      schemaVersion: 1,
      fourPoint: {
        dimensionBasis: 'LENGTH',
        bands: [
          { maxCm: 10, points: 1 },
          { maxCm: 5, points: 2 },
          { maxCm: null, points: 4 },
        ],
        maxPointsPerLinearUnit: null,
        areaUnit: 'PER_100_SQ_M',
      },
    };
    expect(standardRulesSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects bands without open last band', () => {
    const bad = {
      schemaVersion: 1,
      fourPoint: {
        dimensionBasis: 'LENGTH',
        bands: [{ maxCm: 10, points: 1 }],
        maxPointsPerLinearUnit: null,
        areaUnit: 'PER_100_SQ_M',
      },
    };
    expect(standardRulesSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects relative measurement limit without spec field', () => {
    const bad = {
      schemaVersion: 1,
      measurementLimits: [{ itemKey: 'gsm', label: '克重', mode: 'RELATIVE_TO_SPEC', minPct: -5 }],
    };
    expect(standardRulesSchema.safeParse(bad).success).toBe(false);
  });
});

describe('templateContentSchema', () => {
  it('accepts default template', () => {
    expect(templateContentSchema.safeParse(DEFAULT_TEMPLATE_CONTENT).success).toBe(true);
  });
  it('rejects duplicate keys', () => {
    const r = templateContentSchema.safeParse({
      checklist: [
        { key: 'a', label: 'A' },
        { key: 'a', label: 'B' },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe('inspectionDraftSchema', () => {
  const base = {
    baseVersion: 0,
    mode: 'MANUAL',
    scope: 'PARTIAL',
    measurements: [],
    checklist: [],
    defects: [],
    photos: [],
  };
  it('rejects overlapping segments', () => {
    const r = inspectionDraftSchema.safeParse({
      ...base,
      segments: [
        { startM: 0, endM: 10 },
        { startM: 5, endM: 20 },
      ],
    });
    expect(r.success).toBe(false);
  });
  it('rejects defect photo pointing to unknown defect', () => {
    const r = inspectionDraftSchema.safeParse({
      ...base,
      segments: [{ startM: 0, endM: 10 }],
      photos: [
        {
          mediaId: '7d0c7e1e-3f7b-4a3e-9d2c-111111111111',
          kind: 'DEFECT',
          defectClientId: '7d0c7e1e-3f7b-4a3e-9d2c-222222222222',
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe('parseRollQr', () => {
  it('parses url and bare code', () => {
    expect(parseRollQr('https://qc.example.com/r/7K3M9P2QXA')).toBe('7K3M9P2QXA');
    expect(parseRollQr('7k3m9p2qxa')).toBe('7K3M9P2QXA');
    expect(parseRollQr('https://qc.example.com/r/7K3M9P2QXA?x=1')).toBe('7K3M9P2QXA');
  });
  it('rejects garbage and ambiguous letters', () => {
    expect(parseRollQr('hello')).toBeNull();
    expect(parseRollQr('ILOU123456')).toBeNull();
  });
});

describe('wechatBindSchema', () => {
  it('normalizes bind code to upper case', () => {
    const r = wechatBindSchema.parse({ bindTicket: 'x'.repeat(30), employeeNo: 'E001', bindCode: 'ab12cd34' });
    expect(r.bindCode).toBe('AB12CD34');
  });
});
