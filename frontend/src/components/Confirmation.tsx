/** 확인 대화상자와 비동기 확인 요청을 관리합니다. */
import {createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode} from 'react';
import {useLocation} from 'react-router-dom';
import {useVisit} from '../store/VisitContext';

const ConfirmationContext = createContext<((message: string) => Promise<boolean>) | null>(null);

/** Explicit confirmation without a browser-wide blocking JavaScript dialog. */
/** 확인 대화상자와 비동기 확인 요청을 관리합니다. */
export function ConfirmationProvider({children}: {children: ReactNode}) {
  const [message, setMessage] = useState<string | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const proceed = useRef<HTMLButtonElement>(null);
  const titleId = useId(); const bodyId = useId();
  const {pathname} = useLocation(); const {state} = useVisit();
  const settle = useCallback((value: boolean) => {
    const resolve = resolver.current; resolver.current = null; setMessage(null);
    if (previousFocus.current?.isConnected) previousFocus.current.focus();
    resolve?.(value);
  }, []);
  const confirmAction = useCallback((text: string): Promise<boolean> => {
    if (resolver.current) return Promise.resolve(false);
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return new Promise(resolve => {resolver.current = resolve; setMessage(text);});
  }, []);
  useEffect(() => {settle(false);}, [pathname, state.user?.id, state.visitId, settle]);
  useEffect(() => {if (message) cancel.current?.focus();}, [message]);
  useEffect(() => () => {resolver.current?.(false); resolver.current = null;}, []);
  return <ConfirmationContext.Provider value={confirmAction}>
    {children}
    {message && <div className="confirm-backdrop">
      <section className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}
        onKeyDown={event => {
          if (event.key === 'Escape') {event.preventDefault(); settle(false);}
          if (event.key === 'Tab') {event.preventDefault(); (document.activeElement === cancel.current ? proceed : cancel).current?.focus();}
        }}>
        <h2 id={titleId}>진행하기 전에 확인해 주세요</h2>
        <p id={bodyId}>{message}</p>
        <div className="action-row">
          <button ref={cancel} className="btn outline" onClick={() => settle(false)}>취소</button>
          <button ref={proceed} className="btn primary" onClick={() => settle(true)}>확인하고 계속</button>
        </div>
      </section>
    </div>}
  </ConfirmationContext.Provider>;
}

export function useConfirm() {
  const confirmAction = useContext(ConfirmationContext);
  if (!confirmAction) throw new Error('ConfirmationProvider가 필요합니다.');
  return confirmAction;
}
