import { describe, expect, it } from 'vitest';
import { businessProgress } from './business-progress';

describe('业务任务卷数', () => {
  it('未登记、草稿与退回计入未验，退回单列', () => {
    expect(businessProgress(10, ['SUBMITTED', 'APPROVED', 'REJECTED', 'SUBMITTED', 'DRAFT', 'RETURNED']))
      .toEqual({ planned: 10, registered: 6, inspected: 4, uninspected: 6, pendingReview: 2, reviewed: 2, returned: 1 });
  });
  it('拒绝登记数超过计划数', () => {
    expect(() => businessProgress(1, ['DRAFT', 'SUBMITTED'])).toThrow();
  });
});
