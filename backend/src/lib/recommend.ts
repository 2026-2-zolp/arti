/**
 * 개인화 추천 + 관람 순서 계산 (프론트 src/lib/recommend.ts의 목업 로직을 서버로 옮긴 것)
 *
 * 1) 검수 완료(approved) + 위치 등록된 작품만 후보 — 설계서: 검증된 데이터만 서비스
 * 2) 취향 태그 일치 수로 점수 → 관람 시간에 맞는 개수만큼 상위 선택
 * 3) 입구에서 출발해 가장 가까운 작품을 차례로 고르는 방식(최근접 이웃)으로 관람 순서 결정
 */
import { DURATION_OPTIONS, TASTE_LABEL } from '../seed.js';
import type { Artwork, Exhibition, MapPoint, Recommendation, TasteTag, VisitDuration } from '../types.js';

export const countForDuration = (d: VisitDuration) => DURATION_OPTIONS.find((o) => o.value === d)?.count ?? 5;

const dist = (p: MapPoint, q: MapPoint) => Math.hypot(p.x - q.x, p.y - q.y);

export function buildRecommendations(
  artworks: Artwork[],
  exhibition: Exhibition,
  tastes: TasteTag[],
  duration: VisitDuration,
): Recommendation[] {
  const candidates = artworks.filter(
    (w) => w.exhibitionId === exhibition.id && w.reviewStatus === 'approved' && w.position,
  );

  const picked = candidates
    .map((w) => {
      const matched = w.tags.filter((t) => tastes.includes(t));
      return { w, matched, score: matched.length * 2 + (w.tags.length > 0 ? 0.1 : 0) };
    })
    .sort((x, y) => y.score - x.score || x.w.id.localeCompare(y.w.id))
    .slice(0, countForDuration(duration));

  const remaining = [...picked];
  const ordered: typeof picked = [];
  let cur: MapPoint = exhibition.entrance;
  while (remaining.length) {
    let best = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (dist(cur, remaining[i].w.position!) < dist(cur, remaining[best].w.position!)) best = i;
    }
    const [next] = remaining.splice(best, 1);
    ordered.push(next);
    cur = next.w.position!;
  }

  return ordered.map(({ w, matched }, i) => ({
    artworkId: w.id,
    order: i + 1,
    matchedTags: matched,
    reason: matched.length ? matched.map((t) => TASTE_LABEL[t]).join(' · ') : '새로운 취향을 넓혀 줄 작품',
  }));
}
