import { createHmac, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';
import { z } from 'zod';

export const DEMO_ENVIRONMENT = 'fabricqc-demo';
export const DEMO_RESET_VERSION = 'v1';
export const DEMO_ISSUER = 'fabricqc-production-demo-ticket';
export const DEMO_AUDIENCE = 'fabricqc-demo-exchange';
export const DEMO_TICKET_TYPE = 'fqc_demo_ticket';
const body = z.object({iss:z.literal(DEMO_ISSUER),aud:z.literal(DEMO_AUDIENCE),typ:z.literal(DEMO_TICKET_TYPE),environmentId:z.literal(DEMO_ENVIRONMENT),resetVersion:z.literal(DEMO_RESET_VERSION),personaId:z.enum(['p01','p02','p03','p04','p05','p06','p07']),chainId:z.string().regex(/^[a-f0-9]{64}$/),jti:z.string().regex(/^[a-f0-9]{32}$/),iat:z.number().int(),exp:z.number().int()}).strict();
export type DemoTicketClaims = z.infer<typeof body>;
export type TicketInput = Pick<DemoTicketClaims,'environmentId'|'resetVersion'|'personaId'|'chainId'|'jti'>;
const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
function rsaKey(key:string, privateKey:boolean) {
  const k=privateKey?createPrivateKey(key):createPublicKey(key);
  if(k.asymmetricKeyType!=='rsa'||(k.asymmetricKeyDetails?.modulusLength??0)<2048) throw new Error('invalid ticket key');
  return k;
}
export function deriveChain(secret:string,env:string,userId:string,sessionId:string):string {
  if(Buffer.byteLength(secret)<32) throw new Error('invalid chain key');
  return createHmac('sha256',secret).update(JSON.stringify([env,userId,sessionId])).digest('hex');
}
export function newTicketId():string { return randomBytes(16).toString('hex'); }
export function createTicket(key:string,input:TicketInput,now=Math.floor(Date.now()/1000)):string {
  const claims=body.parse({...input,iss:DEMO_ISSUER,aud:DEMO_AUDIENCE,typ:DEMO_TICKET_TYPE,iat:now,exp:now+60});
  const data=`${encode({alg:'RS256',typ:'JWT'})}.${encode(claims)}`;
  return `${data}.${sign('RSA-SHA256',Buffer.from(data),rsaKey(key,true)).toString('base64url')}`;
}
export function verifyTicket(key:string,ticket:string,now=Math.floor(Date.now()/1000)):DemoTicketClaims {
  try {
    if(ticket.length>4096) throw new Error('size');
    const parts=ticket.split('.');if(parts.length!==3) throw new Error('format');
    const header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    if(header.alg!=='RS256'||header.typ!=='JWT'||Object.keys(header).length!==2) throw new Error('algorithm');
    if(!verify('RSA-SHA256',Buffer.from(`${parts[0]}.${parts[1]}`),rsaKey(key,false),Buffer.from(parts[2],'base64url'))) throw new Error('signature');
    const value=body.parse(JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')));
    if(value.exp-value.iat!==60||value.iat>now||value.exp<=now) throw new Error('time');
    return value;
  } catch { throw new Error('invalid demo ticket'); }
}
