import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../config/app-config';
import { AppError } from '../common/app-error';
import { AuditService } from '../audit/audit.service';
import { DEMO_ENVIRONMENT, DEMO_RESET_VERSION, verifyTicket } from './demo-ticket';
import { personaFor } from './demo-personas';
import { DemoSessionStore } from './demo-session.store';
import { burnPasswordCheck, verifyPassword } from '../auth/password';

const ISSUER='fabricqc-demo';
const AUDIENCE='fabricqc-demo-api';
const TYPE='fqc_demo_access';
const REVIEW_TYPE='fqc_review_access';
interface Claims {sub:string;sid:string;typ:string;personaId:string;chainId:string;resetVersion:string;iat:number;exp:number;reviewRevision?:string}
@Injectable()
export class DemoSessionService {
 constructor(private readonly config:AppConfig,private readonly jwt:JwtService,private readonly store:DemoSessionStore,private readonly audit:AuditService) {}
 private secret():string {
  const e=this.config.env;if(e.DEMO_RUNTIME_MODE!=='demo'||!e.DEMO_SESSION_SECRET||Buffer.byteLength(e.DEMO_SESSION_SECRET)<32) throw AppError.forbidden('演示未启用');return e.DEMO_SESSION_SECRET;
 }
 async exchange(ticket:string) {
  if(this.config.env.REVIEW_MODE)throw AppError.forbidden('审核环境不支持演示票据');
  const secret=this.secret();const key=this.config.env.DEMO_TICKET_PUBLIC_KEY;
  if(!key)throw AppError.forbidden('演示未启用');
  let c;try{c=verifyTicket(key,ticket);}catch{throw AppError.of('DEMO_TICKET_INVALID','演示凭证无效或已过期',401);}
  const p=personaFor(c.personaId);const sid=randomBytes(24).toString('hex');
  const accessToken=this.jwt.sign({sub:p.actorId,sid,typ:TYPE,personaId:p.personaId,chainId:c.chainId,resetVersion:c.resetVersion},{secret,algorithm:'HS256',issuer:ISSUER,audience:AUDIENCE,expiresIn:300});
  const status=await this.store.createCandidate({jti:c.jti,sid,chainId:c.chainId,personaId:p.personaId,actorId:p.actorId,resetVersion:c.resetVersion});
  if(status==='TICKET_USED')throw AppError.of('DEMO_TICKET_USED','演示凭证已使用',409);
  if(status!=='OK')throw AppError.invalidState('无法建立演示会话');
  const claims=this.decode(accessToken);
  return {accessToken,expiresAt:new Date(claims.exp*1000).toISOString(),environmentId:DEMO_ENVIRONMENT,resetVersion:DEMO_RESET_VERSION,personaId:p.personaId,role:p.role,scopeLabel:p.scopeLabel,sessionState:'PENDING' as const};
 }
 async reviewLogin(username:string,password:string) {
  const e=this.config.env;const now=Math.floor(Date.now()/1000);
  if(!e.REVIEW_MODE||!e.REVIEW_ENABLED||!e.REVIEW_USERNAME||!e.REVIEW_PASSWORD_HASH||!e.REVIEW_EXPIRES_AT||!e.REVIEW_REVISION)throw AppError.unauthenticated('审核账号不可用');
  const expires=Math.floor(Date.parse(e.REVIEW_EXPIRES_AT)/1000);
  if(!Number.isFinite(expires)||expires<=now)throw AppError.unauthenticated('审核账号不可用');
  if(username!==e.REVIEW_USERNAME){await burnPasswordCheck(password);throw AppError.unauthenticated('审核账号或密码错误');}
  if(!await verifyPassword(e.REVIEW_PASSWORD_HASH,password))throw AppError.unauthenticated('审核账号或密码错误');
  const p=personaFor('p01'),sid=randomBytes(24).toString('hex'),chainId=randomBytes(32).toString('hex'),jti=randomBytes(16).toString('hex'),ttl=Math.min(7200,expires-Math.floor(Date.now()/1000)-1);
  if(ttl<1)throw AppError.unauthenticated('审核账号不可用');
  const accessToken=this.jwt.sign({sub:p.actorId,sid,typ:REVIEW_TYPE,personaId:p.personaId,chainId,resetVersion:DEMO_RESET_VERSION,reviewRevision:e.REVIEW_REVISION},{secret:this.secret(),algorithm:'HS256',issuer:ISSUER,audience:AUDIENCE,expiresIn:ttl});
  const status=await this.store.createCandidate({jti,sid,chainId,personaId:p.personaId,actorId:p.actorId,resetVersion:DEMO_RESET_VERSION,ttlSeconds:ttl});
  if(status!=='OK')throw AppError.invalidState('无法建立审核会话');
  await this.audit.log(null,{action:'review.session.login',entityType:'ReviewSession',after:{personaId:p.personaId}});
  const claims=this.decode(accessToken);
  return {accessToken,expiresAt:new Date(claims.exp*1000).toISOString(),environmentId:DEMO_ENVIRONMENT,resetVersion:DEMO_RESET_VERSION,personaId:p.personaId,role:p.role,scopeLabel:'审核演示',sessionState:'PENDING' as const};
 }
 private decode(token:string,controlRoute=false):Claims {
  try {
   const c=this.jwt.verify<Claims>(token,{secret:this.secret(),algorithms:['HS256'],issuer:ISSUER,audience:AUDIENCE});
   const e=this.config.env,now=Math.floor(Date.now()/1000);
   if(!Number.isSafeInteger(c.iat)||!Number.isSafeInteger(c.exp)||c.iat>now||!/^[a-f0-9]{48}$/.test(c.sid)||!/^[a-f0-9]{64}$/.test(c.chainId)||c.resetVersion!==DEMO_RESET_VERSION||personaFor(c.personaId).actorId!==c.sub)throw new Error('claims');
   if(c.typ===REVIEW_TYPE){if(!e.REVIEW_MODE||!e.REVIEW_ENABLED||!e.REVIEW_EXPIRES_AT||!e.REVIEW_REVISION||c.reviewRevision!==e.REVIEW_REVISION||c.personaId!=='p01'||c.exp-c.iat<1||c.exp-c.iat>7200||c.exp>Math.floor(Date.parse(e.REVIEW_EXPIRES_AT)/1000)||now>=Math.floor(Date.parse(e.REVIEW_EXPIRES_AT)/1000))throw new Error('review claims');}
   else if(c.typ!==TYPE||e.REVIEW_MODE||c.exp-c.iat!==300)throw new Error('demo claims');
   return c;
  }catch(err){
   if((err as Error).name==='TokenExpiredError')throw AppError.of(controlRoute?'DEMO_SESSION_EXPIRED':'DEMO_LEASE_EXPIRED','演示会话已过期',401);
   throw AppError.unauthenticated('演示凭证无效');
  }
 }
 async context(token:string,allowPending:boolean) {
  const c=this.decode(token,allowPending);const data=await this.store.get(c.sid);
  if(!data.state||data.state==='REVOKED')throw AppError.of(allowPending?'DEMO_SESSION_EXPIRED':'DEMO_LEASE_REVOKED','演示会话已失效',401);
  if(data.chainId!==c.chainId||data.personaId!==c.personaId||data.actorId!==c.sub||data.resetVersion!==c.resetVersion)throw AppError.unauthenticated('演示会话无效');
  if(data.state!=='ACTIVE'&&!(allowPending&&data.state==='PENDING'))throw AppError.forbidden('演示会话尚未启用');
  return {claims:c,state:data.state as 'PENDING'|'ACTIVE'};
 }
 async me(token:string) {
  const {claims:c,state}=await this.context(token,true);const p=personaFor(c.personaId);
  return {environmentId:DEMO_ENVIRONMENT,resetVersion:DEMO_RESET_VERSION,personaId:p.personaId,actorId:p.actorId,role:p.role,scopeLabel:p.scopeLabel,expiresAt:new Date(c.exp*1000).toISOString(),sessionState:state};
 }
 async commit(token:string) {
  const {claims:c}=await this.context(token,true);const ttl=c.typ===REVIEW_TYPE?Math.max(1,c.exp-Math.floor(Date.now()/1000)):300;const result=await this.store.commit(c.sid,c.chainId,ttl);
  if(result==='CHANGED')throw AppError.of('DEMO_SESSION_CHANGED','演示身份已变化，请重新选择',409);
  if(result!=='ACTIVE')throw AppError.of('DEMO_SESSION_CHANGED','演示会话已变化，请重试',409);
  await this.audit.log(null,{action:'demo.session.commit',entityType:'DemoSession',after:{chainId:c.chainId,personaId:c.personaId,actorId:c.sub}});
  return {sessionState:'ACTIVE' as const,expiresAt:new Date(c.exp*1000).toISOString()};
 }
 async logout(token:string) {
  const {claims:c}=await this.context(token,true);await this.store.logout(c.sid,c.chainId);return {ok:true};
 }
}
