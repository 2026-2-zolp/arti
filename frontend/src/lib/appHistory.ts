import { useEffect, useRef } from 'react';

/**
 * 앱 ← 버튼과 휴대폰(브라우저) 뒤로가기를 같은 곳으로 보내기 위한 기록 도우미.
 *
 * - 앱 안에서 이동해 왔으면 브라우저 기록을 하나 "꺼내서"(navigate(-1)) 돌아간다.
 *   휴대폰 뒤로가기와 똑같이 움직인다.
 * - 주소로 바로 들어와 돌아갈 앱 기록이 없으면 정해 둔 기본 화면으로 "덮어쓴다"(replace).
 *   앱 밖으로 나가거나 버튼이 반응하지 않는 일을 막는다.
 */

/** React Router가 기록마다 붙이는 순번(idx). 0이면 이 탭에서 앱이 처음 연 화면이다. */
export function appHistoryIndex(): number {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : 0;
}

/** 앱 안에서 이동해 온 기록이 있으면 true */
export function hasAppHistory(): boolean {
  return appHistoryIndex() > 0;
}

/** 로그인·회원가입의 ?redirect=에서 전시 첫 화면 경로(/exhibitions/:id)를 꺼낸다. 없으면 전시 목록. */
export function exhibitionHomeFrom(redirect: string | null | undefined): string {
  const match = redirect?.match(/^\/exhibitions\/[^/?#]+/);
  return match ? match[0] : '/';
}

interface CloseWatcherLike {
  onclose: (() => void) | null;
  destroy(): void;
}
type CloseWatcherConstructor = new () => CloseWatcherLike;

/**
 * 안드로이드 휴대폰 뒤로가기(버튼·제스처)를 페이지 이동 대신 화면 안 동작(덮개 닫기, 질문 띄우기)으로 받는다.
 * 브라우저의 CloseWatcher를 쓰므로 기록을 건드리지 않는다. 지원하지 않는 브라우저(iOS Safari 등)에서는 아무 일도 하지 않는다.
 * 한 번 받으면 끝나므로, 다시 받으려면 rearm 값을 바꾼다.
 */
export function useCloseWatcher(active: boolean, onClose: () => void, rearm: unknown = 0) {
  const handler = useRef(onClose);
  handler.current = onClose;
  useEffect(() => {
    const Watcher = (window as unknown as { CloseWatcher?: CloseWatcherConstructor }).CloseWatcher;
    if (!active || !Watcher) return;
    let watcher: CloseWatcherLike | null = null;
    try {
      watcher = new Watcher();
    } catch {
      return;
    }
    watcher.onclose = () => {
      watcher = null;
      handler.current();
    };
    return () => watcher?.destroy();
  }, [active, rearm]);
}
