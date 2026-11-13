/** 추천 이유와 관람 시간 등 화면 표시용 값을 계산합니다. 실제 추천 순서는 서버가 정합니다. */
import type { TasteTag, VisitDuration } from '../types';
import { DURATION_OPTIONS, TASTE_LABEL } from '../data/mock';
import { josa } from './josa';

/** 관람 시간 → 추천 작품 수 */
export function countForDuration(d: VisitDuration): number {
  return DURATION_OPTIONS.find((o) => o.value === d)?.count ?? 5;
}

/** U-10 "이 작품이 추천된 이유" 문장 — 사용자가 고른 취향 카드 중 이 작품에 해당하는 태그로 설명 */
export function reasonSentence(matched: TasteTag[], aiTags = false): string {
  if (!matched.length) return '선택한 취향 태그와 일치하는 항목이 없어요. 새로운 감상 포인트를 발견해 보세요.';
  const names = matched.map((t) => `'${TASTE_LABEL[t]}'`);
  const joined = names.length > 1 ? `${names.slice(0, -1).map((n) => josa(n, '와', '과')).join(' ')} ${names.at(-1)}` : names[0];
  return aiTags
    ? `AI가 그림을 분석해 보니 당신이 고른 ${josa(joined, '가', '이')} 잘 드러나는 작품이에요.`
    : `당신이 고른 ${josa(joined, '가', '이')} 담긴 작품이에요.`;
}
