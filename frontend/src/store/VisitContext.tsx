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

export const DEFAULT_EXHIBITION_ID = 'ex-mvp';

export interface VisitState {
  exhibitionId: string;
  user: User | null;
  tastes: TasteTag[];
  /** 토너먼트에서 정한 태그 순위 전체 (1위, 2위, 4강, 8강 순) — 전시에 없는 취향을 대신 채울 때 씀. 없으면 [] */
  tasteRanking: TasteTag[];
  duration: VisitDuration | null;
  recommendations: Recommendation[];
  /** 지금 보러 갈(또는 보고 있는) 추천 작품의 인덱스 (0부터) */
  current: number;
  viewed: string[];
  reactions: Record<string, Reaction>;
  /** 작품별 감상 시간(초) — 아트 영수증의 "가장 오래 본 작품" 계산용 */
  dwell: Record<string, number>;
  startedAt: number | null;
  /** recommend = 취향 추천 관람, free = 추천 없이 전시 작품 전체를 골라 보는 자유 관람 (U-16) */
  mode: 'recommend' | 'free';
}

type Action =
  | { type: 'setExhibition'; id: string }
  | { type: 'login'; user: User }
  | { type: 'logout' }
  | { type: 'setTastes'; tastes: TasteTag[]; ranking?: TasteTag[] }
  | { type: 'setDuration'; duration: VisitDuration }
  | { type: 'setRecommendations'; recs: Recommendation[] }
  | { type: 'startVisit' }
  | { type: 'addDwell'; artworkId: string; seconds: number }
  | { type: 'react'; artworkId: string; reaction: Reaction | null }
  | { type: 'completeCurrent' }
  | { type: 'resetVisit' }
  /** 자유 관람 시작: 전시 작품 전체를 걷는 순서로 (recs의 이유·태그는 비어 있음) */
  | { type: 'startFree'; recs: Recommendation[] }
  /** 자유 관람 목록에서 작품 하나를 열기 → 본 작품에 기록 */
  | { type: 'openArtwork'; index: number };

const VISIT_KEY = 'arti.visit';
const USER_KEY = 'arti.user';

const emptyVisit = {
  tastes: [] as TasteTag[],
  tasteRanking: [] as TasteTag[],
  duration: null,
  recommendations: [] as Recommendation[],
  current: 0,
  viewed: [] as string[],
  reactions: {} as Record<string, Reaction>,
  dwell: {} as Record<string, number>,
  startedAt: null,
  mode: 'recommend' as VisitState['mode'],
};

/** 예전 버전의 취향 태그(고요한 풍경·감정 표현 …)가 브라우저에 남아 있으면 새 8개로 바꾼다 (calm→풍경, 나머지 없는 키는 버림) */
const cleanTastes = (tags: string[] | undefined): TasteTag[] =>
  [...new Set((tags ?? []).map((t) => (t === 'calm' ? 'landscape' : t)))].filter((t): t is TasteTag => t in TASTE_LABEL);

function init(): VisitState {
  const stored = load<Partial<VisitState>>(VISIT_KEY, {}, 'session');
  const user = load<User | null>(USER_KEY, null);
  return {
    exhibitionId: DEFAULT_EXHIBITION_ID,
    ...emptyVisit,
    ...stored,
    tastes: cleanTastes(stored.tastes),
    tasteRanking: cleanTastes(stored.tasteRanking),
    user: user && { ...user, tastes: cleanTastes(user.tastes) },
  };
}

function reducer(s: VisitState, a: Action): VisitState {
  switch (a.type) {
    case 'setExhibition':
      return s.exhibitionId === a.id ? s : { ...s, ...emptyVisit, exhibitionId: a.id };
    case 'login':
      return { ...s, user: a.user };
    case 'logout':
      // 이전 계정의 취향이 다음 사람(다른 계정·비회원)에게 이어지지 않게 비운다
      return { ...s, user: null, tastes: [], tasteRanking: [] };
    case 'setTastes':
      return { ...s, tastes: a.tastes, tasteRanking: a.ranking ?? [] };
    case 'setDuration':
      return { ...s, duration: a.duration };
    case 'setRecommendations':
      return { ...s, recommendations: a.recs, current: 0, viewed: [], reactions: {}, dwell: {}, startedAt: null, mode: 'recommend' };
    case 'startFree':
      // 이미 자유 관람 중이면(목록으로 돌아온 경우) 본 작품·반응을 그대로 둔다
      if (s.mode === 'free' && s.recommendations.length === a.recs.length) return s;
      return { ...s, recommendations: a.recs, current: 0, viewed: [], reactions: {}, dwell: {}, startedAt: Date.now(), mode: 'free' };
    case 'openArtwork': {
      const rec = s.recommendations[a.index];
      if (!rec) return s;
      const viewed = s.viewed.includes(rec.artworkId) ? s.viewed : [...s.viewed, rec.artworkId];
      return { ...s, current: a.index, viewed };
    }
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
