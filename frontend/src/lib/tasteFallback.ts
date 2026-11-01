/**
 * 전시에 없는 취향 태그 처리
 *
 * 취향은 사람의 것이라 그대로 저장하고(다른 전시에서 다시 씀), 이 전시에서 추천할 때만
 * 작품이 0점인 태그를 토너먼트 다음 순위 태그로 대신 채운다. 예: 인물(없음) → 4강에서 진 「추상」.
 * 토너먼트 순위가 없으면(저장된 취향·태그로 바로 고르기) 대신 채우지 않고 안내만 한다.
 */
import type { TasteTag } from '../types';

export type TagCoverage = Record<TasteTag, number>;

export interface TasteFallback {
  /** 이 전시에서 추천에 실제로 쓸 태그 */
  effective: TasteTag[];
  /** 이 전시에 해당 작품이 없는 태그 */
  missing: TasteTag[];
  /** [없는 태그, 대신 쓴 태그] */
  swaps: [TasteTag, TasteTag][];
}

export function fallbackTastes(tastes: TasteTag[], ranking: TasteTag[], coverage: TagCoverage | null): TasteFallback {
  if (!coverage) return { effective: tastes, missing: [], swaps: [] };
  const missing = tastes.filter((t) => !coverage[t]);
  const effective = tastes.filter((t) => coverage[t]);
  const spare = ranking.filter((t) => !tastes.includes(t) && coverage[t]);
  const swaps = missing.slice(0, spare.length).map((m, i) => [m, spare[i]] as [TasteTag, TasteTag]);
  return { effective: [...effective, ...swaps.map(([, s]) => s)], missing, swaps };
}
