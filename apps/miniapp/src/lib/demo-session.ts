import type {RoleCode} from '@fabricqc/shared';
import {DEMO_API_BASE_URL} from './config';
import {requestReal, rawAt, ApiError} from './api';
import {activeDemo,activateDemo,activateReal,assertIdentity,assertReady,contextPhase,currentContext,pendingDemo,prepareIdentity,setContextPhase,storePending,waitForWrites,writeCount,holdWrite,safeLease,type DemoSession,type SessionContext} from './session-context';
export interface DemoPersona {personaId:string;label:string;role:RoleCode;scopeLabel:string}
export interface DemoCapability {enabled:boolean;environmentId:string;resetVersion:string;personas:DemoPersona[]}
interface Identity {environmentId:string;resetVersion:string;personaId:string;actorId:string;role:RoleCode;scopeLabel:string;expiresAt:string;sessionState:'PENDING'|'ACTIVE'}
interface Exchange extends Omit<Identity,'actorId'> {accessToken:string}
let switching:Promise<void>|null=null;
let renewing:Promise<void>|null=null;
let quiescing=false;
export function demoConfigured(){return typeof DEMO_API_BASE_URL==='string'&&/^https:\/\//.test(DEMO_API_BASE_URL);}
function demoBase(){if(!demoConfigured())throw new ApiError(503,'DEMO_NOT_CONFIGURED','演示环境暂未配置');return DEMO_API_BASE_URL.replace(/\/$/,'');}
export function demoCapability(){return requestReal<DemoCapability>('GET','/demo/capability');}
async function candidateMe(token:string){return rawAt<Identity>(demoBase(),'GET','/demo/me',undefined,token);}
function match(x:Identity,e:Pick<Identity,'environmentId'|'resetVersion'|'personaId'|'role'>){if(!x.actorId||x.environmentId!==e.environmentId||x.resetVersion!==e.resetVersion||x.personaId!==e.personaId||x.role!==e.role||!Number.isFinite(Date.parse(x.expiresAt))||!['PENDING','ACTIVE'].includes(x.sessionState))throw new ApiError(409,'DEMO_SESSION_CHANGED','演示身份核对失败，请重新选择');}
async function commitPending(){
  const pending=pendingDemo();
  if(!pending){
    const existing=activeDemo();if(!existing)throw new ApiError(409,'DEMO_RECOVERY_INVALID','演示记录无效，请明确切回本人后重新选择');
    setContextPhase('recovering');const checked=await candidateMe(existing.accessToken);match(checked,existing);
    if(checked.sessionState!=='ACTIVE'||checked.actorId!==existing.actorId)throw new ApiError(409,'DEMO_SESSION_CHANGED','演示身份已失效，请切回本人后重新选择');
    activateDemo({...existing,expiresAt:checked.expiresAt});return;
  }
  setContextPhase('recovering');
  const c=pending.candidate;const me=await candidateMe(c.accessToken);match(me,c);
  if(me.actorId!==c.actorId)throw new ApiError(409,'DEMO_SESSION_CHANGED','演示员工已变更');
  if(me.sessionState!=='ACTIVE'){
    storePending({...pending,phase:'COMMITTING'});
    const result=await rawAt<{sessionState:string;expiresAt:string}>(demoBase(),'POST','/demo/commit',{},c.accessToken);
    if(result.sessionState!=='ACTIVE'||!Number.isFinite(Date.parse(result.expiresAt)))throw new ApiError(409,'DEMO_COMMIT_UNKNOWN','切换结果待确认，请恢复身份');
    c.expiresAt=result.expiresAt;
  }else c.expiresAt=me.expiresAt;
  activateDemo(c);
}
async function prepareAndCommit(personaId:string,expected?:SessionContext){
  const cap=await demoCapability();const persona=cap.personas.find(p=>p.personaId===personaId);
  if(!cap.enabled||!persona)throw new ApiError(403,'DEMO_NOT_AUTHORIZED','当前账号没有该演示身份权限');
  if(expected&&(expected.environmentId!==cap.environmentId||expected.resetVersion!==cap.resetVersion))throw new ApiError(409,'DEMO_RESET_CHANGED','演示环境已更新，旧草稿保留，请重新选择身份');
  const ticket=await requestReal<{ticket:string;expiresAt:string}>('POST','/demo/ticket',{personaId});
  const exchanged=await rawAt<Exchange>(demoBase(),'POST','/demo/exchange',{ticket:ticket.ticket});
  const wanted={environmentId:cap.environmentId,resetVersion:cap.resetVersion,personaId,role:persona.role};
  if(exchanged.sessionState!=='PENDING'||!exchanged.accessToken)throw new ApiError(409,'DEMO_SESSION_CHANGED','演示候选身份无效');
  const me=await candidateMe(exchanged.accessToken);match(me,wanted);
  if(expected&&me.actorId!==expected.actorId)throw new ApiError(409,'DEMO_SESSION_CHANGED','演示员工已变更，不能自动续期');
  const candidate=prepareIdentity({...wanted,actorId:me.actorId,scopeLabel:me.scopeLabel,accessToken:exchanged.accessToken,expiresAt:me.expiresAt});
  // This durable record is required BEFORE commit can revoke the previous server session.
  storePending({candidate,phase:'PREPARED'});
  await commitPending();
}
export function switchDemoPersona(personaId:string):Promise<void>{
  if(switching)return switching;
  const run=(async()=>{if(renewing)await renewing;assertReady();quiescing=true;setContextPhase('switching');try{await waitForWrites();await prepareAndCommit(personaId);}catch(e){if(contextPhase()!=='recovering')setContextPhase('ready');throw e;}finally{quiescing=false;}})();
  switching=run.finally(()=>{switching=null;});return switching;
}
export function recoverDemo():Promise<void>{if(switching)return switching;if(renewing)return renewing;const run=commitPending();switching=run.finally(()=>{switching=null;});return switching;}
export function renewDemoLease(ctx:SessionContext):Promise<void>{
  assertIdentity(ctx);if(renewing)return renewing;if(contextPhase()==='recovering')return Promise.reject(new ApiError(409,'DEMO_RECOVERY_REQUIRED','请先恢复上一次身份切换'));
  const run=(async()=>{try{await prepareAndCommit(ctx.personaId!,ctx);}catch(e){if(contextPhase()!=='recovering')setContextPhase('ready');throw e;}})();
  renewing=run.finally(()=>{renewing=null;});return renewing;
}
export async function withContextWrite<T>(ctx:SessionContext,fn:(ctx:SessionContext)=>Promise<T>):Promise<T>{
  assertIdentity(ctx);assertReady();if(quiescing)throw new ApiError(409,'DEMO_SWITCH_BUSY','正在切换身份，请稍候');
  if(ctx.kind==='demo'){
    if(Date.parse(safeLease(ctx).expiresAt)-Date.now()<=60000){
      if(writeCount())await waitForWrites();assertIdentity(ctx);assertReady();await renewDemoLease(ctx);
      if(Date.parse(safeLease(ctx).expiresAt)-Date.now()<=60000)throw new ApiError(409,'DEMO_CLOCK_MISMATCH','演示会话剩余时间不足，请核对设备时间后重试');
    }
  }
  assertIdentity(ctx);assertReady();if(quiescing)throw new ApiError(409,'DEMO_SWITCH_BUSY','正在切换身份，请稍候');const release=holdWrite(ctx);
  try{return await fn(ctx);}finally{release();}
}
export async function returnToReal(){
  if(switching)return switching;
  const run=(async()=>{if(renewing)await renewing.catch(()=>undefined);const old=activeDemo(),previousPhase=contextPhase();quiescing=true;setContextPhase('switching');try{await waitForWrites();try{await requestReal('GET','/auth/me');}catch(e){if(!(e instanceof ApiError)||e.status!==401)throw e;/* Explicit return to本人 permits the normal real login on the next home load. */}activateReal();if(old)void rawAt(demoBase(),'POST','/demo/logout',{},old.accessToken).catch(()=>undefined);}catch(e){setContextPhase(previousPhase==='recovering'?'recovering':'ready');throw e;}finally{quiescing=false;}})();
  switching=run.finally(()=>{switching=null;});return switching;
}
export async function verifyDemo(){
  if(contextPhase()==='recovering')throw new ApiError(409,'DEMO_RECOVERY_REQUIRED','身份切换待恢复，请前往演示身份页');
  const c=currentContext();if(c.kind!=='demo')return;
  if(Date.parse(safeLease(c).expiresAt)<=Date.now()){if(writeCount())await waitForWrites();await renewDemoLease(c);}
  const me=await candidateMe(safeLease(c).accessToken);match(me,safeLease(c));
  if(me.sessionState!=='ACTIVE'||me.actorId!==c.actorId)throw new ApiError(401,'DEMO_SESSION_CHANGED','演示身份已失效，请重新选择');
}
