import { HealthController } from '../health/health.controller';
describe('演示健康检查',()=>{
 it('即使通知worker关闭仍检查演示会话Redis',async()=>{
  const c=new HealthController({$queryRaw:jest.fn().mockResolvedValue([{ok:1}])} as never,{env:{RUN_WORKERS:false,DEMO_RUNTIME_MODE:'demo'}} as never);
  (c as unknown as {redis:unknown}).redis={status:'ready',ping:jest.fn().mockResolvedValue('PONG')};
  const response=await c.check({status:jest.fn()} as never);
  expect(response.redis).toBe('ok');
 });
 it('演示Redis故障不得报告HTTP健康',async()=>{
  const c=new HealthController({$queryRaw:jest.fn().mockResolvedValue([])} as never,{env:{RUN_WORKERS:false,DEMO_RUNTIME_MODE:'demo'}} as never);
  (c as unknown as {redis:unknown}).redis={status:'ready',ping:jest.fn().mockRejectedValue(new Error('down'))};
  const res={status:jest.fn()};const response=await c.check(res as never);
  expect(response.redis).toBe('down');expect(res.status).toHaveBeenCalledWith(503);
 });
});
