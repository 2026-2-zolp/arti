/** Chrome against a disposable V2 fixture database and a loopback Django build. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const { body, button, isResponse, choosePairs, recommend } = require('./visitBrowserHelpers.cjs');

const base = new URL(process.env.ARTI_REVIEW_BASE || 'http://127.0.0.1:5277');
const exhibitionId = 'fixture-ex01';
const exhibition = '/exhibitions/' + exhibitionId;
const password = 'Fixture-visit-2026!';
const reason = '색감이 좋아요';
const repository = path.resolve(__dirname, '../..');
const fixtureMarker = 'ARTI DEVELOPMENT FIXTURE — NOT A REAL EXHIBITION';

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

const pageOptions = { baseURL: base.href, viewport: { width: 390, height: 812 }, reducedMotion: 'reduce' };

async function openPage(browser, sharedContext) {
  const page = sharedContext ? await sharedContext.newPage() : await browser.newPage(pageOptions);
  page.setDefaultTimeout(10000);
  await page.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  return page;
}

const visit = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('arti.visit')));
const pending = (page, key) => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), key);
const currentToken = page => page.evaluate(() => JSON.parse(localStorage.getItem('arti.token')));
const headersFor = token => ({ Authorization: `Bearer ${token}` });

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
    await button(page, '지도에서 관람순서 보기').click();
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
    const history = page.getByRole('tabpanel');
    const emptyHistory = history.getByText('아직 저장된 관람기록이 없어요.', { exact: true });
    const receiptCards = history.getByRole('button', { name: /아트 영수증 보기/ });
    const reloadHistory = async () => {
      const [response] = await Promise.all([
        page.waitForResponse(r => isResponse(r, listPath, 'GET')),
        page.reload(),
      ]);
      // Read the reload's HTTP status without relying on Chromium retaining the response body.
      assert.equal(response.status(), 200);
    };
    if (switchAccount) {
      await recovery.waitFor({ state: 'hidden' });
      assert.equal(await pending(page, pendingKey), null);
      const denied = await page.request.get(`/api/users/${original.user.id}/visits`, { headers: headersFor(activeToken) });
      assert.equal(denied.status(), 403);
      await emptyHistory.waitFor();
      await reloadHistory();
      await emptyHistory.waitFor();
      assert.equal(await receiptCards.count(), 0);
      assert.deepEqual(await list(), []);
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
      await receiptCards.first().waitFor();
      await reloadHistory();
      await receiptCards.first().waitFor();
      assert.equal(await receiptCards.count(), 1);
      assert.deepEqual(await list(), [record]);
      assert.equal(await pending(page, pendingKey), null);
      await receiptCards.first().click();
      await page.waitForURL(new URL(`/receipt/${record.id}`, base).href);
      await page.getByRole('article', { name: '아트 영수증' }).waitFor();
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

function setFixtureTags(id, tags) {
  fixtureCommand([
    'import json',
    'from arti.management.commands.load_test_fixture import FIXTURE_SOURCE',
    'from arti.models import Artwork',
    'count = Artwork.objects.filter(pk=os.environ["ARTI_BROWSER_ARTWORK_ID"], source=FIXTURE_SOURCE).update(tags=json.loads(os.environ["ARTI_BROWSER_ARTWORK_TAGS"]))',
    'assert count == 1, "Update only one synthetic artwork"',
  ], { ARTI_BROWSER_ARTWORK_ID: id, ARTI_BROWSER_ARTWORK_TAGS: JSON.stringify(tags) });
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
    await button(page, '지도에서 관람순서 보기').waitFor({ state: 'hidden' });
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
    await button(page, '지도에서 관람순서 보기').click();
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

function createShortageExhibition(requested) {
  const id = `fixture-shortage-${requested}`;
  const eligible = Array.from({ length: requested - 1 }, (_, index) => ({
    id: `${id}-${index + 1}`, title: `합성 추천 작품 ${index + 1}`,
  }));
  const noPosition = { id: `${id}-unplaced`, title: '좌표 없는 합성 작품' };
  const hidden = { id: `${id}-hidden`, title: '비공개 합성 작품' };
  fixtureCommand([
    'import json',
    'from django.db import transaction',
    'from arti.management.commands.load_test_fixture import FIXTURE_SOURCE',
    'from arti.models import Artwork, Exhibition',
    'data = json.loads(os.environ["ARTI_BROWSER_SHORTAGE"])',
    'template = Exhibition.objects.get(pk="fixture-ex01", subtitle=FIXTURE_SOURCE)',
    'with transaction.atomic():',
    '    ex, _ = Exhibition.objects.get_or_create(pk=data["id"], defaults=dict(',
    '        title="Synthetic recommendation shortage", subtitle=FIXTURE_SOURCE, status="running",',
    '        start_date=template.start_date, end_date=template.end_date))',
    '    assert ex.subtitle == FIXTURE_SOURCE',
    '    for index, work in enumerate(data["works"], start=1):',
    '        unplaced = work["id"].endswith("-unplaced")',
    '        Artwork.objects.update_or_create(pk=work["id"], exhibition=ex, defaults=dict(',
    '            title=work["title"], artist="Synthetic artist", source=FIXTURE_SOURCE,',
    '            position_x=None if unplaced else index * 10, position_y=None if unplaced else 10,',
    '            review_status="source_check" if work["id"].endswith("-hidden") else "approved"))',
  ], { ARTI_BROWSER_SHORTAGE: JSON.stringify({ id, works: [...eligible, noPosition, hidden] }) });
  return { id, eligible, noPosition, hidden };
}

async function completeShortageVisit(browser, fixture, duration, requested, signedIn) {
  const { id, eligible, noPosition, hidden } = fixture;
  const page = await openPage(browser);
  const expectedIds = eligible.map(work => work.id);
  const expectedTitles = eligible.map(work => work.title);
  const numberedTitles = expectedTitles.map((title, index) => `${index + 1}. ${title}`);
  const saves = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/visits' && request.method() === 'POST') saves.push(request.postDataJSON());
  });
  try {
    await checkEnvironment(page);
    const publicWorks = await body(await page.request.get(`/api/artworks?exhibitionId=${id}`));
    assert.deepEqual(publicWorks.map(work => work.id).sort(), [...expectedIds, noPosition.id].sort());
    assert.equal(publicWorks.find(work => work.id === noPosition.id).position, null);
    assert.equal((await page.request.get('/api/artworks/' + hidden.id)).status(), 404);

    const member = signedIn ? await newMember(page) : null;
    if (member) {
      await page.goto('/login');
      await login(page, member);
      await page.waitForURL(base.href);
    }
    await page.goto(`/exhibitions/${id}/taste`);
    await choosePairs(page);
    await button(page, '취향 미리 확인').click();
    await button(page, member ? '이번 관람만 적용' : '이 취향으로 계속').click();
    const recs = await recommend(page, duration);
    assert.deepEqual(recs.map(item => item.artworkId), expectedIds);
    assert.deepEqual(recs.map(item => item.order), eligible.map((_, index) => index + 1));
    await page.getByText(`선택한 시간의 기준은 ${requested}점이에요. 지금 추천할 수 있는 작품만 안내해요.`, { exact: true }).waitFor();
    assert.deepEqual(await page.locator('.rec-list .rec-info strong').allTextContents(), numberedTitles);

    await button(page, '지도에서 관람순서 보기').click();
    const visitStart = await visit(page);
    assert.equal(visitStart.ownerId ?? null, member?.user.id ?? null);
    await page.locator('.route-details[open]').waitFor();
    assert.deepEqual(await page.locator('.route-list .route-title').allTextContents(), expectedTitles);
    assert.deepEqual(await page.locator('.floor-map .fm-marker title').allTextContents(), expectedTitles);

    for (const [index, work] of eligible.entries()) {
      await button(page, index === 0 ? '관람 시작하기' : `${index + 1}번 작품 감상하기`).click();
      await page.getByRole('heading', { name: work.title, exact: true }).waitFor();
      if (index < eligible.length - 1) {
        await button(page, '다음 작품 안내').click();
        await page.locator('.next-artwork h2').getByText(eligible[index + 1].title, { exact: true }).waitFor();
      }
    }

    const created = member ? page.waitForResponse(r => isResponse(r, '/api/visits', 'POST')) : null;
    await button(page, '관람 마치기').click();
    const record = created ? await body(await created, 201) : null;
    const receiptWorks = page.locator('.receipt-works li > span:first-child');
    const saveStatus = page.getByRole('status').getByText(member ? '관람기록에 저장되었어요' : /비회원 관람기록은 서버에 저장되지 않아요/);
    await receiptWorks.last().getByText(numberedTitles.at(-1), { exact: true }).waitFor();
    assert.deepEqual(await receiptWorks.allTextContents(), numberedTitles);
    const finished = await visit(page);
    assert.equal(finished.visitId, visitStart.visitId);
    assert.deepEqual(finished.viewed, expectedIds);
    await saveStatus.waitFor();
    await page.reload();
    await saveStatus.waitFor();
    assert.deepEqual(await receiptWorks.allTextContents(), numberedTitles);
    if (member) {
      assert(saves.length >= 1);
      for (const payload of saves) {
        assert.equal(payload.visitId, visitStart.visitId);
        assert.deepEqual(payload.viewedArtworkIds, expectedIds);
      }
      assert.equal(record.visitId, visitStart.visitId);
      assert.deepEqual(record.viewedArtworkIds, expectedIds);
      const headers = headersFor(await currentToken(page));
      assert.deepEqual(await body(await page.request.get(`/api/users/${member.user.id}/visits`, { headers })), [record]);
    } else {
      assert.deepEqual(saves, []);
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function recommendationShortage(browser) {
  for (const [requested, duration] of [[3, /30분/], [5, /1시간/], [7, /여유롭게/]]) {
    const fixture = createShortageExhibition(requested);
    await completeShortageVisit(browser, fixture, duration, requested, true);
    await completeShortageVisit(browser, fixture, duration, requested, false);
    console.log(`PASS V2 ${requested} → ${requested - 1}: no-coordinate and hidden works excluded, same map/receipt order, member record 1, guest saves 0`);
  }
}

async function completeTasteVisit(page, taste, owner) {
  await page.getByRole('radio', { name: /30분/ }).click();
  const [recommendation] = await Promise.all([
    page.waitForResponse(r => isResponse(r, '/api/recommendations', 'POST')),
    button(page, '추천 받기').click(),
  ]);
  assert.deepEqual(recommendation.request().postDataJSON().tasteProfile, taste.tasteProfile);
  const recommended = (await body(recommendation)).map(item => item.artworkId);
  assert.equal(new Set(recommended).size, 3);
  await button(page, '지도에서 관람순서 보기').click();
  await button(page, '관람 시작하기').click();
  for (const ordinal of [2, 3]) {
    await button(page, '다음 작품 안내').click();
    await button(page, `${ordinal}번 작품 감상하기`).click();
  }

  const [created] = await Promise.all([
    page.waitForResponse(r => isResponse(r, '/api/visits', 'POST')),
    button(page, '관람 마치기').click(),
  ]);
  const submitted = created.request().postDataJSON();
  const record = await body(created, 201);
  assert.equal(submitted.visitId, taste.visitId);
  assert.equal(submitted.tasteEvidenceReceipt, taste.visitEvidenceReceipt);
  assert.deepEqual(submitted.tasteProfile, taste.tasteProfile);
  assert.equal(record.userId, owner);
  assert.equal(record.visitId, taste.visitId);
  assert.deepEqual(record.viewedArtworkIds, recommended);
  assert.deepEqual(record.tastes, taste.tasteProfile.selectedTags);
  await page.getByRole('status').getByText('관람기록에 저장되었어요').waitFor();
  assert.equal(await page.locator('.receipt-works li').count(), recommended.length);
  await button(page, '관람 완료').click();
  await page.waitForURL(base.href + exhibition.slice(1));
  return record;
}

async function savedV2(browser) {
  const context = await browser.newContext(pageOptions);
  const page = await openPage(browser, context);
  const resolvePath = '/api/taste-profiles/resolve';
  const errors = [];
  const writes = [];
  let originalOrder;
  let surveyChanged = false;
  let tieWork;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'PUT' && /^\/api\/users\/[^/]+\/tastes$/.test(new URL(request.url()).pathname)) {
      writes.push(request.postDataJSON());
    }
  });
  const account = async () => body(await page.request.get('/api/auth/me', { headers: headersFor(await currentToken(page)) }));
  const tasteState = ({ tastes, tasteProfile, tasteProfileVersion }) => ({ tastes, tasteProfile, tasteProfileVersion });
  const resolved = async label => {
    const [response] = await Promise.all([
      page.waitForResponse(r => isResponse(r, resolvePath, 'POST')),
      button(page, label).click(),
    ]);
    const submitted = response.request().postDataJSON();
    const result = await body(response);
    assert.equal(submitted.exhibitionId, exhibitionId);
    assert(result.visitEvidenceReceipt, 'A V2 visit must have signed taste evidence');
    return { ...result, visitId: submitted.visitId, submitted: submitted.tasteProfile };
  };

  try {
    await checkEnvironment(page);
    const member = await newMember(page);
    const seed = await body(await page.request.get('/api/taste-pool'));
    originalOrder = seed.pairs.flatMap(pair => [pair.leftId, pair.rightId]);
    assert.equal(new Set(originalOrder).size, 10);
    const first = seed.artworks.find(artwork => artwork.id === seed.pairs[0].leftId);
    assert.deepEqual(first.tags, ['landscape']);
    // Three lefts and two rights now produce a 3:3 tie in the stored snapshot.
    setFixtureTags(first.id, [...first.tags, 'warm']);
    tieWork = first;
    const initial = await body(await page.request.get('/api/taste-pool'));
    assert(initial.tieContext?.tieContextVersion);

    await page.goto('/login');
    await login(page, member);
    await page.waitForURL(base.href);
    await page.goto(exhibition + '/taste');
    await choosePairs(page, 1, [0, 0, 0, 1, 1]);
    const preview = await resolved('취향 미리 확인');
    assert.equal(preview.tasteProfile.version, 2);
    assert.equal(preview.tasteProfile.source, 'picks');
    assert.equal(preview.tasteProfile.poolVersion, initial.poolVersion);
    assert.equal(preview.tasteProfile.tieContextVersion, initial.tieContext.tieContextVersion);
    assert.deepEqual(preview.tasteProfile.picks.map(pick => pick.artworkId), initial.pairs.map((pair, index) =>
      index < 3 ? pair.leftId : pair.rightId));
    assert.equal(preview.tasteProfile.counts.landscape, 3);
    assert.equal(preview.tasteProfile.counts.warm, 3);
    const savePath = `/api/users/${member.user.id}/tastes`;
    let committedStatus;
    // Let Django commit the first PUT before dropping only its response to Chrome.
    await page.route(new URL(savePath, base).href, async route => {
      const response = await route.fetch({ maxRetries: 0 });
      committedStatus = response.status();
      if (committedStatus === 204) await route.abort('connectionreset');
      else await route.fulfill({ response });
    }, { times: 1 });
    await button(page, '확인하고 계정에 저장').click();
    await page.getByRole('alert').getByText(/취향을 계정에 저장하지 못했어요/).waitFor();
    assert.equal(committedStatus, 204);
    const committed = tasteState(await account());
    assert.equal(committed.tasteProfileVersion, member.user.tasteProfileVersion + 1);
    assert.equal(writes.length, 1);
    assert.match(writes[0].clientMutationId, /^[0-9a-f-]{36}$/i);
    assert.equal(writes[0].expectedSavedProfileVersion, member.user.tasteProfileVersion);
    await Promise.all([
      page.waitForResponse(r => isResponse(r, '/api/taste-pool', 'GET') && r.ok()),
      page.reload(),
    ]);
    const [storedResponse] = await Promise.all([
      page.waitForResponse(r => isResponse(r, savePath, 'PUT')),
      button(page, '같은 요청으로 저장 재시도').click(),
    ]);
    assert.equal(storedResponse.status(), 204);
    await page.waitForURL('**' + exhibition + '/time');
    const stored = tasteState(await account());
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1], writes[0]);
    assert.deepEqual(stored, committed);
    assert.deepEqual(stored.tastes, preview.tasteProfile.selectedTags);
    assert.deepEqual(stored.tasteProfile.originalPicks, preview.tasteProfile.picks);
    assert.equal(stored.tasteProfile.originalPoolVersion, initial.poolVersion);
    assert.equal(stored.tasteProfile.tieContextVersion, initial.tieContext.tieContextVersion);
    assert.deepEqual(stored.tasteProfile.tieEvidence.orderedTags, preview.tagOrder);

    reviseSurvey([...originalOrder.slice(2), ...originalOrder.slice(0, 2)]);
    surveyChanged = true;
    const revised = await body(await page.request.get('/api/taste-pool'));
    assert.notEqual(revised.poolVersion, initial.poolVersion);
    assert.notEqual(revised.tieContext.tieContextVersion, initial.tieContext.tieContextVersion);
    assert.deepEqual(revised.pairs[0], initial.pairs[1]);

    const tokenBefore = await currentToken(page);
    await page.goto('/mypage');
    const [logout] = await Promise.all([
      page.waitForResponse(r => isResponse(r, '/api/auth/logout', 'POST')),
      button(page, '로그아웃').click(),
    ]);
    assert.equal(logout.status(), 204);
    await page.waitForURL(base.href);
    assert.equal((await page.request.get('/api/auth/me', { headers: headersFor(tokenBefore) })).status(), 401);
    await page.goto(exhibition + '/entry');
    await button(page, '로그인').click();
    await login(page, member);
    await page.waitForURL('**' + exhibition + '/taste/saved');
    assert.notEqual(await currentToken(page), tokenBefore);
    assert.deepEqual(tasteState(await account()), stored);
    await page.getByText('저장된 취향 키워드', { exact: true }).waitFor();

    const reused = await resolved('이 취향으로 관람 시작');
    assert.equal(reused.submitted.savedProfileVersion, stored.tasteProfileVersion);
    assert.equal(reused.tasteProfile.source, 'saved');
    assert.equal(reused.tasteProfile.poolVersion, null);
    assert.deepEqual(reused.tasteProfile.counts, stored.tasteProfile.counts);
    assert.deepEqual(reused.tagOrder, stored.tasteProfile.tieEvidence.orderedTags);
    assert(reused.groups.some(group => group.rule === 'frozen_snapshot'), 'The fixture must exercise a frozen tie');
    const fromSaved = await completeTasteVisit(page, reused, member.user.id);
    assert.deepEqual(fromSaved.tasteProfile, stored.tasteProfile);

    await page.goto(exhibition + '/taste/saved');
    await button(page, '태그 수정하기').click();
    const tags = page.getByLabel('수정할 취향 태그');
    await tags.getByRole('button', { pressed: false }).first().click();
    assert.equal(await tags.getByRole('button', { pressed: true }).count(), stored.tastes.length + 1);
    await resolved('취향 미리 확인');
    const manual = await resolved('이 취향으로 계속');
    assert.equal(manual.tasteProfile.version, 2);
    assert.equal(manual.tasteProfile.source, 'manual');
    assert.equal(manual.tasteProfile.poolVersion, null);
    assert.deepEqual(manual.tasteProfile.picks, []);
    assert.equal(manual.tasteProfile.selectedTags.length, stored.tastes.length + 1);
    assert(stored.tastes.every(tag => manual.tasteProfile.selectedTags.includes(tag)));
    assert.notEqual(manual.visitId, reused.visitId);
    assert.notEqual(manual.visitEvidenceReceipt, reused.visitEvidenceReceipt);
    const fromManual = await completeTasteVisit(page, manual, member.user.id);
    assert.deepEqual(fromManual.tasteProfile.selectedTags, manual.tasteProfile.selectedTags);
    assert.equal(fromManual.tasteProfile.source, 'manual');
    assert.notEqual(fromManual.id, fromSaved.id);
    assert.deepEqual(tasteState(await account()), stored);
    assert.equal(writes.length, 2);

    const rows = await body(await page.request.get(`/api/users/${member.user.id}/visits`, {
      headers: headersFor(await currentToken(page)),
    }));
    assert.deepEqual(rows, [fromManual, fromSaved]);
    await page.goto('/mypage');
    await page.locator('.history-card').nth(1).click();
    await page.waitForURL('**/receipt/' + fromSaved.id);
    await page.locator('.receipt-works li').nth(2).waitFor();

    await page.goto(exhibition + '/taste/saved');
    await page.getByText('저장된 취향 키워드', { exact: true }).waitFor();
    const beforeConflict = await visit(page);
    const oldTags = await page.getByLabel('저장된 취향').locator('.chip').allTextContents();
    const writer = await openPage(browser, context);
    writer.on('pageerror', error => errors.push(error.message));
    let releaseResolve;
    const resolveGate = new Promise(resolve => { releaseResolve = resolve; });
    let latest;
    try {
      await writer.goto(exhibition + '/taste');
      assert.equal(await currentToken(writer), await currentToken(page));
      await choosePairs(writer, 1, [1, 1, 1, 1, 1]);
      await button(writer, '취향 미리 확인').click();
      // The first tab has checked /api/auth/me when it reaches this request.
      await page.route(new URL(resolvePath, base).href, async route => {
        await resolveGate;
        await route.continue();
      }, { times: 1 });
      const staleRequest = page.waitForRequest(r => r.method() === 'POST' && new URL(r.url()).pathname === resolvePath);
      const staleResponse = page.waitForResponse(r => isResponse(r, resolvePath, 'POST'));
      await button(page, '이 취향으로 관람 시작').click();
      const stale = (await staleRequest).postDataJSON();
      assert.equal(stale.tasteProfile.savedProfileVersion, stored.tasteProfileVersion);
      assert.deepEqual(stale.tasteProfile.selectedTags, stored.tastes);
      const [writerSave] = await Promise.all([
        writer.waitForResponse(r => isResponse(r, savePath, 'PUT')),
        button(writer, '확인하고 계정에 저장').click(),
      ]);
      assert.equal(writerSave.status(), 204);
      latest = tasteState(await account());
      assert.equal(latest.tasteProfileVersion, stored.tasteProfileVersion + 1);
      assert.notDeepEqual([...latest.tastes].sort(), [...stored.tastes].sort(), 'The second tab must save different tags');
      releaseResolve();
      assert.equal((await body(await staleResponse, 409)).code, 'VERSION_CONFLICT');
      await page.getByRole('alert').getByText(/저장된 취향을 적용하지 못했어요/).waitFor();
      assert.deepEqual(await visit(page), beforeConflict);
    } finally {
      releaseResolve();
      await writer.close();
    }
    await button(page, '계정 최신 취향 확인').click();
    await page.waitForFunction(tags => {
      const labels = Array.from(document.querySelectorAll('[aria-label="저장된 취향"] .chip'), chip => chip.textContent);
      return labels.length > 0 && JSON.stringify(labels) !== JSON.stringify(tags);
    }, oldTags);
    await page.getByRole('alert').getByText(/저장된 취향을 적용하지 못했어요/).waitFor({ state: 'hidden' });
    assert.deepEqual(await visit(page), beforeConflict);
    const recovered = await resolved('이 취향으로 관람 시작');
    assert.equal(recovered.submitted.savedProfileVersion, latest.tasteProfileVersion);
    assert.deepEqual(recovered.tasteProfile.selectedTags, latest.tastes);
    await page.waitForURL('**' + exhibition + '/time');
    assert.equal((await visit(page)).visitId, recovered.visitId);
    assert.deepEqual(tasteState(await account()), latest);
    assert.equal(writes.length, 2);
    assert.deepEqual(await body(await page.request.get(`/api/users/${member.user.id}/visits`, {
      headers: headersFor(await currentToken(page)),
    })), rows);
    assert.deepEqual(errors, []);
    console.log('PASS saved V2: response lost after 204, identical PUT after reload, version increased once; frozen tie + visit-only receipt; two-tab 409 → latest taste, original receipts intact');
  } finally {
    try {
      if (surveyChanged) reviseSurvey(originalOrder);
    } finally {
      try {
        if (tieWork) setFixtureTags(tieWork.id, tieWork.tags);
      } finally {
        await context.close();
      }
    }
  }
}

