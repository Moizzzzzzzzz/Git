import type { ApiErrorBody } from '@fabricqc/shared';

/** API 错误：携带后端错误码与中文提示 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let identityGeneration = 0;
let refreshing: Promise<boolean> | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setAccessToken(t: string | null) {
  accessToken = t;
  identityGeneration += 1;
}

export function onAuthLost(cb: () => void) {
  onUnauthenticated = cb;
}

/** 用 httpOnly Cookie 中的刷新令牌换新的访问令牌（并发请求共享一次刷新） */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/admin/refresh', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'fabricqc-admin' },
  })
    .then(async (r) => {
      if (!r.ok) return false;
      const body = (await r.json()) as { accessToken: string };
      accessToken = body.accessToken;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function parseError(r: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = (await r.json()) as ApiErrorBody;
  } catch {
    /* 非 JSON 响应 */
  }
  const fallback = r.status >= 500 ? '服务器暂时不可用，请稍后重试' : `请求失败（${r.status}）`;
  return new ApiError(r.status, body.code ?? 'HTTP_ERROR', body.message ?? fallback, body.details);
}

export async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '网络连接失败，请检查网络后重试');
  }
  if (r.status === 401 && retry && !path.startsWith('/auth/admin/')) {
    if (await refreshSession()) return request<T>(method, path, body, false);
    onUnauthenticated?.();
  }
  if (!r.ok) throw await parseError(r);
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
};

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Download files through the employee's authenticated API session. */
export async function downloadFile(path: string, retry = true): Promise<Blob> {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://') || path.includes('\\') || /(^|\/)(\.\.|%2e%2e)(\/|$)/i.test(path.split('?')[0])) throw new ApiError(400, 'INVALID_PATH', '无效文件路径');
  const identity = identityGeneration;
  const assertCurrent = () => { if(identity !== identityGeneration) throw new ApiError(409, 'SESSION_CHANGED', '登录状态已变更，请重新下载'); };
  let response: Response;
  try { response = await fetch(`/api${path}`, { credentials: 'same-origin', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} }); }
  catch { throw new ApiError(0, 'NETWORK_ERROR', '文件下载失败，请检查网络后重试'); }
  assertCurrent();
  if (response.status === 401 && retry && await refreshSession()) return downloadFile(path, false);
  if (!response.ok) throw await parseError(response);
  if (!response.headers.get('content-type')?.includes('application/pdf')) throw new ApiError(502, 'INVALID_FILE', '服务器未返回有效 PDF，请稍后重试');
  const blob = await response.blob();
  assertCurrent();
  return blob;
}
