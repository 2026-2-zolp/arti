import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * 뒤로가기 — 앱 내부 이전 기록이 있으면 history back, 외부 URL 로 바로 들어온 경우 fallback 경로로 이동.
 */
export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, fallback]);
}
