/** Chrome → Django/PostgreSQL → loopback provider receipt regression. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const origin = new URL(process.env.ARTI_REVIEW_BASE || 'http://127.0.0.1:5553').origin;
const exhibition = '/exhibitions/fixture-ex01';
const interpretPath = '/api/visits/interpret';
const password = 'Receipt-interpret-fixture-2026!';
const oldText = '기존 모의 감상 해석';
const newText = '재시도에 성공한 모의 감상 해석';

async function body(response, status = 200) {
  assert.equal(response.status(), status, await response.text());
  return response.json();
}

const isPost = (request, path) => request.method() === 'POST' && new URL(request.url()).pathname === path;
const button = (page, name) => page.getByRole('button', { name, exact: true });

async function signup(page) {
  return body(await page.request.post('/api/auth/signup', { data: {
    email: 'receipt-interpret-' + randomUUID() + '@example.test', password,
    termsAccepted: true, termsVersion: '2026-11-14-draft.1',
  } }));
}

async function switchMemberBeforeReply(page, record, visitId) {
  const other = await signup(page);
  let markHeld;
  let failHeld;
  let release;
  const held = new Promise((resolve, reject) => { markHeld = resolve; failHeld = reject; });
  const waitForSwitch = new Promise(resolve => { release = resolve; });
  const endpoint = origin + interpretPath;
  const holdReply = async route => {
    const upstream = await route.fetch({ maxRetries: 0, timeout: 5000 }).catch(error => {
      failHeld(error);
      return null;
    });
    if (!upstream) return route.abort();
    markHeld(upstream.status());
    await waitForSwitch;
    await route.fulfill({ response: upstream });
  };
  await page.route(endpoint, holdReply);
  const otherTab = await page.context().newPage();
  try {
    await button(page, '다시 해석하기').click();
    assert.equal(await held, 200);
    await otherTab.goto('/mypage');
    await button(otherTab, '로그아웃').click();
    await otherTab.waitForURL(origin + '/');
    await otherTab.goto('/login?redirect=/mypage');
    await otherTab.getByLabel('이메일', { exact: true }).fill(other.user.email);
    await otherTab.locator('input[type="password"]').fill(password);
    await button(otherTab, '로그인').click();
    await otherTab.waitForURL(origin + '/mypage');
    await page.waitForFunction(id => JSON.parse(sessionStorage.getItem('arti.visit'))?.ownerId === id, other.user.id);
    const reply = page.waitForResponse(response => isPost(response.request(), interpretPath));
    release();
    assert.equal((await body(await reply)).text, '계정 전환 뒤에 도착한 모의 감상 해석');
    assert.equal(await page.locator('.receipt-ai').count(), 0);
    assert.equal(await page.evaluate(id => Object.keys(sessionStorage).some(key => key.includes(id)), visitId), false);
    const headers = { Authorization: 'Bearer ' + other.token };
    assert.deepEqual(await body(await page.request.get('/api/users/' + other.user.id + '/visits', { headers })), []);
    assert.equal((await page.request.get('/api/visits/' + record.id, { headers })).status(), 403);
    console.log('PASS account switch: late original receipt response not shown or cached; other account receipt count 0');
  } finally {
    release();
    await page.unroute(endpoint, holdReply);
    await otherTab.close();
  }
}

async function verify(browser, member) {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 360, height: 812 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  const interpreted = [];
  const saved = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (isPost(request, interpretPath)) interpreted.push(request.postDataJSON());
    if (isPost(request, '/api/visits')) saved.push(request.postDataJSON());
  });
  try {
    const fixture = await page.request.get('/api' + exhibition);
    assert.equal(fixture.headers()['x-arti-receipt-mock'], '1', 'Start the local receipt provider and Vite proxy first.');
    assert.equal((await body(fixture)).subtitle, 'ARTI DEVELOPMENT FIXTURE — NOT A REAL EXHIBITION');
    const auth = member ? await signup(page) : null;
    const visitId = randomUUID();
    const dwell = { 'fixture-art01': member ? 21 : 29 };
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.addInitScript(({ auth, visitId, dwell }) => {
      if (sessionStorage.getItem('receipt-browser-fixture')) return;
      sessionStorage.setItem('receipt-browser-fixture', '1');
      if (auth) {
        localStorage.setItem('arti.user', JSON.stringify(auth.user));
        localStorage.setItem('arti.token', JSON.stringify(auth.token));
      }
      sessionStorage.setItem('arti.visit', JSON.stringify({
        visitId, exhibitionId: 'fixture-ex01', ownerId: auth?.user.id ?? null, requestGeneration: 1,
        duration: '30m', tastes: ['warm'], tasteDone: true, current: 1,
        recommendations: [{ artworkId: 'fixture-art01' }], viewed: ['fixture-art01'],
        reactions: { 'fixture-art01': 'like' }, reactionReasons: { 'fixture-art01': '색감' }, dwell,
        startedAt: Date.now() - 60000,
      }));
    }, { auth, visitId, dwell });

    const records = async () => body(await page.request.get('/api/users/' + auth.user.id + '/visits', {
      headers: { Authorization: 'Bearer ' + auth.token },
    }));
    const requestInterpret = name => Promise.all([
      page.waitForResponse(response => isPost(response.request(), interpretPath)),
      button(page, name).click(),
    ]).then(([response]) => response);
    const interpretation = page.locator('.receipt-ai');
    const works = page.locator('.receipt-works');
    await page.goto(exhibition + '/receipt');
    await works.waitFor();
    if (member) await page.getByText('관람기록에 저장되었어요', { exact: true }).waitFor();
    assert.equal(saved.length, member ? 1 : 0);

    assert.equal((await body(await requestInterpret('취향 해석 보기'))).text, oldText);
    await interpretation.getByText(oldText, { exact: true }).waitFor();
    const before = member ? await records() : [];
    if (member) {
      assert.equal(before.length, 1);
      assert.equal(before[0].visitId, visitId);
      assert.equal(before[0].interpretation, oldText);
      assert.deepEqual(before[0].dwell, dwell);
    }

    const failure = await body(await requestInterpret('다시 해석하기'), 502);
    assert.equal(failure.code, 'PROVIDER_ERROR');
    assert.doesNotMatch(JSON.stringify(failure), /upstream-private-debug/);
    await page.getByRole('alert').getByText(/기존 해석은 그대로 남아 있어요/).waitFor();
    assert.equal(await interpretation.textContent(), oldText);
    if (member) assert.deepEqual(await records(), before);

    assert.equal((await body(await requestInterpret('다시 시도'))).text, newText);
    await interpretation.getByText(newText, { exact: true }).waitFor();
    const canonicalRequest = { exhibitionId: 'fixture-ex01', visitId, viewedArtworkIds: ['fixture-art01'],
      reactions: { 'fixture-art01': 'like' }, dwell };
    assert.deepEqual(interpreted, Array(3).fill(canonicalRequest));
    assert.equal(saved.length, member ? 1 : 0, 'Interpretation and retry must not re-save a visit.');
    const expected = member ? [{ ...before[0], interpretation: newText }] : [];
    if (member) assert.deepEqual(await records(), expected);

    await page.reload();
    await interpretation.getByText(newText, { exact: true }).waitFor();
    if (member) {
      await page.getByText('관람기록에 저장되었어요', { exact: true }).waitFor();
      assert.deepEqual(await records(), expected);
      for (const payload of saved) assert.equal(payload.visitId, visitId);
    } else {
      assert.equal(saved.length, 0);
    }
    assert.equal(interpreted.length, 3, 'Reload must reuse the successful interpretation.');
    console.log(`PASS ${member ? 'member' : 'guest'}: 200 → 502 → 200; old text kept on failure, retry payload unchanged, reload kept new text; ${member ? 'one unchanged receipt except interpretation' : 'zero visit POSTs'}`);
    if (member) await switchMemberBeforeReply(page, expected[0], visitId);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

(async () => {
  assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname), 'Use a loopback synthetic environment.');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    await verify(browser, false);
    await verify(browser, true);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
