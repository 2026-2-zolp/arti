/**
 * API 통합 테스트: 메모리 DB로 서버를 띄워 실제 HTTP 요청을 보낸다.
 * 실행: npm test
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

process.env.ANTHROPIC_API_KEY = ''; // 테스트는 항상 규칙 기반 AI로 (외부 API 호출 없음)
process.env.DEMO_MODE = 'true';
process.env.RATE_LIMIT = 'off';

const { createApp } = await import('../src/app.js');
const { openDb } = await import('../src/db.js');

let base = '';
let close: () => void;

before(async () => {
  const server = createApp(openDb(':memory:')).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  close = () => server.close();
});
after(() => close());

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function login(email = 'demo@arti.app', password = 'arti1234') {
  const r = await call('POST', '/auth/login', { email, password });
  assert.equal(r.status, 200);
  return r.body as { user: { id: string }; token: string };
}
async function adminToken() {
  const r = await call('POST', '/admin/login', { id: 'admin', password: 'admin1234' });
  assert.equal(r.status, 200);
  return { 'X-Admin-Token': r.body.token as string };
}

describe('전시·작품 조회', () => {
  test('시드 전시와 작품이 조회된다', async () => {
    const ex = await call('GET', '/exhibitions/ex-mvp');
    assert.equal(ex.status, 200);
    assert.equal(ex.body.rooms.length, 4);
    const aws = await call('GET', '/artworks?exhibitionId=ex-mvp');
    assert.equal(aws.body.length, 12);
    assert.equal((await call('GET', '/exhibitions/nope')).status, 404);
  });
});

describe('추천', () => {
  test('관람 시간만큼, 검수 완료 + 위치 등록 작품만, 1부터 순서대로', async () => {
    const r = await call('POST', '/recommendations', { exhibitionId: 'ex-mvp', tastes: ['vivid', 'emotion'], duration: '60m' });
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 5);
    assert.deepEqual(r.body.map((x: { order: number }) => x.order), [1, 2, 3, 4, 5]);
    const ids = r.body.map((x: { artworkId: string }) => x.artworkId);
    assert.ok(!ids.includes('aw-11') && !ids.includes('aw-12'), '검수 미완료/위치 미등록 작품 제외');
  });

  test('잘못된 관람 시간은 400', async () => {
    const r = await call('POST', '/recommendations', { exhibitionId: 'ex-mvp', tastes: [], duration: '2h' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, '관람 시간을 선택해 주세요.');
  });
});

describe('회원', () => {
  test('회원가입 → 토큰으로 내 정보 조회, 비밀번호는 응답에 없음', async () => {
    const r = await call('POST', '/auth/signup', { email: 'New@Example.com', password: 'abcd1234', nickname: '새회원' });
    assert.equal(r.status, 201);
    assert.equal(r.body.user.email, 'new@example.com');
    assert.equal(r.body.user.password, undefined);
    assert.equal(r.body.user.passwordHash, undefined);
    const me = await call('GET', '/auth/me', undefined, bearer(r.body.token));
    assert.equal(me.body.nickname, '새회원');
    const dup = await call('POST', '/auth/signup', { email: 'new@example.com', password: 'abcd1234' });
    assert.equal(dup.status, 409);
  });

  test('약한 비밀번호는 거절', async () => {
    const r = await call('POST', '/auth/signup', { email: 'weak@example.com', password: 'abcdefgh' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, '비밀번호에 숫자를 포함해 주세요.');
  });

  test('틀린 비밀번호 / 없는 계정은 같은 메시지', async () => {
    const a = await call('POST', '/auth/login', { email: 'demo@arti.app', password: 'wrong1234' });
    const b = await call('POST', '/auth/login', { email: 'ghost@arti.app', password: 'wrong1234' });
    assert.equal(a.status, 401);
    assert.equal(a.body.error, b.body.error);
  });

  test('취향은 본인만 바꿀 수 있다', async () => {
    const { user, token } = await login();
    assert.equal((await call('PUT', `/users/${user.id}/tastes`, { tastes: ['light'] }, bearer(token))).status, 204);
    assert.deepEqual((await call('GET', '/auth/me', undefined, bearer(token))).body.tastes, ['light']);
    assert.equal((await call('PUT', '/users/u-2/tastes', { tastes: ['light'] }, bearer(token))).status, 403);
    assert.equal((await call('PUT', '/users/u-2/tastes', { tastes: ['light'] })).status, 401);
  });

  test('로그아웃하면 토큰이 무효', async () => {
    const { token } = await login();
    await call('POST', '/auth/logout', undefined, bearer(token));
    assert.equal((await call('GET', '/auth/me', undefined, bearer(token))).status, 401);
  });
});

describe('비밀번호 재설정', () => {
  test('요청 → 데모 토큰으로 변경 → 새 비밀번호로 로그인, 토큰 재사용 불가', async () => {
    const req = await call('POST', '/auth/password-reset/request', { email: 'minji@example.com' });
    assert.equal(req.status, 200);
    const token = req.body.demoToken as string;
    assert.ok(token);
    const old = await login('minji@example.com', 'password1');

    assert.equal((await call('POST', '/auth/password-reset/confirm', { token, password: 'newpass99' })).status, 204);
    await login('minji@example.com', 'newpass99');
    assert.equal((await call('GET', '/auth/me', undefined, bearer(old.token))).status, 401, '기존 세션 종료');
    assert.equal((await call('POST', '/auth/password-reset/confirm', { token, password: 'again1234' })).status, 400);
  });

  test('가입되지 않은 이메일도 같은 형태로 응답', async () => {
    const r = await call('POST', '/auth/password-reset/request', { email: 'nobody@example.com' });
    assert.equal(r.status, 200);
    assert.equal(r.body.demoToken, null);
  });
});

describe('관람 기록', () => {
  const record = {
    exhibitionId: 'ex-mvp',
    exhibitionTitle: '미술 초보자를 위한 맞춤형 관람',
    venue: 'ARTI 시범 전시관',
    date: new Date().toISOString(),
    durationMin: 30,
    viewedArtworkIds: ['aw-01', 'aw-02'],
    recommendedCount: 3,
    reactions: { 'aw-01': 'like' },
    longestViewedArtworkId: 'aw-01',
    keywords: ['강한 색감'],
  };

  test('로그인 사용자는 저장, userId는 토큰 기준(본문 위조 무시)', async () => {
    const { user, token } = await login();
    const saved = await call('POST', '/visits', { ...record, userId: 'u-2' }, bearer(token));
    assert.equal(saved.status, 201);
    assert.equal(saved.body.userId, user.id);
    const list = await call('GET', `/users/${user.id}/visits`, undefined, bearer(token));
    assert.ok(list.body.some((v: { id: string }) => v.id === saved.body.id));
    assert.equal((await call('GET', `/visits/${saved.body.id}`, undefined, bearer(token))).status, 200);
  });

  test('비회원은 영수증만 받고 저장되지 않음', async () => {
    const r = await call('POST', '/visits', { ...record, userId: null });
    assert.equal(r.status, 200);
    assert.equal(r.body.userId, null);
  });

  test('남의 기록은 볼 수 없고, 관리자는 볼 수 있음', async () => {
    const { token } = await login();
    assert.equal((await call('GET', '/users/u-2/visits', undefined, bearer(token))).status, 403);
    assert.equal((await call('GET', '/visits/v-3', undefined, bearer(token))).status, 403);
    const admin = await adminToken();
    assert.equal((await call('GET', '/users/u-2/visits', undefined, admin)).body.length, 1);
  });
});

describe('AI (규칙 기반)', () => {
  test('질문에 작품 자료 기반 답 + 출처', async () => {
    const r = await call('POST', '/artworks/aw-01/ask', { question: '누가 그렸나요?' });
    assert.equal(r.status, 200);
    assert.match(r.body.answer, /빈센트 반 고흐/);
    assert.match(r.body.answer, /출처: /);
    assert.equal((await call('POST', '/artworks/aw-01/ask', { question: '  ' })).status, 400);
  });

  test('맞춤 설명', async () => {
    const r = await call('POST', '/artworks/aw-02/explanation', { tastes: ['calm'] });
    assert.match(r.body.text, /수련/);
  });
});

describe('관리자', () => {
  const artwork = {
    id: '',
    exhibitionId: 'ex-mvp',
    title: '테스트 작품',
    artist: '테스트 작가',
    year: '2026',
    roomId: 'r1',
    position: { x: 10, y: 10 },
    palette: ['#111111'],
    tags: ['calm'],
    description: '설명',
    guidedLooking: ['질문'],
    source: '출처',
    referenceUrl: '',
    reviewStatus: 'pending',
  };

  test('토큰 없이는 수정 불가', async () => {
    assert.equal((await call('POST', '/admin/artworks', artwork)).status, 401);
    const { token } = await login();
    assert.equal((await call('POST', '/admin/artworks', artwork, bearer(token))).status, 401, '일반 사용자 토큰도 불가');
    assert.equal((await call('POST', '/admin/login', { id: 'admin', password: 'nope' })).status, 401);
  });

  test('작품 등록 → 수정(위치 지정) → 조회', async () => {
    const admin = await adminToken();
    const created = await call('POST', '/admin/artworks', artwork, admin);
    assert.equal(created.status, 201);
    assert.ok(created.body.id);
    const moved = await call('PUT', `/admin/artworks/${created.body.id}`, { ...created.body, position: { x: 55, y: 60 } }, admin);
    assert.deepEqual(moved.body.position, { x: 55, y: 60 });
    assert.deepEqual((await call('GET', `/artworks/${created.body.id}`)).body.position, { x: 55, y: 60 });
    assert.equal((await call('POST', '/admin/artworks', { ...artwork, exhibitionId: 'nope' }, admin)).status, 400);
  });

  test('전시 등록, 날짜 검증', async () => {
    const admin = await adminToken();
    const ex = { id: '', title: '새 전시', subtitle: '', venue: '본관', startDate: '2027-01-01', endDate: '2027-02-01', status: 'draft', rooms: [], entrance: { x: 50, y: 99 } };
    const created = await call('POST', '/admin/exhibitions', ex, admin);
    assert.equal(created.status, 201);
    assert.ok(created.body.id.startsWith('ex-'));
    const bad = await call('POST', '/admin/exhibitions', { ...ex, endDate: '2026-01-01' }, admin);
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, '종료일은 시작일보다 빠를 수 없어요.');
  });

  test('회원 조회·검색', async () => {
    const admin = await adminToken();
    const all = await call('GET', '/admin/members', undefined, admin);
    const demo = all.body.find((m: { email: string }) => m.email === 'demo@arti.app');
    assert.ok(demo.visitCount >= 2);
    const found = await call('GET', '/admin/members?q=민지', undefined, admin);
    assert.deepEqual(found.body.map((m: { nickname: string }) => m.nickname), ['민지']);
  });
});
