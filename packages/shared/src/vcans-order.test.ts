import { describe, expect, it } from 'vitest';
import { requiredSampleCount } from './vcans-order';

describe('每缸原定应检卷数', () => {
  it('全检等于实际卷数', () => expect(requiredSampleCount(7, { mode: 'FULL' })).toBe(7));
  it('固定数不超过实际卷数', () => expect(requiredSampleCount(3, { mode: 'FIXED_PER_LOT', fixedRolls: 8 })).toBe(3));
  it('百分比按十进制精确向上取整', () => {
    expect(requiredSampleCount(1000, { mode: 'PERCENT_PER_LOT', percent: '0.1001' })).toBe(2);
    expect(requiredSampleCount(3, { mode: 'PERCENT_PER_LOT', percent: '33.3333' })).toBe(1);
  });
  it('0卷尚无应检卷，不能据此认定到齐', () => expect(requiredSampleCount(0, { mode: 'FULL' })).toBe(0));
  it('拒绝不合法的卷数和比例', () => {
    expect(() => requiredSampleCount(-1, { mode: 'FULL' })).toThrow();
    expect(() => requiredSampleCount(2, { mode: 'FIXED_PER_LOT', fixedRolls: 0 })).toThrow();
    expect(() => requiredSampleCount(2, { mode: 'PERCENT_PER_LOT', percent: '101' })).toThrow();
  });
});

