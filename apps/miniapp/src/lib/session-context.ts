import Taro from '@tarojs/taro';
import type { RoleCode } from '@fabricqc/shared';

export interface SessionContext {
  kind:'real'|'demo'; environmentId:string; resetVersion:string; actorId:string; personaId?:string;
  identityGeneration:number; leaseVersion:number;
}
export interface DemoSession extends SessionContext {
  kind:'demo'; storageVersion?:1; personaId:string; accessToken:string; expiresAt:string; role:RoleCode; scopeLabel:string;
}
export interface PendingDemo { storageVersion?:1; candidate:DemoSession; phase:'PREPARED'|'COMMITTING' }
export type ContextPhase='ready'|'switching'|'recovering';
const ACTIVE='fqc_demo_active', PENDING='fqc_demo_pending';
const real:SessionContext={kind:'real',environmentId:'real',resetVersion:'legacy',actorId:'',identityGeneration:0,leaseVersion:0};
function valid(value:unknown):value is DemoSession {
  const x=value as Partial<DemoSession>|null;
  const nonempty=(v:unknown)=>typeof v==='string'&&v.trim().length>0;
  return !!x&&x.kind==='demo'&&(x.storageVersion===undefined||x.storageVersion===1)
    &&nonempty(x.accessToken)&&nonempty(x.actorId)&&nonempty(x.personaId)&&nonempty(x.environmentId)&&nonempty(x.resetVersion)
    &&typeof x.scopeLabel==='string'&&['ADMIN','INSPECTOR','QC_SUPERVISOR','QUALITY_MANAGER','SALES','BUSINESS_MANAGER','BUSINESS_CLERK'].includes(x.role??'')
    &&Number.isInteger(x.identityGeneration)&&x.identityGeneration!>0&&Number.isInteger(x.leaseVersion)&&x.leaseVersion!>0&&Number.isFinite(Date.parse(x.expiresAt??''));
}
// Every persisted demo session is revalidated after cold start.
// An existing but corrupt marker is not evidence that the user chose real mode.
// Legacy unversioned records are v1; unknown explicit versions require recovery.
function storedSlot(key:string):{present:boolean;value:unknown}{
  try {
    const value:unknown=Taro.getStorageSync(key);
    const keys=typeof Taro.getStorageInfoSync==='function'?Taro.getStorageInfoSync().keys:undefined;
    return {present:keys?keys.includes(key):value!==undefined&&value!=='',value};
  } catch {return {present:true,value:undefined};}
}
let active:SessionContext=real;
const stored=storedSlot(ACTIVE),pending=storedSlot(PENDING);
if(valid(stored.value))active=stored.value;
let phase:ContextPhase=pending.present||stored.present?'recovering':'ready';
let writes=0;
let generation=active.identityGeneration;
const listeners=new Set<()=>void>();
const pauseListeners=new Set<()=>void>();
const idleListeners=new Set<()=>void>();
export class ContextError extends Error { readonly status=409; constructor(readonly code:string,message:string){super(message);} }
export function currentContext():SessionContext{return active;}
export function activeDemo():DemoSession|null{return active.kind==='demo'?active as DemoSession:null;}
export function contextPhase(){return phase;}
export function contextScope(c:SessionContext=currentContext()){return c.kind==='real'?'real':JSON.stringify([c.environmentId,c.resetVersion,c.actorId]);}
export function sameIdentity(c:SessionContext){return c.identityGeneration===active.identityGeneration&&contextScope(c)===contextScope(active);}
export function assertIdentity(c:SessionContext){if(!sameIdentity(c))throw new ContextError('CONTEXT_CHANGED','身份已切换，请重新进入当前页面');}
export function assertReady(){if(phase!=='ready')throw new ContextError('DEMO_SWITCH_BUSY',phase==='recovering'?'身份切换待恢复，请前往演示身份页':'正在切换身份，请稍候');}
export function contextChanged(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
export function onContextPause(fn:()=>void){pauseListeners.add(fn);return()=>{pauseListeners.delete(fn);};}
function emit(){listeners.forEach(fn=>fn());}
export function setContextPhase(value:ContextPhase){phase=value;if(value!=='ready')pauseListeners.forEach(fn=>fn());emit();}
export function writeCount(){return writes;}
export function holdWrite(c:SessionContext){assertIdentity(c);assertReady();writes++;let done=false;return()=>{if(done)return;done=true;writes--;if(!writes)idleListeners.forEach(fn=>fn());};}
export function waitForWrites(timeout=20000):Promise<void>{
  if(!writes)return Promise.resolve();
  return new Promise((resolve,reject)=>{const finish=()=>{if(writes)return;clearTimeout(timer);idleListeners.delete(finish);resolve();};const timer=setTimeout(()=>{idleListeners.delete(finish);reject(new ContextError('DEMO_SWITCH_BUSY','当前保存或上传尚未完成，请稍后再切换；本机草稿已保留'));},timeout);idleListeners.add(finish);});
}
export function prepareIdentity(fields:Omit<DemoSession,'kind'|'identityGeneration'|'leaseVersion'>):DemoSession {
  const same=active.kind==='demo'&&active.environmentId===fields.environmentId&&active.resetVersion===fields.resetVersion&&active.personaId===fields.personaId&&active.actorId===fields.actorId;
  return {...fields,kind:'demo',storageVersion:1,identityGeneration:same?active.identityGeneration:++generation,leaseVersion:(active.leaseVersion??0)+1};
}
export function storePending(p:PendingDemo){Taro.setStorageSync(PENDING,{...p,storageVersion:1});}
export function pendingDemo():PendingDemo|null {
  const slot=storedSlot(PENDING);if(!slot.present)return null;
  const p=slot.value as PendingDemo|null;
  if(!p||(p.storageVersion!==undefined&&p.storageVersion!==1)||!valid(p.candidate)||!['PREPARED','COMMITTING'].includes(p.phase))throw new ContextError('DEMO_RECOVERY_INVALID','演示恢复记录无效，请切回本人后重新选择');
  return p;
}
export function activateDemo(candidate:DemoSession){
  Taro.setStorageSync(ACTIVE,candidate);
  // Keep the recovery record until the durable active session is written successfully.
  Taro.removeStorageSync(PENDING);active=candidate;generation=Math.max(generation,candidate.identityGeneration);setContextPhase('ready');
}
export function activateReal(){Taro.removeStorageSync(ACTIVE);Taro.removeStorageSync(PENDING);active={...real,identityGeneration:++generation};setContextPhase('ready');}
export function safeLease(c:SessionContext):DemoSession {assertIdentity(c);const d=activeDemo();if(!d)throw new ContextError('DEMO_SESSION_CHANGED','演示身份已变更');return d;}
