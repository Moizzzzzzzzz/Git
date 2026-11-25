import Taro from '@tarojs/taro';
import { contextPhase, setContextPhase, waitForWrites } from './session-context';

export const REVIEW_API_BASE = 'https://example.invalid/review-api';
const MODE='fqc_review_mode_v1', ACTIVE='fqc_review_active_v1', PENDING='fqc_review_pending_v1';
type Identity={environmentId:'fabricqc-demo';resetVersion:'v1';personaId:'p01';role:'SALES';scopeLabel:string;expiresAt:string};
type Session=Identity&{accessToken:string;actorId?:string};
type RemoteIdentity=Identity&{actorId:string;sessionState:'PENDING'|'ACTIVE'};
let previousPhase=contextPhase();
let epoch=0, working=false;
let expiryTimer:ReturnType<typeof setTimeout>|undefined;
export class ReviewAccessError extends Error {constructor(message:string,readonly expired=false){super(message);}}
const expiryListeners=new Set<()=>void>();
export function onReviewExpired(fn:()=>void){expiryListeners.add(fn);return()=>{expiryListeners.delete(fn);};}
function invalidateExpired(e:number,error:unknown){if(error instanceof ReviewAccessError&&error.expired&&e===epoch&&reviewSelected()){epoch++;if(expiryTimer)clearTimeout(expiryTimer);Taro.removeStorageSync(ACTIVE);Taro.removeStorageSync(PENDING);expiryListeners.forEach(fn=>fn());}}
const message='审核会话已失效，请重新登录';
function scheduleExpiry(s:Session,e:number){if(expiryTimer)clearTimeout(expiryTimer);expiryTimer=setTimeout(()=>invalidateExpired(e,new ReviewAccessError(message,true)),Math.max(0,Date.parse(s.expiresAt)-Date.now()));}
function slot(key:string):unknown {try{return Taro.getStorageSync(key);}catch{throw new ReviewAccessError('审核记录无法读取，请退出审核后重试');}}
export function reviewSelected():boolean {try{if(typeof Taro.getStorageInfoSync==='function'){const keys=Taro.getStorageInfoSync().keys;return keys.includes(MODE)||keys.includes(ACTIVE)||keys.includes(PENDING);}return [MODE,ACTIVE,PENDING].some(k=>{const v=Taro.getStorageSync(k);return v!==undefined&&v!==null&&v!=='';});}catch{return true;}}
function assertEpoch(e:number){if(e!==epoch||!reviewSelected())throw new ReviewAccessError('审核状态已改变，请重新进入');}
function validIdentity(x:Partial<Identity>|null|undefined){return !!x&&x.environmentId==='fabricqc-demo'&&x.resetVersion==='v1'&&x.personaId==='p01'&&x.role==='SALES'&&typeof x.scopeLabel==='string'&&typeof x.expiresAt==='string'&&Number.isFinite(Date.parse(x.expiresAt));}
function readSession(key:string):Session|null {const x=slot(key) as Session|null;if(!x)return null;if(!validIdentity(x)||typeof x.accessToken!=='string'||!x.accessToken)throw new ReviewAccessError('审核记录无效，请退出审核后重试');return x;}
function assertLive(s:Session){if(Date.parse(s.expiresAt)<=Date.now())throw new ReviewAccessError(message,true);}
function match(me:RemoteIdentity,s:Session){if(!validIdentity(me)||!me.actorId||!['PENDING','ACTIVE'].includes(me.sessionState)||(s.actorId&&s.actorId!==me.actorId))throw new ReviewAccessError('审核身份核对失败，请退出后重试');}
async function transport<T>(method:'GET'|'POST',path:string,body?:unknown,token?:string):Promise<T>{
  let r:{statusCode:number;data:T};
  try{r=await Taro.request<T>({url:REVIEW_API_BASE+path,method,data:body as Record<string,unknown>|undefined,header:{'content-type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},timeout:20000});}
  catch{throw new ReviewAccessError('网络未确认操作结果，请恢复审核登录或稍后重试');}
  if(r.statusCode===401)throw new ReviewAccessError(message,true);
  if(r.statusCode===429)throw new ReviewAccessError('请求较多，请稍后重试');
  if(r.statusCode<200||r.statusCode>=300)throw new ReviewAccessError('审核操作未完成，请核对账号或稍后重试');
  return r.data;
}
export async function enterReview(){
  if(reviewSelected()){setContextPhase('switching');return;}
  if(contextPhase()!=='ready')throw new ReviewAccessError('请先完成当前身份切换，再进入审核');
  const enteringEpoch=epoch;previousPhase=contextPhase();setContextPhase('switching');
  try{await waitForWrites();if(enteringEpoch!==epoch)throw new ReviewAccessError('审核状态已改变，请重新进入');Taro.setStorageSync(MODE,{version:1});epoch++;}
  catch(e){if(enteringEpoch===epoch)setContextPhase('ready');throw e;}
}
export function hasReviewRecovery(){return !!slot(PENDING);}
export function hasReviewSession(){return !!slot(ACTIVE);}
async function checkedMe(s:Session,e:number){assertLive(s);const me=await transport<RemoteIdentity>('GET','/demo/me',undefined,s.accessToken);assertEpoch(e);match(me,s);return me;}
async function verifyEmployee(s:Session,e:number){const me=await transport<{id:string;roles:{role:string}[]}>('GET','/auth/me',undefined,s.accessToken);assertEpoch(e);if(me.id!==s.actorId||!me.roles?.some(r=>r.role==='SALES'))throw new ReviewAccessError('审核员工身份核对失败');}
async function complete(s:Session,e:number){
  const me=await checkedMe(s,e);const candidate={...s,actorId:me.actorId,expiresAt:me.expiresAt};
  Taro.setStorageSync(PENDING,candidate);
  if(me.sessionState==='PENDING'){
    const committed=await transport<{sessionState:string;expiresAt:string}>('POST','/demo/commit',{},s.accessToken);assertEpoch(e);
    if(committed.sessionState!=='ACTIVE'||!Number.isFinite(Date.parse(committed.expiresAt)))throw new ReviewAccessError('审核登录结果待确认，请恢复审核登录');
    candidate.expiresAt=committed.expiresAt;
  }
  await verifyEmployee(candidate,e);assertEpoch(e);assertLive(candidate);
  Taro.setStorageSync(ACTIVE,candidate);Taro.removeStorageSync(PENDING);scheduleExpiry(candidate,e);
}
export async function loginReview(username:string,password:string){
  if(working)throw new ReviewAccessError('审核登录正在进行');
  working=true;
  try{await enterReview();if(hasReviewRecovery())throw new ReviewAccessError('上次审核登录结果待确认，请先恢复或退出');const e=++epoch;
    const result=await transport<Session&{sessionState:string}>('POST','/review-access/login',{username,password});assertEpoch(e);
    if(!validIdentity(result)||result.scopeLabel!=='审核演示'||!result.accessToken||result.sessionState!=='PENDING')throw new ReviewAccessError('审核登录响应无效');
    const s:Session={accessToken:result.accessToken,expiresAt:result.expiresAt,environmentId:result.environmentId,resetVersion:result.resetVersion,personaId:result.personaId,role:result.role,scopeLabel:result.scopeLabel};
    Taro.setStorageSync(PENDING,s);await complete(s,e);
  }finally{working=false;}
}
export async function resumeReview(){if(working)throw new ReviewAccessError('审核登录正在进行');working=true;try{await enterReview();const e=epoch;const s=readSession(PENDING);if(s){await complete(s,e);return;}const active=readSession(ACTIVE);if(!active)throw new ReviewAccessError(message,true);const me=await checkedMe(active,e);if(me.sessionState!=='ACTIVE')throw new ReviewAccessError(message,true);await verifyEmployee(active,e);scheduleExpiry(active,e);}finally{working=false;}}
function lease(){const s=readSession(ACTIVE);if(!s||!s.actorId||hasReviewRecovery())throw new ReviewAccessError(message,true);assertLive(s);return s;}
const uuid='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export function allowedReviewRead(path:string){return /^\/orders(?:\?q=[^#]*)?$/.test(path)||new RegExp(`^/orders/${uuid}(?:/reports)?$`).test(path);}
export function allowedReviewPdf(path:string){return new RegExp(`^/orders/${uuid}/reports/[1-9][0-9]*/pdf$`).test(path);}
export async function reviewGet<T>(path:string):Promise<T>{if(!allowedReviewRead(path))throw new ReviewAccessError('审核演示仅支持订单与报告查看');const e=epoch;try{assertEpoch(e);const s=lease();const result=await transport<T>('GET',path,undefined,s.accessToken);assertEpoch(e);assertLive(s);return result;}catch(error){invalidateExpired(e,error);throw error;}}
export async function reviewPdf(path:string):Promise<string>{
  if(!allowedReviewPdf(path))throw new ReviewAccessError('无效报告路径');const e=epoch;assertEpoch(e);let s:Session;try{s=lease();}catch(error){invalidateExpired(e,error);throw error;}
  let file:Taro.downloadFile.FileSuccessCallbackResult;
  try{file=await Taro.downloadFile({url:REVIEW_API_BASE+path,header:{Authorization:`Bearer ${s.accessToken}`},timeout:60000});}catch{throw new ReviewAccessError('报告下载失败，请稍后重试');}
  const remove=()=>{try{Taro.getFileSystemManager().unlink({filePath:file.tempFilePath,fail:()=>undefined});}catch{}};
  try{assertEpoch(e);assertLive(s);if(file.statusCode!==200)throw new ReviewAccessError(file.statusCode===401?message:'报告暂不可用',file.statusCode===401);const sig=String(Taro.getFileSystemManager().readFileSync(file.tempFilePath,'utf8',0,5));if(sig!=='%PDF-')throw new ReviewAccessError('未收到有效PDF报告');return file.tempFilePath;}catch(err){remove();invalidateExpired(e,err);throw err;}
}
export async function exitReview(returnToEmployee=false){
  epoch++;if(expiryTimer)clearTimeout(expiryTimer);let old:Session|null=null;try{old=readSession(ACTIVE)||readSession(PENDING);}catch{}
  Taro.removeStorageSync(ACTIVE);Taro.removeStorageSync(PENDING);
  if(returnToEmployee){Taro.removeStorageSync(MODE);setContextPhase(previousPhase==='recovering'?'recovering':'ready');}else{Taro.setStorageSync(MODE,{version:1});setContextPhase('switching');}
  if(old)void transport('POST','/demo/logout',{},old.accessToken).catch(()=>undefined);
}
