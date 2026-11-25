import Taro from '@tarojs/taro';
import { API_BASE_URL, DEMO_API_BASE_URL } from './config';
import { currentContext, assertIdentity, assertReady, safeLease, waitForWrites, type SessionContext } from './session-context';
import { renewDemoLease, withContextWrite } from './demo-session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
  /** 网络错误（可离线重试） */
  get isNetwork() {
    return this.status === 0;
  }
}

const K_ACCESS = 'fqc_access';
const K_REFRESH = 'fqc_refresh';

let accessToken: string | null = Taro.getStorageSync(K_ACCESS) || null;
let refreshing: Promise<boolean> | null = null;
let tokenRevision = 0;

export function sessionRevision(){return tokenRevision;}

export function saveTokens(t: { accessToken: string; refreshToken?: string }) {
  tokenRevision += 1;
  accessToken = t.accessToken;
  Taro.setStorageSync(K_ACCESS, t.accessToken);
  if (t.refreshToken) Taro.setStorageSync(K_REFRESH, t.refreshToken);
}

export function clearTokens() {
  tokenRevision += 1;
  refreshing = null;
  accessToken = null;
  Taro.removeStorageSync(K_ACCESS);
  Taro.removeStorageSync(K_REFRESH);
}

export function hasSession() {
  return !!accessToken || !!Taro.getStorageSync(K_REFRESH);
}

async function rawRequest<T>(method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown, token?: string | null, base=API_BASE_URL) {
  if(!path.startsWith('/')||path.startsWith('//')||path.includes('://')||path.includes('\\')||/(^|\/)(\.\.|%2e%2e)(\/|$)/i.test(path.split('?')[0]))throw new ApiError(400,'INVALID_PATH','无效接口路径');
  try {
    const r = await Taro.request<T>({
      url: `${base}${path}`,
      method,
      data: data as Record<string, unknown> | undefined,
      header: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: 20000,
    });
    return r;
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '网络不可用，数据已保存在本机，恢复网络后会自动同步');
  }
}

function responseError(status:number,data:unknown){
  const body=(data??{}) as {code?:string;message?:string;details?:unknown};
  const message=status===429?'请求较多，请稍后重试，登录信息和本机草稿已保留':status===503?'服务暂时繁忙，请稍后重试，登录信息和本机草稿已保留':body.message??`请求失败（${status}）`;
  return new ApiError(status,body.code??'HTTP_ERROR',message,body.details);
}

/** 用刷新令牌换新的访问令牌（并发共享一次）；暂时错误不能当作会话失效。 */
export function refreshSession(): Promise<boolean> {
  const rt = Taro.getStorageSync(K_REFRESH);
  if (!rt) return Promise.resolve(false);
  if(refreshing)return refreshing;
  const revision=tokenRevision;
  const pending=rawRequest<{ accessToken: string; refreshToken: string }>('POST', '/auth/refresh', { refreshToken: rt })
    .then((r) => {
      // A response started before logout or a newer login must never restore an old session.
      if(tokenRevision!==revision||Taro.getStorageSync(K_REFRESH)!==rt)throw new ApiError(409,'SESSION_CHANGED','登录状态已变更，请重新进入');
      if (r.statusCode === 200) {
        saveTokens(r.data);
        return true;
      }
      if (r.statusCode === 401) {clearTokens();return false;}
      throw responseError(r.statusCode,r.data);
    })
    .finally(() => { if(refreshing===pending)refreshing=null; });
  refreshing=pending;
  return pending;
}

