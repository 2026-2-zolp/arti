import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { authApi } from '@/api/services/auth.api';
import { tokenStorage } from '@/api/tokenStorage';
import type { Admin } from '@/types/domain';

/** 관리자 인증 전역 상태 — 사용자 인증과 분리 */

type AdminAuthStatus = 'loading' | 'authenticated' | 'guest';

interface AdminAuthContextValue {
  admin: Admin | null;
  status: AdminAuthStatus;
  login: (loginId: string, password: string) => Promise<Admin>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [status, setStatus] = useState<AdminAuthStatus>(() =>
    tokenStorage.getAdmin() ? 'loading' : 'guest',
  );

  useEffect(() => {
    if (status !== 'loading') return;
    let cancelled = false;
    authApi
      .adminMe()
      .then((me) => {
        if (cancelled) return;
        setAdmin(me);
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        tokenStorage.setAdmin(null);
        setStatus('guest');
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const login = useCallback(async (loginId: string, password: string) => {
    const { token, admin: next } = await authApi.adminLogin(loginId, password);
    tokenStorage.setAdmin(token);
    setAdmin(next);
    setStatus('authenticated');
    return next;
  }, []);

  const logout = useCallback(() => {
    tokenStorage.setAdmin(null);
    setAdmin(null);
    setStatus('guest');
  }, []);

  const value = useMemo(() => ({ admin, status, login, logout }), [admin, status, login, logout]);
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
