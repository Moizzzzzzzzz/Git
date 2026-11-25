import { AuthGuard } from '../auth/auth.guard';

describe('演示认证守卫',()=>{
 const ctx=(path:string,method:string,token='x')=>({getHandler:()=>({}),getClass:()=>({}),switchToHttp:()=>({getRequest:()=>({path,method,header:()=>`Bearer ${token}`})})}) as never;
 it('生产默认认证路径保持原token服务与公开登录',async()=>{
  const tokens={authenticate:jest.fn().mockResolvedValue({userId:'real',roles:[]})};
  const guard=new AuthGuard({getAllAndOverride:()=>undefined} as never,tokens as never,{env:{DEMO_RUNTIME_MODE:'production'}} as never,{} as never,{} as never);
  await expect(guard.canActivate(ctx('/api/auth/me','GET','real-token'))).resolves.toBe(true);
  expect(tokens.authenticate).toHaveBeenCalledWith('real-token');
  const publicGuard=new AuthGuard({getAllAndOverride:()=>true} as never,tokens as never,{env:{DEMO_RUNTIME_MODE:'production'}} as never,{} as never,{} as never);
  await expect(publicGuard.canActivate(ctx('/api/auth/wechat/login','POST'))).resolves.toBe(true);
 });
 it('demo禁止公开微信登录旁路，即使标为public',async()=>{
  const guard=new AuthGuard({getAllAndOverride:()=>true} as never,{} as never,{env:{DEMO_RUNTIME_MODE:'demo'}} as never,{} as never,{} as never);
  await expect(guard.canActivate(ctx('/api/auth/wechat/login','POST'))).rejects.toThrow();
 });
 it('pending只能访问me/commit/logout，不能访问业务',async()=>{
  const guard=new AuthGuard({getAllAndOverride:()=>undefined} as never,{} as never,{env:{DEMO_RUNTIME_MODE:'demo'}} as never,{context:jest.fn().mockResolvedValue({claims:{personaId:'p01',sid:'s'},state:'PENDING'})} as never,{load:jest.fn().mockResolvedValue({roles:[]})} as never);
  await expect(guard.canActivate(ctx('/api/tasks/business','POST'))).rejects.toThrow();
  await expect(guard.canActivate(ctx('/api/demo/me','GET'))).resolves.toBe(true);
 });
});
