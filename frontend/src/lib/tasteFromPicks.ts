/** U-05에서 고른 작품의 태그 후보와 첫 화면의 기본 선택을 계산합니다. */
import type { Artwork, TasteTag } from '../types';
import { TAG_KEYS, TASTE_LABEL } from '../data/mock';

export function tastesFromPicks(
  works: Pick<Artwork, 'id' | 'tags'>[],
  pickIds: string[],
  pairs?: { leftId: string; rightId: string }[],
) {
  const counts = new Map<TasteTag, number>();
  for (const [index, id] of pickIds.entries()) {
    const pair = pairs?.[index];
    if (pairs && (!pair || (id !== pair.leftId && id !== pair.rightId))) continue;
    const otherId = pair && (pair.leftId === id ? pair.rightId : pair.leftId);
    const shared = works.find((work) => work.id === otherId)?.tags ?? [];
    for (const tag of works.find((w) => w.id === id)?.tags ?? []) {
      if (!(tag in TASTE_LABEL) || shared.includes(tag)) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const options = ranked.map(([tag]) => tag);
  if (pairs) return { options, defaultTags: options };
  const highest = ranked[0]?.[1];
  const leaders = ranked.filter(([, count]) => count === highest).map(([tag]) => tag);
  // For a wider tie, use the fixed tag display order for the editable suggestions.
  const defaultTags = leaders.length <= 2
    ? leaders : TAG_KEYS.filter(tag => leaders.includes(tag)).slice(0, 2);
  return {
    options,
    defaultTags,
  };
}
