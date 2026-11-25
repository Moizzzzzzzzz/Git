import { describe, expect, it } from 'vitest';
import { createBusinessTaskSchema } from './dto';

const valid = {
  title: '订单验布',
  businessDepartmentId: 'e515eab4-dce9-4af1-b2d6-d94a6923f013',
  supervisorId: 'e515eab4-dce9-4af1-b2d6-d94a6923f014',
  plannedRollCount: 10,
  fourPointStandardId: 'e515eab4-dce9-4af1-b2d6-d94a6923f015',
  templateId: 'e515eab4-dce9-4af1-b2d6-d94a6923f016',
};
describe('业务任务建单', () => {
  it('接受正整数计划卷数，不要求卷号', () => {
    expect(createBusinessTaskSchema.safeParse(valid).success).toBe(true);
  });
  it.each([0, -1, 1.5, null, undefined])('拒绝无效计划卷数 %s', (plannedRollCount) => {
    expect(createBusinessTaskSchema.safeParse({ ...valid, plannedRollCount }).success).toBe(false);
  });
  it('拒绝注入任务来源或执行人', () => {
    expect(createBusinessTaskSchema.safeParse({ ...valid, origin: 'LEGACY' }).success).toBe(false);
    expect(createBusinessTaskSchema.safeParse({ ...valid, assigneeId: valid.supervisorId }).success).toBe(false);
  });
});

it('提供部门经理和内勤角色，并可被角色校验识别', async () => {
  const { ROLE_CODES, ROLE_LABELS } = await import('./index');
  expect(ROLE_CODES).toContain('BUSINESS_MANAGER');
  expect(ROLE_CODES).toContain('BUSINESS_CLERK');
  expect(ROLE_LABELS.BUSINESS_MANAGER).toBe('部门经理');
  expect(ROLE_LABELS.BUSINESS_CLERK).toBe('内勤');
});
