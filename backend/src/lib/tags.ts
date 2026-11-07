/**
 * 취향 태그 8개 — 사용자 취향 카드 = 관리자 태그 = AI 태그 (ai-service/app/tags.py 와 같은 키)
 *
 * 작품의 태그 강도(0~1):
 * - AI 태그 분석을 관리자가 「확정」했으면 확정된 점수(tagScores)
 * - 아니면 관리자가 켠 태그 1, 나머지 0
 */
import type { Artwork, TagScores, TasteTag } from '../types.js';

export const TAG_KEYS: TasteTag[] = ['landscape', 'people', 'abstract', 'light', 'vivid', 'cool', 'warm', 'soft'];

/** AI 점수가 이 값 이상이면 그 태그를 "해당함"으로 본다 (관리자 화면에서 버튼이 미리 켜지는 기준) */
export const TAG_THRESHOLD = 0.5;

/** 예전 6개 태그 → 새 8개 (저장된 작품·사용자 취향을 옮길 때). 없는 키는 버린다 */
export const LEGACY_TAGS: Record<string, TasteTag | null> = { calm: 'landscape', emotion: null };

export function migrateTagList(list: string[]): TasteTag[] {
  const out = list
    .map((t) => (t in LEGACY_TAGS ? LEGACY_TAGS[t] : (t as TasteTag)))
    .filter((t): t is TasteTag => t !== null && TAG_KEYS.includes(t));
  return [...new Set(out)];
}

/** AI가 "해당함"으로 본 태그 (점수 높은 순) */
export const suggestedTags = (ai: TagScores): TasteTag[] =>
  TAG_KEYS.filter((t) => ai[t] >= TAG_THRESHOLD).sort((a, b) => ai[b] - ai[a]);

/**
 * 확정 점수: 관리자가 AI 판단을 그대로 둔 태그는 AI 점수, 관리자가 바꾼 태그는 켬 1 / 끔 0 (사람의 판단이 우선)
 */
export function confirmTagScores(ai: TagScores, tagsOn: TasteTag[]): TagScores {
  return Object.fromEntries(
    TAG_KEYS.map((t) => {
      const aiOn = ai[t] >= TAG_THRESHOLD;
      const on = tagsOn.includes(t);
      return [t, on === aiOn ? ai[t] : on ? 1 : 0];
    }),
  ) as TagScores;
}

/** 추천에 쓰는 태그 강도 0~1 */
export function tagStrength(w: Pick<Artwork, 'tags' | 'tagScores' | 'tagStatus'>, t: TasteTag): number {
  if (w.tagStatus === 'confirmed' && w.tagScores) return w.tagScores[t];
  return w.tags.includes(t) ? 1 : 0;
}
