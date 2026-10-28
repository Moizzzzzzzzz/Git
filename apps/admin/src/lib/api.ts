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
let refreshing: Promise<boolean> | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setAccessToken(t: string | null) {
  accessToken = t;
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
