import type { Artwork, RecommendationResult, TasteOption, VisitTimeOption } from '@/types/domain';
import { withJosa } from '@/utils/josa';

/** 관람 시간별 추천 작품 수 (임시 규칙 — 실제 추천 로직은 서버에서 결정) */
export const RECOMMEND_COUNT: Record<VisitTimeOption, number> = {
  '30m': 3,
  '1h': 5,
  free: 7,
};

const ROOM_ORDER = ['1전시실', '2전시실', '3전시실', '4전시실'];

export function recommend(
  artworks: Artwork[],
  tasteOptions: TasteOption[],
  tasteIds: string[],
  timeOption: VisitTimeOption,
): RecommendationResult {
  const selected = tasteOptions.filter((t) => tasteIds.includes(t.tasteId));

  const scored = artworks
    .map((artwork) => {
      const matched = selected.filter((t) => artwork.tasteTags.includes(t.tasteId));
      return { artwork, matched, score: matched.length };
    })
    .sort((a, b) => b.score - a.score || a.artwork.title.localeCompare(b.artwork.title));

  const picked = scored.slice(0, RECOMMEND_COUNT[timeOption]);

  // 동선이 짧도록 전시실 순서대로 정렬한 뒤 order 부여
  picked.sort(
    (a, b) => roomIndex(a.artwork.roomName) - roomIndex(b.artwork.roomName) || b.score - a.score,
  );

  return {
    items: picked.map(({ artwork, matched }, index) => ({
      artworkId: artwork.artworkId,
      title: artwork.title,
      imageUrl: artwork.imageUrl,
      recommendationReason: buildReason(matched),
      order: index + 1,
      floorId: artwork.floorId,
      artist: artwork.artist,
      roomName: artwork.roomName,
    })),
    tasteKeywords: Array.from(new Set(selected.flatMap((t) => t.keywords))),
  };
}

function roomIndex(name: string) {
  const i = ROOM_ORDER.indexOf(name);
  return i === -1 ? ROOM_ORDER.length : i;
}

function buildReason(matched: TasteOption[]) {
  const keywords = matched.flatMap((t) => t.keywords).slice(0, 2);
  if (keywords.length === 0) return '이번 전시의 대표 작품';
  if (keywords.length === 1) return keywords[0];
  return `${withJosa(keywords[0], '와/과')} ${keywords[1]}`;
}