async function exhibitionOrder(browser, memberVisit) {
  const page = await openPage(browser);
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST') requests.push(new URL(request.url()).pathname);
  });
  const ids = ['fixture-art03', 'fixture-art01', 'fixture-art05'];
  const setMiddleVisibility = reviewStatus => fixtureCommand([
    'from arti.models import Artwork',
    'work = Artwork.objects.get(pk="fixture-art01", exhibition_id="fixture-ex01")',
    'assert work.source == "ARTI DEVELOPMENT FIXTURE — NOT A REAL EXHIBITION"',
    'Artwork.objects.filter(pk=work.pk).update(review_status=os.environ["ARTI_BROWSER_REVIEW_STATUS"])',
  ], { ARTI_BROWSER_REVIEW_STATUS: reviewStatus });
  const readState = () => visit(page);
  let hidden = false;
  try {
    await page.setViewportSize({ width: 360, height: 760 });
    await checkEnvironment(page);
    assert.deepEqual((await body(await page.request.get('/api' + exhibition))).exhibitionOrder, ids);
    const works = await body(await page.request.get('/api/artworks?exhibitionId=' + exhibitionId));
    const title = id => works.find(work => work.id === id).title;
    const seeArtwork = id => page.getByRole('heading', { name: title(id), exact: true }).waitFor();
    const member = memberVisit ? await newMember(page) : null;
    if (member) {
      await page.goto('/login');
      await login(page, member);
      await page.waitForURL(base.href);
    }
    requests.length = 0;
    await page.goto(exhibition);
    await button(page, '전시 순서로 바로 보기').click();
    await page.waitForURL('**' + exhibition + '/artwork');
    await seeArtwork(ids[0]);
    assert.deepEqual(requests, []);
    assert.equal(await page.getByText('이 작품이 추천된 이유', { exact: true }).count(), 0);
    const initial = await readState();
    assert.equal(initial.visitMode, 'exhibition_order');
    assert.deepEqual(initial.recommendations.map(rec => rec.artworkId), ids);
    assert.ok(initial.startedAt);
    assert.equal(initial.duration, null);
    assert.equal(initial.ownerId, member?.user.id ?? null);

    await page.goBack();
    await button(page, '이어서 관람').click();
    await seeArtwork(ids[0]);
    assert.equal((await readState()).visitId, initial.visitId);

    const next = button(page, '다음 작품 안내');
    await next.click();
    await button(page, '2번 작품 감상하기').waitFor();
    assert.equal(await page.locator('.floor-map').count(), 0, 'next artwork does not require opening the map');
    await page.reload();
    await button(page, '2번 작품 감상하기').waitFor();
    assert.deepEqual((await readState()).viewed, [ids[0]]);
    await button(page, '뒤로가기').click();
    await seeArtwork(ids[0]);
    await next.click();
    await button(page, '2번 작품 감상하기').waitFor();
    await page.goBack();
    await seeArtwork(ids[0]);
    assert.equal((await readState()).visitId, initial.visitId);
    assert.deepEqual((await readState()).viewed, [ids[0]]);
    await page.goForward();
    await button(page, '2번 작품 감상하기').waitFor();

    setMiddleVisibility('pending');
    hidden = true;
    assert.deepEqual((await body(await page.request.get('/api' + exhibition))).exhibitionOrder, [ids[0], ids[2]]);
    await page.reload();
    await page.getByRole('alert').getByText('이 작품을 현재 볼 수 없어요.', { exact: true }).waitFor();
    await button(page, '이 작품 건너뛰기').click();
    await button(page, '3번 작품 감상하기').click();
    await seeArtwork(ids[2]);
    assert.deepEqual((await readState()).viewed, [ids[0]]);

    let firstReceipt;
    if (member) {
      await page.route('**/api/visits', async route => {
        const response = await route.fetch();
        firstReceipt = await body(response, 201);
        await route.abort('failed');
      }, { times: 1 });
    }
    await button(page, '관람 마치기').click();
    await page.getByText('전시 순서 안내', { exact: true }).waitFor();
    if (member) {
      await page.getByText('관람기록을 저장하지 못했어요', { exact: true }).waitFor();
      const [replay] = await Promise.all([
        page.waitForResponse(r => isResponse(r, '/api/visits', 'POST')),
        button(page, '다시 저장').click(),
      ]);
      const record = await body(replay);
      assert.equal(record.id, firstReceipt.id);
      assert.equal(record.visitId, initial.visitId);
      assert.equal(record.visitMode, 'exhibition_order');
      assert.equal(record.selectedDuration, null);
      assert.deepEqual(record.viewedArtworkIds, [ids[0], ids[2]]);
      await page.reload();
      await page.getByText('관람기록에 저장되었어요', { exact: true }).waitFor();
      const rows = await body(await page.request.get('/api/users/' + member.user.id + '/visits', {
        headers: headersFor(await currentToken(page)),
      }));
      assert.deepEqual(rows.map(row => row.id), [record.id]);
      assert.ok(requests.length >= 2 && requests.every(path => path === '/api/visits'));
    } else {
      await page.getByText(/비회원 관람기록은 서버에 저장되지 않아요/).waitFor();
      await page.reload();
      await page.getByText(/비회원 관람기록은 서버에 저장되지 않아요/).waitFor();
      assert.deepEqual((await readState()).viewed, [ids[0], ids[2]]);
      assert.deepEqual(requests, []);
    }
    assert.deepEqual(errors, []);
    console.log(member ? 'PASS exhibition order member: same receipt ID and one row after response loss and reload'
      : 'PASS exhibition order guest: one click, app/browser back, refresh, private work skipped, zero saves');
  } finally {
    try {
      if (hidden) setMiddleVisibility('approved');
    } finally {
      await page.close();
    }
  }
}

