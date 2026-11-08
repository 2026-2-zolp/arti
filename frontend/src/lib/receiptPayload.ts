import type {VisitState} from '../store/visitReducer';
import type {Artwork, Exhibition, TasteTag, VisitRecord} from '../types';
import {TASTE_LABEL} from '../data/mock';
export function buildRecord(s: VisitState, artworks: Artwork[], ex: Exhibition): Omit<VisitRecord, 'id'> {
  const byId = new Map(artworks.map((w) => [w.id, w]));
  const dwell = Object.fromEntries(Object.entries(s.dwell).filter(([id]) => s.viewed.includes(id)));
  const reactions = Object.fromEntries(Object.entries(s.reactions).filter(([id]) => s.viewed.includes(id)));
  const reasons = Object.fromEntries(Object.entries(s.reactionReasons).filter(([id]) => s.viewed.includes(id) && reactions[id]));
  const longest = Object.entries(dwell).sort((a, b) => b[1] - a[1])[0]?.[0] ?? s.viewed[0] ?? null;

  // 취향 키워드: 선택한 취향 + 👍 누른 작품의 특성
  const liked = Object.entries(s.reactions)
    .filter(([, r]) => r === 'like')
    .flatMap(([id]) => byId.get(id)?.tags ?? []);
  // 화면 이름표(TASTE_LABEL)가 없는 예전 태그(calm·emotion 등)는 뺀다.
  // 빼지 않으면 키워드에 null이 들어가 서버 입력 검사에서 관람기록 전체가 거부됨 (태그 통일 전 임시 처리)
  const tags = [...new Set<TasteTag>([...s.tastes, ...liked])].filter((t) => TASTE_LABEL[t]).slice(0, 4);

  return {
    visitId: s.visitId, tasteProfile: s.tasteProfile, tastes: s.tastes, selectedDuration: s.duration ?? '30m', requestGeneration: s.requestGeneration, reactionReasons: reasons, dwell,
    userId: s.user?.id ?? null,
    exhibitionId: ex.id,
    exhibitionTitle: ex.title,
    venue: ex.venue,
    date: new Date().toISOString(),
    durationMin: s.startedAt ? Math.max(1, Math.round((Date.now() - s.startedAt) / 60000)) : 0,
    viewedArtworkIds: s.viewed,
    recommendedCount: s.recommendations.length,
    reactions,
    longestViewedArtworkId: longest,
    keywords: tags.map((t) => TASTE_LABEL[t]),
  };
}
