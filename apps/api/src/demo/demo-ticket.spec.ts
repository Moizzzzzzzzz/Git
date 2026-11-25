import { generateKeyPairSync } from 'node:crypto';
import { createTicket, verifyTicket, deriveChain, DEMO_AUDIENCE } from './demo-ticket';

const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const now=1_700_000_000;
const claims={environmentId:'fabricqc-demo',resetVersion:'v1',personaId:'p01',chainId:'a'.repeat(64),jti:'b'.repeat(32)} as const;
describe('演示票据',()=>{
 it('仅接受60秒内的指定用途签名',()=>{
  const ticket=createTicket(keys.privateKey,claims,now);
  expect(verifyTicket(keys.publicKey,ticket,now+1)).toMatchObject(claims);
  expect(()=>verifyTicket(keys.publicKey,ticket,now+61)).toThrow();
  const other=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  expect(()=>verifyTicket(other.publicKey,ticket,now+1)).toThrow();
  expect(DEMO_AUDIENCE).toBe('fabricqc-demo-exchange');
 });
 it('设备链绑定已认证主体和会话',()=>{
  const a=deriveChain('k'.repeat(32),'fabricqc-demo','owner','session');
  expect(a).toEqual(deriveChain('k'.repeat(32),'fabricqc-demo','owner','session'));
  expect(a).not.toEqual(deriveChain('k'.repeat(32),'fabricqc-demo','owner','session2'));
 });
});
