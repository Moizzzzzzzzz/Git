import {beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({storage:new Map<string,unknown>(),calls:[] as any[],login:vi.fn(),relaunch:vi.fn(),handler:async(_r:any):Promise<any>=>({statusCode:200,data:{}})}));
vi.mock('@tarojs/taro',()=>({default:{getStorageSync:(k:string)=>h.storage.get(k),setStorageSync:(k:string,v:unknown)=>h.storage.set(k,v),removeStorageSync:(k:string)=>h.storage.delete(k),request:async(r:any)=>{h.calls.push(r);return h.handler(r);},login:h.login,reLaunch:h.relaunch,eventCenter:{trigger:vi.fn()}}}));
vi.mock('../src/lib/config',()=>({API_BASE_URL:'https://real.test/api',DEMO_API_BASE_URL:'https://demo.test/api'}));
const persona={personaId:'p01',label:'TEST',role:'SALES',scopeLabel:'TEST'};
const fields=()=>({environmentId:'fabricqc-demo',resetVersion:'v1',personaId:'p01',actorId:'actor1',role:'SALES',scopeLabel:'TEST',expiresAt:new Date(Date.now()+300000).toISOString()});
let committed=false;let loseCommit=false;
beforeEach(()=>{vi.resetModules();h.storage.clear();h.calls=[];h.login.mockClear();h.relaunch.mockClear();committed=false;loseCommit=false;h.handler=async r=>{
 if(r.url.endsWith('/capability'))return {statusCode:200,data:{enabled:true,environmentId:'fabricqc-demo',resetVersion:'v1',personas:[persona]}};
 if(r.url.endsWith('/ticket'))return {statusCode:200,data:{ticket:'test-ticket',expiresAt:new Date(Date.now()+60000).toISOString()}};
 if(r.url.endsWith('/exchange'))return {statusCode:200,data:{...fields(),accessToken:'PUBLIC_REDACTED',sessionState:'PENDING'}};
 if(r.url.endsWith('/demo/me'))return {statusCode:200,data:{...fields(),sessionState:committed?'ACTIVE':'PENDING'}};
 if(r.url.endsWith('/commit')){committed=true;if(loseCommit){loseCommit=false;throw Error('lost');}return {statusCode:200,data:{sessionState:'ACTIVE',expiresAt:fields().expiresAt}};}
 return {statusCode:200,data:{id:'real',roles:[{role:'SALES'}]}};
};});
async function setup(){const api=await import('../src/lib/api');api.saveTokens({accessToken:'PUBLIC_REDACTED',refreshToken:'PUBLIC_REDACTED'});return {api,demo:await import('../src/lib/demo-session'),ctx:await import('../src/lib/session-context')};}
describe('独立演示身份恢复验收',()=>{
 it.each([
  ['损坏active',{kind:'demo',accessToken:'broken'}],
  ['未知环境版本',{kind:'demo',accessToken:'x',actorId:'a',personaId:'p01',environmentId:'fabricqc-demo',resetVersion:'unknown',identityGeneration:1,leaseVersion:1,expiresAt:'2099-01-01T00:00:00Z',role:'SALES',scopeLabel:'TEST'}],
 ])('%s冷启动进入安全恢复态，不静默开放本人写操作',async(_label,active)=>{
  h.storage.set('fqc_access','real-token');h.storage.set('fqc_refresh','real-refresh');h.storage.set('fqc_drafts',['keep']);h.storage.set('fqc_demo_active',active);
  const ctx=await import('../src/lib/session-context');expect(ctx.contextPhase()).toBe('recovering');expect(()=>ctx.assertReady()).toThrow();expect(h.storage.get('fqc_access')).toBe('real-token');expect(h.storage.get('fqc_drafts')).toEqual(['keep']);
 });
 it('损坏pending冷启动保持恢复屏障且不删除本人数据',async()=>{
  h.storage.set('fqc_access','real-token');h.storage.set('fqc_drafts',['keep']);h.storage.set('fqc_demo_pending',{phase:'COMMITTING',candidate:{}});
  const ctx=await import('../src/lib/session-context');expect(ctx.contextPhase()).toBe('recovering');expect(()=>ctx.pendingDemo()).toThrow();expect(h.storage.get('fqc_access')).toBe('real-token');expect(h.storage.get('fqc_drafts')).toEqual(['keep']);
 });
 it('冷启动持久演示身份须经真实me为ACTIVE才解除屏障',async()=>{
  const {demo}=await setup();await demo.switchDemoPersona('p01');committed=true;vi.resetModules();
  const ctx=await import('../src/lib/session-context'),freshDemo=await import('../src/lib/demo-session');expect(ctx.contextPhase()).toBe('recovering');expect(()=>ctx.assertReady()).toThrow();
  await freshDemo.recoverDemo();expect(ctx.contextPhase()).toBe('ready');expect(ctx.currentContext().kind).toBe('demo');
 });
 it('冷启动演示租约过期保持恢复屏障，不触发微信登录并保留本人草稿',async()=>{
  const {demo}=await setup();await demo.switchDemoPersona('p01');h.storage.set('fqc_drafts',['keep']);vi.resetModules();
  h.handler=async r=>r.url.endsWith('/demo/me')?{statusCode:401,data:{code:'DEMO_SESSION_EXPIRED'}}:{statusCode:200,data:{}};
  const ctx=await import('../src/lib/session-context'),freshDemo=await import('../src/lib/demo-session');await expect(freshDemo.recoverDemo()).rejects.toThrow();
  expect(ctx.contextPhase()).toBe('recovering');expect(h.login).not.toHaveBeenCalled();expect(h.storage.get('fqc_access')).toBe('real-token');expect(h.storage.get('fqc_drafts')).toEqual(['keep']);
 });
 it('服务端已commit但响应丢失，冷启动读取pending并恢复同候选',async()=>{
  const {demo,ctx}=await setup();h.storage.set('fqc_drafts',['original']);loseCommit=true;
  await expect(demo.switchDemoPersona('p01')).rejects.toThrow();expect(ctx.contextPhase()).toBe('recovering');expect(h.storage.has('fqc_demo_pending')).toBe(true);
  vi.resetModules();const freshCtx=await import('../src/lib/session-context');const freshDemo=await import('../src/lib/demo-session');expect(freshCtx.contextPhase()).toBe('recovering');
  await freshDemo.recoverDemo();expect(freshCtx.currentContext().kind).toBe('demo');expect(h.calls.filter(r=>r.url.endsWith('/commit'))).toHaveLength(1);expect(h.storage.get('fqc_drafts')).toEqual(['original']);expect(h.storage.get('fqc_access')).toBe('real-token');expect(h.login).not.toHaveBeenCalled();
 });
 it('同persona续期保留身份代次与草稿作用域，只更新凭据租约',async()=>{
  const {demo,ctx}=await setup();await demo.switchDemoPersona('p01');const before=ctx.currentContext(),scope=ctx.contextScope(before);await demo.renewDemoLease(before);const after=ctx.currentContext();
  expect(after.identityGeneration).toBe(before.identityGeneration);expect(after.leaseVersion).toBeGreaterThan(before.leaseVersion);expect(ctx.contextScope(after)).toBe(scope);
 });
 it('写入超时结果未知时不自动重放',async()=>{
  const {demo,api}=await setup();await demo.switchDemoPersona('p01');const normal=h.handler;h.calls=[];h.handler=async r=>{if(r.url.endsWith('/tasks/business'))throw Error('timeout');return normal(r);};
  await expect(api.api.post('/tasks/business',{})).rejects.toThrow();expect(h.calls.filter(r=>r.url.endsWith('/tasks/business'))).toHaveLength(1);expect(h.calls.every(r=>!r.url.endsWith('/auth/wechat/login'))).toBe(true);expect(h.login).not.toHaveBeenCalled();
 });
 it.each(['DEMO_LEASE_EXPIRED','DEMO_LEASE_REVOKED'])('确认请求仅在守卫业务前明确%s拒绝后续票并重试一次',async code=>{
  const {demo,api}=await setup();await demo.switchDemoPersona('p01');const normal=h.handler;let count=0;h.calls=[];h.handler=async r=>{if(r.url.endsWith('/media/id/confirm'))return ++count===1?{statusCode:401,data:{code}}:{statusCode:200,data:{ok:true}};return normal(r);};
  await expect(api.api.post('/media/id/confirm',{})).resolves.toEqual({ok:true});expect(count).toBe(2);expect(h.calls.filter(r=>r.url.endsWith('/ticket'))).toHaveLength(1);expect(h.login).not.toHaveBeenCalled();
 });
 it('其他401不续票、不重放写请求',async()=>{
  const {demo,api}=await setup();await demo.switchDemoPersona('p01');h.calls=[];h.handler=async()=>({statusCode:401,data:{code:'OTHER'}});await expect(api.api.post('/media/id/confirm',{})).rejects.toThrow();expect(h.calls).toHaveLength(1);expect(h.login).not.toHaveBeenCalled();
 });
 it('有在途写链时20秒超时不得切换或发候选票据',async()=>{
  vi.useFakeTimers();
  try{
   const {demo,ctx}=await setup();await demo.switchDemoPersona('p01');const before=ctx.currentContext(),release=ctx.holdWrite(before);h.calls=[];
   const promise=demo.switchDemoPersona('p02');const result=expect(promise).rejects.toMatchObject({code:'DEMO_SWITCH_BUSY'});
   await vi.advanceTimersByTimeAsync(20001);await result;
   expect(ctx.currentContext()).toEqual(before);expect(ctx.contextPhase()).toBe('ready');expect(h.calls).toHaveLength(0);release();
  } finally {vi.useRealTimers();}
 });
});
