/**
 * 감정 분석 서버(ai-service, Python) 호출
 * CLIP(이미지) + mDeBERTa(한국어 해설) 제로샷 분석 결과를 받아 ArtworkAnalysis 형태로 바꾼다.
 */
import { config } from '../config.js';
import { HttpError } from '../http.js';
import { emotionScores } from '../schemas.js';
import type { Artwork, ArtworkAnalysis } from '../types.js';
import { z } from 'zod';

const responseSchema = z.object({
  emotions: emotionScores,
  usedImage: z.boolean(),
  imageError: z.string().nullable(),
  models: z.object({ image: z.string(), text: z.string() }),
});

export async function analyzeEmotions(w: Artwork, useImage: boolean): Promise<ArtworkAnalysis> {
  let res: Response;
  try {
    res = await fetch(`${config.emotionServiceUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: w.title,
        description: w.description,
        imageUrl: useImage && w.imageUrl ? w.imageUrl : null,
      }),
      signal: AbortSignal.timeout(config.emotionTimeoutMs),
    });
  } catch {
    throw new HttpError(503, '감정 분석 서버에 연결할 수 없어요. ai-service가 실행 중인지 확인해 주세요.');
  }
  const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  if (!res.ok) {
    // FastAPI 에러 형식: { detail: "..." }
    const detail = typeof body?.detail === 'string' ? body.detail : '감정 분석에 실패했어요.';
    throw new HttpError(res.status === 400 ? 400 : 502, detail);
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(502, '감정 분석 서버의 응답 형식이 올바르지 않아요.');
  return { ...parsed.data, analyzedAt: new Date().toISOString() };
}
