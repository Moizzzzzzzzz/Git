import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import type { Actor } from '../common/actor';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/decorators';
import { AppError } from '../common/app-error';
import { assertAllowedOwner, demoPersonas, personaFor } from './demo-personas';
import { createTicket, deriveChain, DEMO_ENVIRONMENT, DEMO_RESET_VERSION, newTicketId } from './demo-ticket';

@Injectable()
export class DemoProductionService {
 constructor(private readonly config:AppConfig,private readonly audit:AuditService) {}
 private allowed(actor:Actor) {
  const e=this.config.env;
  assertAllowedOwner(actor.userId,e.DEMO_ALLOWED_USER_ID??'',e.DEMO_ENTRY_ENABLED&&e.DEMO_RUNTIME_MODE!=='demo');
  if(!e.DEMO_CHAIN_SECRET||Buffer.byteLength(e.DEMO_CHAIN_SECRET)<32||!e.DEMO_TICKET_PRIVATE_KEY) throw AppError.invalidState('演示配置尚未完成');
 }
 capability(actor:Actor) {
  this.allowed(actor);
  return {enabled:true,environmentId:DEMO_ENVIRONMENT,resetVersion:DEMO_RESET_VERSION,personas:demoPersonas.map(({actorId:_actorId,...p})=>p)};
 }
 async ticket(actor:Actor,personaId:string,meta?:RequestMeta) {
  this.allowed(actor); const p=personaFor(personaId);const e=this.config.env;
  if(!e.DEMO_CHAIN_SECRET||!e.DEMO_TICKET_PRIVATE_KEY) throw AppError.invalidState('演示配置尚未完成');
  const now=Math.floor(Date.now()/1000);
  const chainId=deriveChain(e.DEMO_CHAIN_SECRET,DEMO_ENVIRONMENT,actor.userId,actor.sessionId);
  const ticket=createTicket(e.DEMO_TICKET_PRIVATE_KEY,{environmentId:DEMO_ENVIRONMENT,resetVersion:DEMO_RESET_VERSION,personaId:p.personaId,chainId,jti:newTicketId()},now);
  await this.audit.log(actor,{action:'demo.ticket.issue',entityType:'DemoSession',after:{environmentId:DEMO_ENVIRONMENT,personaId:p.personaId,chainId}},meta);
  return {ticket,expiresAt:new Date((now+60)*1000).toISOString()};
 }
}
