/**
 * AI 기능 통합 테스트 — AI 분석 서버는 가짜 HTTP 서버로, Claude는 키 없이(대체 결과) 실행
 * 실행: npm test
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

// 가짜 AI 분석 서버: 해설 내용에 따라 정해진 감정·태그 점수를 돌려준다 (ai-service /analyze 와 같은 응답 형식)
let emotionCalls = 0;
let lastEmotionRequest: { imageBase64?: string; imageUrl?: string } = {};
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    emotionCalls += 1;
    lastEmotionRequest = JSON.parse(raw);
    const { description, imageUrl, imageBase64 } = lastEmotionRequest as { description: string; imageUrl?: string; imageBase64?: string };
    const base = { calm: 0.2, joy: 0.2, sadness: 0.1, tension: 0.1, awe: 0.3, nostalgia: 0.2 };
    const emotions = /수면|고요|새벽|조용/.test(description)
      ? { ...base, calm: 1, nostalgia: 0.6 }
      : /비명|불안|소용돌이/.test(description)
        ? { ...base, tension: 1, sadness: 0.7 }
        : { ...base, joy: 1 };
    const t0 = { landscape: 0.1, people: 0.1, abstract: 0.1, light: 0.1, vivid: 0.1, cool: 0.1, warm: 0.1, soft: 0.1 };
    const tags = /수면|고요|새벽|조용/.test(description)
      ? { ...t0, landscape: 0.9, cool: 0.8, soft: 0.7, light: 0.6 }
      : /비명|불안|소용돌이/.test(description)
        ? { ...t0, people: 0.9, vivid: 0.85, warm: 0.7 }
        : { ...t0, warm: 0.8, vivid: 0.7, people: 0.6 };
    const usedImage = Boolean(imageUrl || imageBase64);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      emotions, imageScores: null, textScores: emotions, usedImage, imageError: null,
      models: { image: 'fake-clip', text: 'fake-nli' }, tags, tagSource: usedImage ? 'image' : 'text',
    }));
  });
});
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));

process.env.ANTHROPIC_API_KEY = '';
process.env.RATE_LIMIT = 'off';
process.env.EMOTION_SERVICE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
const fs = await import('node:fs');
const os = await import('node:os');
const pathMod = await import('node:path');
process.env.UPLOAD_DIR = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'arti-uploads-'));

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
  test('분석하면 태그·감정 점수·요약이 「AI 제안」으로 저장되고, 확정 전에는 추천에 쓰이지 않는다', async () => {
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
    assert.equal(w.tagStatus, 'suggested');
    assert.equal(w.analysis.tags.landscape, 0.9);
    assert.equal(w.analysis.tagSource, 'text');
    assert.deepEqual(w.tags, ['landscape', 'soft', 'light'], '확정 전에는 관리자 태그가 그대로');

    const rec = await call('POST', '/recommendations', { exhibitionId: 'ex-mvp', tastes: ['landscape'], duration: '60m' });
    assert.ok(rec.body.every((x: { aiTags: boolean }) => !x.aiTags), '확정 전에는 관리자가 켠 태그(1/0)로만 추천');
  });

  test('AI 태그를 확정하면 관리자가 바꾼 태그는 켬 1 / 끔 0, 그대로 둔 태그는 AI 점수', async () => {
    const h = await admin();
    const w = (await call('GET', '/artworks/aw-02')).body;
    // AI 제안: 풍경 .9 · 차가운 .8 · 부드러운 .7 · 빛 .6 → 관리자가 '인물'을 켜고 '차가운'·'부드러운'을 끔
    const r = await call('PUT', '/admin/artworks/aw-02', { ...w, tagStatus: 'confirmed', tags: ['landscape', 'light', 'people'], tagScores: null }, h);
    assert.equal(r.status, 200);
    const s = r.body.tagScores;
    assert.deepEqual([s.landscape, s.light, s.people, s.cool, s.soft, s.warm], [0.9, 0.6, 1, 0, 0, 0.1]);

    const rec = await call('POST', '/recommendations', { exhibitionId: 'ex-mvp', tastes: ['landscape', 'light'], duration: '60m' });
    const x = rec.body.find((y: { artworkId: string }) => y.artworkId === 'aw-02');
    assert.equal(x.aiTags, true);
    assert.equal(x.score, 0.75); // (0.9 + 0.6) / 2

    // AI 태그 분석이 없는 작품은 태그 확정 불가
    const w5 = (await call('GET', '/artworks/aw-05')).body;
    const bad = await call('PUT', '/admin/artworks/aw-05', { ...w5, tagStatus: 'confirmed' }, h);
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'AI 태그 분석 결과가 없으면 확정할 수 없어요.');
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

describe('전시 일괄 분석·확정 → 태그 기반 추천', () => {
  test('일괄 분석 후 확정하면 추천이 AI 태그 점수로 바뀐다', async () => {
    const h = await admin();
    const all = await call('POST', '/admin/exhibitions/ex-mvp/analyze', {}, h);
    assert.equal(all.status, 200);
    assert.equal(all.body.analyzed, all.body.total);
    assert.equal(all.body.errors.length, 0);

    const conf = await call('POST', '/admin/exhibitions/ex-mvp/confirm-ai', {}, h);
    assert.ok(conf.body.confirmed >= 10);

    // 일괄 확정은 AI가 "해당함"으로 본 태그를 그대로 켠다 (aw-05: 해설에 '새벽' → 풍경·차가운·부드러운·빛)
    const w5 = (await call('GET', '/artworks/aw-05')).body;
    assert.equal(w5.tagStatus, 'confirmed');
    assert.deepEqual(w5.tags, ['landscape', 'cool', 'soft', 'light']);

    const rec = await call('POST', '/recommendations', { exhibitionId: 'ex-mvp', tastes: ['landscape', 'cool'], duration: '30m' });
    assert.equal(rec.status, 200);
    assert.equal(rec.body.length, 3);
    assert.ok(rec.body.every((x: { aiTags: boolean }) => x.aiTags));
    assert.ok(rec.body.some((x: { artworkId: string }) => x.artworkId === 'aw-05'));
    // 풍경·차가운 취향에 '불안·비명' 작품(절규: 인물·강렬·따뜻)은 추천되지 않는다
    assert.ok(!rec.body.some((x: { artworkId: string }) => x.artworkId === 'aw-07'));
  });

  test('성격이 다른 카드를 고르면 카드마다 그 태그가 있는 작품이 최소 1점씩 들어간다', async () => {
    const rec = await call('POST', '/recommendations', { exhibitionId: 'ex-mvp', tastes: ['cool', 'warm'], duration: '30m' });
    assert.equal(rec.status, 200);
    const cards = rec.body.map((x: { matchedCard: string | null }) => x.matchedCard);
    assert.ok(cards.includes('cool') && cards.includes('warm'), `두 카드가 모두 반영되어야 함: ${cards}`);
    const cool = rec.body.find((x: { matchedCard: string }) => x.matchedCard === 'cool');
    assert.match(cool.reason, /차가운 색감/);
  });

  test('확정 후 공식 해설을 바꾸면 다시 「AI 제안」으로 돌아간다', async () => {
    const h = await admin();
    const w = (await call('GET', '/artworks/aw-01')).body;
    assert.equal(w.emotionStatus, 'confirmed');
    const r = await call('PUT', '/admin/artworks/aw-01', { ...w, description: `${w.description} 추가 설명.` }, h);
    assert.equal(r.body.emotionStatus, 'suggested');
    assert.equal(r.body.summaryStatus, 'suggested');
    assert.equal(r.body.tagStatus, 'suggested');
    assert.equal(r.body.tagScores, null, '태그 확정이 풀리면 관리자가 켠 태그(1/0)로 추천');
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

describe('작품 이미지 업로드 (캡처 이미지)', () => {
  // 1×1 PNG
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const upload = (id: string, body: Buffer, type: string, headers: Record<string, string>) =>
    fetch(`${base}/admin/artworks/${id}/image`, { method: 'POST', headers: { 'Content-Type': type, ...headers }, body });

  test('올린 이미지를 저장·제공하고, AI 분석 때 파일 내용을 감정 분석 서버로 보낸다', async () => {
    const h = await admin();
    const res = await upload('aw-02', PNG, 'image/png', h);
    assert.equal(res.status, 200);
    const w = await res.json();
    assert.match(w.imageFile, /^aw-02-[0-9a-f]+\.png$/);
    assert.equal(w.emotionStatus, 'suggested', '이미지가 바뀌면 확정 해제');

    const img = await fetch(`${base}/uploads/${w.imageFile}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');

    const r = await call('POST', '/admin/artworks/aw-02/analyze', { useImage: true }, h);
    assert.equal(r.body.artwork.analysis.usedImage, true);
    assert.equal(lastEmotionRequest.imageBase64, PNG.toString('base64'));
    await call('POST', '/admin/artworks/aw-02/analyze', { useImage: false }, h);
    assert.equal(lastEmotionRequest.imageBase64, undefined, '「이미지도 분석」을 끄면 보내지 않음');

    const del = await call('DELETE', '/admin/artworks/aw-02/image', undefined, h);
    assert.equal(del.body.imageFile, null);
    const gone = await fetch(`${base}/uploads/${w.imageFile}`);
    assert.equal(gone.status, 404);
  });

  test('이미지가 아닌 파일·권한 없는 요청은 거절', async () => {
    const h = await admin();
    assert.equal((await upload('aw-02', Buffer.from('hello'), 'text/plain', h)).status, 415);
    assert.equal((await upload('aw-02', Buffer.from('not really a png'), 'image/png', h)).status, 415);
    assert.equal((await upload('aw-02', PNG, 'image/png', {})).status, 401);
    const traversal = (await fetch(`${base}/uploads/..%2Farti.db`)).status;
    assert.ok(traversal === 403 || traversal === 404, `업로드 폴더 밖 파일은 접근 불가 (${traversal})`);
  });

  test('평면도 이미지를 올리면 전시에 저장되고, 전시 정보 수정으로는 바뀌지 않는다', async () => {
    const h = await admin();
    const plan = (q: string, headers = h) =>
      fetch(`${base}/admin/exhibitions/ex-mvp/floor-plan${q}`, { method: 'POST', headers: { 'Content-Type': 'image/png', ...headers }, body: PNG });
    assert.equal((await plan('')).status, 400, '이미지 크기(width·height) 필요');
    assert.equal((await plan('?width=1200&height=800', {})).status, 401);

    const res = await plan('?width=1200&height=800');
    assert.equal(res.status, 200);
    const ex = await res.json();
    assert.match(ex.floorPlan.file, /^ex-mvp-plan-[0-9a-f]+\.png$/);
    assert.deepEqual([ex.floorPlan.width, ex.floorPlan.height], [1200, 800]);
    assert.equal((await fetch(`${base}/uploads/${ex.floorPlan.file}`)).status, 200);

    // 전시실 이름만 있는 전시실(사각형 없음)도 저장되고, 평면도는 그대로 유지
    const rooms = [...ex.rooms, { id: 'r5', name: '야외 조각정원' }];
    const put = await call('PUT', '/admin/exhibitions/ex-mvp', { ...ex, rooms, floorPlan: null, entrance: { x: 10, y: 90 } }, h);
    assert.equal(put.status, 200);
    assert.equal(put.body.floorPlan.file, ex.floorPlan.file);
    assert.equal(put.body.rooms.at(-1).name, '야외 조각정원');
    assert.deepEqual((await call('GET', '/exhibitions/ex-mvp')).body.entrance, { x: 10, y: 90 });

    const del = await call('DELETE', '/admin/exhibitions/ex-mvp/floor-plan', undefined, h);
    assert.equal(del.body.floorPlan, null);
    assert.equal((await fetch(`${base}/uploads/${ex.floorPlan.file}`)).status, 404);
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
