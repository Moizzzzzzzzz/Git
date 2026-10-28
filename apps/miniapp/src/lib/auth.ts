import Taro from '@tarojs/taro';
import type { RoleCode } from '@fabricqc/shared';
import { api, ApiError, clearTokens, hasSession, refreshSession, request, saveTokens } from './api';

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

export function currentMe() {
  return me;
}

export function getBindTicket() {
  return bindTicket;
}

export function hasRole(...roles: RoleCode[]) {
  return !!me && me.roles.some((r) => roles.includes(r.role));
}

type LoginResult = { status: 'BOUND'; accessToken: string; refreshToken: string } | { status: 'UNBOUND'; bindTicket: string };

/**
 * 确保已登录：优先用刷新令牌；否则 wx.login → 后端 code2Session。
 * 返回 'READY' 或 'NEED_BIND'（需要输入员工编号和绑定码）。
 */
export async function ensureLogin(): Promise<'READY' | 'NEED_BIND'> {
  if (hasSession() && (await refreshSession())) {
    me = await api.get<Me>('/auth/me');
    return 'READY';
  }
  const { code } = await Taro.login();
  const r = await request<LoginResult>('POST', '/auth/wechat/login', { code }, false);
  if (r.status === 'UNBOUND') {
    bindTicket = r.bindTicket;
    return 'NEED_BIND';
  }
  saveTokens(r);
  me = await api.get<Me>('/auth/me');
  return 'READY';
}

export async function bind(employeeNo: string, bindCode: string) {
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
    saveTokens(r);
    bindTicket = null;
    me = await api.get<Me>('/auth/me');
  } catch (e) {
    // 票据过期时重新获取
    if (e instanceof ApiError && e.message.includes('重新进入')) bindTicket = null;
    throw e;
  }
}

export async function logout() {
  try {
    await api.post('/auth/logout');
  } catch {
    /* 离线也允许退出 */
  }
  clearTokens();
  me = null;
}
