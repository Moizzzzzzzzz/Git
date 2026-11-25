import { generateKeyPairSync } from 'node:crypto';
import { DemoProductionService } from './demo-production.service';
import { verifyTicket } from './demo-ticket';
const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const owner={userId:'owner',sessionId:'sid'} as never;
describe('生产演示授权',()=>{
 it('只允许当前已认证白名单本人并隐藏真实演示actor ID',async()=>{
  const service=new DemoProductionService({env:{DEMO_ENTRY_ENABLED:true,DEMO_ALLOWED_USER_ID:'owner',DEMO_CHAIN_SECRET:'x'.repeat(32),DEMO_TICKET_PRIVATE_KEY:keys.privateKey}} as never,{log:jest.fn().mockResolvedValue(undefined)} as never);
  const capability=service.capability(owner);
  expect(capability.personas).toHaveLength(7);
  expect(capability.personas[0]).not.toHaveProperty('actorId');
  expect(verifyTicket(keys.publicKey,(await service.ticket(owner,'p01')).ticket).personaId).toBe('p01');
  expect(()=>service.capability({userId:'other'} as never)).toThrow();
 });
 it('审计失败不得发放票据',async()=>{
  const service=new DemoProductionService({env:{DEMO_ENTRY_ENABLED:true,DEMO_ALLOWED_USER_ID:'owner',DEMO_CHAIN_SECRET:'x'.repeat(32),DEMO_TICKET_PRIVATE_KEY:keys.privateKey}} as never,{log:jest.fn().mockRejectedValue(new Error('audit'))} as never);
  await expect(service.ticket(owner,'p01')).rejects.toThrow();
 });
 it('缺少签票密钥时不开放入口',()=>{
  const service=new DemoProductionService({env:{DEMO_ENTRY_ENABLED:true,DEMO_ALLOWED_USER_ID:'owner'}} as never,{log:jest.fn().mockResolvedValue(undefined)} as never);
  expect(()=>service.capability(owner)).toThrow();
 });
 it('默认关闭时拒绝授权',()=>{
  const service=new DemoProductionService({env:{DEMO_ENTRY_ENABLED:false,DEMO_ALLOWED_USER_ID:'owner'}} as never,{log:jest.fn().mockResolvedValue(undefined)} as never);
  expect(()=>service.capability(owner)).toThrow();
 });
});
