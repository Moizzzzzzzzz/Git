import { generateKeyPairSync } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { DemoSessionService } from './demo-session.service';
import { createTicket } from './demo-ticket';
const pair=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
describe('演示候选会话',()=>{
 it('拒绝同密钥但超出300秒期限的会话',async()=>{
  const store={get:jest.fn().mockResolvedValue({state:'ACTIVE',chainId:'b'.repeat(64),personaId:'p01',actorId:'13943a7e-f52a-4824-984c-1771fefbd6a4',resetVersion:'v1'})};
  const svc=new DemoSessionService({env:{DEMO_RUNTIME_MODE:'demo',DEMO_SESSION_SECRET:'s'.repeat(32)}} as never,new JwtService(),store as never,{} as never);
  const token=new JwtService().sign({sub:'13943a7e-f52a-4824-984c-1771fefbd6a4',sid:'a'.repeat(48),typ:'fqc_demo_access',personaId:'p01',chainId:'b'.repeat(64),resetVersion:'v1'},{secret:'s'.repeat(32),algorithm:'HS256',issuer:'fabricqc-demo',audience:'fabricqc-demo-api',expiresIn:3600});
  await expect(svc.me(token)).rejects.toThrow();
  expect(store.get).not.toHaveBeenCalled();
 });
 it('仅业务前鉴权返回可重试的租约过期码',async()=>{
  const svc=new DemoSessionService({env:{DEMO_RUNTIME_MODE:'demo',DEMO_SESSION_SECRET:'s'.repeat(32)}} as never,new JwtService(),{} as never,{} as never);
  const token=new JwtService().sign({sub:'13943a7e-f52a-4824-984c-1771fefbd6a4',sid:'a'.repeat(48),typ:'fqc_demo_access',personaId:'p01',chainId:'b'.repeat(64),resetVersion:'v1',iat:Math.floor(Date.now()/1000)-301},{secret:'s'.repeat(32),algorithm:'HS256',issuer:'fabricqc-demo',audience:'fabricqc-demo-api',expiresIn:300});
  await expect(svc.context(token,false)).rejects.toMatchObject({code:'DEMO_LEASE_EXPIRED'});
  await expect(svc.me(token)).rejects.toMatchObject({code:'DEMO_SESSION_EXPIRED'});
 });
 it('候选只在提交后变活动且同候选重复提交幂等',async()=>{
  const store={createCandidate:jest.fn().mockResolvedValue('OK'),get:jest.fn().mockResolvedValue({state:'PENDING',chainId:'a'.repeat(64),personaId:'p01',actorId:'13943a7e-f52a-4824-984c-1771fefbd6a4',resetVersion:'v1'}),commit:jest.fn().mockResolvedValue('ACTIVE')};
  const audit={log:jest.fn().mockResolvedValue(undefined)};
  const svc=new DemoSessionService({env:{DEMO_RUNTIME_MODE:'demo',DEMO_TICKET_PUBLIC_KEY:pair.publicKey,DEMO_SESSION_SECRET:'s'.repeat(32)}} as never,new JwtService(),store as never,audit as never);
  const t=createTicket(pair.privateKey,{environmentId:'fabricqc-demo',resetVersion:'v1',personaId:'p01',chainId:'a'.repeat(64),jti:'b'.repeat(32)});
  const session=await svc.exchange(t);
  expect(session.sessionState).toBe('PENDING');
  expect((await svc.me(session.accessToken)).sessionState).toBe('PENDING');
  expect((await svc.commit(session.accessToken)).sessionState).toBe('ACTIVE');
  expect((await svc.commit(session.accessToken)).sessionState).toBe('ACTIVE');
  expect(audit.log).toHaveBeenCalledWith(null,expect.objectContaining({action:'demo.session.commit'}));
 });
});