async function exhibitionOrderV2(browser) {
  const page = await openPage(browser);
  try {
    await page.goto(exhibition);
    await button(page, '내 취향으로 추천').click();
    await button(page, '비회원으로 계속').click();
    await choosePairs(page);
    await button(page, '취향 미리 확인').click();
    await button(page, '이 취향으로 계속').click();
    assert.equal((await recommend(page)).length, 3);
    assert.equal((await visit(page)).visitMode, undefined);
    await button(page, '지도에서 관람순서 보기').waitFor();
    console.log('PASS exhibition order secondary entry: unchanged V2 five pairs and three recommendations');
  } finally {
    await page.close();
  }
}

async function openAdmin(browser) {
  const page = await openPage(browser);
  await page.goto('/admin/login');
  await page.getByLabel('관리자 ID', { exact: true }).fill('visit-boundaries-admin');
  await page.getByLabel('비밀번호', { exact: true }).fill(process.env.ARTI_BOOTSTRAP_PASSWORD);
  await button(page, '로그인').click();
  await page.waitForURL('**/admin');
  return page;
}

async function mapVariants(browser) {
  const admin = await openAdmin(browser);
  const setup = variant => fixtureCommand([
    'from pathlib import Path',
    'exec(Path("frontend/tests/fixtures/mapVariants.py").read_text(encoding="utf-8"))',
  ], { ARTI_BROWSER_MAP_VARIANT: variant });
  try {
    for (const variant of ['native', 'pillar', 'two-rooms']) {
      setup(variant);
      await admin.goto('/admin/map?exhibition=' + exhibitionId);
      const adminMap = admin.locator('.floor-map');
      await adminMap.locator('.fm-marker').last().waitFor();
      assert.equal(await adminMap.locator('.fm-marker').count(), 3);
      if (variant === 'native') {
        assert.equal(await adminMap.locator('.fm-room').count(), 1);
      } else {
        await admin.waitForFunction(() => document.querySelector('.floor-map image')?.getAttribute('href')?.startsWith('blob:'));
      }

      const visitor = await openPage(browser);
      try {
        await visitor.setViewportSize({ width: 360, height: 760 });
        await visitor.goto(exhibition);
        await button(visitor, '전시 순서로 바로 보기').click();
        await button(visitor, '다음 작품 안내').click();
        await button(visitor, '2번 작품 감상하기').waitFor();
        assert.equal(await visitor.locator('.floor-map').count(), 0);
        await visitor.getByText('전체 지도와 관람 순서', { exact: true }).click();
        const map = visitor.locator('.floor-map');
        await map.locator('.fm-marker.current').waitFor();
        assert.equal(await map.locator('.fm-marker').count(), 3);
        assert.equal(await map.locator('.fm-route').count(), 0);
        assert.ok(await button(visitor, '2번 작품 감상하기').isVisible());
        assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth), 360);
        const planRatio = await map.evaluate(svg => 100 / svg.viewBox.baseVal.height);
        if (variant !== 'native') {
          const expectedRatio = variant === 'pillar' ? 360 / 640 : 640 / 360;
          assert.ok(Math.abs(planRatio - expectedRatio) < 0.001);
        } else {
          await visitor.route('**/api/artworks?exhibitionId=fixture-ex01', route => route.fulfill({
            status: 502, json: { error: '합성 지도 요청 실패' },
          }), { times: 1 });
          await visitor.reload();
          await button(visitor, '작품 열기').click();
          await visitor.waitForURL('**' + exhibition + '/artwork');
          assert.equal((await visit(visitor)).current, 1);
          await visitor.locator('.art-title').waitFor();
        }
      } finally {
        await visitor.close();
      }

      if (variant !== 'native') {
        const legacy = await openPage(browser);
        try {
          const recs = await body(await legacy.request.post('/api/recommendations', {
            data: { exhibitionId, tastes: [], duration: '30m' },
          }));
          assert.deepEqual(recs.map(rec => rec.artworkId), ['fixture-art03', 'fixture-art05', 'fixture-art01']);
          await legacy.addInitScript(({ exhibitionId, recs }) => sessionStorage.setItem('arti.visit', JSON.stringify({
            exhibitionId, recommendations: recs, current: 2, viewed: recs.slice(0, 2).map(rec => rec.artworkId),
          })), { exhibitionId, recs });
          await legacy.goto(exhibition + '/route');
          const leg = legacy.locator('.fm-route.active');
          await leg.waitFor();
          const crossing = await leg.evaluate(line => {
            const [from, to] = Array.from(line.points);
            const yAt50 = from.y + (50 - from.x) * (to.y - from.y) / (to.x - from.x);
            return { y: 100 * yAt50 / line.ownerSVGElement.viewBox.baseVal.height, crossesX50: from.x < 50 && to.x > 50 };
          });
          assert.ok(crossing.crossesX50);
          assert.ok(variant === 'pillar' ? crossing.y >= 35 && crossing.y <= 65 : crossing.y <= 72);
        } finally {
          await legacy.close();
        }
      }
      console.log('PASS map variant:', variant, 'admin pins and visitor map checked');
    }
  } finally {
    try { setup('restore'); } finally { await admin.close(); }
  }
}

