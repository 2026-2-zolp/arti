/** Chrome against a disposable V2 fixture database and a loopback Django build. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');

const base = new URL(process.env.ARTI_REVIEW_BASE || 'http://127.0.0.1:5277');
const exhibitionId = 'fixture-ex01';
const exhibition = '/exhibitions/' + exhibitionId;
const password = 'Fixture-visit-2026!';
const reason = '색감이 좋아요';
const repository = path.resolve(__dirname, '../..');
const fixtureMarker = 'ARTI DEVELOPMENT FIXTURE — NOT A REAL EXHIBITION';

async function body(response, status = 200) {
  assert.equal(response.status(), status, await response.text());
  return response.json();
}

// No browser-accessible expiry hook. The child process only updates the synthetic DB.
function fixtureCommand(code, values = {}) {
  const preamble = [
    'import os',
    'from arti.tests.visit_browser_server import require_visit_fixture',
    'require_visit_fixture()',
  ];
  const result = spawnSync(process.env.ARTI_TEST_PYTHON || 'python', [
    'backend-django/manage.py', 'shell', '-c', [...preamble, ...code].join('\n'),
  ], { cwd: repository, env: { ...process.env, ...values }, encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
}

async function checkEnvironment(page) {
  const fixture = await body(await page.request.get('/api' + exhibition));
  assert.equal(fixture.subtitle, fixtureMarker);
  assert.deepEqual((await body(await page.request.get('/api/health'))).aiConfiguration, {
    docent: 'disabled', analysis: 'disabled',
  });
}

async function openPage(browser) {
  const page = await browser.newPage({ baseURL: base.href, viewport: { width: 390, height: 812 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(10000);
  await page.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  return page;
}

const button = (page, name) => page.getByRole('button', { name, exact: true });
const visit = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('arti.visit')));
const pending = (page, key) => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), key);
const currentToken = page => page.evaluate(() => JSON.parse(localStorage.getItem('arti.token')));
const headersFor = token => ({ Authorization: `Bearer ${token}` });
const isResponse = (response, pathname, method) =>
  new URL(response.url()).pathname === pathname && response.request().method() === method;

async function newMember(page) {
  return body(await page.request.post('/api/auth/signup', { data: {
    email: `visit-boundaries-${randomUUID()}@example.test`, password,
    termsAccepted: true, termsVersion: '2026-11-14-draft.1',
  } }));
}

async function adminHeaders(page) {
  const password = process.env.ARTI_BOOTSTRAP_PASSWORD;
  assert(password, 'Set the password for the synthetic visit-boundaries-admin');
  const { token } = await body(await page.request.post('/api/admin/login', {
    data: { id: 'visit-boundaries-admin', password },
  }));
  return { 'X-Admin-Token': token };
}

async function login(page, member) {
  await page.getByLabel('이메일', { exact: true }).fill(member.user.email);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  const [response] = await Promise.all([
    page.waitForResponse(r => isResponse(r, '/api/auth/login', 'POST')),
    button(page, '로그인').click(),
  ]);
  assert.equal((await body(response)).user.id, member.user.id);
}

async function choosePairs(page, start = 1) {
  for (let index = start; index <= 5; index++) {
    await page.getByText(index + '/5', { exact: true }).waitFor();
    await page.locator('.duel-card').getByRole('button', { name: / 선택$/ }).first().click();
  }
}

async function recommend(page, duration = /30분/, status = 200) {
  await page.getByRole('radio', { name: duration }).click();
  const [response] = await Promise.all([
    page.waitForResponse(r => isResponse(r, '/api/recommendations', 'POST')),
    button(page, '추천 받기').click(),
  ]);
  assert.equal(response.request().postDataJSON().tasteProfile.version, 2);
  return body(response, status);
}

function expireMember(token, accountId) {
  fixtureCommand([
    'from datetime import timedelta',
    'from django.utils import timezone',
    'from arti.models import Session',
    'now = timezone.now()',
    'count = Session.objects.filter(token_hash=os.environ["ARTI_BROWSER_SESSION_HASH"], account_id=os.environ["ARTI_BROWSER_ACCOUNT_ID"], expires_at__gt=now).update(expires_at=now-timedelta(minutes=1))',
    'assert count == 1, "Expected to expire exactly one active browser session"',
  ], {
    ARTI_BROWSER_SESSION_HASH: createHash('sha256').update(token).digest('hex'),
    ARTI_BROWSER_ACCOUNT_ID: accountId,
  });
}

async function receiptSession(browser, switchAccount) {
  const page = await openPage(browser);
  const errors = [];
  const saves = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/visits' && request.method() === 'POST') saves.push(request.postDataJSON());
  });
  try {
    await checkEnvironment(page);
    const original = await newMember(page);
    const next = switchAccount ? await newMember(page) : original;
    const admin = await adminHeaders(page);
    const adminList = async member => body(await page.request.get(`/api/admin/members/${member.user.id}/visits`, { headers: admin }));
    await page.goto('/login');
    await login(page, original);
    await page.waitForURL(base.href);
    const token = await currentToken(page);
    assert(token && token !== original.token, 'The test must expire the session issued to Chrome');

    await page.goto(exhibition + '/taste');
    await choosePairs(page);
    await button(page, '취향 미리 확인').click();
    await button(page, '이번 관람만 적용').click();
    const recommended = (await recommend(page)).map(item => item.artworkId);
    assert.equal(new Set(recommended).size, 3);
    await button(page, '2D 지도에서 경로 보기').click();
    await button(page, '관람 시작하기').click();
    await button(page, '좋아요').click();
    await button(page, reason).click();
    await button(page, '다음 작품 안내').click();
    await button(page, '2번 작품 감상하기').click();
    await button(page, '다음 작품 안내').click();
    await button(page, '3번 작품 감상하기').click();

    const activeVisit = await visit(page);
    assert.equal(activeVisit.ownerId, original.user.id);
    assert.deepEqual(activeVisit.viewed, recommended.slice(0, 2));
    expireMember(token, original.user.id);
    const [expired] = await Promise.all([
      page.waitForResponse(r => isResponse(r, '/api/auth/me', 'GET')),
      button(page, '관람 마치기').click(),
    ]);
    assert.equal(expired.status(), 401);
    await page.getByText('로그인이 만료돼 저장하지 못했어요', { exact: true }).waitFor();
    assert.deepEqual(saves, []);
    const pendingKey = `arti.pendingReceipt.${original.user.id}.${activeVisit.visitId}`;
    const savedDraft = await pending(page, pendingKey);
    assert.equal(savedDraft.visitId, activeVisit.visitId);
    assert.deepEqual(savedDraft.viewedArtworkIds, recommended);
    assert.equal(savedDraft.reactionReasons[recommended[0]], reason);

    await button(page, '로그인하고 복구하기').click();
    await login(page, next);
    await page.waitForURL('**/mypage');
    const listPath = `/api/users/${next.user.id}/visits`;
    const activeToken = await currentToken(page);
    const list = async () => body(await page.request.get(listPath, { headers: headersFor(activeToken) }));
    assert.deepEqual(await list(), []);
    assert.deepEqual(saves, []);
    const recovery = button(page, '기록 확인 후 복구');
    if (switchAccount) {
      await recovery.waitFor({ state: 'hidden' });
      assert.equal(await pending(page, pendingKey), null);
      const denied = await page.request.get(`/api/users/${original.user.id}/visits`, { headers: headersFor(activeToken) });
      assert.equal(denied.status(), 403);
      const [reloaded] = await Promise.all([
        page.waitForResponse(r => isResponse(r, listPath, 'GET')),
        page.reload(),
      ]);
      assert.deepEqual(await body(reloaded), []);
      await recovery.waitFor({ state: 'hidden' });
      assert.equal(await pending(page, pendingKey), null);
      assert.deepEqual(saves, []);
      assert.deepEqual(await adminList(original), []);
      assert.deepEqual(await adminList(next), []);
    } else {
      await recovery.click();
      const [created] = await Promise.all([
        page.waitForResponse(r => isResponse(r, '/api/visits', 'POST')),
        button(page, '확인하고 계속').click(),
      ]);
      const record = await body(created, 201);
      await page.getByText('미저장 기록을 복구했어요.', { exact: true }).waitFor();
      assert.deepEqual(saves, [savedDraft]);
      assert.equal(record.visitId, activeVisit.visitId);
      assert.deepEqual(record.viewedArtworkIds, recommended);
      assert.deepEqual(await list(), [record]);
      assert.equal(await pending(page, pendingKey), null);
      const [reloaded] = await Promise.all([
        page.waitForResponse(r => isResponse(r, listPath, 'GET')),
        page.reload(),
      ]);
      assert.deepEqual(await body(reloaded), [record]);
      assert.deepEqual(saves, [savedDraft]);
      assert.deepEqual(await adminList(original), [record]);
    }
    assert.deepEqual(errors, []);
    console.log(switchAccount ? 'PASS expired session → other member: 0 save requests' :
      'PASS expired session → original member: original visit ID, one save and one receipt');
  } finally {
    await page.close();
  }
}

