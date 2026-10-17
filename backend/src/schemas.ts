/** 요청 본문 검증 스키마 (zod). 프론트 types.ts와 같은 모양을 강제한다. */
import { z } from 'zod';

export const tasteTag = z.enum(['vivid', 'calm', 'abstract', 'soft', 'emotion', 'light']);
export const visitDuration = z.enum(['30m', '60m', 'relaxed'], { message: '관람 시간을 선택해 주세요.' });

const point = z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식이어야 해요.');
const text = (max: number) => z.string().trim().max(max);

export const email = z.string().trim().toLowerCase().email('올바른 이메일 형식이 아니에요.').max(254);
export const password = z
  .string()
  .min(8, '비밀번호는 8자 이상이어야 해요.')
  .max(128, '비밀번호가 너무 길어요.')
  .regex(/[A-Za-z]/, '비밀번호에 영문을 포함해 주세요.')
  .regex(/\d/, '비밀번호에 숫자를 포함해 주세요.');

export const exhibitionInput = z.object({
  id: z.string().max(64).default(''),
  title: text(100).min(1, '전시명을 입력해 주세요.'),
  subtitle: text(200).default(''),
  venue: text(100).default(''),
  startDate: date,
  endDate: date,
  status: z.enum(['draft', 'running', 'closed']),
  rooms: z
    .array(
      z.object({
        id: z.string().min(1).max(32),
        name: text(50),
        rect: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
      }),
    )
    .max(50)
    .default([]),
  entrance: point,
}).refine((e) => e.startDate <= e.endDate, { message: '종료일은 시작일보다 빠를 수 없어요.' });

export const artworkInput = z.object({
  id: z.string().max(64).default(''),
  exhibitionId: z.string().min(1, '전시를 선택해 주세요.'),
  title: text(200).min(1, '작품명을 입력해 주세요.'),
  artist: text(100).min(1, '작가를 입력해 주세요.'),
  year: text(50).default(''),
  roomId: z.string().max(32).default(''),
  position: point.nullable().default(null),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{3,8}$/)).max(12).default([]),
  imageUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((u) => u === '' || /^https?:\/\//.test(u), '이미지 URL은 http(s)로 시작해야 해요.')
    .optional(),
  tags: z.array(tasteTag).max(6).default([]),
  description: text(5000).default(''),
  guidedLooking: z.array(text(500)).max(20).default([]),
  source: text(500).default(''),
  referenceUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((u) => u === '' || /^https?:\/\//.test(u), '참고자료 URL은 http(s)로 시작해야 해요.')
    .default(''),
  reviewStatus: z.enum(['pending', 'source_check', 'approved']),
});

export const visitInput = z.object({
  exhibitionId: z.string().min(1),
  exhibitionTitle: text(200),
  venue: text(200),
  date: z.string().datetime({ offset: true }).or(date),
  durationMin: z.number().int().min(0).max(24 * 60),
  viewedArtworkIds: z.array(z.string().max(64)).max(200),
  recommendedCount: z.number().int().min(0).max(200),
  reactions: z.record(z.string().max(64), z.enum(['like', 'dislike'])),
  longestViewedArtworkId: z.string().max(64).nullable(),
  keywords: z.array(text(50)).max(20),
});
