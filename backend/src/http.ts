/**
 * HTTP 공통: 에러 형식, 입력 검증, 인증 미들웨어, 간단한 요청 횟수 제한
 *
 * 에러 응답 형식: { "error": "사용자에게 보여줄 한국어 메시지" }
 * 프론트 client.ts가 이 message를 ApiError로 바꿔 화면에 그대로 보여 준다.
 */
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodError } from 'zod';
import { config } from './config.js';
import type { DB } from './db.js';
import { sha256 } from './lib/password.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const notFound = (message: string) => new HttpError(404, message);

/** 요청 본문/쿼리를 zod 스키마로 검증. 실패하면 400 */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else if (err instanceof ZodError) {
    // 스키마에 한국어 메시지를 지정한 항목은 그대로, 나머지는 어떤 필드가 잘못됐는지만 알려 준다
    const issue = err.issues[0];
    const custom = issue && /[가-힣]/.test(issue.message);
    res.status(400).json({ error: custom ? issue.message : `입력값을 확인해 주세요. (${issue?.path.join('.') || '요청'})` });
  } else if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: '요청 형식(JSON)이 올바르지 않아요.' });
  } else {
    console.error(err);
    res.status(500).json({ error: '서버에서 문제가 발생했어요. 잠시 후 다시 시도해 주세요.' });
  }
};

// ───────────────────────── 인증 ─────────────────────────
/**
 * 사용자 토큰:  Authorization: Bearer <token>
 * 관리자 토큰: X-Admin-Token: <token>
 * 관리자 화면(A-06)에서 회원 기록을 볼 때처럼 두 토큰이 함께 올 수 있어 헤더를 분리했다.
 */
export interface Auth {
  userId: string | null;
  adminId: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth: Auth;
  }
}

function lookup(db: DB, token: string | undefined, role: 'user' | 'admin'): string | null {
  if (!token) return null;
  const row = db
    .prepare('SELECT subject_id, expires_at FROM sessions WHERE token_hash = ? AND role = ?')
    .get(sha256(token), role) as { subject_id: string; expires_at: number } | undefined;
  if (!row || row.expires_at < Date.now()) return null;
  return row.subject_id;
}

export const authenticate =
  (db: DB): RequestHandler =>
  (req, _res, next) => {
    const bearer = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    req.auth = {
      userId: lookup(db, bearer, 'user'),
      adminId: lookup(db, req.get('x-admin-token') ?? undefined, 'admin'),
    };
    next();
  };

export function createSession(db: DB, role: 'user' | 'admin', subjectId: string, token: string) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, role, subject_id, expires_at) VALUES (?,?,?,?)').run(
    sha256(token), role, subjectId, Date.now() + config.sessionTtlMs,
  );
}

export function deleteSession(db: DB, token: string | undefined) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export const requireUser: RequestHandler = (req, _res, next) =>
  next(req.auth.userId ? undefined : new HttpError(401, '로그인이 필요해요.'));

export const requireAdmin: RequestHandler = (req, _res, next) =>
  next(req.auth.adminId ? undefined : new HttpError(401, '관리자 로그인이 필요해요.'));

/** 본인 또는 관리자만 접근 허용 */
export function assertSelfOrAdmin(req: Request, userId: string) {
  if (req.auth.adminId) return;
  if (!req.auth.userId) throw new HttpError(401, '로그인이 필요해요.');
  if (req.auth.userId !== userId) throw new HttpError(403, '다른 사용자의 정보에는 접근할 수 없어요.');
}

// ───────────────────────── 요청 횟수 제한 ─────────────────────────
/**
 * 로그인·재설정 요청 남용(무차별 대입) 방지용. 메모리 기반이라 서버 한 대 기준.
 * windowMs 동안 같은 IP에서 max회를 넘으면 429.
 */
export function rateLimit(max: number, windowMs: number): RequestHandler {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!config.rateLimit) return next();
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return next();
    }
    h.count += 1;
    next(h.count > max ? new HttpError(429, '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.') : undefined);
  };
}
