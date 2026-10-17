/** 서비스 기본 전시 — "/" 접속, returnUrl 없는 일반 로그인 후 이동하는 기본 화면 */
export const DEFAULT_EXHIBITION_ID: string =
  import.meta.env.VITE_DEFAULT_EXHIBITION_ID ?? 'mvp-2026';

export const IS_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';
