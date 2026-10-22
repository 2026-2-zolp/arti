/**
 * 개인화 추천 + 관람 순서 계산
 *
 * 1) 후보: 검수 완료(approved) + 위치 등록된 작품만 (설계서: 검증된 데이터만 서비스)
 * 2) 점수:
 *    - 감정 분석이 확정된 작품 → 0.7 × 감정 유사도(사용자 취향 프로필 ↔ 작품 AI 감정 점수) + 0.3 × 취향 태그 일치율
 *    - 아직 분석이 확정되지 않은 작품 → 취향 태그 일치율만 사용 (기존 방식)
 * 3) 관람 시간에 맞는 개수만큼 상위 선택
 * 4) 입구에서 출발해 가장 가까운 작품을 차례로 고르는 방식(최근접 이웃)으로 관람 순서 결정
 */
import { DURATION_OPTIONS, TASTE_LABEL } from '../seed.js';
import type { Artwork, Exhibition, MapPoint, Recommendation, TasteTag, VisitDuration } from '../types.js';
import { cosine, emotionLabel, sharedTop, tasteProfile } from './emotion.js';

export const countForDuration = (d: VisitDuration) => DURATION_OPTIONS.find((o) => o.value === d)?.count ?? 5;

export const EMOTION_WEIGHT = 0.7;

const dist = (p: MapPoint, q: MapPoint) => Math.hypot(p.x - q.x, p.y - q.y);

export function buildRecommendations(
  artworks: Artwork[],
  exhibition: Exhibition,
  tastes: TasteTag[],
  duration: VisitDuration,
): Recommendation[] {
  const profile = tasteProfile(tastes);
  const candidates = artworks.filter(
    (w) => w.exhibitionId === exhibition.id && w.reviewStatus === 'approved' && w.position,
  );

  const picked = candidates
    .map((w) => {
      const matchedTags = w.tags.filter((t) => tastes.includes(t));
      const tagScore = tastes.length ? matchedTags.length / tastes.length : 0;
      const emotions = w.emotionStatus === 'confirmed' ? w.analysis?.emotions : undefined;
      if (profile && emotions) {
        const similarity = cosine(profile, emotions);
        return {
          w,
          matchedTags,
          matchedEmotions: sharedTop(profile, emotions),
          similarity: Math.round(similarity * 1000) / 1000,
          score: EMOTION_WEIGHT * similarity + (1 - EMOTION_WEIGHT) * tagScore,
        };
      }
      return { w, matchedTags, matchedEmotions: [], similarity: null, score: tagScore };
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

  return ordered.map(({ w, matchedTags, matchedEmotions, similarity }, i) => ({
    artworkId: w.id,
    order: i + 1,
    matchedTags,
    matchedEmotions,
    similarity,
    // U-08 카드에 붙는 짧은 이유: 감정이 겹치면 감정, 아니면 취향 태그
    reason: matchedEmotions.length
      ? `${matchedEmotions.map(emotionLabel).join(' · ')}의 분위기`
      : matchedTags.length
        ? matchedTags.map((t) => TASTE_LABEL[t]).join(' · ')
        : '새로운 취향을 넓혀 줄 작품',
  }));
}
