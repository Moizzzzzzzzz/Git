import { vcansFabricFallback } from './vcans-fabric';
describe('缺料卷的真实订单资料', () => {
  it('只取订单明确填写的字段，未知字段留空', () => {
    expect(vcansFabricFallback({ productCode: null, productName: 'TEST品名', specification: 'TEST规格', color: '蓝' })).toEqual({ fabricCode: '', fabricName: 'TEST品名', specification: 'TEST规格', color: '蓝' });
  });
});
import { vcansSelectionAllowsInspection } from './vcans-fabric';
it('新订单未选择的卷不可开始验布，旧卷保持原流程', () => {
  expect(vcansSelectionAllowsInspection(null)).toBe(true);
  expect(vcansSelectionAllowsInspection([])).toBe(false);
  expect(vcansSelectionAllowsInspection(['ORIGINAL'])).toBe(true);
  expect(vcansSelectionAllowsInspection(['ADDITIONAL'])).toBe(true);
});
