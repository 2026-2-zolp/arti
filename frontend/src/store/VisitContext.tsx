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
import type { Reaction, Recommendation, TasteTag, User, VisitDuration } from '../types';
import { load, save } from '../lib/storage';

export const DEFAULT_EXHIBITION_ID = 'ex-mvp';

export interface VisitState {
  exhibitionId: string;
  user: User | null;
  tastes: TasteTag[];
  duration: VisitDuration | null;
  recommendations: Recommendation[];
  /** 지금 보러 갈(또는 보고 있는) 추천 작품의 인덱스 (0부터) */
  current: number;
  viewed: string[];
  reactions: Record<string, Reaction>;
  /** 작품별 감상 시간(초) — 아트 영수증의 "가장 오래 본 작품" 계산용 */
  dwell: Record<string, number>;
  startedAt: number | null;
}

type Action =
  | { type: 'setExhibition'; id: string }
  | { type: 'login'; user: User }
  | { type: 'logout' }
  | { type: 'setTastes'; tastes: TasteTag[] }
  | { type: 'setDuration'; duration: VisitDuration }
  | { type: 'setRecommendations'; recs: Recommendation[] }
  | { type: 'startVisit' }
  | { type: 'addDwell'; artworkId: string; seconds: number }
  | { type: 'react'; artworkId: string; reaction: Reaction | null }
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
  dwell: {} as Record<string, number>,
  startedAt: null,
};

function init(): VisitState {
  const stored = load<Partial<VisitState>>(VISIT_KEY, {}, 'session');
  return {
    exhibitionId: DEFAULT_EXHIBITION_ID,
    ...emptyVisit,
    ...stored,
    user: load<User | null>(USER_KEY, null),
  };
}

function reducer(s: VisitState, a: Action): VisitState {
  switch (a.type) {
    case 'setExhibition':
      return s.exhibitionId === a.id ? s : { ...s, ...emptyVisit, exhibitionId: a.id };
    case 'login':
      return { ...s, user: a.user };
    case 'logout':
      return { ...s, user: null };
    case 'setTastes':
      return { ...s, tastes: a.tastes };
    case 'setDuration':
      return { ...s, duration: a.duration };
    case 'setRecommendations':
      return { ...s, recommendations: a.recs, current: 0, viewed: [], reactions: {}, dwell: {}, startedAt: null };
    case 'startVisit':
      return s.startedAt ? s : { ...s, startedAt: Date.now() };
    case 'addDwell':
      return { ...s, dwell: { ...s.dwell, [a.artworkId]: (s.dwell[a.artworkId] ?? 0) + a.seconds } };
    case 'react': {
      const reactions = { ...s.reactions };
      if (a.reaction) reactions[a.artworkId] = a.reaction;
      else delete reactions[a.artworkId];
      return { ...s, reactions };
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
