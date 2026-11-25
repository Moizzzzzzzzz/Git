import { describe, expect, it } from 'vitest';
import { profileActions, logoutConfirmation } from '../src/lib/profile-workspace';
describe('personal workspace routes',()=>{
 it.each(['SALES','BUSINESS_MANAGER','BUSINESS_CLERK'] as const)('%s gets department tasks without QC routes',role=>{
  expect(profileActions([role]).map(a=>a.url)).toEqual(['/pages/orders/list','/pages/notifications/index']);
 });
 it.each(['QC_SUPERVISOR','QUALITY_MANAGER'] as const)('%s retains task workspace and review',role=>{
  expect(profileActions([role]).map(a=>a.id)).toEqual(['tasks','reviews','messages']);
 });
 it('inspector has assigned tasks but no review',()=>expect(profileActions(['INSPECTOR']).map(a=>a.id)).toEqual(['tasks','messages']));
 it('admin does not acquire review permission',()=>expect(profileActions(['ADMIN']).map(a=>a.id)).toEqual(['tasks','messages']));
 it('mixed business and inspection retains both distinct task routes',()=>expect(profileActions(['SALES','INSPECTOR']).map(a=>a.url)).toEqual(['/pages/orders/list','/pages/tasks/index','/pages/notifications/index']));
 it('mixed inspector and supervisor retains review once',()=>expect(profileActions(['INSPECTOR','QC_SUPERVISOR']).filter(a=>a.id==='reviews')).toHaveLength(1));
 it('logout warning explicitly preserves unsynced data',()=>{expect(logoutConfirmation(2)).toContain('2 条未同步');expect(logoutConfirmation(2)).toContain('仍保留在本机');expect(logoutConfirmation(0)).toBe('退出后需要重新进入小程序登录');});
});
