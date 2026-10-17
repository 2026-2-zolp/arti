import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/api/queryKeys';
import { authApi, type SignupInput } from '@/api/services/auth.api';
import { tokenStorage } from '@/api/tokenStorage';
import { ApiError } from '@/api/types';
import type { User } from '@/types/domain';

/** 사용자 인증 전역 상태 (React Context) */

type AuthStatus = 'loading' | 'authenticated' | 'guest';

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  isLoggedIn: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (input: SignupInput) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>(() =>
    tokenStorage.getUser() ? 'loading' : 'guest',
  );

  // 저장된 토큰으로 사용자 복원
  useEffect(() => {
    if (status !== 'loading') return;
    let cancelled = false;
    authApi
      .me()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setStatus('authenticated');
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) tokenStorage.setUser(null);
        setUser(null);
        setStatus('guest');
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const resetUserQueries = useCallback(() => {
    queryClient.removeQueries({ queryKey: queryKeys.tastes.mine() });
    queryClient.removeQueries({ queryKey: queryKeys.visits.all });
  }, [queryClient]);

  const applySession = useCallback(
    (token: string, nextUser: User) => {
      tokenStorage.setUser(token);
      resetUserQueries();
      setUser(nextUser);
      setStatus('authenticated');
      return nextUser;
    },
    [resetUserQueries],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const { token, user: nextUser } = await authApi.login(email, password);
      return applySession(token, nextUser);
    },
    [applySession],
  );

  const signup = useCallback(
    async (input: SignupInput) => {
      const { token, user: nextUser } = await authApi.signup(input);
      return applySession(token, nextUser);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      tokenStorage.setUser(null);
      resetUserQueries();
      setUser(null);
      setStatus('guest');
    }
  }, [resetUserQueries]);

  const value = useMemo(
    () => ({ user, status, isLoggedIn: status === 'authenticated', login, signup, logout }),
    [user, status, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
