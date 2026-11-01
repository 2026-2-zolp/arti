/** 고른 취향 중 이 전시에 작품이 없는 태그 안내 (U-05 결과 · U-08 추천) */
import { TASTE_LABEL } from '../data/mock';
import type { TasteFallback } from '../lib/tasteFallback';
import type { TasteTag } from '../types';

const names = (tags: TasteTag[]) => tags.map((t) => `「${TASTE_LABEL[t]}」`).join(' · ');

export function MissingNote({ fallback }: { fallback: TasteFallback }) {
  if (fallback.missing.length === 0) return null;
  const swapped = fallback.swaps.map(([m]) => m);
  const unswapped = fallback.missing.filter((t) => !swapped.includes(t));
  return (
    <p className="missing-note" role="note">
      이 전시에는 {names(fallback.missing)} 작품이 없어요.
      {fallback.swaps.length > 0 && ` 그래서 다음으로 끌린 ${names(fallback.swaps.map(([, s]) => s))} 작품을 대신 골라 드려요.`}
      {unswapped.length > 0 && ' 다른 취향을 더 고르면 추천이 풍성해져요.'}
    </p>
  );
}
