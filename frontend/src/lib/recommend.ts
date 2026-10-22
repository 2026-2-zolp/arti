import type { EmotionKey, MapPoint, TasteTag, VisitDuration } from '../types';
import { DURATION_OPTIONS, EMOTION_LABEL, TASTE_LABEL } from '../data/mock';
import { josa } from './josa';

/** 관람 시간 → 추천 작품 수 */
export function countForDuration(d: VisitDuration): number {
  return DURATION_OPTIONS.find((o) => o.value === d)?.count ?? 5;
}

/** 추천 목록·관람 순서 계산은 서버(backend/src/lib/recommend.ts)에서 한다. 여기는 화면 표시용 계산만 남겨 둔다. */
function dist(p: MapPoint, q: MapPoint): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/** 평면도 거리(퍼센트) → 예상 이동 시간(분). 평면도 가로를 약 40m로 가정. */
export function walkMinutes(from: MapPoint, to: MapPoint): number {
  const meters = dist(from, to) * 0.4;
  return Math.max(1, Math.round(meters / 50 + 0.5)); // 느린 관람 걸음 약 50m/분 + 여유
}

/** U-10 "이 작품이 추천된 이유" 문장 — 감정 분석 기반이면 감정, 아니면 취향 태그로 설명 */
export function reasonSentence(matched: TasteTag[], emotions: EmotionKey[] = []): string {
  if (emotions.length) {
    const names = emotions.map((e) => `'${EMOTION_LABEL[e]}'`);
    const joined = names.length > 1 ? `${josa(names[0], '와', '과')} ${names[1]}` : names[0];
    return `AI가 분석한 이 작품의 분위기가 당신의 취향과 닮았어요. 특히 ${josa(joined, '가', '이')} 느껴지는 작품이에요.`;
  }
  if (!matched.length) return '평소 취향과 조금 다른 작품이에요. 새로운 감상 포인트를 발견해 보세요.';
  const parts = matched.map((t) => josa(`'${TASTE_LABEL[t]}'`, '와', '과'));
  return `당신이 좋아하는 ${parts.join(' ')} 관련된 작품입니다.`;
}
