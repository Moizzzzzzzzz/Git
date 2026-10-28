import Taro from '@tarojs/taro';
import { API_BASE_URL } from './config';

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

export function saveTokens(t: { accessToken: string; refreshToken?: string }) {
  accessToken = t.accessToken;
  Taro.setStorageSync(K_ACCESS, t.accessToken);
  if (t.refreshToken) Taro.setStorageSync(K_REFRESH, t.refreshToken);
}

export function clearTokens() {
  accessToken = null;
  Taro.removeStorageSync(K_ACCESS);
  Taro.removeStorageSync(K_REFRESH);
}

export function hasSession() {
  return !!Taro.getStorageSync(K_REFRESH);
}

async function rawRequest<T>(method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown, token?: string | null) {
  try {
    const r = await Taro.request<T>({
      url: `${API_BASE_URL}${path}`,
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

/** 用刷新令牌换新的访问令牌（并发共享一次） */
export function refreshSession(): Promise<boolean> {
  const rt = Taro.getStorageSync(K_REFRESH);
  if (!rt) return Promise.resolve(false);
  refreshing ??= rawRequest<{ accessToken: string; refreshToken: string }>('POST', '/auth/refresh', { refreshToken: rt })
    .then((r) => {
      if (r.statusCode === 200) {
        saveTokens(r.data);
        return true;
      }
      if (r.statusCode === 401) clearTokens();
      return false;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function request<T>(method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown, retry = true): Promise<T> {
  const r = await rawRequest<T>(method, path, data, accessToken);
  if (r.statusCode === 401 && retry) {
    if (await refreshSession()) return request<T>(method, path, data, false);
    // 会话失效：回到首页重新走微信登录
    Taro.reLaunch({ url: '/pages/index/index' });
    throw new ApiError(401, 'UNAUTHENTICATED', '登录已失效，请重新登录');
  }
  if (r.statusCode >= 200 && r.statusCode < 300) return r.data;
  const body = (r.data ?? {}) as { code?: string; message?: string; details?: unknown };
  throw new ApiError(r.statusCode, body.code ?? 'HTTP_ERROR', body.message ?? `请求失败（${r.statusCode}）`, body.details);
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