async function operationsLog(browser) {
  const page = await openAdmin(browser);
  try {
    const opsPath = '/api/admin/operations';
    const forbidden = await page.request.get(opsPath);
    assert.equal(forbidden.status(), 401);
    const adminToken = await page.evaluate(() => JSON.parse(localStorage.getItem('arti.adminToken')));
    const headers = { 'X-Admin-Token': adminToken };
    const workPath = '/api/admin/artworks/fixture-art03';
    const work = await body(await page.request.get(workPath, { headers }));
    const saved = await page.request.put(workPath, { headers, data: work });
    assert.equal(saved.status(), 200);
    const requestId = saved.headers()['x-request-id'];
    const question = '합성 작품의 모양을 알려 주세요.';
    const failed = await page.request.post('/api/artworks/fixture-art03/ask', { data: { question } });
    assert.equal(failed.status(), 503);
    const failedId = failed.headers()['x-request-id'];
    const report = await body(await page.request.get(opsPath, { headers }));
    assert.deepEqual(report.configuration, { docent: 'disabled', analysis: 'disabled' });
    assert.ok(report.today.docentRequests >= 1 && report.today.aiErrors >= 1);
    const storedEvent = report.recent.find(event => event.requestId === failedId);
    assert.deepEqual(Object.keys(storedEvent).sort(), ['action', 'occurredAt', 'requestId', 'status']);
    assert.equal(storedEvent.status, 503);
    assert.equal(JSON.stringify(report).includes(question), false);

    await page.reload();
    await page.getByText(/오늘 도슨트 요청/).waitFor();
    await page.getByRole('link', { name: '운영 로그', exact: true }).click();
    await page.getByText(requestId, { exact: true }).waitFor();
    await page.getByText(failedId, { exact: true }).waitFor();
    await page.getByRole('checkbox', { name: '오류만 보기' }).check();
    assert.equal(await page.getByText(requestId, { exact: true }).count(), 0);
    assert.equal(await page.getByText(failedId, { exact: true }).count(), 1);
    console.log('PASS admin operations: authorization, event IDs, dashboard counts, error filter and request-data exclusion');

    const returnTo = exhibition + '/taste/saved';
    await page.goto('/login?redirect=' + encodeURIComponent(returnTo));
    await button(page, '로그인 도움').click();
    await page.getByText('현재는 비밀번호 재설정 메일을 보낼 수 없어요.').waitFor();
    await page.getByRole('link', { name: '로그인으로 돌아가기' }).click();
    await page.waitForURL(url => url.pathname === '/login' && url.searchParams.get('redirect') === returnTo);
    const disabled = await page.request.post('/api/auth/password-reset/request', { data: { email: 'reset@example.test' } });
    assert.equal(disabled.status(), 501);
    console.log('PASS login help: explicit disabled reset and original exhibition continuation');
  } finally {
    await page.close();
  }
}

(async () => {
  assert(['127.0.0.1', 'localhost'].includes(base.hostname), 'Use a dedicated local synthetic environment.');
  const suite = process.argv[2] || 'all';
  assert(['all', 'receipt-session', 'survey-map', 'recommendation-shortage', 'saved-v2', 'exhibition-order', 'map-variants', 'operations'].includes(suite), 'Unknown Chrome suite');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    if (suite === 'recommendation-shortage') return await recommendationShortage(browser);
    if (suite === 'saved-v2') return await savedV2(browser);
    if (suite === 'map-variants') return await mapVariants(browser);
    if (suite === 'operations') return await operationsLog(browser);
    if (suite === 'exhibition-order') {
      await exhibitionOrder(browser, false);
      await exhibitionOrder(browser, true);
      return await exhibitionOrderV2(browser);
    }
    if (suite !== 'survey-map') {
      await receiptSession(browser, false);
      await receiptSession(browser, true);
    }
    if (suite !== 'receipt-session') await surveyAndMap(browser);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
