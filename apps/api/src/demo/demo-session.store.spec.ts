import { Test } from '@nestjs/testing';
import { DemoSessionStore } from './demo-session.store';
describe('演示会话存储协议',()=>{
 it('Nest应用关闭时释放演示Redis，生产空store关闭也安全',async()=>{
  const redis={disconnect:jest.fn(),del:jest.fn(),flushdb:jest.fn()};
  const module=await Test.createTestingModule({providers:[{provide:DemoSessionStore,useFactory:()=>new DemoSessionStore(redis as never)}]}).compile();
  await module.init();await module.close();expect(redis.disconnect).toHaveBeenCalledTimes(1);expect(redis.del).not.toHaveBeenCalled();expect(redis.flushdb).not.toHaveBeenCalled();
  expect(()=>new DemoSessionStore({} as never).onModuleDestroy()).not.toThrow();
  const direct={disconnect:jest.fn()};const store=new DemoSessionStore(direct as never);store.onModuleDestroy();store.onModuleDestroy();expect(direct.disconnect).toHaveBeenCalledTimes(1);
 });
 it('兑换与提交必须由 redis 单条原子脚本执行',async()=>{
  const redis={eval:jest.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce('ACTIVE')};
  const store=new DemoSessionStore(redis as never);
  await expect(store.createCandidate({jti:'j',sid:'s',chainId:'c',personaId:'p01',actorId:'a',resetVersion:'v1'})).resolves.toBe('OK');
  await expect(store.commit('s','c')).resolves.toBe('ACTIVE');
  expect(redis.eval).toHaveBeenCalledTimes(2);
 });
});