function reviseSurvey(ids) {
  fixtureCommand([
    'from pathlib import Path',
    'from tempfile import TemporaryDirectory',
    'from django.core.management import call_command',
    'from arti.models import SurveyPool',
    'import json',
    'pool = SurveyPool.objects.get(pk="fixture-survey", active=True)',
    'with TemporaryDirectory() as directory:',
    '    manifest = Path(directory) / "survey.json"',
    '    manifest.write_text(json.dumps(dict(id=pool.id, name=pool.name, artworkIds=json.loads(os.environ["ARTI_BROWSER_SURVEY_ORDER"]))), encoding="utf-8")',
    '    call_command("configure_taste_survey", manifest=str(manifest), expected_revision=pool.revision, activate=True)',
  ], { ARTI_BROWSER_SURVEY_ORDER: JSON.stringify(ids) });
}

async function chooseNewSurveyProfile(page) {
  await button(page, '취향 다시 선택').click();
  await choosePairs(page);
  await button(page, '취향 미리 확인').click();
  await button(page, '이 취향으로 계속').click();
}

async function surveyAndMap(browser) {
  const page = await openPage(browser);
  const errors = [];
  const saves = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/visits' && request.method() === 'POST') saves.push(request.postDataJSON());
  });
  let originalOrder;
  let surveyChanged = false;
  let changePlan;
  let headers;
  let originalWorks = [];
  const plan = '/api/admin' + exhibition + '/floor-plan?width=1&height=1';
  const updateWork = async (id, changes) => {
    const url = '/api/admin/artworks/' + id;
    const work = await body(await page.request.get(url, { headers }));
    assert.equal(work.source, fixtureMarker);
    return body(await page.request.put(url, { headers, data: { ...work, ...changes } }));
  };
  try {
    await checkEnvironment(page);
    headers = await adminHeaders(page);
    const initial = await body(await page.request.get('/api/taste-pool'));
    originalOrder = initial.pairs.flatMap(pair => [pair.leftId, pair.rightId]);
    assert.equal(new Set(originalOrder).size, 10);
    assert(initial.tieContext?.tieContextVersion, 'Enable V2 in the synthetic Django server');
    await page.goto(exhibition + '/taste');
    await choosePairs(page);
    reviseSurvey([...originalOrder.slice(2), ...originalOrder.slice(0, 2)]);
    surveyChanged = true;
    const updated = await body(await page.request.get('/api/taste-pool'));
    assert.notEqual(updated.poolVersion, initial.poolVersion);
    const [stale] = await Promise.all([
      page.waitForResponse(r => isResponse(r, '/api/taste-profiles/resolve', 'POST')),
      button(page, '취향 미리 확인').click(),
    ]);
    assert.equal(stale.request().postDataJSON().tasteProfile.poolVersion, initial.poolVersion);
    assert.equal(stale.status(), 409);
    await button(page, '조사 근거 다시 불러오기').click();
    await page.getByRole('status').getByText('조사 근거가 바뀌었어요. 고른 작품은 초안에 남아 있어요.').waitFor();
    await button(page, '작품을 처음부터 다시 고르기').click();
    await choosePairs(page);
    const [preview] = await Promise.all([
      page.waitForResponse(r => isResponse(r, '/api/taste-profiles/resolve', 'POST')),
      button(page, '취향 미리 확인').click(),
    ]);
    assert.equal(preview.status(), 200);
    assert.equal(preview.request().postDataJSON().tasteProfile.poolVersion, updated.poolVersion);
    await button(page, '이 취향으로 계속').click();

    const exPath = '/api/admin' + exhibition;
    const ex = await body(await page.request.get(exPath, { headers }));
    assert.equal(ex.subtitle, fixtureMarker);
    assert.equal(ex.floorPlan ?? null, null, 'Use the unmodified synthetic starting map');
    const allWorks = await body(await page.request.get('/api/artworks?exhibitionId=' + exhibitionId));
    originalWorks = allWorks.filter(work => work.position);
    const image = await page.request.get('/api/uploads/fixture-public.png');
    assert.equal(image.status(), 200);
    const png = await image.body();
    const upload = async version => body(await page.request.post(plan, {
      headers: { ...headers, 'Content-Type': 'image/png', 'If-Match': `"${version}"` }, data: png,
    }));
    const currentPlan = await upload(ex.version);
    changePlan = true;

    // Replacing a floor plan updates position/content versions of the works in the pool.
    assert.equal((await recommend(page, /여유롭게/, 409)).code, 'VERSION_CONFLICT');
    await chooseNewSurveyProfile(page);
    assert.deepEqual(await recommend(page, /여유롭게/), []);
    await page.getByText('지금 추천할 수 있는 작품이 없어요', { exact: true }).waitFor();
    await button(page, '2D 지도에서 경로 보기').waitFor({ state: 'hidden' });
    const placed = originalWorks.slice(0, 3);
    assert.equal(placed.length, 3);
    for (const [index, work] of placed.entries()) {
      await updateWork(work.id, { position: { x: 20 * (index + 1), y: 20 } });
    }
    const [retry] = await Promise.all([
      page.waitForResponse(r => isResponse(r, '/api/recommendations', 'POST')),
      button(page, '다시 시도하기').click(),
    ]);
    assert.equal((await body(retry, 409)).code, 'VERSION_CONFLICT');
    await chooseNewSurveyProfile(page);
    const recs = await recommend(page, /여유롭게/);
    assert.deepEqual(recs.map(item => item.artworkId), placed.map(work => work.id));
    await page.getByText('오늘의 관람 작품은 3점이에요.', { exact: true }).waitFor();
    await page.getByText('선택한 시간의 기준은 7점이에요. 지금 추천할 수 있는 작품만 안내해요.', { exact: true }).waitFor();
    const { tastes, tasteProfile } = await visit(page);
    for (const duration of ['30m', '60m']) {
      const picks = await body(await page.request.post('/api/recommendations', {
        data: { exhibitionId, tastes, tasteProfile, duration },
      }));
      assert.deepEqual(picks.map(item => item.artworkId), placed.map(work => work.id));
    }
    await button(page, '2D 지도에서 경로 보기').click();
    const floorMap = page.locator('.floor-map');
    await floorMap.locator('image').waitFor();
    assert((await floorMap.locator('image').getAttribute('href')).includes(currentPlan.floorPlan.file));
    assert.equal(await floorMap.locator('.fm-marker').count(), 3);
    await button(page, '관람 시작하기').click();
    await page.getByRole('heading', { name: placed[0].title, exact: true }).waitFor();
    await button(page, '좋아요').click();
    await button(page, reason).click();
    await button(page, '다음 작품 안내').click();
    await button(page, '2번 작품 감상하기').waitFor();
    const before = await visit(page);
    assert.deepEqual(before.viewed, [placed[0].id]);
    assert.equal(before.reactionReasons[placed[0].id], reason);

    const replacement = await upload(currentPlan.version);
    assert.notEqual(replacement.floorPlan.file, currentPlan.floorPlan.file);
    await page.reload();
    await page.getByText('작품 위치 정보가 부족해 이번 구간을 표시할 수 없어요.').waitFor();
    await updateWork(placed[1].id, { reviewStatus: 'source_check' });
    const [first, , third] = placed;
    await updateWork(first.id, { position: { x: 25, y: 40 } });
    await updateWork(third.id, { position: { x: 75, y: 60 } });
    assert.equal((await page.request.get('/api/artworks/' + placed[1].id)).status(), 404);
    await page.goBack();
    await page.getByRole('heading', { name: first.title, exact: true }).waitFor();
    await page.goForward();
    await page.getByText('추천 작품 정보를 불러올 수 없어요.').waitFor();
    await button(page, '다시 시도하기').click();
    await button(page, '이 작품 건너뛰기').click();
    await button(page, '3번 작품 감상하기').waitFor();
    assert((await floorMap.locator('image').getAttribute('href')).includes(replacement.floorPlan.file));
    await floorMap.locator('.fm-marker.done').getByText(first.title, { exact: true }).waitFor({ state: 'attached' });
    await floorMap.locator('.fm-marker.current').getByText(third.title, { exact: true }).waitFor({ state: 'attached' });
    const after = await visit(page);
    assert.equal(after.visitId, before.visitId);
    assert.deepEqual(after.viewed, before.viewed);
    assert.deepEqual(after.reactionReasons, before.reactionReasons);
    assert.deepEqual(after.recommendations, before.recommendations);
    await page.getByText('전체 지도와 관람 순서', { exact: true }).click();
    await page.locator('.route-list').getByText('건너뜀', { exact: true }).waitFor();
    await button(page, '3번 작품 감상하기').click();
    await page.getByRole('heading', { name: third.title, exact: true }).waitFor();
    await button(page, '관람 마치기').click();
    await page.locator('.receipt-works').getByText(third.title, { exact: false }).waitFor();
    assert.equal(await page.locator('.receipt-works').getByText(placed[1].title, { exact: false }).count(), 0);
    const finished = await visit(page);
    assert.deepEqual(finished.viewed, [first.id, third.id]);
    assert.equal(finished.reactionReasons[first.id], reason);
    assert.deepEqual(saves, []);
    assert.deepEqual(errors, []);
    console.log('PASS revised survey and changed map: 409 → V2, 0 → 3 of 7, next work hidden and skipped, guest saves 0');
  } finally {
    try {
      if (changePlan) {
        const current = await body(await page.request.get('/api/admin' + exhibition, { headers }));
        await body(await page.request.delete(plan, { headers: { ...headers, 'If-Match': `"${current.version}"` } }));
        for (const work of originalWorks) {
          await updateWork(work.id, { reviewStatus: work.reviewStatus ?? 'approved', position: work.position });
        }
      }
      if (surveyChanged) reviseSurvey(originalOrder);
    } finally {
      await page.close();
    }
  }
}

(async () => {
  assert(['127.0.0.1', 'localhost'].includes(base.hostname), 'Use a dedicated local synthetic environment.');
  const suite = process.argv[2] || 'all';
  assert(['all', 'receipt-session', 'survey-map'].includes(suite), 'Unknown Chrome suite');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    if (suite !== 'survey-map') {
      await receiptSession(browser, false);
      await receiptSession(browser, true);
    }
    if (suite !== 'receipt-session') await surveyAndMap(browser);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
