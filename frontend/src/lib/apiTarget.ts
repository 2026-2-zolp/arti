/** 개발 API 대상과 프록시 설정을 해석합니다. */
/** Shared by Vite and the browser: no implicit legacy fallback. */
export function apiTarget(value?: string): 'django' | 'express' {
  if (value === undefined) return 'django';
  if (value === 'django' || value === 'express') return value;
  throw new Error('VITE_API_TARGET must be django or express.');
}

export function apiProxy(target: 'django' | 'express', override?: string): string {
  const value = override ?? (target === 'django' ? 'http://127.0.0.1:4018' : 'http://127.0.0.1:4000');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('VITE_API_PROXY must be an HTTP(S) origin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VITE_API_PROXY must be an HTTP(S) origin without credentials, path, query or fragment.');
  }
  return url.origin;
}
