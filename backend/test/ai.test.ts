/**
 * AI 기능 통합 테스트 — 감정 분석 서버는 가짜 HTTP 서버로, Claude는 키 없이(대체 결과) 실행
 * 실행: npm test
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

// 가짜 감정 분석 서버: 해설 내용에 따라 정해진 점수를 돌려준다 (ai-service /analyze 와 같은 응답 형식)
let emotionCalls = 0;
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    emotionCalls += 1;
    const { description, imageUrl } = JSON.parse(raw);
    const base = { calm: 0.2, joy: 0.2, sadness: 0.1, tension: 0.1, awe: 0.3, nostalgia: 0.2 };
    const emotions = /수면|고요|새벽|조용/.test(description)
      ? { ...base, calm: 1, nostalgia: 0.6 }
      : /비명|불안|소용돌이/.test(description)
        ? { ...base, tension: 1, sadness: 0.7 }
        : { ...base, joy: 1 };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      emotions, imageScores: null, textScores: emotions, usedImage: Boolean(imageUrl), imageError: null,
      models: { image: 'fake-clip', text: 'fake-nli' },
    }));
  });
});
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));

process.env.ANTHROPIC_API_KEY = '';
process.env.RATE_LIMIT = 'off';
process.env.EMOTION_SERVICE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

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
after(() => {
  close();
  fake.close();
});

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
async function admin() {
  const r = await call('POST', '/admin/login', { id: 'admin', password: 'admin1234' });
  return { 'X-Admin-Token': r.body.token as string };
}

describe('작품 AI 분석 (A-04)', () => {
  test('분석하면 감정 점수·요약이 「AI 제안」으로 저장되고, 확정 전에는 추천에 쓰이지 않는다', async () => {
    const h = await admin();
    const r = await call('POST', '/admin/artworks/aw-02/analyze', {}, h);
    assert.equal(r.status, 200);
    assert.equal(r.body.emotion.ok, true);
    assert.equal(r.body.summary.source, 'fallback'); // 키가 없으면 원문 앞 2문장
    const w = r.body.artwork;
    assert.equal(w.emotionStatus, 'suggested');
    assert.equal(w.analysis.emotions.calm, 1); // 수련 해설에 '수면'
    assert.equal(w.summaryStatus, 'suggested');
    assert.ok(w.description.startsWith(w.summary.split(' ')[0]));

    const rec = await call('POST', '/recommendations', { exhibitionId: 'ex-mvp', tastes: ['calm'], duration: '60m' });
    assert.ok(rec.body.every((x: { similarity: number | null }) => x.similarity === null), '확정 전에는 태그 기반');
  });

  test('관리자 토큰 없이는 분석할 수 없다', async () => {
    assert.equal((await call('POST', '/admin/artworks/aw-02/analyze', {})).status, 401);
  });

  test('감정 분석 결과 없이 확정하면 400', async () => {
    const h = await admin();
    const w = (await call('GET', '/artworks/aw-05')).body;
    const r = await call('PUT', '/admin/artworks/aw-05', { ...w, emotionStatus: 'confirmed' }, h);
    assert.equal(r.status, 400);
    assert.equal(r.body.error, '감정 분석 결과가 없으면 확정할 수 없어요.');
  });
});

describe('전시 일괄 분석·확정 → 감정 기반 추천', () => {
  test('일괄 분석 후 확정하면 추천이 감정 유사도로 바뀐다', async () => {
    const h = await admin();
    const all = await call('POST', '/admin/exhibitions/ex-mvp/analyze', {}, h);
    assert.equal(all.status, 200);
    assert.equal(all.body.analyzed, all.body.total);
    assert.equal(all.body.errors.length, 0);

    const conf = await call('POST', '/admin/exhibitions/ex-mvp/confirm-ai', {}, h);
    assert.ok(conf.body.confirmed >= 10);

    const rec = await call('POST', '/recommendations', { exhibitionId: 'ex-mvp', tastes: ['calm', 'soft'], duration: '30m' });
    assert.equal(rec.status, 200);
    assert.equal(rec.body.length, 3);
    for (const x of rec.body) {
      assert.equal(typeof x.similarity, 'number');
      assert.ok(x.matchedEmotions.includes('calm'), `${x.artworkId}은(는) 평온 기반 추천이어야 함`);
      assert.match(x.reason, /평온/);
    }
    // 평온 취향에 '불안·비명' 작품(절규)은 추천되지 않는다
    assert.ok(!rec.body.some((x: { artworkId: string }) => x.artworkId === 'aw-07'));
  });

  test('확정 후 공식 해설을 바꾸면 다시 「AI 제안」으로 돌아간다', async () => {
    const h = await admin();
    const w = (await call('GET', '/artworks/aw-01')).body;
    assert.equal(w.emotionStatus, 'confirmed');
    const r = await call('PUT', '/admin/artworks/aw-01', { ...w, description: `${w.description} 추가 설명.` }, h);
    assert.equal(r.body.emotionStatus, 'suggested');
    assert.equal(r.body.summaryStatus, 'suggested');
    const same = await call('PUT', '/admin/artworks/aw-02', (await call('GET', '/artworks/aw-02')).body, h);
    assert.equal(same.body.emotionStatus, 'confirmed', '해설이 그대로면 확정 유지');
  });

  test('확정된 감정은 AI 질문(규칙 기반)에도 쓰인다', async () => {
    const r = await call('POST', '/artworks/aw-02/ask', { question: '이 작품은 어떤 분위기예요?' });
    assert.match(r.body.answer, /AI 감정 분석/);
    assert.match(r.body.answer, /평온/);
  });
});

describe('아트 영수증 AI 해석 (U-12)', () => {
  test('본 작품의 감정 프로필과 해석 문장을 돌려주고, 관람기록에 함께 저장된다', async () => {
    const viewed = ['aw-02', 'aw-05', 'aw-07'];
    const r = await call('POST', '/visits/interpret', {
      viewedArtworkIds: viewed,
      reactions: { 'aw-02': 'like', 'aw-07': 'dislike' },
      dwell: { 'aw-02': 200, 'aw-05': 60, 'aw-07': 10 },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.source, 'fallback');
    assert.equal(r.body.emotionProfile.calm, 1, '👍·오래 본 평온 작품이 가장 크게 반영');
    assert.match(r.body.text, /평온/);
    assert.match(r.body.text, /수련/);

    const login = await call('POST', '/auth/login', { email: 'demo@arti.app', password: 'arti1234' });
    const saved = await call(
      'POST', '/visits',
      {
        exhibitionId: 'ex-mvp', exhibitionTitle: 't', venue: 'v', date: new Date().toISOString(), durationMin: 10,
        viewedArtworkIds: viewed, recommendedCount: 3, reactions: { 'aw-02': 'like' }, longestViewedArtworkId: 'aw-02',
        keywords: [], interpretation: r.body.text, emotionProfile: r.body.emotionProfile,
      },
      { Authorization: `Bearer ${login.body.token}` },
    );
    assert.equal(saved.status, 201);
    const back = await call('GET', `/visits/${saved.body.id}`, undefined, { Authorization: `Bearer ${login.body.token}` });
    assert.equal(back.body.interpretation, r.body.text);
    assert.equal(back.body.emotionProfile.calm, 1);
  });
});

describe('감정 분석 서버가 꺼져 있을 때', () => {
  test('분석은 실패 이유를 알려 주고, 요약은 그대로 저장된다', async () => {
    const before = emotionCalls;
    fake.closeAllConnections();
    await new Promise<void>((r) => fake.close(() => r()));
    const h = await admin();
    const prevStatus = (await call('GET', '/artworks/aw-12')).body.emotionStatus;
    const r = await call('POST', '/admin/artworks/aw-12/analyze', {}, h);
    assert.equal(r.status, 200);
    assert.equal(r.body.emotion.ok, false);
    assert.match(r.body.emotion.error, /감정 분석 서버에 연결할 수 없어요/);
    assert.equal(r.body.summary.ok, true);
    assert.equal(r.body.artwork.emotionStatus, prevStatus, '분석 실패 시 기존 감정 분석 상태는 그대로');
    assert.equal(emotionCalls, before);

    const all = await call('POST', '/admin/exhibitions/ex-mvp/analyze', {}, h);
    assert.equal(all.body.errors.length, 1, '연결 실패 시 첫 작품에서 중단');
  });
});
