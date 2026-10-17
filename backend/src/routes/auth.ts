/**
 * 회원 인증 (U-03 로그인, U-04 회원가입, U-05/U-06 취향 저장, U-14/U-15 비밀번호 재설정)
 */
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import type { DB } from '../db.js';
import { tx } from '../db.js';
import { assertSelfOrAdmin, createSession, deleteSession, HttpError, parse, rateLimit, requireUser } from '../http.js';
import { hashPassword, newToken, sha256, verifyPassword } from '../lib/password.js';
import * as repo from '../repo.js';
import { email, password, tasteTag } from '../schemas.js';

/** 로그인 실패 시 이메일 존재 여부를 알 수 없도록 같은 메시지를 쓴다 */
const LOGIN_FAILED = '이메일 또는 비밀번호가 올바르지 않아요.';
/** 가입되지 않은 이메일로 로그인할 때도 해시 계산 시간을 맞추기 위한 더미 해시 */
const DUMMY_HASH = hashPassword('dummy-password-0');

export function authRoutes(db: DB) {
  const r = Router();
  const limit = rateLimit(10, 60_000);

  const issueSession = (userId: string) => {
    const token = newToken();
    createSession(db, 'user', userId, token);
    return token;
  };

  r.post('/auth/signup', limit, (req, res) => {
    const body = parse(
      z.object({ email, password, nickname: z.string().trim().max(20, '닉네임은 20자 이내로 입력해 주세요.').default('') }),
      req.body,
    );
    if (repo.findUserByEmail(db, body.email)) throw new HttpError(409, '이미 가입된 이메일이에요.');
    const user = repo.createUser(db, { email: body.email, passwordHash: hashPassword(body.password), nickname: body.nickname });
    res.status(201).json({ user: repo.publicUser(user), token: issueSession(user.id) });
  });

  r.post('/auth/login', limit, (req, res) => {
    const body = parse(z.object({ email: z.string().trim(), password: z.string().max(128) }), req.body);
    const user = repo.findUserByEmail(db, body.email);
    const ok = verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, LOGIN_FAILED);
    res.json({ user: repo.publicUser(user), token: issueSession(user.id) });
  });

  r.post('/auth/logout', (req, res) => {
    deleteSession(db, req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]);
    res.status(204).end();
  });

  /** 저장된 로그인 정보가 아직 유효한지 확인 + 최신 사용자 정보 */
  r.get('/auth/me', requireUser, (req, res) => {
    const user = repo.getUser(db, req.auth.userId!);
    if (!user) throw new HttpError(401, '로그인이 필요해요.');
    res.json(repo.publicUser(user));
  });

  r.put('/users/:id/tastes', (req, res) => {
    assertSelfOrAdmin(req, req.params.id);
    const { tastes } = parse(z.object({ tastes: z.array(tasteTag).max(6) }), req.body);
    repo.updateUserTastes(db, req.params.id, [...new Set(tastes)]);
    res.status(204).end();
  });

  /**
   * U-14 재설정 링크 요청.
   * 가입 여부와 관계없이 같은 응답을 돌려준다(이메일 존재 여부 노출 방지).
   * 데모 모드에서는 메일 발송 대신 토큰을 응답에 넣어 화면에서 바로 링크를 열 수 있게 한다.
   */
  r.post('/auth/password-reset/request', limit, (req, res) => {
    const body = parse(z.object({ email }), req.body);
    const user = repo.findUserByEmail(db, body.email);
    let demoToken: string | null = null;
    if (user) {
      const token = newToken();
      db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?').run(user.id, Date.now());
      db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)').run(
        sha256(token), user.id, Date.now() + config.resetTokenTtlMs,
      );
      // TODO(운영): 메일 발송 서비스 연동 — 링크: <프론트 주소>/password/reset?token=<token>
      console.log(`[password-reset] ${user.email} → /password/reset?token=${token}`);
      if (config.demoMode) demoToken = token;
    }
    res.json({ demoToken });
  });

  /** U-15 새 비밀번호 설정 */
  r.post('/auth/password-reset/confirm', limit, (req, res) => {
    const body = parse(z.object({ token: z.string().min(1).max(200), password }), req.body);
    const row = db
      .prepare('SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?')
      .get(sha256(body.token)) as { user_id: string; expires_at: number } | undefined;
    if (!row || row.expires_at < Date.now())
      throw new HttpError(400, '링크가 만료되었거나 올바르지 않아요. 다시 요청해 주세요.');
    tx(db, () => {
      repo.updateUserPassword(db, row.user_id, hashPassword(body.password));
      db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id);
      // 비밀번호가 바뀌면 기존 로그인 세션은 모두 끊는다
      db.prepare("DELETE FROM sessions WHERE role = 'user' AND subject_id = ?").run(row.user_id);
    });
    res.status(204).end();
  });

  return r;
}
