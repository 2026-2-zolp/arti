/**
 * 관람 기록 (U-12 아트 영수증 저장, U-13 관람기록, A-06 회원 기록 조회)
 */
import { Router } from 'express';
import type { DB } from '../db.js';
import { assertSelfOrAdmin, HttpError, notFound, parse } from '../http.js';
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
