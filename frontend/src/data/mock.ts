import type { AiStatus, EmotionKey, TasteTag, VisitDuration } from '../types';

/**
 * 화면 공통 상수 (취향 라벨, 취향 파악 카드, 관람 시간 옵션).
 * 전시·작품·회원 데이터는 이제 백엔드 DB에 있다 → backend/src/seed.ts
 * (서버의 TASTE_LABEL·DURATION_OPTIONS와 값이 같아야 한다)
 */

export const TASTE_LABEL: Record<TasteTag, string> = {
  landscape: '풍경',
  people: '인물',
  abstract: '추상',
  light: '빛',
  vivid: '강렬한 색감',
  cool: '차가운 색감',
  warm: '따뜻한 색감',
  soft: '부드러운 색감',
};

/** 취향 태그 순서 (화면 표시용, backend/src/lib/tags.ts 의 TAG_KEYS 와 같다) */
export const TAG_KEYS = Object.keys(TASTE_LABEL) as TasteTag[];

/** AI 태그 점수가 이 값 이상이면 "해당함" (backend/src/lib/tags.ts 의 TAG_THRESHOLD 와 같다) */
export const TAG_THRESHOLD = 0.5;

/**
 * U-05 취향 파악 카드 8장 (= 관리자 태그 = AI 태그)
 * 카드 그림: frontend/public/taste/<tag>.jpg|png|webp 파일이 있으면 그 그림, 없으면 palette 색으로 그린 자리표시 그림.
 * 그림을 바꾸려면 같은 이름의 파일만 바꿔 넣으면 된다 (public/taste/README.txt).
 */
export const tasteImageUrls = (tag: TasteTag) => ['jpg', 'png', 'webp'].map((ext) => `/taste/${tag}.${ext}`);

export const TASTE_SAMPLES: { tag: TasteTag; palette: string[] }[] = [
  { tag: 'landscape', palette: ['#DCE8D2', '#7FA36B', '#4F7A5A', '#A9C9E0', '#E9DFC4'] },
  { tag: 'people', palette: ['#F2E4D8', '#C98F6B', '#7A4E3B', '#2F3A4D', '#E8C9A8'] },
  { tag: 'abstract', palette: ['#EDE6DD', '#8C6A4A', '#2E3A4D', '#C99A55', '#F7F1E8'] },
  { tag: 'light', palette: ['#FFF7E0', '#F6D77A', '#B9D4E8', '#E8B9A4', '#FFFFFF'] },
  { tag: 'vivid', palette: ['#F3D6CD', '#D6544A', '#F0B94A', '#2F4A5C', '#1E8C7A'] },
  { tag: 'cool', palette: ['#DDE7F0', '#4F7FA8', '#2E4A6B', '#7FB3A3', '#B9CFE0'] },
  { tag: 'warm', palette: ['#F8E6CC', '#E36A3A', '#F2C14E', '#B5452F', '#F3D9A8'] },
  { tag: 'soft', palette: ['#F5EAD8', '#EBC7C9', '#D9E3EC', '#E9D9B8', '#C9D8C5'] },
];

export const DURATION_OPTIONS: { value: VisitDuration; label: string; desc: string; count: number }[] = [
  { value: '30m', label: '30분', desc: '핵심 작품 3점을 가볍게 둘러봐요', count: 3 },
  { value: '60m', label: '1시간', desc: '추천 작품 5점을 차분히 감상해요', count: 5 },
  { value: 'relaxed', label: '여유롭게', desc: '추천 작품 7점을 충분히 즐겨요', count: 7 },
];

/** AI 감정 분석 항목 (backend/src/lib/emotion.ts, ai-service/app/emotions.py 와 같은 키·순서) */
export const EMOTION_LABEL: Record<EmotionKey, string> = {
  calm: '평온',
  joy: '기쁨',
  sadness: '슬픔',
  tension: '긴장',
  awe: '경외',
  nostalgia: '그리움',
};
export const EMOTION_KEYS = Object.keys(EMOTION_LABEL) as EmotionKey[];

export const AI_STATUS_LABEL: Record<AiStatus, string> = {
  none: '분석 전',
  suggested: 'AI 제안',
  confirmed: '확정',
};
