import { demoAuthRouteAllowed, demoPendingRouteAllowed } from './demo-route-policy';
describe('演示接口旁路限制',()=>{
 it('只允许 auth/me 而拒绝所有登录绑定刷新旁路',()=>{
  expect(demoAuthRouteAllowed('GET','/api/auth/me')).toBe(true);
  for(const path of ['/api/auth/admin/login','/api/auth/admin/refresh','/api/auth/wechat/login','/api/auth/wechat/bind','/api/auth/refresh','/api/auth/logout'])expect(demoAuthRouteAllowed('POST',path)).toBe(false);
  expect(demoAuthRouteAllowed('GET','/api/auth/me/extra')).toBe(false);
  expect(demoAuthRouteAllowed('POST','/API/AUTH/WECHAT/LOGIN')).toBe(false);
  expect(demoAuthRouteAllowed('POST','/Api/Auth/refresh/')).toBe(false);
 });
 it('待提交候选不能调用业务API',()=>{
  expect(demoPendingRouteAllowed('GET','/api/demo/me')).toBe(true);
  expect(demoPendingRouteAllowed('POST','/api/demo/commit')).toBe(true);
  expect(demoPendingRouteAllowed('POST','/api/tasks/business')).toBe(false);
 });
});
