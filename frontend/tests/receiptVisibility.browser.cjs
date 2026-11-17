/** 격리된 PostgreSQL 합성 전시에서 공개 상태 변경과 첫 영수증 저장을 검증합니다. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const base = process.env.ARTI_REVIEW_BASE || 'http://127.0.0.1:5244';
const origin = new URL(base).origin;
const exhibitionId = 'fixture-ex01';
const exhibition = '/exhibitions/' + exhibitionId;
const fixtureMarker = 'ARTI DEVELOPMENT FIXTURE — NOT A REAL EXHIBITION';
const reason = '색감이 좋아요';

async function body(response, status = 200) {
  assert.equal(response.status(), status, await response.text());
  return response.json();
}

async function verify(browser, closed) {
  const page = await browser.newPage({ baseURL: base, viewport: { width: 360, height: 812 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(10000);
  const button = name => page.getByRole('button', { name, exact: true });
  const visit = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('arti.visit')));
  const errors = [];
  const attempts = [];
  page.on('pageerror', error => errors.push(error.message));
  let restore;
  try {
    const publicExhibition = await body(await page.request.get('/api' + exhibition));
    assert.equal(publicExhibition.subtitle, fixtureMarker);
    assert.deepEqual((await body(await page.request.get('/api/health'))).aiConfiguration, {
      docent: 'disabled', analysis: 'disabled',
    });
    const password = process.env.ARTI_BOOTSTRAP_PASSWORD;
    assert(password, 'set the synthetic receipt administrator password');
    const admin = await body(await page.request.post('/api/admin/login', {
      data: { id: 'receipt-snapshot-admin', password },
    }));
    const adminHeaders = { 'X-Admin-Token': admin.token };
    const { user, token } = await body(await page.request.post('/api/auth/signup', { data: {
      email: `receipt-visibility-${randomUUID()}@example.test`, password: 'Fixture-visit-2026!',
      termsAccepted: true, termsVersion: '2026-11-14-draft.1',
    } }));
    const memberHeaders = { Authorization: `Bearer ${token}` };
    await page.addInitScript(({ user, token }) => {
      let now = 0;
      performance.now = () => now;
      window.advanceReceiptDwell = seconds => { now += seconds * 1000; };
      localStorage.setItem('arti.user', JSON.stringify(user));
      localStorage.setItem('arti.token', JSON.stringify(token));
    }, { user, token });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.route(base + '/api/visits', async route => {
      const payload = route.request().postDataJSON();
      const upstream = await route.fetch({ maxRetries: 0 });
      attempts.push({ payload, status: upstream.status(), record: await upstream.json() });
      if (attempts.length === 1 && upstream.status() === 201) await route.abort('connectionreset');
      else await route.fulfill({ response: upstream });
    });

    await page.goto(exhibition + '/taste', { waitUntil: 'domcontentloaded' });
    for (let i = 1; i <= 5; i++) {
      await page.getByText(i + '/5', { exact: true }).waitFor();
      await page.locator('.duel-card').getByRole('button', { name: / 선택$/ }).first().click();
    }
    await button('이번 관람만 적용').click();
    await page.getByRole('radio', { name: /30분/ }).click();
    const [recommendation] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/recommendations')),
      button('추천 받기').click(),
    ]);
    assert.equal(recommendation.request().postDataJSON().tasteProfile.version, 2);
    const recommended = (await body(recommendation)).map(item => item.artworkId);
    assert.equal(recommended.length, 3);
    const work = await body(await page.request.get('/api/artworks/' + recommended[0]));
    await button('지도에서 관람순서 보기').click();
    await button('관람 시작하기').click();
    await page.getByRole('heading', { name: work.title, exact: true }).waitFor();
    await button('좋아요').click();
    await button(reason).click();
    await page.evaluate(() => window.advanceReceiptDwell(21));
    await button('다음 작품 안내').click();
    await button('2번 작품 감상하기').waitFor();
    const before = await visit();
    assert.deepEqual(before.viewed, recommended.slice(0, 1));
    assert.equal(before.dwell[work.id], 21);
    assert.equal(before.reactionReasons[work.id], reason);
    assert.ok(before.receiptArtworks[work.id].evidence);
    assert.equal(attempts.length, 0);

    const editedPath = '/api/admin' + (closed ? exhibition : '/artworks/' + work.id);
    const original = await body(await page.request.get(editedPath, { headers: adminHeaders }));
    assert.equal(closed ? original.subtitle : original.source, fixtureMarker);
    const changed = closed ? { status: 'closed' } : { reviewStatus: 'source_check' };
    const edit = await body(await page.request.put(editedPath, { headers: adminHeaders, data: { ...original, ...changed } }));
    restore = async () => body(await page.request.put(editedPath, {
      headers: adminHeaders, data: { ...original, version: edit.version },
    }));
    assert.equal((await page.request.get('/api/artworks/' + work.id)).status(), 404);
    if (closed) assert.equal((await page.request.get('/api' + exhibition)).status(), 404);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.goBack();
    await page.getByText('작품 정보를 불러오지 못했어요.', { exact: false }).waitFor();
    assert.deepEqual((await visit()).viewed, before.viewed);
    await page.goForward();
    if (closed) {
      await page.getByText('전시를 더 이상 관람할 수 없어요.').waitFor();
      await button('다시 시도하기').click();
      await button('지금까지 관람으로 마치기').click();
    } else {
      await button('2번 작품 감상하기').click();
      await button('다음 작품 안내').click();
      await button('3번 작품 감상하기').click();
      await button('관람 마치기').click();
    }

    const failure = '관람기록을 저장하지 못했어요';
    const saved = '관람기록에 저장되었어요';
    await page.getByText(failure, { exact: true }).waitFor();
    const first = attempts[0];
    assert.equal(first.status, 201);
    assert.equal(first.payload.visitId, before.visitId);
    const record = first.record;
    assert.deepEqual(record.viewedArtworkIds, closed ? recommended.slice(0, 1) : recommended);
    assert.equal(record.dwell[work.id], 21);
    assert.equal(record.reactions[work.id], 'like');
    assert.equal(record.reactionReasons[work.id], reason);
    assert.equal(record.exhibitionTitle, publicExhibition.title);
    assert.equal(record.artworkSnapshots[0].title, work.title);
    assert.equal(record.artworkSnapshots[0].imageUrl, undefined);
    assert.equal(record.artworkSnapshots[0].description, undefined);
    await page.locator('.receipt-works').getByText(work.title, { exact: false }).waitFor();
    const list = async () => body(await page.request.get(`/api/users/${user.id}/visits`, { headers: memberHeaders }));
    assert.deepEqual(await list(), [record]);

    await button('다시 저장').click();
    await page.getByText(saved, { exact: true }).waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(saved, { exact: true }).waitFor();
    await page.goBack();
    await page.getByRole('alertdialog').getByText('관람을 종료할까요?').waitFor();
    await button('머무르기').click();
    await page.getByText(saved, { exact: true }).waitFor();
    await page.locator('.receipt-works').getByText(work.title, { exact: false }).waitFor();
    assert.deepEqual(attempts.map(attempt => attempt.status), [201, 200, 200, 200]);
    for (const retry of attempts.slice(1)) {
      assert.deepEqual(retry.payload, first.payload);
      assert.deepEqual(retry.record, record);
    }
    assert.deepEqual(await list(), [record]);
    assert.deepEqual(await body(await page.request.get(`/api/admin/members/${user.id}/visits`, { headers: adminHeaders })), [record]);
    assert.deepEqual(await body(await page.request.get('/api/visits/' + record.id, { headers: memberHeaders })), record);
    await page.goto('/receipt/' + record.id, { waitUntil: 'domcontentloaded' });
    await page.locator('.receipt-works').getByText(work.title, { exact: false }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS ${closed ? 'closed exhibition' : 'hidden artwork'}: 201 → 200 × 3, one receipt, dwell and reaction preserved`);
  } catch (error) {
    console.error(page.url(), attempts.map(attempt => attempt.status));
    throw error;
  } finally {
    try { await restore?.(); }
    finally { await page.close(); }
  }
}

(async () => {
  assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Use a dedicated local synthetic environment.');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    await verify(browser, false);
    await verify(browser, true);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
