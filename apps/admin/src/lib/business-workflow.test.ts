import { describe, expect, it } from 'vitest';
import { canRemindTask, homePathForRoles, isBusinessOnly, parseRollNumbers } from './business-workflow';
describe('business workflow presentation rules', () => {
  it('uses service reminder permission, never counts rejected reviews as approved', () => {
    expect(canRemindTask({ delivered:false, planned:10, registered:10, reviewed:10, pendingReview:0, canRemind:false, status:'IN_PROGRESS' })).toBe(false);
    expect(canRemindTask({ delivered:false, planned:10, registered:10, reviewed:10, pendingReview:0, canRemind:true, status:'IN_PROGRESS' })).toBe(true);
    expect(canRemindTask({ delivered:true, canRemind:true, status:'COMPLETED' })).toBe(false);
    expect(canRemindTask({ delivered:false, canRemind:true, status:'CANCELLED' })).toBe(false);
    expect(canRemindTask({ delivered:false })).toBe(false);
  });
  it('keeps a real QC role available while routing pure business roles to the safe workspace', () => {
    expect(isBusinessOnly(['BUSINESS_MANAGER'])).toBe(true);
    expect(isBusinessOnly(['SALES', 'QC_SUPERVISOR'])).toBe(false);
  });
  it('rejects duplicate roll numbers rather than silently reducing the submitted count', () => {
    expect(() => parseRollNumbers('A01\nA01')).toThrow('重复');
    expect(parseRollNumbers(' A01， A02\nA03 ')).toEqual(['A01', 'A02', 'A03']);
  });
});

describe('default workspace follows dashboard authorization', () => {
  it('routes an inspector to tasks instead of a forbidden dashboard', () => {
    expect(homePathForRoles(['INSPECTOR'])).toBe('/tasks');
  });
  it('routes business plus inspector to department tasks without removing either role', () => {
    expect(homePathForRoles(['SALES', 'INSPECTOR'])).toBe('/orders');
    expect(isBusinessOnly(['SALES', 'INSPECTOR'])).toBe(false);
    expect(homePathForRoles(['BUSINESS_MANAGER'])).toBe('/orders');
  });
  it('keeps the dashboard for an actual supervisory or management role', () => {
    expect(homePathForRoles(['SALES', 'QC_SUPERVISOR'])).toBe('/');
    expect(homePathForRoles(['QUALITY_MANAGER'])).toBe('/');
    expect(homePathForRoles(['ADMIN'])).toBe('/');
  });
});
