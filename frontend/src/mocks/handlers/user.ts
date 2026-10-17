import type { ChatMessage, User, VisitRecord, VisitTimeOption } from '@/types/domain';
import { mockAnswer, mockExplanation, mockSuggestedQuestions } from '../ai';
import { commit, getDb } from '../db';
import { fail, ok, type MockRequest, type MockRoute } from '../http';
import { recommend } from '../recommend';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MOCK_RESET_TOKEN = 'mock-reset-token';

function toUser(u: { userId: string; email: string; nickname: string }): User {
  return { userId: u.userId, email: u.email, nickname: u.nickname };
}

function currentUser(req: MockRequest) {
  if (!req.token?.startsWith('mock-user-token:')) return null;
  const userId = req.token.split(':')[1];
  return getDb().users.find((u) => u.userId === userId) ?? null;
}

const unauthorized = () => fail(401, 'UNAUTHORIZED', '로그인이 필요해요.');

function findExhibition(exhibitionId: string) {
  return getDb().exhibitions.find((e) => e.exhibitionId === exhibitionId);
}

const exhibitionNotFound = () => fail(404, 'EXHIBITION_NOT_FOUND', '전시 정보를 찾을 수 없어요.');

export const userRoutes: MockRoute[] = [
  // ---- 전시 ----
  [
    'GET',
    '/exhibitions/:exhibitionId',
    ({ params }) => {
      const db = getDb();
      const exhibition = findExhibition(params.exhibitionId);
      if (!exhibition) return exhibitionNotFound();
      const artworkCount = db.artworks.filter(
        (a) => a.exhibitionId === exhibition.exhibitionId,
      ).length;
      return ok({ ...exhibition, artworkCount });
    },
  ],
  [
    'GET',
    '/exhibitions/:exhibitionId/taste-options',
    ({ params }) => {
      if (!findExhibition(params.exhibitionId)) return exhibitionNotFound();
      return ok(getDb().tasteOptions);
    },
  ],
  [
    'POST',
    '/exhibitions/:exhibitionId/recommendations',
    ({ params, body }) => {
      const db = getDb();
      if (!findExhibition(params.exhibitionId)) return exhibitionNotFound();
      const tasteIds = (body.tasteIds as string[] | undefined) ?? [];
      const timeOption = body.timeOption as VisitTimeOption | undefined;
      if (!timeOption) return fail(422, 'INVALID_INPUT', '관람 시간을 선택해 주세요.');
      const artworks = db.artworks.filter((a) => a.exhibitionId === params.exhibitionId);
      return ok(recommend(artworks, db.tasteOptions, tasteIds, timeOption));
    },
  ],
  [
    'GET',
    '/exhibitions/:exhibitionId/artworks/:artworkId',
    ({ params }) => {
      const artwork = getDb().artworks.find(
        (a) => a.artworkId === params.artworkId && a.exhibitionId === params.exhibitionId,
      );
      if (!artwork) return fail(404, 'ARTWORK_NOT_FOUND', '작품 정보를 찾을 수 없어요.');
      return ok(artwork);
    },
  ],
  [
    'GET',
    '/exhibitions/:exhibitionId/map',
    ({ params }) => {
      const db = getDb();
      if (!findExhibition(params.exhibitionId)) return exhibitionNotFound();
      const maps = db.maps.filter((m) => m.exhibitionId === params.exhibitionId);
      const mapIds = maps.map((m) => m.mapId);
      return ok({ maps, positions: db.positions.filter((p) => mapIds.includes(p.mapId)) });
    },
  ],

  // ---- AI ----
  [
    'POST',
    '/artworks/:artworkId/ai/explanation',
    ({ params, body }) => {
      const db = getDb();
      const artwork = db.artworks.find((a) => a.artworkId === params.artworkId);
      if (!artwork) return fail(404, 'ARTWORK_NOT_FOUND', '작품 정보를 찾을 수 없어요.');
      const tasteIds = (body.tasteIds as string[] | undefined) ?? [];
      const tastes = db.tasteOptions.filter((t) => tasteIds.includes(t.tasteId));
      return ok({ content: mockExplanation(artwork, tastes) });
    },
  ],
  [
    'GET',
    '/artworks/:artworkId/ai/suggested-questions',
    ({ params }) => {
      const artwork = getDb().artworks.find((a) => a.artworkId === params.artworkId);
      if (!artwork) return fail(404, 'ARTWORK_NOT_FOUND', '작품 정보를 찾을 수 없어요.');
      return ok(mockSuggestedQuestions(artwork));
    },
  ],
  [
    'POST',
    '/artworks/:artworkId/ai/questions',
    ({ params, body }) => {
      const artwork = getDb().artworks.find((a) => a.artworkId === params.artworkId);
      if (!artwork) return fail(404, 'ARTWORK_NOT_FOUND', '작품 정보를 찾을 수 없어요.');
      const question = String(body.question ?? '').trim();
      if (!question) return fail(422, 'INVALID_INPUT', '질문을 입력해 주세요.');
      const message: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: mockAnswer(artwork, question),
      };
      return ok(message);
    },
  ],

  // ---- 인증 ----
  [
    'POST',
    '/auth/login',
    ({ body }) => {
      const email = String(body.email ?? '')
        .trim()
        .toLowerCase();
      const password = String(body.password ?? '');
      if (!email || !password)
        return fail(422, 'INVALID_INPUT', '이메일과 비밀번호를 입력해 주세요.');
      const user = getDb().users.find((u) => u.email === email);
      if (!user || user.password !== password) {
        return fail(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않아요.');
      }
      if (user.status !== 'active')
        return fail(403, 'ACCOUNT_SUSPENDED', '이용이 제한된 계정이에요.');
      return ok({ token: `mock-user-token:${user.userId}`, user: toUser(user) });
    },
  ],
  [
    'POST',
    '/auth/signup',
    ({ body }) => {
      const db = getDb();
      const email = String(body.email ?? '')
        .trim()
        .toLowerCase();
      const password = String(body.password ?? '');
      const nickname = String(body.nickname ?? '').trim();
      if (!EMAIL_RE.test(email))
        return fail(422, 'INVALID_EMAIL', '올바른 이메일 형식이 아니에요.');
      if (password.length < 8)
        return fail(422, 'INVALID_PASSWORD', '비밀번호는 8자 이상이어야 해요.');
      if (body.agreeTerms !== true) return fail(400, 'TERMS_REQUIRED', '약관에 동의해 주세요.');
      if (db.users.some((u) => u.email === email)) {
        return fail(409, 'EMAIL_DUPLICATED', '이미 가입된 이메일이에요.');
      }
      const seq = db.users.length + 1;
      const user = {
        userId: `u-${Date.now()}`,
        memberCode: `user${String(seq).padStart(3, '0')}`,
        email,
        password,
        nickname: nickname || email.split('@')[0],
        joinedAt: new Date().toISOString(),
        status: 'active' as const,
        taste: null,
      };
      db.users.push(user);
      commit();
      return ok({ token: `mock-user-token:${user.userId}`, user: toUser(user) }, 201);
    },
  ],
  [
    'GET',
    '/auth/me',
    (req) => {
      const user = currentUser(req);
      return user ? ok(toUser(user)) : unauthorized();
    },
  ],
  ['POST', '/auth/logout', () => ok(null)],
  [
    'POST',
    '/auth/password/forgot',
    ({ body }) => {
      const email = String(body.email ?? '').trim();
      if (!EMAIL_RE.test(email))
        return fail(422, 'INVALID_EMAIL', '올바른 이메일 형식이 아니에요.');
      // 계정 존재 여부를 노출하지 않기 위해 항상 성공 응답
      return ok({ sent: true, devResetToken: MOCK_RESET_TOKEN });
    },
  ],
  [
    'POST',
    '/auth/password/reset',
    ({ body }) => {
      if (body.token !== MOCK_RESET_TOKEN) {
        return fail(400, 'INVALID_RESET_TOKEN', '재설정 링크가 만료되었거나 올바르지 않아요.');
      }
      const password = String(body.password ?? '');
      if (password.length < 8)
        return fail(422, 'INVALID_PASSWORD', '비밀번호는 8자 이상이어야 해요.');
      return ok(null);
    },
  ],

  // ---- 내 정보 ----
  [
    'GET',
    '/me/taste',
    (req) => {
      const user = currentUser(req);
      if (!user) return unauthorized();
      return ok(user.taste);
    },
  ],
  [
    'PUT',
    '/me/taste',
    (req) => {
      const db = getDb();
      const user = currentUser(req);
      if (!user) return unauthorized();
      const tasteIds = (req.body.tasteIds as string[] | undefined) ?? [];
      if (tasteIds.length < 2) return fail(422, 'INVALID_INPUT', '취향을 2개 이상 선택해 주세요.');
      const keywords = db.tasteOptions
        .filter((t) => tasteIds.includes(t.tasteId))
        .flatMap((t) => t.keywords);
      user.taste = { tasteIds, keywords };
      commit();
      return ok(user.taste);
    },
  ],
  [
    'GET',
    '/me/visits',
    (req) => {
      const user = currentUser(req);
      if (!user) return unauthorized();
      const visits = getDb()
        .visits.filter((v) => v.userId === user.userId)
        .sort((a, b) => b.visitedAt.localeCompare(a.visitedAt))
        .map(({ userId: _userId, ...v }) => v);
      return ok(visits);
    },
  ],
  [
    'GET',
    '/me/visits/:visitId',
    (req) => {
      const user = currentUser(req);
      if (!user) return unauthorized();
      const visit = getDb().visits.find((v) => v.visitId === req.params.visitId);
      if (!visit) return fail(404, 'VISIT_NOT_FOUND', '관람 기록을 찾을 수 없어요.');
      if (visit.userId !== user.userId) return fail(403, 'FORBIDDEN', '접근 권한이 없어요.');
      const { userId: _userId, ...rest } = visit;
      return ok(rest);
    },
  ],
  [
    'POST',
    '/me/visits',
    (req) => {
      const db = getDb();
      const user = currentUser(req);
      if (!user) return unauthorized();
      const input = req.body as unknown as Omit<VisitRecord, 'visitId'>;
      const existing = db.visits.find(
        (v) => v.sessionId === input.sessionId && v.userId === user.userId,
      );
      if (existing) {
        const { userId: _userId, ...rest } = existing;
        return ok(rest);
      }
      const visit = { ...input, visitId: `v-${Date.now()}`, userId: user.userId };
      db.visits.push(visit);
      commit();
      const { userId: _userId, ...rest } = visit;
      return ok(rest, 201);
    },
  ],
];
