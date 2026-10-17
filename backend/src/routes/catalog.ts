/**
 * 전시·작품 조회, 추천, AI (사용자 화면 U-01, U-08~U-11에서 사용 — 로그인 불필요)
 */
import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db.js';
import { notFound, parse, rateLimit } from '../http.js';
import { answerQuestion, personalizedExplanation } from '../lib/ai.js';
import { buildRecommendations } from '../lib/recommend.js';
import * as repo from '../repo.js';
import { tasteTag, visitDuration } from '../schemas.js';

export function catalogRoutes(db: DB) {
  const r = Router();

  const exhibitionOr404 = (id: string) => repo.getExhibition(db, id) ?? (() => { throw notFound('전시 정보를 찾을 수 없어요.'); })();
  const artworkOr404 = (id: string) => repo.getArtwork(db, id) ?? (() => { throw notFound('작품 정보를 찾을 수 없어요.'); })();

  r.get('/exhibitions', (_req, res) => {
    res.json(repo.listExhibitions(db));
  });

  r.get('/exhibitions/:id', (req, res) => {
    res.json(exhibitionOr404(req.params.id));
  });

  r.get('/artworks', (req, res) => {
    const exhibitionId = typeof req.query.exhibitionId === 'string' ? req.query.exhibitionId : undefined;
    res.json(repo.listArtworks(db, exhibitionId));
  });

  r.get('/artworks/:id', (req, res) => {
    res.json(artworkOr404(req.params.id));
  });

  /** U-07 → U-08: 취향 + 관람 시간 기반 추천 */
  r.post('/recommendations', (req, res) => {
    const body = parse(
      z.object({
        exhibitionId: z.string().min(1),
        tastes: z.array(tasteTag).max(6),
        duration: visitDuration,
      }),
      req.body,
    );
    const ex = exhibitionOr404(body.exhibitionId);
    res.json(buildRecommendations(repo.listArtworks(db, ex.id), ex, body.tastes, body.duration));
  });

  // AI 엔드포인트는 외부 API 비용이 드니 IP당 분당 20회로 제한
  const aiLimit = rateLimit(20, 60_000);

  /** U-10 AI 맞춤 설명 */
  r.post('/artworks/:id/explanation', aiLimit, async (req, res) => {
    const { tastes } = parse(z.object({ tastes: z.array(tasteTag).max(6) }), req.body);
    const text = await personalizedExplanation(artworkOr404(String(req.params.id)), tastes);
    res.json({ text });
  });

  /** U-11 AI 자유 질문 */
  r.post('/artworks/:id/ask', aiLimit, async (req, res) => {
    const { question } = parse(
      z.object({ question: z.string().trim().min(1, '질문을 입력해 주세요.').max(500, '질문은 500자 이내로 입력해 주세요.') }),
      req.body,
    );
    const answer = await answerQuestion(artworkOr404(String(req.params.id)), question);
    res.json({ answer });
  });

  return r;
}
