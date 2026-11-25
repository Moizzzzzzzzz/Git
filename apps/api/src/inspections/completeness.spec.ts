import { templateContentSchema, DEFAULT_TEMPLATE_CONTENT } from '@fabricqc/shared';
import { checkCompleteness, type CompletenessInput } from './completeness';

const template = templateContentSchema.parse(DEFAULT_TEMPLATE_CONTENT);
const D1 = '00000000-0000-4000-8000-000000000001';

function complete(overrides: Partial<CompletenessInput> = {}): CompletenessInput {
  return {
    scope: 'FULL',
    template,
    nominalLengthM: 100,
    segments: [{ startM: 0, endM: 100 }],
    measurements: [
      ...[1, 2, 3].map((seq) => ({ itemKey: 'width', seq, value: 160 })),
      ...[1, 2, 3].map((seq) => ({ itemKey: 'effective_width', seq, value: 152 })),
      { itemKey: 'gsm', seq: 1, value: 200 },
      { itemKey: 'roll_length', seq: 1, value: 100 },
    ],
    checklist: template.checklist.map((c) => ({ key: c.key, status: 'OK' })),
    defects: [{ clientId: D1, positionM: 10, defectTypeCode: 'SLUB' }],
    photos: [
      { kind: 'CHECKPOINT', checkpointKey: 'roll_label', defectClientId: null, uploaded: true },
      { kind: 'CHECKPOINT', checkpointKey: 'fabric_face', defectClientId: null, uploaded: true },
      { kind: 'DEFECT', checkpointKey: null, defectClientId: D1, uploaded: true },
    ],
    requireDefectPhoto: true,
    ...overrides,
  };
}

describe('checkCompleteness', () => {
  it('accepts a complete full inspection', () => {
    expect(checkCompleteness(complete())).toEqual([]);
  });

  it('rejects full scope that does not cover the whole roll', () => {
    const p = checkCompleteness(complete({ segments: [{ startM: 0, endM: 60 }], defects: [] , photos: complete().photos.slice(0, 2)}));
    expect(p.join()).toContain('整卷全检的检验区段必须连续覆盖');
  });

  it('rejects full scope with a gap between segments', () => {
    const p = checkCompleteness(
      complete({
        segments: [
          { startM: 0, endM: 40 },
          { startM: 50, endM: 100 },
        ],
      }),
    );
    expect(p.join()).toContain('整卷全检');
  });

  it('accepts partial scope with partial coverage', () => {
    expect(checkCompleteness(complete({ scope: 'PARTIAL', segments: [{ startM: 0, endM: 30 }] }))).toEqual([]);
  });

  it('requires roll length for full inspection', () => {
    const measurements = complete().measurements.filter((m) => m.itemKey !== 'roll_length');
    const p = checkCompleteness(complete({ measurements }));
    expect(p).toContain('整卷全检必须记录实测卷长');
  });

  it('requires minimum readings, checklist and checkpoint photos', () => {
    const p = checkCompleteness(
      complete({
        measurements: [{ itemKey: 'roll_length', seq: 1, value: 100 }],
        checklist: [],
        photos: [{ kind: 'DEFECT', checkpointKey: null, defectClientId: D1, uploaded: true }],
      }),
    );
    expect(p.some((x) => x.includes('门幅至少需要 3 个读数'))).toBe(true);
    expect(p.some((x) => x.includes('检查项未填写'))).toBe(true);
    expect(p.some((x) => x.includes('布卷标签'))).toBe(true);
  });

  it('requires a photo for every defect and all photos uploaded', () => {
    const photos = complete().photos.filter((p) => p.kind !== 'DEFECT');
    photos.push({ kind: 'CHECKPOINT', checkpointKey: 'color_compare', defectClientId: null, uploaded: false });
    const p = checkCompleteness(complete({ photos }));
    expect(p).toContain('1 个疵点缺少照片');
    expect(p).toContain('有 1 张照片尚未上传成功');
  });

  it('rejects defects outside inspected segments', () => {
    const p = checkCompleteness(
      complete({ scope: 'PARTIAL', segments: [{ startM: 0, endM: 5 }], defects: [{ clientId: D1, positionM: 10, defectTypeCode: 'SLUB' }] }),
    );
    expect(p.some((x) => x.includes('不在检验区段内'))).toBe(true);
  });

  it('rejects segments beyond the measured length', () => {
    const p = checkCompleteness(complete({ scope: 'PARTIAL', segments: [{ startM: 0, endM: 120 }] }));
    expect(p.some((x) => x.includes('超过实测卷长'))).toBe(true);
  });
});
