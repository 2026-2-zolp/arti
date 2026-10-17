import type { TasteTag, VisitDuration } from '../types';

/**
 * 화면 공통 상수 (취향 라벨, 취향 파악 카드, 관람 시간 옵션).
 * 전시·작품·회원 데이터는 이제 백엔드 DB에 있다 → backend/src/seed.ts
 * (서버의 TASTE_LABEL·DURATION_OPTIONS와 값이 같아야 한다)
 */

export const TASTE_LABEL: Record<TasteTag, string> = {
  vivid: '강한 색감',
  calm: '고요한 풍경',
  abstract: '추상적 형태',
  soft: '부드러운 색감',
  emotion: '감정 표현',
  light: '빛',
};

/** U-05 취향 파악 카드 (현재 4장 + 확장 2장) */
export const TASTE_SAMPLES: { tag: TasteTag; palette: string[] }[] = [
  { tag: 'vivid', palette: ['#D9EDE6', '#7FB3A3', '#4F7A68', '#E9D9A0', '#C98F6B'] },
  { tag: 'calm', palette: ['#F3D6CD', '#D6544A', '#F0B94A', '#2F4A5C', '#8E1F1F'] },
  { tag: 'abstract', palette: ['#EDE6DD', '#8C6A4A', '#2E3A4D', '#C99A55', '#F7F1E8'] },
  { tag: 'soft', palette: ['#F5EAD8', '#E9585B', '#E2B12F', '#2E3F5C', '#F08A4B'] },
  { tag: 'emotion', palette: ['#1F2A44', '#E36A3A', '#F2C14E', '#7A2E3B', '#F3E9DC'] },
  { tag: 'light', palette: ['#FFF7E0', '#F6D77A', '#B9D4E8', '#E8B9A4', '#FFFFFF'] },
];

export const DURATION_OPTIONS: { value: VisitDuration; label: string; desc: string; count: number }[] = [
  { value: '30m', label: '30분', desc: '핵심 작품 3점을 가볍게 둘러봐요', count: 3 },
  { value: '60m', label: '1시간', desc: '추천 작품 5점을 차분히 감상해요', count: 5 },
  { value: 'relaxed', label: '여유롭게', desc: '추천 작품 7점을 충분히 즐겨요', count: 7 },
];
