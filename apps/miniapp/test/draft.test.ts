import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TEMPLATE_CONTENT, DEV_DEFAULT_FOUR_POINT_RULES, standardRulesSchema, templateContentSchema } from '@fabricqc/shared';
import { resetStorage, requests, setResponder } from './taro-mock';
import {
  draftFromServer,
  isDirty,
  loadDraft,
  localEvaluation,
  mutateDraft,
  syncDraft,
  syncLabel,
  toServerDraft,
} from '@/lib/draft';
import type { InspectionDetail } from '@/lib/types';

process.env.TARO_APP_API_BASE_URL = 'http://api.test/api';

const ID = '11111111-1111-4111-8111-111111111111';
const D1 = '22222222-2222-4222-8222-222222222222';

function detail(): InspectionDetail {
  return {
    id: ID,
    inspectionNo: 'QC1',
    status: 'DRAFT',
    mode: 'MACHINE',
    scope: 'FULL',
    revision: 0,
    draftVersion: 3,
    roll: { id: 'r', rollNo: 'R1', dyeLotNo: null, colorCode: null, nominalLengthM: 91.44, fabric: { code: 'F', nameZh: '面料' } },
    task: { id: 't', taskNo: 'T1', title: 'T' },
    inspector: { name: 'x', employeeNo: 'x' },
    spec: { widthCm: 160, cuttableWidthCm: 152.4, gsm: 200, nominalLengthM: 91.44 },
    template: templateContentSchema.parse(DEFAULT_TEMPLATE_CONTENT),
    standards: {
      fourPoint: { versionId: 'v', name: '四分制', version: 1, isDevDefault: true, rules: standardRulesSchema.parse(DEV_DEFAULT_FOUR_POINT_RULES) },
      customer: null,
    },
    segments: [{ startM: 0, endM: 91.44 }],
    measurements: [],
    checklist: [],
    defects: [],
    photos: [],
    remarks: null,
    result: null,
    overallResult: null,
    submittedAt: null,
    reviews: [],
    permissions: { canEdit: true, canReview: false },
  };
}

describe('本地草稿与同步', () => {
  beforeEach(() => {
    resetStorage();
    vi.useFakeTimers();
  });

  it('修改立即保存到本机并标记待同步', () => {
    draftFromServer(detail());
    mutateDraft(ID, (d) => {
      d.defects.push({ clientId: D1, defectTypeCode: 'SLUB', lengthCm: 30, widthCm: null, positionM: 10, widthPositionCm: null, severity: 'MINOR', remark: null });
    });
    const d = loadDraft(ID)!;
    expect(isDirty(d)).toBe(true);
    expect(syncLabel(d).text).toContain('待同步');
    expect(d.defects).toHaveLength(1);
  });

  it('未关联已保存疵点的照片和未上传的照片不会发送到服务端', () => {
    const d = draftFromServer(detail());
    d.photos = [
      { localId: 'a', kind: 'DEFECT', checkpointKey: null, defectClientId: D1, localPath: 'x', thumbPath: 'y', remoteThumb: null, mediaId: '33333333-3333-4333-8333-333333333333', status: 'uploaded' },
      { localId: 'b', kind: 'CHECKPOINT', checkpointKey: 'roll_label', defectClientId: null, localPath: 'x', thumbPath: 'y', remoteThumb: null, mediaId: null, status: 'pending' },
    ];
    expect(toServerDraft(d).photos).toEqual([]);
    d.defects.push({ clientId: D1, defectTypeCode: 'SLUB', lengthCm: 1, widthCm: null, positionM: 1, widthPositionCm: null, severity: 'MINOR', remark: null });
    expect(toServerDraft(d).photos).toHaveLength(1);
    expect(toServerDraft(d).baseVersion).toBe(3);
  });

  it('同步成功后才显示已同步，并更新基准版本', async () => {
    draftFromServer(detail());
    mutateDraft(ID, (d) => {
      d.remarks = '备注';
    });
    setResponder(() => ({ statusCode: 200, data: { draftVersion: 4, evaluation: { overall: { result: 'PASS' } } } }));
    await syncDraft(ID);
    const d = loadDraft(ID)!;
    expect(requests.at(-1)?.method).toBe('PUT');
    expect(isDirty(d)).toBe(false);
    expect(d.baseVersion).toBe(4);
    expect(syncLabel(d).text).toBe('已同步');
  });

  it('断网时数据保留在本机且不显示为已同步', async () => {
    draftFromServer(detail());
    mutateDraft(ID, (d) => {
      d.remarks = '离线修改';
    });
    setResponder(() => new Error('network'));
    await syncDraft(ID);
    const d = loadDraft(ID)!;
    expect(d.remarks).toBe('离线修改');
    expect(isDirty(d)).toBe(true);
    expect(d.syncState).toBe('error');
    expect(syncLabel(d).text).not.toBe('已同步');
  });

  it('版本冲突时标记冲突', async () => {
    draftFromServer(detail());
    mutateDraft(ID, (d) => {
      d.remarks = 'x';
    });
    setResponder(() => ({ statusCode: 409, data: { code: 'VERSION_CONFLICT', message: '冲突' } }));
    await syncDraft(ID);
    expect(loadDraft(ID)!.syncState).toBe('conflict');
  });

  it('本机离线预估与服务端引擎一致', () => {
    const d = draftFromServer(detail());
    d.defects = [{ clientId: D1, defectTypeCode: 'SLUB', lengthCm: 30, widthCm: null, positionM: 10, widthPositionCm: null, severity: 'MINOR', remark: null }];
    const e = localEvaluation(d)!;
    expect(e.fourPoint.scoring.totalPoints).toBe(4);
    expect(e.overall.result).toBe('PASS');
  });
});
