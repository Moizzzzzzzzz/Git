import { chooseMeasuredLength } from './measurement-choice';
it('按系统录入或提交时间选择可用的实测长度', () => {
  expect(chooseMeasuredLength({ value: '12', at: new Date('2026-01-01') }, { value: '13', at: new Date('2026-01-02') })).toMatchObject({ value: '13', source: 'INSPECTION_SUBMISSION' });
  expect(chooseMeasuredLength({ value: '14', at: new Date('2026-01-03') }, { value: '13', at: new Date('2026-01-02') })).toMatchObject({ value: '14', source: 'MANUAL_ENTRY' });
  expect(chooseMeasuredLength({ value: '14', at: null }, { value: '13', at: new Date('2026-01-02') })).toMatchObject({ value: '13' });
});
