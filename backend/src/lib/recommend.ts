/**
 * 개인화 추천 + 관람 순서 계산
 *
 * 사용자 취향 카드와 작품 태그가 같은 8개 단어라 변환 없이 바로 비교한다.
 * 1) 후보: 검수 완료(approved) + 위치 등록된 작품만 (설계서: 검증된 데이터만 서비스)
 * 2) 점수: 고른 카드마다 작품의 태그 강도(0~1)를 보고 평균
 *    - 태그 강도 = AI 태그 분석을 관리자가 확정했으면 확정 점수, 아니면 관리자가 켠 태그 1 / 나머지 0 (lib/tags.ts)
 * 3) 고른 카드마다 그 태그가 있는 작품을 최소 1점씩 먼저 넣고(한 취향이 목록을 독차지하지 않게), 나머지는 점수순으로
 *    관람 시간에 맞는 개수만큼
 * 4) 입구에서 출발해 가장 가까운 작품을 차례로 고르는 방식(최근접 이웃)으로 관람 순서 결정
 *
 * 같은 태그를 고르면 고른 순서(토너먼트 1·2위 등)와 상관없이 항상 같은 추천이 나오도록,
 * 계산 전에 태그를 고정 순서(TAG_KEYS)로 정렬한다. (정렬 전에는 924가지 경우 중 58건이 순서에 따라 달라졌다)
 *
 * 감정 분석(평온·기쁨 …)은 추천에 쓰지 않고 작품 분위기 설명·아트 영수증에만 쓴다.
 */
import { DURATION_OPTIONS, TASTE_LABEL } from '../seed.js';
import type { Artwork, Exhibition, MapPoint, Recommendation, TasteTag, VisitDuration } from '../types.js';
import { TAG_KEYS, TAG_THRESHOLD, tagStrength } from './tags.js';

export const countForDuration = (d: VisitDuration) => DURATION_OPTIONS.find((o) => o.value === d)?.count ?? 5;

const dist = (p: MapPoint, q: MapPoint) => Math.hypot(p.x - q.x, p.y - q.y);

/** 추천 후보: 이 전시의 검수 완료 + 위치 등록 작품 */
const candidates = (artworks: Artwork[], exhibition: Exhibition) =>
  artworks.filter((w) => w.exhibitionId === exhibition.id && w.reviewStatus === 'approved' && w.position);

/**
 * 전시의 태그 분포: 태그마다 "해당함"(0.5 이상)인 추천 후보 작품 수.
 * 0인 태그는 이 전시에서 추천할 수 없다 → 사용자 화면은 안내하고 다음 순위 취향으로 대신 채우며, 관리자 대시보드에 표시한다.
 */
export function tagCoverage(artworks: Artwork[], exhibition: Exhibition): Record<TasteTag, number> {
  const works = candidates(artworks, exhibition);
  return Object.fromEntries(TAG_KEYS.map((t) => [t, works.filter((w) => tagStrength(w, t) >= TAG_THRESHOLD).length])) as Record<
    TasteTag,
    number
  >;
}

function scoreArtwork(w: Artwork, tastes: TasteTag[]) {
  const strength = Object.fromEntries(tastes.map((t) => [t, tagStrength(w, t)])) as Record<TasteTag, number>;
  const score = tastes.length ? tastes.reduce((sum, t) => sum + strength[t], 0) / tastes.length : 0;
  const byStrength = [...tastes].sort((a, b) => strength[b] - strength[a]);
  return {
    w,
    strength,
    score,
    matchedTags: byStrength.filter((t) => strength[t] >= TAG_THRESHOLD),
    matchedCard: byStrength.length && strength[byStrength[0]] > 0 ? byStrength[0] : null,
    aiTags: w.tagStatus === 'confirmed' && !!w.tagScores,
  };
}

export function buildRecommendations(
  artworks: Artwork[],
  exhibition: Exhibition,
  pickedTastes: TasteTag[],
  duration: VisitDuration,
): Recommendation[] {
  const tastes = TAG_KEYS.filter((t) => pickedTastes.includes(t)); // 고른 순서 무시 + 중복 제거
  const ranked = candidates(artworks, exhibition)
    .map((w) => scoreArtwork(w, tastes))
    .sort((x, y) => y.score - x.score || x.w.id.localeCompare(y.w.id));

  // 한 취향이 목록을 독차지하지 않도록, 고른 카드마다 그 태그가 있는 작품 중 점수 1등을 먼저 1점씩
  const count = countForDuration(duration);
  const picked: typeof ranked = [];
  for (const t of tastes.slice(0, count)) {
    const best = ranked.find((x) => x.strength[t] >= TAG_THRESHOLD && !picked.includes(x));
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

  return ordered.map(({ w, score, matchedTags, matchedCard, aiTags }, i) => ({
    artworkId: w.id,
    order: i + 1,
    matchedTags,
    matchedCard,
    score: Math.round(score * 1000) / 1000,
    aiTags,
    // U-08 카드에 붙는 짧은 이유: 해당하는 취향 태그
    reason: matchedTags.length ? matchedTags.map((t) => TASTE_LABEL[t]).join(' · ') : '새로운 취향을 넓혀 줄 작품',
  }));
}
