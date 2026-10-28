import { buildTemplateData, formatField, formatTime } from './message-format';

describe('subscribe message formatting', () => {
  it('truncates thing fields to 20 chars', () => {
    expect([...formatField('thing1', '一二三四五六七八九十一二三四五六七八九十多出来')].length).toBe(20);
  });
  it('keeps only chinese chars in phrase and limits to 5', () => {
    expect(formatField('phrase4', '不合格 FAIL')).toBe('不合格');
    expect(formatField('phrase4', 'PASS')).toBe('-');
  });
  it('formats time in Asia/Shanghai', () => {
    expect(formatTime(new Date('2026-10-28T02:05:00Z'))).toBe('2026-10-28 10:05');
  });
  it('maps business fields to template keys', () => {
    const d = buildTemplateData({ character_string1: 'rollNo', thing2: 'fabricName' }, { rollNo: 'R-001', fabricName: '涤纶' });
    expect(d).toEqual({ character_string1: { value: 'R-001' }, thing2: { value: '涤纶' } });
  });
});
