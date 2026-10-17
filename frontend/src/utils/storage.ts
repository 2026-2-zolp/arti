/** localStorage 래퍼 — 시크릿 모드 등에서 접근이 막혀도 앱이 죽지 않도록 한다. */
export const safeStorage = {
  get<T>(key: string): T | null {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      if (value === null || value === undefined) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 저장 실패는 무시 (메모리 상태로 계속 동작) */
    }
  },
};
