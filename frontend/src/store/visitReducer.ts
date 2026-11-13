/** 관람 선택·진행·대화·기록 상태를 전이시키는 순수 로직입니다. */
import type { Reaction, Recommendation, TasteTag, User, VisitDuration, TasteProfile } from '../types';
import {load} from '../lib/storage';
import {newVisitId} from '../lib/visitScope';
import {TASTE_LABEL} from '../data/mock';
import {sameTaste, tasteScope} from '../lib/tasteFlow';
export interface VisitState {
  visitId: string;
  requestGeneration: number;
  tasteProfile?: TasteProfile;
  tasteEvidenceReceipt?: string;
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

export type Action =
  | { type: 'setExhibition'; id: string }
  | { type: 'login'; user: User }
  | { type: 'logout' }
  | { type: 'setUserTastes'; tastes: TasteTag[] }
  | { type: 'setTastes'; tastes: TasteTag[]; profile?: TasteProfile }
  | { type: 'finishTaste'; tastes: TasteTag[]; profile?: TasteProfile }
  | { type: 'applyTaste'; scope: string; visitId: string; profile: TasteProfile; receipt?: string; user?: User }
  | { type: 'setDuration'; duration: VisitDuration; newVisit?: boolean; scope?: string; proof?: {visitId: string; receipt: string} }
  | { type: 'setRecommendations'; recs: Recommendation[]; generation?: number }
  | { type: 'startVisit' }
  | { type: 'addDwell'; artworkId: string; seconds: number }
  | { type: 'react'; artworkId: string; reaction: Reaction | null; reason?: string }
  | { type: 'completeCurrent'; visitId: string; artworkId: string }
  | { type: 'resetVisit' };

const VISIT_KEY = 'arti.visit';
const USER_KEY = 'arti.user';

const emptyVisit = {
  tasteProfile: undefined as TasteProfile | undefined,
  tasteEvidenceReceipt: undefined as string | undefined,
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

export function init(): VisitState {
  const cached = load<Partial<VisitState> & {ownerId?: string | null}>(VISIT_KEY, {}, 'session');
  const user = load<User | null>(USER_KEY, null);
  const { ownerId, ...snapshot } = cached;
  const stored = ownerId === undefined || ownerId === (user?.id ?? null) ? snapshot : {};
  return {
    exhibitionId: null,
    ...emptyVisit,
    ...stored,
    visitId: stored.visitId ?? newVisitId(), requestGeneration: stored.requestGeneration ?? 0,
    tastes: cleanTastes(stored.tastes),
    reactionReasons: stored.reactionReasons ?? {},
    tasteDone: stored.tasteDone === true,
    user: user && { ...user, tastes: cleanTastes(user.tastes) },
  };
}

export function reducer(s: VisitState, a: Action): VisitState {
  switch (a.type) {
    case 'setExhibition':
      return s.exhibitionId === a.id ? s : { ...s, ...emptyVisit, visitId: newVisitId(), requestGeneration: s.requestGeneration + 1, exhibitionId: a.id };
    // 관람하는 사람이 바뀌면(비회원→회원, 다른 계정, 로그아웃) 진행 중인 관람을 비운다.
    // 앞사람의 추천·반응이 다음 사람에게 보이거나 다음 사람의 관람기록에 저장되지 않게 하기 위해서다.
    // 서버에 저장된 관람기록(마이페이지)은 그대로 둔다.
    case 'login':
      if (s.user?.id === a.user.id && (a.user.tasteProfileVersion ?? 1) < (s.user.tasteProfileVersion ?? 1)) return s;
      return s.user?.id === a.user.id ? { ...s, user: a.user } : { ...s, ...emptyVisit, visitId: newVisitId(), requestGeneration: s.requestGeneration + 1, user: a.user };
    case 'logout':
      return { ...s, ...emptyVisit, visitId: newVisitId(), requestGeneration: s.requestGeneration + 1, user: null };
    case 'setUserTastes':
      // 계정에 저장한 취향을 로그인 정보에도 반영 (관람 진행 상태는 건드리지 않음)
      return s.user ? { ...s, user: { ...s.user, tastes: a.tastes } } : s;
    case 'setTastes':
      return { ...s, ...emptyVisit, visitId: newVisitId(), requestGeneration: s.requestGeneration + 1, tastes: a.tastes, tasteProfile: a.profile, tasteDone: true };
    case 'finishTaste':
      // U-05에서 고른 작품의 태그로 만든 취향 (lib/tasteFromPicks.ts). 계정 저장은 U-05에서 따로 한다
      return { ...s, ...emptyVisit, visitId: newVisitId(), requestGeneration: s.requestGeneration + 1, tastes: a.tastes, tasteProfile: a.profile, tasteDone: true };
    case 'applyTaste':
      if (tasteScope(s) !== a.scope || (a.user && a.user.id !== s.user?.id)) return s;
      if (a.user && (a.user.tasteProfileVersion ?? 1) < (s.user?.tasteProfileVersion ?? 1)) return s;
      if (sameTaste(s.tasteProfile, a.profile)) return a.user ? { ...s, user: a.user } : s;
      if (a.profile.version === 2 && !a.receipt) return s;
      return { ...s, ...emptyVisit, user: a.user ?? s.user, visitId: a.visitId,
        requestGeneration: s.requestGeneration + 1, tastes: a.profile.selectedTags,
        tasteProfile: a.profile, tasteEvidenceReceipt: a.receipt, tasteDone: true };
    case 'setDuration':
      if ((a.scope && tasteScope(s) !== a.scope) || (a.duration === s.duration && !a.newVisit)) return s;
      if (s.tasteProfile?.version === 2 && s.startedAt && !a.proof) return s;
      return { ...s, duration: a.duration, recommendations: [], current: 0, viewed: [], reactions: {}, reactionReasons: {},
        dwell: {}, startedAt: null, visitId: a.proof?.visitId ?? (s.tasteEvidenceReceipt ? s.visitId : newVisitId()),
        tasteEvidenceReceipt: a.proof?.receipt ?? s.tasteEvidenceReceipt, requestGeneration: s.requestGeneration + 1 };
    case 'setRecommendations':
      if (a.generation !== undefined && a.generation !== s.requestGeneration) return s;
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
      if (a.visitId !== s.visitId || rec?.artworkId !== a.artworkId) return s;
      const viewed = s.viewed.includes(rec.artworkId) ? s.viewed : [...s.viewed, rec.artworkId];
      return { ...s, viewed, current: s.current + 1 };
    }
    case 'resetVisit':
      return { ...s, ...emptyVisit, visitId: newVisitId(), requestGeneration: s.requestGeneration + 1 };
  }
}