/** Explicit transport for the two trusted targets; never accept a response-provided URL. */
export async function rawAt<T>(base:string,method:'GET'|'POST'|'PUT',path:string,data?:unknown,token?:string):Promise<T>{
  if(!base||(base!==API_BASE_URL&&base!==DEMO_API_BASE_URL))throw new ApiError(400,'UNTRUSTED_TARGET','拒绝未知服务地址');
  const r=await rawRequest<T>(method,path,data,token,base);
  if(r.statusCode>=200&&r.statusCode<300)return r.data;
  throw responseError(r.statusCode,r.data);
}
/** Always the original real credentials, including while viewing a demo persona. */
export async function requestReal<T>(method:'GET'|'POST'|'PUT',path:string,data?:unknown,retry=true):Promise<T>{
  const r=await rawRequest<T>(method,path,data,accessToken);
  if(r.statusCode===401&&retry&&await refreshSession())return requestReal<T>(method,path,data,false);
  if(r.statusCode>=200&&r.statusCode<300)return r.data;
  throw responseError(r.statusCode,r.data);
}
export async function requestScoped<T>(ctx:SessionContext,method:'GET'|'POST'|'PUT',path:string,data?:unknown,retry=true,insideWrite=false):Promise<T>{
  assertIdentity(ctx);
  if(method!=='GET'&&!insideWrite)return withContextWrite(ctx,c=>requestScoped<T>(c,method,path,data,retry,true));
  if(!insideWrite)assertReady();
  if(ctx.kind==='real'){
    const r=await rawRequest<T>(method,path,data,accessToken);
    assertIdentity(ctx);
    if(r.statusCode===401&&retry){
      if(await refreshSession())return requestScoped<T>(ctx,method,path,data,false,true);
      Taro.reLaunch({url:'/pages/index/index'});
      throw new ApiError(401,'UNAUTHENTICATED','登录已失效，请重新登录');
    }
    if(r.statusCode>=200&&r.statusCode<300)return r.data;
    throw responseError(r.statusCode,r.data);
  }
  const lease=safeLease(ctx);
  try{
    const result=await rawAt<T>(DEMO_API_BASE_URL,method,path,data,lease.accessToken);
    assertIdentity(ctx);return result;
  }catch(e){
    assertIdentity(ctx);
    // These two codes are issued ONLY by the demo guard before any handler executes.
    if(retry&&e instanceof ApiError&&e.status===401&&['DEMO_LEASE_EXPIRED','DEMO_LEASE_REVOKED'].includes(e.code)){
      if(!insideWrite)await waitForWrites();
      await renewDemoLease(ctx);return requestScoped<T>(ctx,method,path,data,false,true);
    }
    throw e;
  }
}
export function request<T>(method:'GET'|'POST'|'PUT',path:string,data?:unknown,retry=true):Promise<T>{
  return requestScoped<T>(currentContext(),method,path,data,retry);
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, d?: unknown) => request<T>('POST', p, d ?? {}),
  put: <T>(p: string, d?: unknown) => request<T>('PUT', p, d ?? {}),
};

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const problems = (e.details as { problems?: string[] } | undefined)?.problems;
    return problems?.length ? `${e.message}\n${problems.join('\n')}` : e.message;
  }
  return (e as Error)?.message ?? '操作失败';
}

export function toastError(e: unknown) {
  const text = errorText(e);
  if (text.length > 18 || text.includes('\n')) {
    void Taro.showModal({ title: '提示', content: text, showCancel: false });
  } else {
    void Taro.showToast({ title: text, icon: 'none', duration: 2500 });
  }
}

/** Download only from the captured identity's API. Files from a stale identity are discarded. */
export async function downloadScoped(ctx: SessionContext, path: string, retry = true): Promise<string> {
  assertIdentity(ctx); assertReady();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://') || path.includes('\\') || /(^|\/)(\.\.|%2e%2e)(\/|$)/i.test(path.split('?')[0])) {
    throw new ApiError(400, 'INVALID_PATH', '无效文件路径');
  }
  const revision = tokenRevision;
  const base = ctx.kind === 'demo' ? DEMO_API_BASE_URL : API_BASE_URL;
  const token = ctx.kind === 'demo' ? safeLease(ctx).accessToken : accessToken;
  let result: Taro.downloadFile.FileSuccessCallbackResult;
  try { result = await Taro.downloadFile({ url: `${base}${path}`, header: token ? { Authorization: `Bearer ${token}` } : {}, timeout: 60000 }); }
  catch { throw new ApiError(0, 'NETWORK_ERROR', '文件下载失败，请检查网络后重试'); }
  const remove = () => { try { Taro.getFileSystemManager().unlink({ filePath: result.tempFilePath, fail: () => undefined }); } catch { /* best effort temporary-file cleanup */ } };
  try { assertIdentity(ctx); assertReady(); if (ctx.kind === 'real' && revision !== tokenRevision) throw new ApiError(409, 'SESSION_CHANGED', '登录状态已变更，请重新下载'); }
  catch (e) { remove(); throw e; }
  if (result.statusCode >= 200 && result.statusCode < 300) {
    let signature = '';
    try { signature = String(Taro.getFileSystemManager().readFileSync(result.tempFilePath, 'utf8', 0, 5)); } catch { /* invalid or unreadable download */ }
    if (!signature.startsWith('%PDF-')) { remove(); throw new ApiError(502, 'INVALID_DOCUMENT', '未收到有效 PDF 文件，请稍后重试'); }
    return result.tempFilePath;
  }
  let body: unknown;
  try { body = JSON.parse(String(Taro.getFileSystemManager().readFileSync(result.tempFilePath, 'utf8'))); } catch { body = {}; }
  remove();
  const failure = responseError(result.statusCode, body);
  if (retry && result.statusCode === 401) {
    if (ctx.kind === 'real' && await refreshSession()) return downloadScoped(ctx, path, false);
    if (ctx.kind === 'demo' && ['DEMO_LEASE_EXPIRED', 'DEMO_LEASE_REVOKED'].includes(failure.code)) {
      await waitForWrites(); await renewDemoLease(ctx); return downloadScoped(ctx, path, false);
    }
  }
  throw failure;
}
