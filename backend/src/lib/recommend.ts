/**
 * 개인화 추천 + 관람 순서 계산
 *
 * 1) 후보: 검수 완료(approved) + 위치 등록된 작품만 (설계서: 검증된 데이터만 서비스)
 * 2) 점수:
 *    - 감정 분석이 확정된 작품 → 0.7 × 감정 유사도 + 0.3 × 취향 태그 일치율
 *      감정 유사도는 고른 취향 카드마다 따로 작품과 비교해 가장 닮은 카드의 값을 쓴다.
 *      (카드들을 평균 내면 「빛」+「감정 표현」처럼 반대 성격 취향이 섞여 어중간한 작품이 추천되기 때문)
 *    - 아직 분석이 확정되지 않은 작품 → 취향 태그 일치율만 사용
 * 3) 고른 카드마다(서로 비슷한 카드는 한 묶음으로) 가장 닮은 작품을 최소 1점씩 먼저 넣고, 나머지는 점수순으로 관람 시간에 맞는 개수만큼
 * 4) 입구에서 출발해 가장 가까운 작품을 차례로 고르는 방식(최근접 이웃)으로 관람 순서 결정
 */
import { DURATION_OPTIONS, TASTE_LABEL } from '../seed.js';
import type { Artwork, Exhibition, MapPoint, Recommendation, TasteTag, VisitDuration } from '../types.js';
import { cosine, emotionLabel, sharedTop, TASTE_EMOTIONS, tasteProfile } from './emotion.js';

export const countForDuration = (d: VisitDuration) => DURATION_OPTIONS.find((o) => o.value === d)?.count ?? 5;

export const EMOTION_WEIGHT = 0.7;

const dist = (p: MapPoint, q: MapPoint) => Math.hypot(p.x - q.x, p.y - q.y);

/** 변환표에서 이만큼 닮은 카드(예: 고요한 풍경·부드러운 색감)는 같은 취향으로 보고 최소 1점 보장을 한 번만 한다 */
const SAME_TASTE = 0.85;

function groupTastes(tastes: TasteTag[]): TasteTag[][] {
  const groups: TasteTag[][] = [];
  for (const t of tastes) {
    const g = groups.find((g) => cosine(TASTE_EMOTIONS[g[0]], TASTE_EMOTIONS[t]) >= SAME_TASTE);
    if (g) g.push(t);
    else groups.push([t]);
  }
  return groups;
}

/** 작품 하나의 추천 점수와, 어느 취향 카드 때문에 추천됐는지 */
function scoreArtwork(w: Artwork, tastes: TasteTag[]) {
  const matchedTags = w.tags.filter((t) => tastes.includes(t));
  const tagScore = tastes.length ? matchedTags.length / tastes.length : 0;
  const emotions = w.emotionStatus === 'confirmed' ? w.analysis?.emotions : undefined;
  if (emotions && tastes.length) {
    let card = tastes[0];
    let similarity = -1;
    for (const t of tastes) {
      const s = cosine(TASTE_EMOTIONS[t], emotions);
      if (s > similarity) [card, similarity] = [t, s];
    }
    return {
      w,
      matchedTags,
      card,
      matchedEmotions: sharedTop(tasteProfile([card])!, emotions),
      similarity: Math.round(similarity * 1000) / 1000,
      score: EMOTION_WEIGHT * similarity + (1 - EMOTION_WEIGHT) * tagScore,
    };
  }
  return {
    w,
    matchedTags,
    card: tastes.find((t) => matchedTags.includes(t)) ?? null,
    matchedEmotions: [],
    similarity: null,
    score: tagScore,
  };
}

export function buildRecommendations(
  artworks: Artwork[],
  exhibition: Exhibition,
  tastes: TasteTag[],
  duration: VisitDuration,
): Recommendation[] {
  const ranked = artworks
    .filter((w) => w.exhibitionId === exhibition.id && w.reviewStatus === 'approved' && w.position)
    .map((w) => scoreArtwork(w, tastes))
    .sort((x, y) => y.score - x.score || x.w.id.localeCompare(y.w.id));

  // 한 취향이 목록을 독차지하지 않도록, 성격이 다른 카드 묶음마다 가장 닮은 작품을 먼저 1점씩
  const count = countForDuration(duration);
  const picked: typeof ranked = [];
  for (const group of groupTastes(tastes).slice(0, count)) {
    const best = ranked.find((x) => x.card !== null && group.includes(x.card) && !picked.includes(x));
    if (best) picked.push(best);
  }
  for (const x of ranked) {
    if (picked.length >= count) break;
    if (!picked.includes(x)) picked.push(x);
  }

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

  return ordered.map(({ w, matchedTags, card, matchedEmotions, similarity }, i) => ({
    artworkId: w.id,
    order: i + 1,
    matchedTags,
    matchedCard: card,
    matchedEmotions,
    similarity,
    // U-08 카드에 붙는 짧은 이유: 감정이 겹치면 「카드」 취향 + 감정, 아니면 취향 태그
    reason: matchedEmotions.length
      ? `${TASTE_LABEL[card!]} 취향 · ${matchedEmotions.map(emotionLabel).join(' · ')}`
      : matchedTags.length
        ? matchedTags.map((t) => TASTE_LABEL[t]).join(' · ')
        : '새로운 취향을 넓혀 줄 작품',
  }));
}
