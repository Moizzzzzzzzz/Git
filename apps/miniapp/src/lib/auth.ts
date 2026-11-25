import { reviewSelected } from './review-access';
import Taro from '@tarojs/taro';
import { currentContext, contextChanged, contextPhase, activeDemo } from './session-context';
import { verifyDemo, returnToReal } from './demo-session';
import type { RoleCode } from '@fabricqc/shared';
import { api, ApiError, clearTokens, hasSession, refreshSession, request, saveTokens, sessionRevision } from './api';

export interface Me {
  id: string;
  employeeNo: string;
  name: string;
  position: string | null;
  department: { name: string } | null;
  roles: { role: RoleCode; departmentId: string | null }[];
  wechatBound: boolean;
}

let me: Me | null = null;
let bindTicket: string | null = null;
let checking: Promise<'READY' | 'NEED_BIND'> | null = null;
let authEpoch=0;
let loggingOut=false;
let meGeneration=-1;
let observedGeneration=currentContext().identityGeneration;
contextChanged(()=>{if(observedGeneration!==currentContext().identityGeneration){observedGeneration=currentContext().identityGeneration;authEpoch++;checking=null;me=null;bindTicket=null;}});
function requireCurrent(epoch:number){if(epoch!==authEpoch||loggingOut)throw new ApiError(409,'SESSION_CHANGED','登录状态已变更，请重新进入');}

export function currentMe() {
  return contextPhase()==='ready'&&meGeneration===currentContext().identityGeneration&&(currentContext().kind==='demo'||hasSession())?me:null;
}

export function getBindTicket() {
  return bindTicket;
}

export function hasRole(...roles: RoleCode[]) {
  const person=currentMe();
  return !!person && person.roles.some((r) => roles.includes(r.role));
}

type LoginResult = { status: 'BOUND'; accessToken: string; refreshToken: string } | { status: 'UNBOUND'; bindTicket: string };

async function readCurrentMe(epoch:number){
  const revision=sessionRevision();
  const assertCurrent=()=>{requireCurrent(epoch);if(currentContext().kind==='real'&&sessionRevision()!==revision)throw new ApiError(409,'SESSION_CHANGED','登录状态已变更，请重新进入');};
  let latest:Me;
  try{latest=await request<Me>('GET','/auth/me',undefined,false);}catch(e){assertCurrent();throw e;}
  assertCurrent();
  const demo=activeDemo();if(demo&&(latest.id!==demo.actorId||!latest.roles.some(r=>r.role===demo.role)))throw new ApiError(409,'DEMO_SESSION_CHANGED','演示权限核对失败，请重新选择身份');
  me=latest;meGeneration=currentContext().identityGeneration;bindTicket=null;
}

/** 每次读取服务器权限；只有明确401才刷新，不长期缓存/me。 */
async function checkLogin(epoch:number):Promise<'READY'|'NEED_BIND'>{
  if(contextPhase()==='recovering')throw new ApiError(409,'DEMO_RECOVERY_REQUIRED','身份切换待恢复，请前往演示身份页');
  if(currentContext().kind==='demo'){await verifyDemo();requireCurrent(epoch);await readCurrentMe(epoch);return 'READY';}
  if(hasSession()){
    try{
      await readCurrentMe(epoch);return 'READY';
    }catch(e){
      requireCurrent(epoch);
      if(!(e instanceof ApiError)||e.status!==401)throw e;
      me=null;
    }
    const refreshed=await refreshSession();
    requireCurrent(epoch);
    if(refreshed){
      await readCurrentMe(epoch);return 'READY';
    }
    clearTokens();
  }
  requireCurrent(epoch);me=null;
  const {code}=await Taro.login();
  requireCurrent(epoch);
  const r=await request<LoginResult>('POST','/auth/wechat/login',{code},false);
  requireCurrent(epoch);
  if(r.status==='UNBOUND'){bindTicket=r.bindTicket;return 'NEED_BIND';}
  saveTokens(r);bindTicket=null;
  await readCurrentMe(epoch);return 'READY';
}
export function ensureLogin():Promise<'READY'|'NEED_BIND'>{
  if(reviewSelected()){void Taro.reLaunch({url:'/pages/review-access/index'});return Promise.reject(new ApiError(409,'REVIEW_ACTIVE','请在审核演示中继续'));}
  if(loggingOut)return Promise.reject(new ApiError(409,'SESSION_CHANGED','正在退出登录，请稍后重试'));
  if(checking)return checking;
  const pending=checkLogin(authEpoch).finally(()=>{if(checking===pending)checking=null;});
  checking=pending;return pending;
}

export async function bind(employeeNo: string, bindCode: string) {
  const epoch=authEpoch;
  if (!bindTicket) {
    const state = await ensureLogin();
    if (state === 'READY') return;
  }
  try {
    const r = await request<{ accessToken: string; refreshToken: string }>(
      'POST',
      '/auth/wechat/bind',
      { bindTicket, employeeNo, bindCode },
      false,
    );
    requireCurrent(epoch);
    saveTokens(r);
    bindTicket = null;
    await readCurrentMe(epoch);
  } catch (e) {
    // 票据过期时重新获取
    if (e instanceof ApiError && e.message.includes('重新进入')) bindTicket = null;
    throw e;
  }
}

export async function logout() {
  if(currentContext().kind==='demo'){await returnToReal();return;}
  authEpoch+=1;checking=null;loggingOut=true;me=null;bindTicket=null;
  // Capture the current bearer token for revocation, then invalidate local state immediately.
  const revoke=api.post('/auth/logout');
  clearTokens();
  try {await revoke;} catch {/* 离线也允许退出，草稿不删除。 */}
  finally {loggingOut=false;}
}
