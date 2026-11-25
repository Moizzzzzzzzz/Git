import {describe,expect,it} from 'vitest';
import {scoreUnitLabel,usesOnlyLinearScoring} from './score-unit';
describe('frozen score units',()=>{
 it('distinguishes new length scoring from both historical area units',()=>{
  expect(scoreUnitLabel('PER_100_LINEAR_YD')).toBe('分/100码（布长）');
  expect(scoreUnitLabel('PER_100_SQ_YD')).toBe('分/100平方码');
  expect(scoreUnitLabel('PER_100_SQ_M')).toBe('分/100平方米');
 });
 it('does not silently relabel absent or future units as the current factory unit',()=>{
  expect(scoreUnitLabel(undefined)).toBe('计分单位未记录');
  expect(scoreUnitLabel(null)).toBe('计分单位未记录');
  expect(scoreUnitLabel('FUTURE_UNIT')).toBe('未知计分单位');
 });
 it('retains area information for mixed customer rules and unknown historical units',()=>{
  expect(usesOnlyLinearScoring(['PER_100_LINEAR_YD'])).toBe(true);
  expect(usesOnlyLinearScoring(['PER_100_LINEAR_YD','PER_100_SQ_YD'])).toBe(false);
  expect(usesOnlyLinearScoring(['PER_100_LINEAR_YD',undefined])).toBe(false);
  expect(usesOnlyLinearScoring([])).toBe(false);
 });
});
