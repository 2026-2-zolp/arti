/**
 * 브라우저 저장소 래퍼.
 * 사파리 개인 정보 보호 모드 등에서는 localStorage 접근 자체가 예외를 던질 수 있어 try/catch로 감싼다.
 */
type Area = 'local' | 'session';

function area(a: Area): Storage | null {
  try {
    return a === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function load<T>(key: string, fallback: T, a: Area = 'local'): T {
  try {
    const raw = area(a)?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T, a: Area = 'local'): void {
  try {
    area(a)?.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 실패는 무시: 메모리 상태로 계속 동작 */
  }
}

export function remove(key: string, a: Area = 'local'): void {
  try {
    area(a)?.removeItem(key);
  } catch {
    /* noop */
  }
}
