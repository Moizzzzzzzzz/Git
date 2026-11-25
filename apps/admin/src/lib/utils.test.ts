import { describe, expect, it } from 'vitest';
import { qs } from './api';
import { fmtNum, toNumOrNull } from './utils';

describe('admin utils', () => {
  it('formats numbers without trailing zeros', () => {
    expect(fmtNum(3.6)).toBe('3.6');
    expect(fmtNum(12.345)).toBe('12.35');
    expect(fmtNum(null)).toBe('-');
  });
  it('parses optional numeric inputs', () => {
    expect(toNumOrNull('')).toBeNull();
    expect(toNumOrNull(' 152.4 ')).toBe(152.4);
    expect(toNumOrNull('abc')).toBeNull();
  });
  it('builds query strings without empty values', () => {
    expect(qs({ page: 1, q: '', status: undefined, fabricId: 'x' })).toBe('?page=1&fabricId=x');
    expect(qs({ q: '' })).toBe('');
  });
});
