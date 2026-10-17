import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { PageSpinner } from '@/components/common';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { useAuth } from '@/contexts/AuthContext';
import { buildLoginUrl } from '@/utils/returnUrl';
import { paths } from './paths';

/**
 * 합의 3. 로그인이 필요한 화면을 비로그인 상태로 접근하면
 * 원래 화면 → /login?returnUrl=원래경로 → 로그인 성공 → 원래 화면 복귀
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <PageSpinner label="로그인 정보를 확인하고 있어요" />;
  if (status === 'guest') {
    const returnUrl = `${location.pathname}${location.search}`;
    return <Navigate to={buildLoginUrl(returnUrl, paths.login)} replace />;
  }
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status } = useAdminAuth();
  const location = useLocation();

  if (status === 'loading') return <PageSpinner label="관리자 정보를 확인하고 있어요" />;
  if (status === 'guest') {
    const returnUrl = `${location.pathname}${location.search}`;
    return <Navigate to={buildLoginUrl(returnUrl, paths.adminLogin)} replace />;
  }
  return <>{children}</>;
}