import { createVcansOrderSchema } from './vcans-order';
describe('H订单建单请求', () => {
  const base = { hNo: 'H123', businessDepartmentId: 'e515eab4-dce9-4af1-b2d6-d94a6923f013', supervisorId: 'e515eab4-dce9-4af1-b2d6-d94a6923f014', plan: { mode: 'FULL' }, lines: [{ customerOrderNo: 'PO-1' }, { customerOrderNo: 'PO-2' }] };
  it('允许同H内不同客户订单号且不要求现场卷数', () => expect(createVcansOrderSchema.safeParse(base).success).toBe(true));
  it('拒绝空H、无明细及注入创建人', () => {
    expect(createVcansOrderSchema.safeParse({ ...base, hNo: ' ' }).success).toBe(false);
    expect(createVcansOrderSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(createVcansOrderSchema.safeParse({ ...base, supervisorId: undefined }).success).toBe(false);
    expect(createVcansOrderSchema.safeParse({ ...base, createdById: 'fake' }).success).toBe(false);
  });
});

import { assignVcansOrderSchema } from './vcans-order';
it('分发要求质检员和当前版本，不接受客户端角色注入', () => {
  const valid = { assigneeId: 'e515eab4-dce9-4af1-b2d6-d94a6923f014', version: 0 };
  expect(assignVcansOrderSchema.safeParse(valid).success).toBe(true);
  expect(assignVcansOrderSchema.safeParse({ ...valid, version: -1 }).success).toBe(false);
  expect(assignVcansOrderSchema.safeParse({ ...valid, role: 'ADMIN' }).success).toBe(false);
});

import { createVcansLotSchema } from './vcans-order';
it('补缸需要真实正整数卷数和版本', () => {
  const good = { lineId: 'e515eab4-dce9-4af1-b2d6-d94a6923f013', dyeLotNo: 'TEST-LOT', actualRollCount: 5, version: 0 };
  expect(createVcansLotSchema.safeParse(good).success).toBe(true);
  expect(createVcansLotSchema.safeParse({ ...good, actualRollCount: 0 }).success).toBe(false);
  expect(createVcansLotSchema.safeParse({ ...good, version: -1 }).success).toBe(false);
});

import { vcansVersionSchema } from './vcans-order';
it('到齐确认必须提供非负版本', () => {
  expect(vcansVersionSchema.safeParse({ version: 2 }).success).toBe(true);
  expect(vcansVersionSchema.safeParse({}).success).toBe(false);
});

import { updateVcansOrderSchema } from './vcans-order';
it('修改订单时必须携带版本并拒绝无法识别的字段', () => {
  expect(updateVcansOrderSchema.safeParse({ version: 0, supervisorId: 'e515eab4-dce9-4af1-b2d6-d94a6923f014' }).success).toBe(true);
  expect(updateVcansOrderSchema.safeParse({ version: 0, createdById: 'fake' }).success).toBe(false);
});

import { selectVcansSampleSchema } from './vcans-order';
it('手动选卷要求卷ID与订单版本，不允许重复卷', () => {
  const id = 'e515eab4-dce9-4af1-b2d6-d94a6923f013';
  expect(selectVcansSampleSchema.safeParse({ version: 0, orderRollIds: [id] }).success).toBe(true);
  expect(selectVcansSampleSchema.safeParse({ version: 0, orderRollIds: [id, id] }).success).toBe(false);
});
it('编辑保留明细编号并能提交调整后的抽检计划', () => {
  const id = 'e515eab4-dce9-4af1-b2d6-d94a6923f013';
  expect(updateVcansOrderSchema.safeParse({ version: 1, plan: { mode: 'FIXED_PER_LOT', fixedRolls: 2 }, lines: [{ id, customerOrderNo: 'PO-2' }] }).success).toBe(true);
});
import { registerVcansRollsSchema } from './vcans-order';
it('登记卷允许缺物料，保留标称米数重量', () => {
  expect(registerVcansRollsSchema.safeParse({ version: 1, rolls: [{ rollNo: 'TEST-001', nominalLengthM: '10.5', nominalWeightKg: '2.3' }] }).success).toBe(true);
  expect(registerVcansRollsSchema.safeParse({ version: 1, rolls: [] }).success).toBe(false);
});
import { additionalVcansSampleSchema } from './vcans-order';
it('主管追加检验必须记录处理理由', () => {
  const id = 'e515eab4-dce9-4af1-b2d6-d94a6923f013';
  expect(additionalVcansSampleSchema.safeParse({ requestKey: id, version: 1, orderRollIds: [id], reason: 'TEST追加' }).success).toBe(true);
  expect(additionalVcansSampleSchema.safeParse({ requestKey: id, version: 1, orderRollIds: [id], reason: ' ' }).success).toBe(false);
});
import { vcansImportPreviewSchema, vcansImportCommitSchema } from './vcans-order';
it('导入请求必须显式指定预览部门和每组部门', () => {
  const id = 'e515eab4-dce9-4af1-b2d6-d94a6923f013';
  expect(vcansImportPreviewSchema.safeParse({ filename: 'a.xls', fileBase64: 'YWJj', businessDepartmentId: id, idempotencyKey: id }).success).toBe(true);
  expect(vcansImportCommitSchema.safeParse({ previewId: id, idempotencyKey: id, groups: [{ hNo: 'H1', supervisorId: id, plan: { mode: 'FULL' } }] }).success).toBe(false);
});
import { vcansReminderSchema } from './vcans-order';
it('催审必须提供幂等键', () => {
  expect(vcansReminderSchema.safeParse({ idempotencyKey: 'e515eab4-dce9-4af1-b2d6-d94a6923f013' }).success).toBe(true);
  expect(vcansReminderSchema.safeParse({}).success).toBe(false);
});
import { vcansMeasurementsSchema } from './vcans-order';
it('实测米数重量分别提交、保留空值清除语义', () => {
  expect(vcansMeasurementsSchema.safeParse({ version: 1, measuredLengthM: '12.34' }).success).toBe(true);
  expect(vcansMeasurementsSchema.safeParse({ version: 1, measuredWeightKg: null }).success).toBe(true);
  expect(vcansMeasurementsSchema.safeParse({ version: 1 }).success).toBe(false);
  expect(vcansMeasurementsSchema.safeParse({ version: 1, measuredWeightKg: '1.2345' }).success).toBe(false);
});
