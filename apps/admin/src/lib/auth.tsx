import type { RoleCode } from '@fabricqc/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onAuthLost, refreshSession, setAccessToken } from './api';

export interface Me {
  id: string;
  employeeNo: string;
  name: string;
  department: { id: string; name: string } | null;
  roles: { role: RoleCode; departmentId: string | null }[];
  username: string | null;
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (...roles: RoleCode[]) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onAuthLost(() => {
      setAccessToken(null);
      setMe(null);
    });
    // 页面刷新后用 Cookie 恢复登录态
    void (async () => {
      try {
        if (await refreshSession()) setMe(await api.get<Me>('/auth/me'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api.post<{ accessToken: string }>('/auth/admin/login', { username, password });
    setAccessToken(r.accessToken);
    setMe(await api.get<Me>('/auth/me'));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/admin/logout');
    } finally {
      setAccessToken(null);
      setMe(null);
    }
  }, []);

  const can = useCallback((...roles: RoleCode[]) => !!me && me.roles.some((r) => roles.includes(r.role)), [me]);

  const value = useMemo(() => ({ me, loading, login, logout, can }), [me, loading, login, logout, can]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within AuthProvider');
  return v;
}
