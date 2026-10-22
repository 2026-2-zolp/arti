/**
 * 감정 점수 계산 도구 (AI 호출 없음 — 감정 분석 서버가 만든 점수를 비교·조합하는 일반 계산)
 *
 * - 취향 카드 → 감정 프로필: U-05에서 고른 카드들의 감정 값을 평균
 * - 코사인 유사도: 사용자 감정 프로필과 작품 감정 점수가 얼마나 닮았는지 (0~1)
 */
import type { EmotionKey, EmotionScores, TasteTag } from '../types.js';

/** ai-service/app/emotions.py 와 같은 순서·키 */
export const EMOTIONS: { key: EmotionKey; label: string }[] = [
  { key: 'calm', label: '평온' },
  { key: 'joy', label: '기쁨' },
  { key: 'sadness', label: '슬픔' },
  { key: 'tension', label: '긴장' },
  { key: 'awe', label: '경외' },
  { key: 'nostalgia', label: '그리움' },
];
export const EMOTION_KEYS = EMOTIONS.map((e) => e.key);
export const emotionLabel = (k: EmotionKey) => EMOTIONS.find((e) => e.key === k)?.label ?? k;

/**
 * U-05 취향 카드별 감정 값 (팀이 정한 설계 값 — AI가 만든 값이 아님).
 * 예: 「고요한 풍경」을 고른 사람은 평온·그리움 쪽 작품을 좋아할 가능성이 높다고 본다.
 */
export const TASTE_EMOTIONS: Record<TasteTag, EmotionScores> = {
  vivid: { calm: 0.1, joy: 0.6, sadness: 0.1, tension: 0.5, awe: 0.4, nostalgia: 0.1 },
  calm: { calm: 0.9, joy: 0.2, sadness: 0.1, tension: 0.0, awe: 0.3, nostalgia: 0.5 },
  abstract: { calm: 0.3, joy: 0.3, sadness: 0.1, tension: 0.4, awe: 0.5, nostalgia: 0.1 },
  soft: { calm: 0.7, joy: 0.5, sadness: 0.1, tension: 0.0, awe: 0.1, nostalgia: 0.5 },
  emotion: { calm: 0.0, joy: 0.2, sadness: 0.6, tension: 0.6, awe: 0.3, nostalgia: 0.4 },
  light: { calm: 0.5, joy: 0.7, sadness: 0.0, tension: 0.0, awe: 0.5, nostalgia: 0.2 },
};

const zeros = (): EmotionScores => ({ calm: 0, joy: 0, sadness: 0, tension: 0, awe: 0, nostalgia: 0 });

/** 여러 감정 점수의 가중 평균 → 가장 강한 감정을 1로 맞춤. 입력이 없으면 null */
export function weightedProfile(items: { scores: EmotionScores; weight: number }[]): EmotionScores | null {
  const valid = items.filter((i) => i.weight > 0);
  if (!valid.length) return null;
  const sum = zeros();
  for (const { scores, weight } of valid) for (const k of EMOTION_KEYS) sum[k] += scores[k] * weight;
  const top = Math.max(...EMOTION_KEYS.map((k) => sum[k]));
  if (top <= 0) return null;
  const out = zeros();
  for (const k of EMOTION_KEYS) out[k] = Math.round((sum[k] / top) * 1000) / 1000;
  return out;
}

/** 고른 취향 카드들 → 사용자 감정 프로필 */
export const tasteProfile = (tastes: TasteTag[]) =>
  weightedProfile(tastes.map((t) => ({ scores: TASTE_EMOTIONS[t], weight: 1 })));

export function cosine(a: EmotionScores, b: EmotionScores): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of EMOTION_KEYS) {
    dot += a[k] * b[k];
    na += a[k] * a[k];
    nb += b[k] * b[k];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** 두 프로필에서 함께 강한 감정 상위 n개 (추천 이유 문장용) */
export function sharedTop(a: EmotionScores, b: EmotionScores, n = 2): EmotionKey[] {
  return EMOTION_KEYS.map((k) => [k, a[k] * b[k]] as const)
    .filter(([, v]) => v >= 0.15)
    .sort((x, y) => y[1] - x[1])
    .slice(0, n)
    .map(([k]) => k);
}

export const topEmotions = (s: EmotionScores, n = 2): EmotionKey[] =>
  [...EMOTION_KEYS].sort((x, y) => s[y] - s[x]).slice(0, n);
