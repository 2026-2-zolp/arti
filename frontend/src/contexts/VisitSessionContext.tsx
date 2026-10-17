import { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import type { Reaction, RecommendedArtwork, VisitTimeOption } from '@/types/domain';
import { safeStorage } from '@/utils/storage';

/**
 * 합의 6. 비회원 상태 기준 — 현재 관람 세션 전역 상태.
 * Zustand 대신 React Context + useReducer + localStorage 로 구현했다. (AGENTS.md "변경 사항" 참고)
 * - 새로고침해도 유지
 * - 로그인/로그아웃과 독립적으로 유지 (로그인 전환 시에도 진행 중인 관람 상태 유지)
 */

const STORAGE_KEY = 'arti.visitSession.v1';

export type VisitStatus = 'in_progress' | 'completed';

export interface VisitSessionState {
  sessionId: string;
  exhibitionId: string;
  status: VisitStatus;
  startedAt: string;
  endedAt: string | null;
  /** 선택한 취향 */
  tasteIds: string[];
  tasteKeywords: string[];
  /** 관람 가능 시간 */
  timeOption: VisitTimeOption | null;
  /** 추천 작품 목록 (order 기준 정렬) */
  recommendations: RecommendedArtwork[];
  /** 추천을 만든 조건 — 조건이 바뀌면 추천/진행 상황을 새로 시작 */
  recommendationKey: string | null;
  /** 현재 관람 위치 (recommendations 인덱스) */
  currentIndex: number;
  /** 작품 👍 / 👎 — 선택 안 함은 키 없음 */
  reactions: Record<string, Reaction>;
  viewedArtworkIds: string[];
  viewSeconds: Record<string, number>;
  /** 로그인 사용자의 기록이 서버에 저장된 경우 */
  savedVisitId: string | null;
}

type Action =
  | { type: 'start'; exhibitionId: string }
  | { type: 'setTastes'; tasteIds: string[]; keywords: string[] }
  | { type: 'setTimeOption'; timeOption: VisitTimeOption }
  | {
      type: 'setRecommendations';
      items: RecommendedArtwork[];
      key: string;
      keywords: string[];
    }
  | { type: 'setReaction'; artworkId: string; reaction: Reaction | null }
  | { type: 'markViewed'; artworkId: string }
  | { type: 'addViewTime'; artworkId: string; seconds: number }
  | { type: 'goTo'; index: number }
  | { type: 'finish' }
  | { type: 'setSavedVisitId'; visitId: string }
  | { type: 'clear' };

function createSession(exhibitionId: string): VisitSessionState {
  return {
    sessionId: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    exhibitionId,
    status: 'in_progress',
    startedAt: new Date().toISOString(),
    endedAt: null,
    tasteIds: [],
    tasteKeywords: [],
    timeOption: null,
    recommendations: [],
    recommendationKey: null,
    currentIndex: 0,
    reactions: {},
    viewedArtworkIds: [],
    viewSeconds: {},
    savedVisitId: null,
  };
}

function reducer(state: VisitSessionState | null, action: Action): VisitSessionState | null {
  if (action.type === 'start') {
    if (state && state.exhibitionId === action.exhibitionId && state.status === 'in_progress') {
      return state;
    }
    return createSession(action.exhibitionId);
  }
  if (action.type === 'clear') return null;
  if (!state) return state;

  switch (action.type) {
    case 'setTastes':
      return { ...state, tasteIds: action.tasteIds, tasteKeywords: action.keywords };
    case 'setTimeOption':
      return { ...state, timeOption: action.timeOption };
    case 'setRecommendations':
      if (state.recommendationKey === action.key) return state;
      return {
        ...state,
        recommendations: [...action.items].sort((a, b) => a.order - b.order),
        recommendationKey: action.key,
        tasteKeywords: action.keywords.length ? action.keywords : state.tasteKeywords,
        currentIndex: 0,
        viewedArtworkIds: [],
        viewSeconds: {},
        reactions: {},
        status: 'in_progress',
        endedAt: null,
        savedVisitId: null,
      };
    case 'setReaction': {
      const reactions = { ...state.reactions };
      if (action.reaction) reactions[action.artworkId] = action.reaction;
      else delete reactions[action.artworkId];
      return { ...state, reactions };
    }
    case 'markViewed':
      if (state.viewedArtworkIds.includes(action.artworkId)) return state;
      return { ...state, viewedArtworkIds: [...state.viewedArtworkIds, action.artworkId] };
    case 'addViewTime':
      return {
        ...state,
        viewSeconds: {
          ...state.viewSeconds,
          [action.artworkId]: (state.viewSeconds[action.artworkId] ?? 0) + action.seconds,
        },
      };
    case 'goTo':
      return {
        ...state,
        currentIndex: Math.max(0, Math.min(action.index, state.recommendations.length - 1)),
      };
    case 'finish':
      return state.status === 'completed'
        ? state
        : { ...state, status: 'completed', endedAt: new Date().toISOString() };
    case 'setSavedVisitId':
      return { ...state, savedVisitId: action.visitId };
    default:
      return state;
  }
}

interface VisitSessionContextValue {
  session: VisitSessionState | null;
  startSession: (exhibitionId: string) => void;
  setTastes: (tasteIds: string[], keywords: string[]) => void;
  setTimeOption: (timeOption: VisitTimeOption) => void;
  setRecommendations: (items: RecommendedArtwork[], key: string, keywords: string[]) => void;
  setReaction: (artworkId: string, reaction: Reaction | null) => void;
  markViewed: (artworkId: string) => void;
  addViewTime: (artworkId: string, seconds: number) => void;
  goTo: (index: number) => void;
  finish: () => void;
  setSavedVisitId: (visitId: string) => void;
  clear: () => void;
}

const VisitSessionContext = createContext<VisitSessionContextValue | null>(null);

export function VisitSessionProvider({ children }: { children: ReactNode }) {
  const [session, dispatch] = useReducer(reducer, null, () =>
    safeStorage.get<VisitSessionState>(STORAGE_KEY),
  );

  useEffect(() => {
    safeStorage.set(STORAGE_KEY, session);
  }, [session]);

  const startSession = useCallback(
    (exhibitionId: string) => dispatch({ type: 'start', exhibitionId }),
    [],
  );
  const setTastes = useCallback(
    (tasteIds: string[], keywords: string[]) => dispatch({ type: 'setTastes', tasteIds, keywords }),
    [],
  );
  const setTimeOption = useCallback(
    (timeOption: VisitTimeOption) => dispatch({ type: 'setTimeOption', timeOption }),
    [],
  );
  const setRecommendations = useCallback(
    (items: RecommendedArtwork[], key: string, keywords: string[]) =>
      dispatch({ type: 'setRecommendations', items, key, keywords }),
    [],
  );
  const setReaction = useCallback(
    (artworkId: string, reaction: Reaction | null) =>
      dispatch({ type: 'setReaction', artworkId, reaction }),
    [],
  );
  const markViewed = useCallback(
    (artworkId: string) => dispatch({ type: 'markViewed', artworkId }),
    [],
  );
  const addViewTime = useCallback(
    (artworkId: string, seconds: number) => dispatch({ type: 'addViewTime', artworkId, seconds }),
    [],
  );
  const goTo = useCallback((index: number) => dispatch({ type: 'goTo', index }), []);
  const finish = useCallback(() => dispatch({ type: 'finish' }), []);
  const setSavedVisitId = useCallback(
    (visitId: string) => dispatch({ type: 'setSavedVisitId', visitId }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  const value = useMemo(
    () => ({
      session,
      startSession,
      setTastes,
      setTimeOption,
      setRecommendations,
      setReaction,
      markViewed,
      addViewTime,
      goTo,
      finish,
      setSavedVisitId,
      clear,
    }),
    [
      session,
      startSession,
      setTastes,
      setTimeOption,
      setRecommendations,
      setReaction,
      markViewed,
      addViewTime,
      goTo,
      finish,
      setSavedVisitId,
      clear,
    ],
  );

  return <VisitSessionContext.Provider value={value}>{children}</VisitSessionContext.Provider>;
}

export function useVisitSession() {
  const ctx = useContext(VisitSessionContext);
  if (!ctx) throw new Error('useVisitSession must be used within VisitSessionProvider');
  return ctx;
}

/**
 * 현재 URL 의 전시와 일치하는 세션만 반환.
 * ensure=true 이면 진행 중인 세션이 없을 때 새로 시작한다 (U-02 ~ U-07 처럼 흐름 앞단 화면용).
 */
export function useExhibitionSession(exhibitionId: string, { ensure = false } = {}) {
  const ctx = useVisitSession();
  const session = ctx.session?.exhibitionId === exhibitionId ? ctx.session : null;
  const needsStart = ensure && (!session || session.status === 'completed');
  const { startSession } = ctx;

  useEffect(() => {
    if (needsStart) startSession(exhibitionId);
  }, [needsStart, exhibitionId, startSession]);

  return { ...ctx, session };
}
