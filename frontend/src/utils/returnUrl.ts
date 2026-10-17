/**
 * 합의 3. 로그인 후 복귀 기준
 * - 외부 도메인으로의 오픈 리다이렉트를 막기 위해 "/" 로 시작하는 내부 경로만 허용한다.
 */
export function sanitizeReturnUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.startsWith('/login') || value.startsWith('/admin/login')) return null;
  return value;
}

export function buildLoginUrl(returnUrl?: string, base = '/login') {
  const safe = sanitizeReturnUrl(returnUrl);
  return safe ? `${base}?returnUrl=${encodeURIComponent(safe)}` : base;
}
