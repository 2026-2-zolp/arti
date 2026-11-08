/**
 * 관람 세션 전역 상태 (Context + useReducer)
 *
 * - Context: 여러 화면(U-01~U-13)이 같은 데이터를 props 전달 없이 함께 쓰도록 하는 React 기능
 * - useReducer: "어떤 동작(action)이 일어나면 상태가 어떻게 바뀐다"를 한곳(reducer)에 모아 두는 훅
 *
 * 관람 진행 정보는 sessionStorage(탭을 닫으면 사라짐)에,
 * 로그인 사용자는 localStorage(다시 방문해도 유지)에 저장한다.
 */
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type Dispatch, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import {init, reducer, type VisitState, type Action} from './visitReducer';
export type {VisitState} from './visitReducer';
const VISIT_KEY = 'arti.visit'; const USER_KEY = 'arti.user';
import { load, save } from '../lib/storage';
import { clearPrivateCaches } from '../lib/visitScope';

interface Ctx {
  state: VisitState;
  dispatch: Dispatch<Action>;
}

const VisitCtx = createContext<Ctx | null>(null);

export function VisitProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, init);

  useEffect(() => {
    let active = true;
    const expired = () => { clearPrivateCaches(false); dispatch({ type: 'logout' }); };
    const onStorage = (e: StorageEvent) => { if (e.key === 'arti.token') { clearPrivateCaches(); if (localStorage.getItem('arti.token')) api.me().then(user => active && dispatch({type: 'login', user})).catch(expired); else expired(); } };
    window.addEventListener('arti:expired', expired); window.addEventListener('storage', onStorage);
    const bootstrapToken = load('arti.token', null);
    if (bootstrapToken) api.me().then(user => active && load('arti.token', null) === bootstrapToken && dispatch({type: 'login', user})).catch((e: {status?: number}) => { if (e.status === 401 && load('arti.token', null) === bootstrapToken) expired(); });
    else if (state.user) expired();
    return () => { active = false; window.removeEventListener('arti:expired', expired); window.removeEventListener('storage', onStorage); };
    // Bootstrap once; user mutations are explicit actions.
  }, []);
  const previousActor = useRef(state.user?.id);
  useEffect(() => {
    if (previousActor.current !== state.user?.id) {
      if (state.user) for (const key of Object.keys(sessionStorage)) if (key.startsWith('arti.pendingReceipt.') && !key.startsWith(`arti.pendingReceipt.${state.user.id}.`)) sessionStorage.removeItem(key);
      clearPrivateCaches(false); previousActor.current = state.user?.id;
    }
  }, [state.user?.id]);
  // 상태가 바뀔 때마다 저장소에 반영 (새로고침해도 관람 흐름 유지)
  useEffect(() => {
    const { user, ...visit } = state;
    save(VISIT_KEY, visit, 'session');
    save(USER_KEY, user);
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <VisitCtx.Provider value={value}>{children}</VisitCtx.Provider>;
}

export function useVisit(): Ctx {
  const ctx = useContext(VisitCtx);
  if (!ctx) throw new Error('useVisit은 VisitProvider 안에서만 사용할 수 있어요.');
  return ctx;
}

/** 로그아웃 후 이동. 서버 세션을 먼저 끝내야 바로 다른 계정으로 로그인해도 새 토큰이 지워지지 않는다 */
export function useLogout() {
  const { dispatch } = useVisit();
  const navigate = useNavigate();
  return async (to = '/') => {
    if (!await api.logout()) return;
    clearPrivateCaches();
    dispatch({ type: 'logout' });
    navigate(to, { replace: true });
  };
}
