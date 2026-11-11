/**
 * 관람 기록 (U-12 아트 영수증 저장, U-13 관람기록, A-06 회원 기록 조회)
 */
import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db.js';
import { assertSelfOrAdmin, HttpError, notFound, parse, rateLimit } from '../http.js';
import { interpretVisit } from '../lib/ai.js';
import { weightedProfile } from '../lib/emotion.js';
import { newId } from '../lib/password.js';
import * as repo from '../repo.js';
import { visitInput } from '../schemas.js';
import type { VisitRecord } from '../types.js';

export function visitRoutes(db: DB) {
  const r = Router();

  /**
   * 관람 종료 시 아트 영수증 저장.
   * 로그인 사용자의 기록만 DB에 저장하고, 비회원은 영수증만 돌려준다(설계서: 로그인은 기록 저장용 선택 기능).
   * userId는 요청 본문이 아니라 로그인 토큰에서 정한다(다른 사람 이름으로 저장 방지).
   */
  r.post('/visits', (req, res) => {
    const body = parse(visitInput, req.body);
    const userId = req.auth.userId;
    const record: VisitRecord = { ...body, id: newId('v'), userId };
    if (userId) repo.insertVisit(db, { ...record, userId });
    res.status(userId ? 201 : 200).json(record);
  });

  /**
   * U-12 아트 영수증의 AI 취향 해석.
   * 오늘 본 작품의 (확정된) 감정 분석 점수를 반응·감상 시간으로 가중 평균해 감정 프로필을 만들고,
   * Claude가 그 결과를 2~3문장으로 해석한다 (키가 없으면 규칙 기반 문장).
   */
  r.post('/visits/interpret', rateLimit(20, 60_000), async (req, res) => {
    const body = parse(
      z.object({
        viewedArtworkIds: z.array(z.string().max(64)).max(50),
        reactions: z.record(z.string().max(64), z.enum(['like', 'dislike'])).default({}),
        dwell: z.record(z.string().max(64), z.number().min(0).max(24 * 3600)).default({}),
      }),
      req.body,
    );
    const artworks = body.viewedArtworkIds.flatMap((id) => repo.getArtwork(db, id) ?? []);
    // 👍 작품은 크게, 👎 작품은 작게 반영. 오래 본 작품일수록 조금 더 반영(최대 2배)
    const profile = weightedProfile(
      artworks
        .filter((w) => w.emotionStatus === 'confirmed' && w.analysis)
        .map((w) => {
          const r = body.reactions[w.id];
          const reaction = r === 'like' ? 2 : r === 'dislike' ? 0.3 : 1;
          const time = 1 + Math.min(1, (body.dwell[w.id] ?? 0) / 180);
          return { scores: w.analysis!.emotions, weight: reaction * time };
        }),
    );
    const { text, source } = await interpretVisit({ artworks, reactions: body.reactions, dwell: body.dwell, profile });
    res.json({ text, source, emotionProfile: profile });
  });

  r.get('/users/:id/visits', (req, res) => {
    assertSelfOrAdmin(req, req.params.id);
    res.json(repo.listVisits(db, req.params.id));
  });

  r.get('/visits/:id', (req, res) => {
    const v = repo.getVisit(db, req.params.id);
    if (!v) throw notFound('관람 기록을 찾을 수 없어요.');
    if (!v.userId) throw new HttpError(403, '접근할 수 없는 기록이에요.');
    assertSelfOrAdmin(req, v.userId);
    res.json(v);
  });

  return r;
}
