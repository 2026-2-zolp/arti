/**
 * 감정 점수 계산 도구 (AI 호출 없음 — 감정 분석 서버가 만든 점수를 조합하는 일반 계산)
 *
 * 감정은 추천에 쓰지 않고, 작품 분위기 설명(U-10)과 아트 영수증의 감정 프로필(U-12)에만 쓴다.
 * 추천은 취향 태그로 한다 (lib/tags.ts, lib/recommend.ts).
 */
import type { EmotionKey, EmotionScores } from '../types.js';

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

export const topEmotions = (s: EmotionScores, n = 2): EmotionKey[] =>
  [...EMOTION_KEYS].sort((x, y) => s[y] - s[x]).slice(0, n);
