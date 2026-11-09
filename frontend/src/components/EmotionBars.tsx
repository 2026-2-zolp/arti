/** AI 감정 분석 점수 막대그래프 (A-04 분석 결과, U-12 오늘의 감정 프로필에서 사용) */
import { EMOTION_KEYS, EMOTION_LABEL } from '../data/mock';
import type { EmotionScores } from '../types';

/** 작품·관람의 감정 점수를 막대 형태로 표시합니다. */
export function EmotionBars({ scores, highlight = 2 }: { scores: EmotionScores; highlight?: number }) {
  const top = new Set([...EMOTION_KEYS].sort((a, b) => scores[b] - scores[a]).slice(0, highlight));
  return (
    <ul className="emo-bars" aria-label="감정 분석 점수">
      {EMOTION_KEYS.map((k) => (
        <li key={k} className={top.has(k) ? 'top' : ''}>
          <span className="emo-name">{EMOTION_LABEL[k]}</span>
          <span className="emo-track" aria-hidden>
            <span className="emo-fill" style={{ width: `${Math.round(scores[k] * 100)}%` }} />
          </span>
          <span className="emo-val">{scores[k].toFixed(2)}</span>
        </li>
      ))}
    </ul>
  );
}

/** 상위 감정 이름 (예: ['평온', '그리움']) */
export const topEmotionLabels = (scores: EmotionScores, n = 2) =>
  [...EMOTION_KEYS].sort((a, b) => scores[b] - scores[a]).slice(0, n).map((k) => EMOTION_LABEL[k]);
