/**
 * 관람 세션 전역 상태 (Context + useReducer)
 *
 * - Context: 여러 화면(U-01~U-13)이 같은 데이터를 props 전달 없이 함께 쓰도록 하는 React 기능
 * - useReducer: "어떤 동작(action)이 일어나면 상태가 어떻게 바뀐다"를 한곳(reducer)에 모아 두는 훅
 *
 * 관람 진행 정보는 sessionStorage(탭을 닫으면 사라짐)에,
 * 로그인 사용자는 localStorage(다시 방문해도 유지)에 저장한다.
 */
import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Reaction, Recommendation, TasteTag, User, VisitDuration } from '../types';
import { load, save } from '../lib/storage';
import { TASTE_LABEL } from '../data/mock';

export interface VisitState {
  /** 관람 중인 전시. 주소(/exhibitions/:exhibitionId)를 따라 맞춘다 — store/ExhibitionRoute.tsx. 아직 없으면 null */
  exhibitionId: string | null;
  user: User | null;
  tastes: TasteTag[];
  duration: VisitDuration | null;
  recommendations: Recommendation[];
  /** 지금 보러 갈(또는 보고 있는) 추천 작품의 인덱스 (0부터) */
  current: number;
  viewed: string[];
  reactions: Record<string, Reaction>;
  /** 👍/👎를 누른 뒤 고른 이유 (기타면 직접 적은 문장) */
  reactionReasons: Record<string, string>;
  /** U-05 양자택일을 끝냈는지. 취향 태그와는 따로 둔다. */
  tasteDone: boolean;
  /** 작품별 감상 시간(초) — 아트 영수증의 "가장 오래 본 작품" 계산용 */
  dwell: Record<string, number>;
  startedAt: number | null;
}

type Action =
  | { type: 'setExhibition'; id: string }
  | { type: 'login'; user: User }
  | { type: 'logout' }
  | { type: 'setUserTastes'; tastes: TasteTag[] }
  | { type: 'setTastes'; tastes: TasteTag[] }
  | { type: 'finishTaste'; tastes: TasteTag[] }
  | { type: 'setDuration'; duration: VisitDuration }
  | { type: 'setRecommendations'; recs: Recommendation[] }
  | { type: 'startVisit' }
  | { type: 'addDwell'; artworkId: string; seconds: number }
  | { type: 'react'; artworkId: string; reaction: Reaction | null; reason?: string }
  | { type: 'completeCurrent' }
  | { type: 'resetVisit' };

const VISIT_KEY = 'arti.visit';
const USER_KEY = 'arti.user';

const emptyVisit = {
  tastes: [] as TasteTag[],
  duration: null,
  recommendations: [] as Recommendation[],
  current: 0,
  viewed: [] as string[],
  reactions: {} as Record<string, Reaction>,
  reactionReasons: {} as Record<string, string>,
  tasteDone: false,
  dwell: {} as Record<string, number>,
  startedAt: null,
};

/** 예전 버전의 취향 태그(고요한 풍경·감정 표현 …)가 브라우저에 남아 있으면 새 8개로 바꾼다 (calm→풍경, 나머지 없는 키는 버림) */
const cleanTastes = (tags: string[] | undefined): TasteTag[] =>
  [...new Set((tags ?? []).map((t) => (t === 'calm' ? 'landscape' : t)))].filter((t): t is TasteTag => t in TASTE_LABEL);

function init(): VisitState {
  const stored = load<Partial<VisitState>>(VISIT_KEY, {}, 'session');
  const user = load<User | null>(USER_KEY, null);
  return {
    exhibitionId: null,
    ...emptyVisit,
    ...stored,
    tastes: cleanTastes(stored.tastes),
    reactionReasons: stored.reactionReasons ?? {},
    tasteDone: stored.tasteDone === true,
    user: user && { ...user, tastes: cleanTastes(user.tastes) },
  };
}

function reducer(s: VisitState, a: Action): VisitState {
  switch (a.type) {
    case 'setExhibition':
      return s.exhibitionId === a.id ? s : { ...s, ...emptyVisit, exhibitionId: a.id };
    // 관람하는 사람이 바뀌면(비회원→회원, 다른 계정, 로그아웃) 진행 중인 관람을 비운다.
    // 앞사람의 추천·반응이 다음 사람에게 보이거나 다음 사람의 관람기록에 저장되지 않게 하기 위해서다.
    // 서버에 저장된 관람기록(마이페이지)은 그대로 둔다.
    case 'login':
      return s.user?.id === a.user.id ? { ...s, user: a.user } : { ...s, ...emptyVisit, user: a.user };
    case 'logout':
      return { ...s, ...emptyVisit, user: null };
    case 'setUserTastes':
      // 계정에 저장한 취향을 로그인 정보에도 반영 (관람 진행 상태는 건드리지 않음)
      return s.user ? { ...s, user: { ...s.user, tastes: a.tastes } } : s;
    case 'setTastes':
      return { ...s, tastes: a.tastes, tasteDone: a.tastes.length > 0 };
    case 'finishTaste':
      // U-05에서 고른 작품의 태그로 만든 취향 (lib/tasteFromPicks.ts). 계정 저장은 U-05에서 따로 한다
      return { ...s, tastes: a.tastes, tasteDone: true };
    case 'setDuration':
      return { ...s, duration: a.duration };
    case 'setRecommendations':
      return { ...s, recommendations: a.recs, current: 0, viewed: [], reactions: {}, reactionReasons: {}, dwell: {}, startedAt: null };
    case 'startVisit':
      return s.startedAt ? s : { ...s, startedAt: Date.now() };
    case 'addDwell':
      return { ...s, dwell: { ...s.dwell, [a.artworkId]: (s.dwell[a.artworkId] ?? 0) + a.seconds } };
    case 'react': {
      const reactions = { ...s.reactions };
      const reactionReasons = { ...s.reactionReasons };
      if (a.reaction) {
        reactions[a.artworkId] = a.reaction;
        reactionReasons[a.artworkId] = a.reason?.trim() ?? '';
      } else {
        delete reactions[a.artworkId];
        delete reactionReasons[a.artworkId];
      }
      return { ...s, reactions, reactionReasons };
    }
    case 'completeCurrent': {
      const rec = s.recommendations[s.current];
      if (!rec) return s;
      const viewed = s.viewed.includes(rec.artworkId) ? s.viewed : [...s.viewed, rec.artworkId];
      return { ...s, viewed, current: s.current + 1 };
    }
    case 'resetVisit':
      return { ...s, ...emptyVisit };
  }
}

interface Ctx {
  state: VisitState;
  dispatch: Dispatch<Action>;
}

const VisitCtx = createContext<Ctx | null>(null);

export function VisitProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, init);

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
    await api.logout();
    dispatch({ type: 'logout' });
    navigate(to, { replace: true });
  };
}
