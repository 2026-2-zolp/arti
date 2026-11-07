/**
 * U-05 양자택일로 고른 작품에 이미 붙어 있는 태그를 세어, 추천 API에 넘길 취향 태그를 만든다.
 * 새 특징을 계산하지 않고 작품에 등록된 태그만 쓴다.
 * - 프론트 태그 8개(TASTE_LABEL)에 없는 예전 태그(calm·emotion)는 세지 않는다
 * - 많이 나온 순, 같으면 이름순
 * - 서버가 취향 태그를 최대 8개까지 받으므로(backend schemas: tastes max 8) 8개로 자른다 (태그가 8개뿐이라 사실상 전부)
 */
import type { Artwork, TasteTag } from '../types';
import { TASTE_LABEL } from '../data/mock';

export const MAX_TASTES = 8;

export function tastesFromPicks(works: Artwork[], pickIds: string[]): TasteTag[] {
  const counts = new Map<TasteTag, number>();
  for (const id of pickIds) {
    for (const tag of works.find((w) => w.id === id)?.tags ?? []) {
      if (!(tag in TASTE_LABEL)) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag)
    .slice(0, MAX_TASTES);
}
