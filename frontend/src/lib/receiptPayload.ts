/** 관람 상태를 서버에 저장할 영수증 요청으로 변환합니다. */
import type {VisitState} from '../store/visitReducer';
import type {Artwork, Exhibition, TasteTag, VisitRecord} from '../types';
import {TASTE_LABEL} from '../data/mock';

// Django와 Express가 허용하는 관람 시간의 최대값입니다.
export const MAX_VISIT_DURATION_MIN = 24 * 60;

/** 이전 버전이 탭에 남긴 영수증의 초과 시간만 저장 범위에 맞춥니다. */
export function limitReceiptDuration(record: Omit<VisitRecord, 'id'>): Omit<VisitRecord, 'id'> {
  if (record.durationMin > MAX_VISIT_DURATION_MIN) return { ...record, durationMin: MAX_VISIT_DURATION_MIN };
  return record;
}

export function buildRecord(s: VisitState, artworks: Artwork[], ex: Exhibition): Omit<VisitRecord, 'id'> {
  const byId = new Map(artworks.map((w) => [w.id, w]));
  const dwell = Object.fromEntries(Object.entries(s.dwell).filter(([id]) => s.viewed.includes(id)));
  const reactions = Object.fromEntries(Object.entries(s.reactions).filter(([id]) => s.viewed.includes(id)));
  const reasons = Object.fromEntries(Object.entries(s.reactionReasons).filter(([id]) => s.viewed.includes(id) && reactions[id]));
  let longest: string | null = null;
  for (const id of s.viewed) {
    if (longest === null || (dwell[id] ?? -1) > (dwell[longest] ?? -1)) longest = id;
  }

  // 취향 키워드: 선택한 취향 + 👍 누른 작품의 특성
  const liked = Object.entries(s.reactions)
    .filter(([, r]) => r === 'like')
    .flatMap(([id]) => byId.get(id)?.tags ?? []);
  // 화면 이름표(TASTE_LABEL)가 없는 예전 태그(calm·emotion 등)는 뺀다.
  // 빼지 않으면 키워드에 null이 들어가 서버 입력 검사에서 관람기록 전체가 거부됨 (태그 통일 전 임시 처리)
  const tags = [...new Set<TasteTag>([...s.tastes, ...liked])].filter((t) => TASTE_LABEL[t]).slice(0, 4);

  return {
    visitId: s.visitId, tasteProfile: s.tasteProfile, tastes: s.tastes, selectedDuration: s.duration ?? '30m', requestGeneration: s.requestGeneration, reactionReasons: reasons, dwell,
    tasteEvidenceReceipt: s.tasteEvidenceReceipt,
    userId: s.user?.id ?? null,
    exhibitionId: ex.id,
    exhibitionTitle: ex.title,
    venue: ex.venue,
    date: new Date().toISOString(),
    durationMin: s.startedAt ? Math.min(MAX_VISIT_DURATION_MIN, Math.max(1, Math.round((Date.now() - s.startedAt) / 60000))) : 0,
    viewedArtworkIds: s.viewed,
    recommendedCount: s.recommendations.length,
    reactions,
    longestViewedArtworkId: longest,
    keywords: tags.map((t) => TASTE_LABEL[t]),
  };
}
