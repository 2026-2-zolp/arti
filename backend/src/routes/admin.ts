/**
 * 관리자 API (A-01 ~ A-06). 로그인을 제외한 모든 요청에 X-Admin-Token 필요.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db.js';
import { createSession, deleteSession, HttpError, parse, rateLimit, requireAdmin } from '../http.js';
import { hashPassword, newToken, verifyPassword } from '../lib/password.js';
import * as repo from '../repo.js';
import { artworkInput, exhibitionInput } from '../schemas.js';

const DUMMY_HASH = hashPassword('dummy-password-0');

export function adminRoutes(db: DB) {
  const r = Router();

  /** A-01 관리자 로그인 */
  r.post('/admin/login', rateLimit(10, 60_000), (req, res) => {
    const body = parse(z.object({ id: z.string().trim().max(64), password: z.string().max(128) }), req.body);
    const admin = db.prepare('SELECT id, password_hash, name FROM admins WHERE login_id = ?').get(body.id) as
      | { id: string; password_hash: string; name: string }
      | undefined;
    const ok = verifyPassword(body.password, admin?.password_hash ?? DUMMY_HASH);
    if (!admin || !ok) throw new HttpError(401, '관리자 ID 또는 비밀번호가 올바르지 않아요.');
    const token = newToken();
    createSession(db, 'admin', admin.id, token);
    res.json({ name: admin.name, token });
  });

  r.post('/admin/logout', (req, res) => {
    deleteSession(db, req.get('x-admin-token') ?? undefined);
    res.status(204).end();
  });

  r.use('/admin', requireAdmin);

  /** A-03 전시 등록·수정 (id가 비어 있으면 새로 등록) */
  r.post('/admin/exhibitions', (req, res) => {
    res.status(201).json(repo.upsertExhibition(db, { ...parse(exhibitionInput, req.body), id: '' }));
  });

  r.put('/admin/exhibitions/:id', (req, res) => {
    if (!repo.getExhibition(db, req.params.id)) throw new HttpError(404, '전시 정보를 찾을 수 없어요.');
    res.json(repo.upsertExhibition(db, { ...parse(exhibitionInput, req.body), id: req.params.id }));
  });

  /** A-04 작품 등록·수정, A-05 위치 지정도 이 API로 저장 */
  const checkExhibition = (id: string) => {
    if (!repo.getExhibition(db, id)) throw new HttpError(400, '존재하지 않는 전시예요.');
  };

  r.post('/admin/artworks', (req, res) => {
    const body = parse(artworkInput, req.body);
    checkExhibition(body.exhibitionId);
    res.status(201).json(repo.upsertArtwork(db, { ...body, id: '', updatedAt: '' }));
  });

  r.put('/admin/artworks/:id', (req, res) => {
    if (!repo.getArtwork(db, req.params.id)) throw new HttpError(404, '작품 정보를 찾을 수 없어요.');
    const body = parse(artworkInput, req.body);
    checkExhibition(body.exhibitionId);
    res.json(repo.upsertArtwork(db, { ...body, id: req.params.id, updatedAt: '' }));
  });

  /** A-06 회원 조회 (이메일·닉네임 검색) */
  r.get('/admin/members', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
    res.json(repo.listMembers(db, q));
  });

  return r;
}
