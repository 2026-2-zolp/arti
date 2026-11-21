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
    termsAccepted: true, termsVersion: '2026-11-18-draft.2',
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
    await button(page, '이번 관람만 적용').click();
    const recommended = (await recommend(page)).map(item => item.artworkId);
    assert.equal(new Set(recommended).size, 3);
    await button(page, '지도에서 관람순서 보기').click();
    await button(page, '관람 시작하기').click();
    await button(page, '좋아요').click();
    await button(page, reason).click();
    await button(page, '다음 작품 안내').click();
    await button(page, '2번 작품 감상하기').click();
    const dislike = button(page, '별로예요');
    await dislike.click();
    const optionalReason = page.getByRole('group', { name: '별로예요 이유' });
    await optionalReason.getByRole('button', { name: '닫기', exact: true }).click();
    await optionalReason.waitFor({ state: 'hidden' });
    await page.reload();
    await dislike.waitFor();
    assert.equal(await dislike.getAttribute('aria-pressed'), 'true');
    assert.equal(await optionalReason.count(), 0);
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
    assert.equal(savedDraft.reactions[recommended[1]], 'dislike');
    assert.equal(savedDraft.reactionReasons[recommended[1]], '');

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
      assert.deepEqual(record.reactions, savedDraft.reactions);
      assert.deepEqual(record.reactionReasons, savedDraft.reactionReasons);
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
      const receipt = page.getByRole('article', { name: '아트 영수증' });
      await receipt.waitFor();
      assert.equal(await receipt.locator('.receipt-works li').nth(1).locator('span').last().textContent(), '👎');
      assert.deepEqual(saves, [savedDraft]);
      assert.deepEqual(await adminList(original), [record]);
    }
    assert.deepEqual(errors, []);
    console.log(switchAccount ? 'PASS expired session → other member: 0 save requests' :
      'PASS expired session → original member: same visit, one receipt and reaction without a reason');
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
      button(page, '이 취향으로 계속').click(),
    ]);
    assert.equal(stale.request().postDataJSON().tasteProfile.poolVersion, initial.poolVersion);
    assert.equal(stale.status(), 409);
    await button(page, '조사 근거 다시 불러오기').click();
    await page.getByRole('status').getByText('조사 근거가 바뀌었어요. 고른 작품은 초안에 남아 있어요.').waitFor();
    await button(page, '작품을 처음부터 다시 고르기').click();
    await choosePairs(page);
    const [preview] = await Promise.all([
      page.waitForResponse(r => isResponse(r, '/api/taste-profiles/resolve', 'POST')),
      button(page, '이 취향으로 계속').click(),
    ]);
    assert.equal(preview.status(), 200);
    assert.equal(preview.request().postDataJSON().tasteProfile.poolVersion, updated.poolVersion);
    await page.waitForURL('**' + exhibition + '/time');

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
    'from arti.constants import TAGS',
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
    '            tags=list(TAGS) if index == 1 else [],',
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
    const applyTaste = button(page, member ? '이번 관람만 적용' : '이 취향으로 계속');
    await applyTaste.waitFor();
    const pickedTags = await page.locator('[aria-label="취향 태그"]')
      .getByRole('button', { pressed: true }).allTextContents();
    assert(pickedTags.length > 0);
    await applyTaste.click();
    const recs = await recommend(page, duration);
    assert.deepEqual(recs.map(item => item.artworkId), expectedIds);
    assert.deepEqual(recs.map(item => item.order), eligible.map((_, index) => index + 1));
    await page.getByText(`선택한 시간의 기준은 ${requested}점이에요. 지금 추천할 수 있는 작품만 안내해요.`, { exact: true }).waitFor();
    assert.deepEqual(await page.locator('.rec-list .rec-info strong').allTextContents(), numberedTitles);
    const displayedTaste = page.getByRole('region', { name: '내가 고른 태그' });
    assert.deepEqual(await displayedTaste.getByRole('listitem').allTextContents(), pickedTags);
    await displayedTaste.getByText(`취향 일치 1점 · 추가 추천 ${eligible.length - 1}점`, { exact: true }).waitFor();
    const reasons = await page.locator('.rec-card .chip').allTextContents();
    assert.deepEqual(reasons, [`취향 일치 · ${recs[0].reason}`, ...eligible.slice(1).map(() => '추가 추천 · 일치 후보 부족')]);

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

async function broadTasteTie(browser) {
  const page = await openPage(browser);
  try {
    const tiedTags = [['warm', 'cool'], ['landscape', 'light'], ['people', 'soft'], ['abstract'], ['vivid']];
    const pool = await body(await page.request.get('/api/taste-pool'));
    for (const [index, pair] of pool.pairs.entries()) {
      pool.artworks.find(work => work.id === pair.leftId).tags = tiedTags[index];
    }
    await page.route('**/api/taste-pool', route => route.fulfill({ json: pool }));
    await page.goto(exhibition + '/taste');
    await choosePairs(page);
    const tags = page.locator('[aria-label="취향 태그"]');
    await tags.waitFor();
    assert.equal(await tags.getByRole('button').count(), 8);
    assert.deepEqual(await tags.getByRole('button', { pressed: true }).allTextContents(), ['풍경', '인물']);
    await button(tags, '풍경').click();
    await button(tags, '인물').click();
    await page.getByText('이번 관람에 쓰고 싶은 태그를 하나 이상 골라 주세요.').waitFor();
    assert.equal(await tags.getByRole('button', { pressed: true }).count(), 0);
    assert.equal(await button(page, '이 취향으로 계속').count(), 0);
    await button(tags, '빛').click();
    await button(page, '이 취향으로 계속').waitFor();
    await Promise.all([
      page.waitForResponse(r => isResponse(r, '/api/taste-pool', 'GET') && r.ok()),
      page.reload(),
    ]);
    await button(tags, '빛').waitFor();
    assert.deepEqual(await tags.getByRole('button', { pressed: true }).allTextContents(), ['빛']);
    console.log('PASS U-05 offers stable broad-tie defaults and preserves the manually chosen tag on reload');
  } finally {
    await page.close();
  }
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
    const pickedTags = page.locator('[aria-label="취향 태그"]');
    await pickedTags.waitFor();
    assert.deepEqual(await pickedTags.getByRole('button', { pressed: true }).allTextContents(), ['풍경', '따뜻한 색감']);
    const savePath = `/api/users/${member.user.id}/tastes`;
    let committedStatus;
    // Let Django commit the first PUT before dropping only its response to Chrome.
    await page.route(new URL(savePath, base).href, async route => {
      const response = await route.fetch({ maxRetries: 0 });
      committedStatus = response.status();
      if (committedStatus === 204) await route.abort('connectionreset');
      else await route.fulfill({ response });
    }, { times: 1 });
    const preview = await resolved('확인하고 계정에 저장');
    assert.equal(preview.tasteProfile.version, 2);
    assert.equal(preview.tasteProfile.source, 'picks');
    assert.equal(preview.tasteProfile.poolVersion, initial.poolVersion);
    assert.equal(preview.tasteProfile.tieContextVersion, initial.tieContext.tieContextVersion);
    assert.deepEqual(preview.tasteProfile.picks.map(pick => pick.artworkId), initial.pairs.map((pair, index) =>
      index < 3 ? pair.leftId : pair.rightId));
    assert.equal(preview.tasteProfile.counts.landscape, 3);
    assert.equal(preview.tasteProfile.counts.warm, 3);
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
    await button(page, '이 취향으로 계속').click();
    assert.equal((await recommend(page)).length, 3);
    assert.equal((await visit(page)).visitMode, undefined);
    await button(page, '지도에서 관람순서 보기').waitFor();
    console.log('PASS exhibition order secondary entry: unchanged V2 five pairs and three recommendations');
  } finally {
    await page.close();
  }
}

async function openAdmin(browser, context) {
  const page = await openPage(browser, context);
  await page.goto('/admin/login');
  await page.getByLabel('관리자 ID', { exact: true }).fill('visit-boundaries-admin');
  await page.getByLabel('비밀번호', { exact: true }).fill(process.env.ARTI_BOOTSTRAP_PASSWORD);
  await button(page, '로그인').click();
  await page.waitForURL('**/admin');
  return page;
}

async function adminExhibitionOrder(browser) {
  const page = await openAdmin(browser);
  const path = '/api/admin/exhibitions/' + exhibitionId;
  const adminToken = await page.evaluate(() => JSON.parse(localStorage.getItem('arti.adminToken')));
  const headers = { 'X-Admin-Token': adminToken };
  const original = await body(await page.request.get(path, { headers }));
  const publicPath = '/api' + exhibition;
  const oldOrder = (await body(await page.request.get(publicPath))).exhibitionOrder;
  try {
    await page.goto('/admin/map?exhibition=' + exhibitionId);
    const details = page.locator('details').filter({ has: page.getByText('전시 순서로 바로 보기', { exact: true }) });
    await details.locator('summary').click();
    const picker = details.getByRole('combobox', { name: '관람 순서에 추가할 작품' });
    await picker.selectOption('fixture-art01');
    await picker.selectOption('fixture-art03');
    const list = details.getByRole('list', { name: '관람 순서' });
    await list.getByRole('listitem').nth(1).getByRole('button', { name: /위로$/ }).click();
    assert.deepEqual((await body(await page.request.get(publicPath))).exhibitionOrder, oldOrder);
    await button(page, '관람 순서 저장').click();
    await details.getByText('관람 순서를 저장했어요.', { exact: true }).waitFor();
    await details.getByText('저장한 검수 완료 작품 2점', { exact: true }).waitFor();
    assert.deepEqual((await body(await page.request.get(publicPath))).exhibitionOrder, ['fixture-art03', 'fixture-art01']);
    console.log('PASS admin exhibition order: reorder remains private until save and editor stays open after save');
  } finally {
    const current = await body(await page.request.get(path, { headers }));
    if (JSON.stringify(current.directVisitOrder) !== JSON.stringify(original.directVisitOrder)) {
      await body(await page.request.put(path, { headers, data: { ...current, directVisitOrder: original.directVisitOrder } }));
    }
    await page.close();
  }
}

async function checkWalkableSvg(map, variant) {
  await map.locator('polyline.fm-route.active').waitFor({ state: 'attached' });
  const geometry = await map.evaluate(svg => {
    const walls = [...svg.querySelectorAll('rect.fm-wall')].map(rect => rect.getBBox());
    const lines = [...svg.querySelectorAll('.fm-route')];
    const blocked = lines.some(line => {
      const length = line.getTotalLength();
      const samples = Math.ceil(length * 5);
      return Array.from({ length: samples + 1 }, (_, index) => line.getPointAtLength(Math.min(length, index / 5)))
        .some(point => walls.some(rect => point.x >= rect.x && point.x <= rect.x + rect.width &&
          point.y >= rect.y && point.y <= rect.y + rect.height));
    });
    const activeLine = svg.querySelector('polyline.fm-route.active');
    const active = [...activeLine.points];
    const corridor = svg.querySelector('rect.fm-corridor')?.getBBox();
    const corridorPoints = corridor ? active.filter(point => point.x >= corridor.x && point.x <= corridor.x + corridor.width &&
      point.y >= corridor.y && point.y <= corridor.y + corridor.height) : [];
    const middle = corridor ? corridor.x + corridor.width / 2 : 0;
    return { blocked, activeCount: active.length, activeLength: activeLine.getTotalLength(),
      activeStroke: getComputedStyle(activeLine).stroke,
      crossesCorridor: corridorPoints.some(point => point.x < middle) && corridorPoints.some(point => point.x > middle) };
  });
  assert.equal(geometry.blocked, false);
  assert.ok(geometry.activeLength > 0 && geometry.activeStroke !== 'none');
  assert.ok(geometry.activeCount >= (['branch', 'three-rooms'].includes(variant) ? 2 : 3));
  if (variant === 'two-rooms') assert.ok(geometry.crossesCorridor, 'The path uses both sides of the displayed corridor');
}

async function navigationPreview(browser, admin) {
  const visitor = await openPage(browser);
  try {
    const durations = ['30m', '60m', 'relaxed'];
    const recommendAll = () => Promise.all(durations.map(duration => visitor.request.post('/api/recommendations', {
      data: { exhibitionId, duration, tastes: ['warm'],
        tasteProfile: { version: 2, source: 'manual', selectedTags: ['warm'] } },
    }).then(response => body(response))));
    const readExhibition = () => visitor.request.get('/api' + exhibition).then(response => body(response));
    const original = await readExhibition();
    const baseline = await recommendAll();
    assert.equal(original.navigationLayout, null);
    assert.deepEqual(baseline.map(items => items.length), [3, 5, 7]);
    await visitor.goto(exhibition);
    await button(visitor, '전시 순서로 바로 보기').click();
    await button(visitor, '다음 작품 안내').click();
    await button(visitor, '2번 작품 감상하기').click();
    await button(visitor, '다음 작품 안내').click();
    const openVisitorMap = async () => {
      await visitor.getByText('전체 지도와 관람 순서', { exact: true }).click();
      const map = visitor.locator('.floor-map');
      await map.locator('.fm-marker.current').waitFor();
      return map;
    };
    let visitorMap = await openVisitorMap();
    assert.equal(await visitorMap.locator('.fm-route, .fm-wall').count(), 0);

    await admin.goto('/admin/map?exhibition=' + exhibitionId);
    await admin.getByText('이동 구조 등록', { exact: true }).click();
    const editor = admin.getByRole('region', { name: '이동 구조 편집' });
    const drawing = editor.locator('.floor-map');
    const preview = editor.getByRole('group', { name: '경로 미리보기' });
    const from = preview.getByLabel('출발', { exact: true });
    const to = preview.getByLabel('도착', { exact: true });
    const category = editor.getByRole('combobox', { name: '이동 구조 종류' });
    const pick = async ([x, y]) => {
      const box = await drawing.boundingBox();
      await drawing.click({ position: { x: box.width * x / 100, y: box.height * y / 100 } });
    };
    const rectangles = async (kind, pairs) => {
      await category.selectOption(kind);
      for (const [first, second] of pairs) {
        await pick(first);
        await pick(second);
      }
    };
    const writes = [];
    admin.on('request', request => {
      if (request.method() === 'PUT' && new URL(request.url()).pathname.endsWith('/navigation')) writes.push(request);
    });
    await to.selectOption('fixture-art02');
    await preview.getByText('관람 가능 공간을 먼저 등록해 주세요.').waitFor();
    await rectangles('walkable', [[[4, 4], [47, 73]], [[53, 4], [96, 73]]]);
    await rectangles('walls', [
      [[46, 4], [54, 76]], [[4, 72], [36, 76]], [[44, 72], [47, 76]],
      [[53, 72], [56, 76]], [[64, 72], [96, 76]],
    ]);
    await rectangles('pillars', [[[30, 28], [36, 36]]]);
    await rectangles('corridors', [[[4, 75], [96, 97]]]);
    await category.selectOption('waypoints');
    for (const point of [[40, 45], [40, 70], [40, 78], [40, 86], [60, 86], [60, 78], [60, 70]]) await pick(point);
    await checkWalkableSvg(drawing, 'pillar');
    await to.selectOption('fixture-art01');
    await preview.getByText(/이어지는 경로가 없어요/).waitFor();
    assert.equal(await drawing.locator('.fm-route.active').count(), 0);
    await rectangles('doors', [[[37, 70], [43, 79]], [[57, 70], [63, 79]]]);
    await checkWalkableSvg(drawing, 'two-rooms');
    await from.selectOption('fixture-art05');
    await checkWalkableSvg(drawing, 'two-rooms');
    await category.selectOption('doors');
    await button(editor, '마지막 입력 취소').click();
    await preview.getByText(/이어지는 경로가 없어요/).waitFor();
    assert.equal(await drawing.locator('.fm-route.active').count(), 0);
    await rectangles('doors', [[[57, 70], [63, 79]]]);
    await checkWalkableSvg(drawing, 'two-rooms');

    const preset = button(editor, '복도로 연결된 두 전시실 불러오기');
    const confirm = admin.getByRole('alertdialog');
    await preset.click();
    await button(confirm, '취소').click();
    assert.equal(await drawing.locator('.fm-wall').count(), 6, 'Cancel preserves the drawn pillar');
    const loadPreset = async () => {
      await preset.click();
      await button(confirm, '프리셋으로 바꾸기').click();
      await checkWalkableSvg(drawing, 'two-rooms');
      assert.equal(await drawing.locator('.fm-wall').count(), 5);
      assert.equal(await drawing.locator('.fm-door').count(), 2);
      assert.equal(await drawing.locator('.fm-corridor').count(), 1);
    };
    await loadPreset();
    await category.selectOption('doors');
    await button(editor, '마지막 입력 취소').click();
    await preview.getByText(/이어지는 경로가 없어요/).waitFor();
    assert.equal(await drawing.locator('.fm-route.active').count(), 0);

    assert.equal(writes.length, 0);
    assert.deepEqual(await readExhibition(), original);
    assert.deepEqual(await recommendAll(), baseline);
    await visitor.reload();
    visitorMap = await openVisitorMap();
    assert.equal(await visitorMap.locator('.fm-route, .fm-wall').count(), 0);

    const save = async () => {
      const savedResponse = admin.waitForResponse(response => isResponse(response, '/api/admin/exhibitions/' + exhibitionId + '/navigation', 'PUT'));
      await button(editor, '이동 구조 저장').click();
      await body(await savedResponse);
      await editor.getByText(/현재 도면 버전에 이동 구조를 저장했어요/).waitFor();
    };
    await save();
    assert.equal(writes.length, 1);
    const blocked = await readExhibition();
    assert.equal(blocked.navigationLayout.doors.length, 1);
    assert.deepEqual(await recommendAll(), baseline);
    const checkBlockedVisitor = async () => {
      await visitor.reload();
      const map = await openVisitorMap();
      await visitor.getByText(/이어지는 통로를 확인할 수 없어요/).waitFor();
      assert.equal(await map.locator('.fm-route.active').count(), 0);
    };
    await checkBlockedVisitor();

    await loadPreset();
    assert.equal(writes.length, 1);
    assert.deepEqual(await readExhibition(), blocked, 'Reopening in the editor must remain a draft');
    assert.deepEqual(await recommendAll(), baseline);
    await checkBlockedVisitor();
    await save();
    assert.equal(writes.length, 2);
    const saved = await readExhibition();
    assert.equal(saved.navigationLayout.floorPlanRevision, original.floorPlanRevision);
    assert.equal(saved.navigationLayout.doors.length, 2);
    const byArtwork = items => Object.fromEntries(items.map(({ artworkId, order, ...details }) => [artworkId, details]));
    const updated = await recommendAll();
    assert.deepEqual(updated.map(items => items.length), [3, 5, 7]);
    for (const [index, items] of updated.entries()) {
      assert.deepEqual(byArtwork(items), byArtwork(baseline[index]));
      assert.deepEqual(items.map(item => item.order), items.map((_, order) => order + 1));
      assert.notDeepEqual(items.map(item => item.artworkId), baseline[index].map(item => item.artworkId));
    }
    await visitor.reload();
    visitorMap = await openVisitorMap();
    await checkWalkableSvg(visitorMap, 'two-rooms');
    await admin.reload();
    await admin.locator('.floor-map .fm-wall').first().waitFor();
    console.log('PASS navigation preset: cancel keeps edits, open/blocked preview, public map and V2 unchanged until save, blocked fallback and open 3/5/7 reorder');
  } finally {
    await visitor.close();
  }
}

async function fitNavigationToReference(browser, admin) {
  const publicPath = '/api' + exhibition;
  const original = await body(await admin.request.get(publicPath));
  await admin.goto('/admin/map?exhibition=' + exhibitionId);
  await admin.getByText('이동 구조 등록', { exact: true }).click();
  const editor = admin.getByRole('region', { name: '이동 구조 편집' });
  const map = editor.locator('.floor-map');
  const preview = editor.getByRole('group', { name: '경로 미리보기' });
  const save = button(editor, '이동 구조 저장');
  const pick = async (x, y) => {
    const box = await map.boundingBox();
    await map.click({ position: { x: box.width * x / 100, y: box.height * y / 100 } });
  };
  await map.locator('image[href]').waitFor();
  await button(editor, '복도로 연결된 두 전시실 불러오기').click();
  const example = editor.getByRole('checkbox', { name: '검수용 예시 배치' });
  assert.ok(await example.isChecked());
  await button(editor, '원본 도면에 맞추기').click();
  assert.ok(await save.isDisabled());
  await pick(10, 8);
  await pick(90, 88);
  await editor.getByText('이동 구조를 선택한 영역에 맞췄어요.').waitFor();
  const bounds = await map.evaluate(svg => {
    const room = svg.querySelector('rect.fm-room').getBBox();
    const corridor = svg.querySelector('rect.fm-corridor').getBBox();
    return { left: room.x, top: room.y * 100 / svg.viewBox.baseVal.height,
      right: corridor.x + corridor.width, bottom: (corridor.y + corridor.height) * 100 / svg.viewBox.baseVal.height };
  });
  for (const [side, expected] of Object.entries({ left: 10, top: 8, right: 90, bottom: 88 })) {
    assert.ok(Math.abs(bounds[side] - expected) < 0.5, side + ' follows the reference corners');
  }
  await preview.getByLabel('도착', { exact: true }).selectOption('fixture-art01');
  await preview.getByLabel('출발', { exact: true }).selectOption('fixture-art03');
  await checkWalkableSvg(map, 'two-rooms');
  const category = editor.getByRole('combobox', { name: '이동 구조 종류' });
  await category.selectOption('waypoints');
  for (let count = 0; count < 6; count++) await button(editor, '마지막 입력 취소').click();
  await preview.getByText(/이어지는 경로가 없어요/).waitFor();
  assert.equal(await map.locator('.fm-route.active').count(), 0);
  await button(editor, '제안 연결점 6개 추가').click();
  assert.equal(await map.locator('.fm-waypoint').count(), 6);
  await checkWalkableSvg(map, 'two-rooms');
  assert.ok(await button(editor, '제안 연결점 0개 추가').isDisabled());
  assert.deepEqual(await body(await admin.request.get(publicPath)), original);

  await save.click();
  await editor.getByText(/현재 도면 버전에 이동 구조를 저장했어요/).waitFor();
  const saved = await body(await admin.request.get(publicPath));
  assert.deepEqual(saved.floorPlan, original.floorPlan);
  assert.equal(saved.navigationLayout.floorPlanRevision, original.floorPlanRevision);
  assert.equal(saved.navigationLayout.waypoints.length, 6);
  assert.equal(saved.navigationLayout.example, true);

  const visitor = await openPage(browser);
  try {
    await visitor.goto(exhibition);
    await button(visitor, '전시 순서로 바로 보기').click();
    await button(visitor, '다음 작품 안내').click();
    await visitor.getByText('전체 지도와 관람 순서', { exact: true }).click();
    await checkWalkableSvg(visitor.locator('.floor-map'), 'two-rooms');
    await visitor.locator('.route-note').filter({ hasText: '검수용 예시 배치예요' }).waitFor();
  } finally {
    await visitor.close();
  }
  console.log('PASS original floor plan fit: draft overlay, suggested links reconnect corridor, saved revision visible to visitor');
}

async function reviewBentCorridor(browser, admin) {
  const readExhibition = () => admin.request.get('/api' + exhibition).then(response => body(response));
  const baseline = await readExhibition();
  await admin.goto('/admin/map?exhibition=' + exhibitionId);
  await admin.getByText('이동 구조 등록', { exact: true }).click();
  const editor = admin.getByRole('region', { name: '이동 구조 편집' });
  const map = editor.locator('.floor-map');
  const preview = editor.getByRole('group', { name: '경로 미리보기' });
  const destination = preview.getByLabel('도착', { exact: true });
  const markers = map.locator('.fm-marker.check');
  await destination.selectOption('fixture-art01');
  await preview.getByText(/지도에 표시된 A·B/).waitFor();
  assert.equal(await markers.count(), 2);
  assert.equal(await map.locator('.fm-route.active').count(), 0);

  await editor.getByRole('button', { name: /제안 연결점 [1-9]\d*개 추가/ }).click();
  await checkWalkableSvg(map, 'pillar');
  assert.equal(await markers.count(), 0);
  const passesDoors = await map.evaluate(svg => {
    const line = svg.querySelector('.fm-route.active');
    const doors = [...svg.querySelectorAll('.fm-door')].map(door => door.getBBox());
    const length = line.getTotalLength();
    const points = Array.from({ length: Math.ceil(length * 10) }, (_, index) => line.getPointAtLength(index / 10));
    return doors.map(door => points.some(point => point.x > door.x && point.x < door.x + door.width &&
      point.y > door.y && point.y < door.y + door.height));
  });
  assert.deepEqual(passesDoors, [true, true]);
  assert.deepEqual(await readExhibition(), baseline);
  await button(editor, '이동 구조 저장').click();
  await editor.getByText(/현재 도면 버전에 이동 구조를 저장했어요/).waitFor();
  const saved = await readExhibition();
  assert.ok(saved.navigationLayout.waypoints.length > 6);
  const visitor = await openPage(browser);
  try {
    await visitor.goto(exhibition);
    await button(visitor, '전시 순서로 바로 보기').click();
    await button(visitor, '다음 작품 안내').click();
    await visitor.getByText('전체 지도와 관람 순서', { exact: true }).click();
    await checkWalkableSvg(visitor.locator('.floor-map'), 'pillar');
    assert.equal(await visitor.locator('.fm-marker.check').count(), 0);
  } finally {
    await visitor.close();
  }

  await editor.getByRole('combobox', { name: '이동 구조 종류' }).selectOption('doors');
  await button(editor, '마지막 입력 취소').click();
  await preview.getByText(/지도에 표시된 A·B/).waitFor();
  assert.equal(await map.locator('.fm-route.active').count(), 0);
  const checkPositions = await markers.evaluateAll(nodes => nodes.map(node => {
    const point = node.transform.baseVal.getItem(0).matrix;
    return { label: node.querySelector('text').textContent, x: point.e, y: point.f };
  }));
  assert.deepEqual(checkPositions.map(point => point.label), ['A', 'B']);
  assert.ok(checkPositions[0].y < 62 && checkPositions[1].y > 62);
  assert.ok(checkPositions.every(point => Math.abs(point.x - 67) < 1 && Math.abs(point.y - 62) < 2));
  await destination.selectOption('fixture-art05');
  await preview.getByText(/도착점 B 위치가 관람 가능 공간에 있는지/).waitFor();
  assert.equal(await markers.count(), 1);
  assert.equal(await markers.locator('text').textContent(), 'B');
  assert.deepEqual(await readExhibition(), saved);
  console.log('PASS bent corridor: narrow doors and pillar detour, check markers near blocked door or invalid endpoint');
}

async function reviewMultiTurnCorridor(browser, admin) {
  const visitor = await openPage(browser);
  try {
    const readExhibition = () => visitor.request.get('/api' + exhibition).then(response => body(response));
    const baseline = await readExhibition();
    await visitor.goto(exhibition);
    await button(visitor, '전시 순서로 바로 보기').click();
    await button(visitor, '다음 작품 안내').click();
    const readVisitorMap = async (connected) => {
      await visitor.getByText('전체 지도와 관람 순서', { exact: true }).click();
      const map = visitor.locator('.floor-map');
      await map.locator('.fm-marker.current').waitFor();
      if (connected) await checkWalkableSvg(map, 'multi-turn');
      else {
        await visitor.getByText(/이어지는 통로를 확인할 수 없어요/).waitFor();
        assert.equal(await map.locator('.fm-route.active').count(), 0);
      }
      assert.equal(await map.locator('.fm-marker.check').count(), 0);
    };
    await readVisitorMap(false);
    const reloadVisitor = async connected => {
      await visitor.reload();
      await readVisitorMap(connected);
    };

    await admin.goto('/admin/map?exhibition=' + exhibitionId);
    await admin.getByText('이동 구조 등록', { exact: true }).click();
    const editor = admin.getByRole('region', { name: '이동 구조 편집' });
    const map = editor.locator('.floor-map');
    const preview = editor.getByRole('group', { name: '경로 미리보기' });
    const category = editor.getByRole('combobox', { name: '이동 구조 종류' });
    const undo = button(editor, '마지막 입력 취소');
    const pick = async (x, y) => {
      const box = await map.boundingBox();
      await map.click({ position: { x: box.width * x / 100, y: box.height * y / 100 } });
    };
    const checkGap = async () => {
      await preview.getByText(/지도에 표시된 A·B/).waitFor();
      assert.equal(await map.locator('.fm-marker.check').count(), 2);
      assert.equal(await map.locator('.fm-route.active').count(), 0);
    };
    const checkConnected = async () => {
      await checkWalkableSvg(map, 'multi-turn');
      assert.equal(await map.locator('.fm-marker.check').count(), 0);
    };
    const save = async () => {
      const result = admin.waitForResponse(response => isResponse(response, '/api/admin/exhibitions/' + exhibitionId + '/navigation', 'PUT'));
      await button(editor, '이동 구조 저장').click();
      await body(await result);
      await editor.getByText(/현재 도면 버전에 이동 구조를 저장했어요/).waitFor();
    };
    await preview.getByLabel('도착', { exact: true }).selectOption('fixture-art01');
    await checkGap();
    await editor.getByRole('button', { name: /제안 연결점 [1-9]\d*개 추가/ }).click();
    await checkConnected();
    const includesShortSeam = await map.locator('.fm-route.active').evaluate(line =>
      [...line.points].some(point => point.x > 50.8 && point.x < 51 && Math.abs(point.y - 24) < 0.01));
    assert.ok(includesShortSeam);

    // The final bend must stay disconnected until its missing link is placed back.
    await category.selectOption('waypoints');
    await undo.click();
    await checkGap();
    await pick(83, 51.5);
    await checkConnected();
    assert.deepEqual(await readExhibition(), baseline);
    await reloadVisitor(false);
    await save();
    await reloadVisitor(true);
    const open = await readExhibition();
    assert.equal(open.navigationLayout.doors.length, 2);

    await category.selectOption('doors');
    await undo.click();
    await checkGap();
    assert.deepEqual(await readExhibition(), open);
    await reloadVisitor(true);
    await save();
    await reloadVisitor(false);
    const closed = await readExhibition();
    assert.equal(closed.navigationLayout.doors.length, 1);

    await pick(82, 67.5);
    await pick(83.4, 69.5);
    await checkConnected();
    assert.deepEqual(await readExhibition(), closed);
    await reloadVisitor(false);
    await save();
    await reloadVisitor(true);
    assert.equal((await readExhibition()).navigationLayout.doors.length, 2);
    console.log('PASS multi-turn corridor: short seam, waypoint and door edits update A/B immediately, visitor changes only after each save');
  } finally {
    await visitor.close();
  }
}

async function reviewBranchConflict(browser, admin) {
  const visitor = await openPage(browser);
  const other = await openPage(browser, admin.context());
  const readExhibition = () => visitor.request.get('/api' + exhibition).then(response => body(response));
  const recommendAll = () => Promise.all(['30m', '60m', 'relaxed'].map(duration =>
    visitor.request.post('/api/recommendations', {
      data: { exhibitionId, duration, tastes: ['warm'],
        tasteProfile: { version: 2, source: 'manual', selectedTags: ['warm'] } },
    }).then(response => body(response))));
  const byArtwork = items => Object.fromEntries(items.map(({ order, ...item }) => [item.artworkId, item]));
  const openEditor = async page => {
    await page.goto('/admin/map?exhibition=' + exhibitionId);
    await page.getByText('이동 구조 등록', { exact: true }).click();
    const editor = page.getByRole('region', { name: '이동 구조 편집' });
    await editor.getByLabel('도착', { exact: true }).selectOption('fixture-art01');
    return editor;
  };
  const verifyRoute = async (map, upper) => {
    await checkWalkableSvg(map, 'branch');
    const crossing = await map.locator('.fm-route.active').evaluate(line => {
      const count = Math.ceil(line.getTotalLength() * 4);
      return Array.from({ length: count + 1 }, (_, index) => line.getPointAtLength(index / 4))
        .find(point => Math.abs(point.x - 50) < 0.5)?.y;
    });
    assert.ok(upper ? crossing >= 24 && crossing <= 30 : crossing >= 70 && crossing <= 78,
      `Expected ${upper ? 'upper' : 'lower'} corridor, crossing y=${crossing}`);
  };
  const removeDoor = async editor => {
    await editor.getByRole('combobox', { name: '이동 구조 종류' }).selectOption('doors');
    await button(editor, '마지막 입력 취소').click();
  };
  const save = async (page, editor, status) => {
    const [response] = await Promise.all([
      page.waitForResponse(r => isResponse(r, '/api/admin/exhibitions/' + exhibitionId + '/navigation', 'PUT')),
      button(editor, '이동 구조 저장').click(),
    ]);
    return body(response, status);
  };

  try {
    const original = await readExhibition();
    const recommendations = await recommendAll();
    assert.deepEqual(recommendations.map(items => items.length), [3, 5, 7]);
    await visitor.goto(exhibition);
    await button(visitor, '전시 순서로 바로 보기').click();
    await button(visitor, '다음 작품 안내').click();
    const openVisitorMap = async () => {
      await visitor.getByText('전체 지도와 관람 순서', { exact: true }).click();
      return visitor.locator('.floor-map');
    };
    const editor = await openEditor(admin);
    const staleEditor = await openEditor(other);
    const map = editor.locator('.floor-map');
    const staleMap = staleEditor.locator('.floor-map');
    await verifyRoute(await openVisitorMap(), true);
    await verifyRoute(map, true);
    await verifyRoute(staleMap, true);

    await removeDoor(editor);
    await verifyRoute(map, false);
    assert.deepEqual(await readExhibition(), original);
    await visitor.reload();
    await verifyRoute(await openVisitorMap(), true);
    const saved = await save(admin, editor, 200);
    assert.equal(saved.navigationLayout.doors.length, 3);
    const published = await readExhibition();
    assert.equal(published.version, saved.version);
    assert.deepEqual(published.navigationLayout, saved.navigationLayout);
    await visitor.reload();
    await verifyRoute(await openVisitorMap(), false);
    const after = await recommendAll();
    assert.deepEqual(after.map(byArtwork), recommendations.map(byArtwork));

    await removeDoor(staleEditor);
    await removeDoor(staleEditor);
    await staleEditor.getByText(/이어지는 경로가 없어요/).waitFor();
    const candidates = staleEditor.getByRole('group', { name: 'A 주변 구조' });
    const candidate = candidates.getByRole('button', { name: /통로 \d+ 표시/ });
    await candidate.click();
    await staleMap.locator('.fm-check-focus').waitFor();
    assert.equal(await candidate.getAttribute('aria-pressed'), 'true');
    assert.equal(await visitor.locator('.fm-check-focus').count(), 0);
    assert.equal((await save(other, staleEditor, 409)).code, 'VERSION_CONFLICT');
    const reload = button(staleEditor, '최신 도면 다시 불러오기');
    assert.equal(await button(staleEditor, '이동 구조 저장').isDisabled(), true);
    await reload.click();
    const dialog = other.getByRole('alertdialog');
    await button(dialog, '취소').click();
    assert.equal(await staleMap.locator('.fm-door').count(), 2);
    await reload.click();
    await button(dialog, '다시 불러오기').click();
    await other.getByText('이동 구조 등록', { exact: true }).click();
    await staleEditor.getByLabel('도착', { exact: true }).selectOption('fixture-art01');
    await verifyRoute(staleMap, false);
    assert.equal(await staleMap.locator('.fm-door').count(), 3);
    assert.deepEqual(await readExhibition(), published);
    console.log('PASS branch corridor: saved detour, stable V2 choices, stale 409 and latest preview recovery');
  } finally {
    await Promise.all([visitor.close(), other.close()]);
  }
}

async function reviewThreeRooms(browser, admin) {
  const visitor = await openPage(browser);
  try {
    const published = () => visitor.request.get('/api' + exhibition).then(response => body(response));
    const original = await published();
    const member = await newMember(visitor);
    await visitor.goto('/login');
    await login(visitor, member);
    await visitor.waitForURL(base.href);
    await visitor.goto(exhibition);
    await button(visitor, '전시 순서로 바로 보기').click();
    await button(visitor, '다음 작품 안내').click();
    const progress = async () => {
      const { visitId, current, viewed, recommendations } = await visit(visitor);
      return { visitId, current, viewed, order: recommendations.map(work => work.artworkId) };
    };
    const initialProgress = await progress();
    assert.deepEqual(initialProgress.viewed, ['fixture-art03']);
    const visitorMap = async () => {
      const details = visitor.locator('.route-details');
      const summary = details.locator('summary');
      await summary.waitFor();
      if (!await details.evaluate(element => element.open)) await summary.click();
      return details.locator('.floor-map');
    };
    const expectBlocked = async () => {
      const map = await visitorMap();
      await visitor.getByText(/이어지는 통로를 확인할 수 없어요/).waitFor();
      assert.equal(await map.locator('.fm-route.active').count(), 0);
    };
    await expectBlocked();

    await admin.goto('/admin/map?exhibition=' + exhibitionId);
    await admin.getByText('이동 구조 등록', { exact: true }).click();
    const editor = admin.getByRole('region', { name: '이동 구조 편집' });
    const map = editor.locator('.floor-map');
    const departure = editor.getByLabel('출발', { exact: true });
    const destination = editor.getByLabel('도착', { exact: true });
    await departure.selectOption('fixture-art02');
    await destination.selectOption('fixture-art04');
    await checkWalkableSvg(map, 'three-rooms');
    assert.equal(await map.locator('.fm-marker.check').count(), 0);
    assert.equal(await map.locator('.fm-room').count(), 3);

    await departure.selectOption('fixture-art03');
    await destination.selectOption('fixture-art01');
    await editor.getByText(/이어지는 경로가 없어요/).waitFor();
    const left = editor.getByRole('group', { name: 'A 주변 구조' });
    const right = editor.getByRole('group', { name: 'B 주변 구조' });
    await button(left, '문 3 표시').waitFor();
    await button(right, '문 4 표시').click();
    assert.equal(await button(right, '문 5 표시').count(), 0);
    await map.locator('.fm-check-focus').waitFor();
    assert.equal(Number(await map.locator('.fm-check-focus').getAttribute('cy')), 33);

    await editor.getByRole('combobox', { name: '이동 구조 종류' }).selectOption('doors');
    const bounds = await map.boundingBox();
    for (const [x, y] of [[72.5, 25], [76, 29]]) {
      await map.click({ position: { x: bounds.width * x / 100, y: bounds.height * y / 100 } });
    }
    await checkWalkableSvg(map, 'three-rooms');
    assert.equal(await map.locator('.fm-check-focus, .fm-marker.check').count(), 0);
    assert.deepEqual(await published(), original);
    await visitor.reload();
    await expectBlocked();

    const save = async () => {
      const [response] = await Promise.all([
        admin.waitForResponse(r => isResponse(r, '/api/admin/exhibitions/' + exhibitionId + '/navigation', 'PUT')),
        button(editor, '이동 구조 저장').click(),
      ]);
      return body(response);
    };
    const saved = await save();
    assert.deepEqual((await published()).navigationLayout, saved.navigationLayout);
    await visitor.reload();
    const savedMap = await visitorMap();
    await checkWalkableSvg(savedMap, 'three-rooms');
    assert.equal(await savedMap.locator('.fm-check-focus, .fm-marker.check').count(), 0);
    assert.deepEqual(await progress(), initialProgress);

    await button(editor, '마지막 입력 취소').click();
    await editor.getByText(/이어지는 경로가 없어요/).waitFor();
    assert.equal((await published()).navigationLayout.doors.length, original.navigationLayout.doors.length + 1);
    await save();
    await visitor.reload();
    await expectBlocked();
    assert.deepEqual(await progress(), initialProgress);
    await button(visitor, '2번 작품 감상하기').click();
    await visitor.waitForURL('**/artwork');
    await visitor.goBack();
    await expectBlocked();
    assert.deepEqual(await progress(), initialProgress);

    await button(visitor, '2번 작품 감상하기').click();
    await button(visitor, '다음 작품 안내').click();
    await button(visitor, '3번 작품 감상하기').click();
    const [posted] = await Promise.all([
      visitor.waitForResponse(response => isResponse(response, '/api/visits', 'POST')),
      button(visitor, '관람 마치기').click(),
    ]);
    const receipt = await body(posted, 201);
    assert.equal(receipt.visitId, initialProgress.visitId);
    assert.deepEqual(receipt.viewedArtworkIds, ['fixture-art03', 'fixture-art01', 'fixture-art05']);
    await visitor.reload();
    await visitor.getByText('관람기록에 저장되었어요', { exact: true }).waitFor();
    const visits = await body(await visitor.request.get('/api/users/' + member.user.id + '/visits', {
      headers: headersFor(await currentToken(visitor)),
    }));
    assert.deepEqual(visits.map(row => row.id), [receipt.id]);
    console.log('PASS three rooms: door repair and closure, same visit after back, one member receipt');
  } finally {
    await visitor.close();
  }
}

async function mapVariants(browser) {
  const adminContext = await browser.newContext(pageOptions);
  const setup = variant => fixtureCommand([
    'from pathlib import Path',
    'exec(Path("frontend/tests/fixtures/mapVariants.py").read_text(encoding="utf-8"))',
  ], { ARTI_BROWSER_MAP_VARIANT: variant });
  try {
    const admin = await openAdmin(browser, adminContext);
    for (const variant of ['native', 'pillar', 'two-rooms']) {
      setup(variant);
      await admin.goto('/admin/map?exhibition=' + exhibitionId);
      const adminMap = admin.locator('.floor-map');
      await adminMap.locator('.fm-marker').last().waitFor();
      assert.equal(await adminMap.locator('.fm-marker').count(), 3);
      if (variant === 'native') {
        assert.equal(await adminMap.locator('.fm-room').count(), 1);
      } else {
        assert.equal(await adminMap.locator('image').count(), 0);
        assert.equal(await adminMap.locator('.fm-wall').count(), variant === 'pillar' ? 1 : 5);
        assert.equal(await adminMap.locator('.fm-door').count(), variant === 'pillar' ? 0 : 2);
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
        assert.ok(await button(visitor, '2번 작품 감상하기').isVisible());
        assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth), 360);
        const planRatio = await map.evaluate(svg => 100 / svg.viewBox.baseVal.height);
        if (variant !== 'native') {
          const expectedRatio = variant === 'pillar' ? 360 / 640 : 640 / 360;
          assert.ok(Math.abs(planRatio - expectedRatio) < 0.001);
          await checkWalkableSvg(map, variant);
          if (variant === 'pillar') {
            await visitor.route('**/api/artworks?exhibitionId=fixture-ex01', async route => {
              const result = await route.fetch();
              const works = await result.json();
              works.find(work => work.id === 'fixture-art01').position = { x: 50, y: 50 };
              await route.fulfill({ response: result, json: works });
            }, { times: 1 });
            await visitor.reload();
            await visitor.getByText('전체 지도와 관람 순서', { exact: true }).click();
            await visitor.getByText(/이어지는 통로를 확인할 수 없어요/).waitFor();
            assert.equal(await visitor.locator('.fm-route.active').count(), 0);
            assert.ok(await button(visitor, '2번 작품 감상하기').isVisible());
          }
        } else {
          assert.equal(await map.locator('.fm-route').count(), 0);
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
          await checkWalkableSvg(legacy.locator('.floor-map'), variant);
        } finally {
          await legacy.close();
        }
      }
      if (variant === 'native') {
        await admin.getByText('이동 구조 등록', { exact: true }).click();
        const editor = admin.getByRole('region', { name: '이동 구조 편집' });
        const drawing = editor.locator('.floor-map');
        const select = editor.getByRole('combobox', { name: '이동 구조 종류' });
        const rect = async (category, a, b) => {
          await select.selectOption(category);
          const box = await drawing.boundingBox();
          for (const [x, y] of [a, b]) {
            await drawing.click({ position: { x: box.width * x / 100, y: box.height * y / 100 } });
          }
        };
        await rect('walkable', [4, 4], [96, 96]);
        await rect('pillars', [40, 35], [60, 65]);
        await select.selectOption('waypoints');
        for (const [x, y] of [[36, 31], [64, 31], [36, 69], [64, 69]]) {
          const box = await drawing.boundingBox();
          await drawing.click({ position: { x: box.width * x / 100, y: box.height * y / 100 } });
        }
        await button(editor, '이동 구조 저장').click();
        await editor.getByText(/현재 도면 버전에 이동 구조를 저장했어요/).waitFor();
        const saved = await body(await admin.request.get('/api/exhibitions/' + exhibitionId));
        assert.equal(saved.navigationLayout.floorPlanRevision, saved.floorPlanRevision);
        assert.equal(saved.navigationLayout.pillars.length, 1);
        assert.equal(saved.navigationLayout.waypoints.length, 4);
        await admin.reload();
        await admin.locator('.floor-map .fm-wall').waitFor();
        const visitor = await openPage(browser);
        try {
          await visitor.goto(exhibition);
          await button(visitor, '전시 순서로 바로 보기').click();
          await button(visitor, '다음 작품 안내').click();
          await visitor.getByText('전체 지도와 관람 순서', { exact: true }).click();
          const svg = visitor.locator('.floor-map');
          await svg.locator('.fm-route.active').waitFor();
          assert.equal(await svg.locator('.fm-wall').count(), 1);
          assert.ok((await svg.locator('.fm-route.active').getAttribute('points')).split(' ').length > 2);
        } finally {
          await visitor.close();
        }
      }
      console.log('PASS map variant:', variant, 'native geometry, visitor routes and fallback checked');
    }
    setup('preview');
    await navigationPreview(browser, admin);
    setup('fit');
    await fitNavigationToReference(browser, admin);
    setup('bend');
    await reviewBentCorridor(browser, admin);
    setup('multi-turn');
    await reviewMultiTurnCorridor(browser, admin);
    setup('branch');
    await reviewBranchConflict(browser, admin);
    setup('three-rooms');
    await reviewThreeRooms(browser, admin);
  } finally {
    try { setup('restore'); } finally { await adminContext.close(); }
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
    const savedWork = await body(saved);
    const requestId = saved.headers()['x-request-id'];
    const question = '합성 작품의 모양을 알려 주세요.';
    const failed = await page.request.post('/api/artworks/fixture-art03/ask', { data: { question } });
    assert.equal(failed.status(), 503);
    const failedId = failed.headers()['x-request-id'];
    const before = await body(await page.request.get(opsPath, { headers }));
    const partial = await page.request.post(workPath + '/analyze', { headers, data: {
      version: savedWork.version, regenerateFields: ['summary', 'guide', 'tag', 'emotion'],
    } });
    const partialId = partial.headers()['x-request-id'];
    const partialResult = await body(partial);
    assert.equal(partialResult.summary.made, true);
    assert.equal(partialResult.guide.code, 'PROVIDER_ERROR');
    for (const kind of ['tag', 'emotion']) assert.equal(partialResult[kind].code, 'AI_UNAVAILABLE');

    const fullFailure = await page.request.post(workPath + '/analyze', { headers, data: {
      version: partialResult.artwork.version, regenerateFields: ['guide'],
    } });
    const fullFailureId = fullFailure.headers()['x-request-id'];
    assert.equal((await body(fullFailure, 502)).code, 'PROVIDER_ERROR');
    fixtureCommand([
      'from uuid import uuid4',
      'from arti.models import OperationEvent, OperationVoiceModelUsage',
      'for status, measured in ((200, True), (504, False)):',
      '    event = OperationEvent.objects.create(action="docent_audio", status=status, request_id=uuid4())',
      '    tokens = dict(input_tokens=100, output_tokens=93, cached_input_tokens=64, output_audio_tokens=48, estimated_cost_usd="0.001093440") if measured else {}',
      '    OperationVoiceModelUsage.objects.create(event=event, intent="prepare", model="synthetic-voice", **tokens)',
    ]);
    const report = await body(await page.request.get(opsPath, { headers }));
    assert.deepEqual(report.configuration, { docent: 'disabled', analysis: 'disabled' });
    assert.equal(report.draftConfiguration, 'configured');
    assert.ok(report.today.docentRequests >= 1 && report.today.aiErrors >= 1);
    assert.equal(report.today.analysisRequests, before.today.analysisRequests + 2);
    assert.equal(report.today.analysisPartialFailures, before.today.analysisPartialFailures + 1);
    assert.equal(report.today.aiErrors, before.today.aiErrors + 2); // Failed analysis and synthetic voice timeout.
    const usage = {
      attempts: before.textModelUsage.attempts + 3, missing: before.textModelUsage.missing + 2,
      inputTokens: (before.textModelUsage.inputTokens ?? 0) + 120,
      outputTokens: (before.textModelUsage.outputTokens ?? 0) + 30,
    };
    assert.deepEqual(report.textModelUsage, usage);
    const storedEvent = report.recent.find(event => event.requestId === failedId);
    assert.deepEqual(Object.keys(storedEvent).sort(), ['action', 'occurredAt', 'requestId', 'status']);
    assert.equal(storedEvent.status, 503);
    assert.equal(JSON.stringify(report).includes(question), false);
    assert.equal(JSON.stringify(report).includes('합성 운영 로그 검수 세부 정보'), false);
    assert.deepEqual(report.recent.find(event => event.requestId === partialId).analysisFailures,
      [{ field: 'guide', code: 'PROVIDER_ERROR' }]);

    await page.route(url => url.pathname === '/api/admin/artworks',
      route => route.fulfill({ status: 503, json: { error: '합성 목록 장애' } }), { times: 1 });
    await page.reload();
    await page.getByRole('alert').filter({ hasText: '전시와 작품 목록을 불러오지 못했어요.' }).waitFor();
    await button(page, '다시 조회').click();
    const activity = page.getByRole('region', { name: '오늘 AI 운영 현황' });
    await activity.getByText('도슨트 질문', { exact: true }).waitFor();
    await activity.getByRole('listitem').filter({ hasText: '텍스트 모델 호출 시도' })
      .getByText(`${usage.attempts}건`, { exact: true }).waitFor();
    await activity.getByRole('link', { name: 'AI 관리 자세히 보기' }).click();
    await page.getByText(`텍스트 모델 호출 시도 ${usage.attempts}건 · 입력 ${usage.inputTokens.toLocaleString('ko-KR')} · 출력 ${usage.outputTokens.toLocaleString('ko-KR')} 토큰 · 토큰 미수집 요청 ${usage.missing}건`, { exact: true }).waitFor();
    const summaryGroup = report.textModelUsageByTaskModel.find(row => row.task === 'summary' && row.model === 'synthetic-operations');
    const guideGroup = report.textModelUsageByTaskModel.find(row => row.task === 'guide' && row.model === 'synthetic-operations');
    assert.equal(summaryGroup.cachedInputTokens, summaryGroup.attempts * 45);
    assert.equal(guideGroup.cachedInputTokens, null);
    const modelTable = page.getByRole('region', { name: '작업·모델별 토큰 사용량' });
    await modelTable.getByRole('row').filter({ hasText: '쉬운 요약' }).getByText(String(summaryGroup.cachedInputTokens), { exact: true }).waitFor();
    await modelTable.getByRole('row').filter({ hasText: '관람가이드' }).getByText(`토큰 ${guideGroup.missing}건 · 캐시 ${guideGroup.cacheMissing}건`, { exact: true }).waitFor();
    const voiceTable = page.getByRole('region', { name: '음성 모델 사용량' });
    const voiceRow = voiceTable.getByRole('row').filter({ hasText: 'synthetic-voice' });
    await voiceRow.getByText('미리 준비', { exact: true }).waitFor();
    await voiceRow.getByText('1/2건', { exact: true }).waitFor();
    await voiceRow.getByText('USD 0.001093440 · 1/2건', { exact: true }).waitFor();
    assert.equal(await page.getByText(requestId, { exact: true }).count(), 0);
    await page.getByRole('link', { name: '운영 로그', exact: true }).click();
    await page.getByText(requestId, { exact: true }).waitFor();
    await page.getByText(failedId, { exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'OpenAI 연결 설정' }).count(), 0);
    assert.equal(await page.getByRole('region', { name: '음성 모델 사용량' }).count(), 0);
    fixtureCommand([
      'from uuid import uuid4',
      'from arti.models import OperationEvent',
      'OperationEvent.objects.bulk_create([OperationEvent(action="artwork_save", status=200, request_id=uuid4()) for _ in range(51)])',
    ]);
    await button(page, '다시 조회').click();
    await page.getByText(failedId, { exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('checkbox', { name: '오류만 보기' }).check();
    await page.getByText(failedId, { exact: true }).waitFor();
    const partialRow = page.getByRole('row').filter({ hasText: partialId });
    await partialRow.getByText('관람가이드 · PROVIDER_ERROR', { exact: true }).waitFor();
    await partialRow.getByText('200', { exact: true }).waitFor();
    await page.getByRole('row').filter({ hasText: fullFailureId }).getByText('502', { exact: true }).waitFor();
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

async function passwordReset(browser) {
  const page = await openPage(browser);
  const other = await openPage(browser);
  try {
    // 전시 첫 화면(U-01)의 개인정보 처리방침 링크는 사용자 결정으로 뺐다. 처리방침은 회원가입 화면에서 확인한다.
    await page.goto('/signup');
    const signupEmail = `reset-review-${randomUUID()}@example.test`;
    const field = page.getByLabel('이메일', { exact: true });
    await field.fill(signupEmail);
    await button(page, '서비스 이용약관 보기').click();
    const terms = page.getByRole('dialog', { name: '서비스 이용약관' });
    await terms.getByText('버전 2026-11-18-draft.2').waitFor();
    await terms.getByText(/비밀번호 재설정을 제공하는 환경/).waitFor();
    await button(terms, '닫기').click();
    await button(page, '개인정보 처리방침 보기').click();
    const policy = page.getByRole('dialog', { name: '개인정보 처리방침' });
    await policy.getByRole('heading', { name: '비회원과 브라우저 저장' }).waitFor();
    await policy.getByRole('heading', { name: '카카오 연결' }).waitFor();
    await policy.getByText(/30분 동안 유효/).waitFor();
    await policy.getByText(/arti\.docent@gmail\.com/).first().waitFor();
    await policy.getByText(/회원 탈퇴 시까지 보관/).waitFor();
    await policy.getByRole('heading', { name: '도슨트 대화 저장 선택' }).waitFor();
    await button(policy, '닫기').click();
    assert.equal(await field.inputValue(), signupEmail);
    const transcriptOption = page.getByRole('checkbox', { name: /도슨트 대화 원문 저장에 동의합니다/ });
    await transcriptOption.waitFor();
    await button(page, '이용약관에 동의하고 가입').waitFor();
    assert.equal(await page.getByRole('checkbox').count(), 1);
    assert.equal(await transcriptOption.isChecked(), false);
    assert.equal(await page.getByText(/이메일과 비밀번호는 가입과 로그인에 사용해요/).count(), 0);

    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByLabel('비밀번호 확인', { exact: true }).fill(password);
    const [signupResponse] = await Promise.all([
      page.waitForResponse(r => isResponse(r, '/api/auth/signup', 'POST')),
      button(page, '이용약관에 동의하고 가입').click(),
    ]);
    const signupAgreement = signupResponse.request().postDataJSON();
    assert.equal(signupAgreement.termsAccepted, true);
    assert.equal(signupAgreement.termsVersion, '2026-11-18-draft.2');
    assert.equal(signupAgreement.docentTranscriptAccepted, undefined);
    const member = await body(signupResponse);
    assert.equal(member.user.email, signupEmail);
    await page.waitForURL(base.href);
    console.log('PASS signup: separate privacy policy, explicit terms assent and transcript disabled by default');
    const secondMember = await newMember(other);
    const savedReceipt = await body(await page.request.post('/api/visits', {
      headers: headersFor(member.token),
      data: {
        visitId: randomUUID(), exhibitionId: 'fixture-ex01', date: '2026-11-08T01:00:00Z',
        durationMin: 10, recommendedCount: 3, selectedDuration: '30m', requestGeneration: 1,
        tastes: ['landscape'], viewedArtworkIds: ['fixture-art01'], reactions: {}, reactionReasons: {}, dwell: {},
      },
    }), 201);
    const recoveryPath = '/api/auth/password-reset/request';
    const requestedEmails = [];
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === recoveryPath) {
        requestedEmails.push(request.postDataJSON().email);
      }
    });
    await page.goto('/login');
    await button(page, '로그인 도움').click();
    // The login form has the same email label while the recovery screen is loading.
    await page.getByRole('heading', { name: '비밀번호 재설정', exact: true }).waitFor();
    await page.clock.install();
    const emailInput = page.getByLabel('이메일', { exact: true });
    const mailNotice = page.getByRole('status').filter({ hasText: '등록된 이메일이라면' });
    const requestLink = async () => {
      const [response] = await Promise.all([
        page.waitForResponse(r => isResponse(r, recoveryPath, 'POST')),
        button(page, '재설정 링크 요청').click(),
      ]);
      assert.equal(response.status(), 204);
      await mailNotice.waitFor();
      return mailNotice.textContent();
    };
    const mistyped = 'unknown-reset@example.test';
    await emailInput.fill(mistyped);
    const originalNotice = await requestLink();
    assert.match(originalNotice, /스팸함/);
    await button(page, '이메일 수정하기').click();
    await emailInput.waitFor();
    assert.equal(await emailInput.inputValue(), mistyped);
    assert.equal(await emailInput.evaluate(input => input === document.activeElement), true);
    assert.deepEqual(requestedEmails, [mistyped]);
    await emailInput.fill(member.user.email);
    assert.equal(await requestLink(), originalNotice);
    assert.deepEqual(requestedEmails, [mistyped, member.user.email]);
    const inbox = await body(await page.request.post('/api/__test__/reset-inbox'));
    assert.equal(inbox.length, 1);
    const resend = button(page, '메일 다시 보내기');
    assert.equal(await resend.isDisabled(), true);
    await page.getByText('요청 후 30초 뒤에 다시 보낼 수 있어요.').waitFor();
    await page.clock.fastForward(31_000);
    await page.getByText('요청 후 30초 뒤에 다시 보낼 수 있어요.').waitFor({ state: 'hidden' });
    assert.equal(await resend.isEnabled(), true);
    const [resent] = await Promise.all([
      page.waitForResponse(r => isResponse(r, recoveryPath, 'POST')),
      resend.click(),
    ]);
    assert.equal(resent.status(), 204);
    await mailNotice.waitFor();
    assert.equal(await mailNotice.textContent(), originalNotice);
    assert.deepEqual(requestedEmails, [mistyped, member.user.email, member.user.email]);
    const resentInbox = await body(await page.request.post('/api/__test__/reset-inbox'));
    assert.equal(resentInbox.length, 2);
    const resetPath = resentInbox[1];
    assert.notEqual(inbox[0], resetPath);
    const newPassword = 'Replacement-42!';
    const fill = async () => {
      await page.getByLabel('새 비밀번호', { exact: true }).fill(newPassword);
      await page.getByLabel('새 비밀번호 확인', { exact: true }).fill(newPassword);
    };
    await page.goto(inbox[0]);
    await fill();
    await button(page, '비밀번호 바꾸기').click();
    const invalidLinkNotice = page.getByRole('alert').filter({ hasText: '이 링크는 사용할 수 없어요' });
    await invalidLinkNotice.waitFor();
    assert.equal((await page.request.get('/api/auth/me', { headers: headersFor(member.token) })).status(), 200);
    await page.goto(resetPath);
    await page.waitForURL(url => url.pathname === '/password/reset' && !url.hash);
    await fill();
    await button(page, '비밀번호 바꾸기').click();
    await page.getByRole('heading', { name: '비밀번호를 바꿨어요' }).waitFor();
    assert.equal((await page.request.get('/api/auth/me', { headers: headersFor(member.token) })).status(), 401);
    assert.equal((await other.request.get('/api/auth/me', { headers: headersFor(secondMember.token) })).status(), 200);
    const oldLogin = await page.request.post('/api/auth/login', { data: { email: member.user.email, password } });
    assert.equal(oldLogin.status(), 401);
    await page.goto(resetPath);
    await fill();
    await button(page, '비밀번호 바꾸기').click();
    await invalidLinkNotice.waitFor();
    await page.getByRole('link', { name: '로그인으로 돌아가기' }).click();
    await page.getByLabel('이메일', { exact: true }).fill(member.user.email);
    await page.getByLabel('비밀번호', { exact: true }).fill(newPassword);
    const [loginResult] = await Promise.all([
      page.waitForResponse(r => isResponse(r, '/api/auth/login', 'POST')),
      button(page, '로그인').click(),
    ]);
    const restored = await body(loginResult);
    assert.equal(restored.user.id, member.user.id);
    const receiptPath = `/api/visits/${savedReceipt.id}`;
    assert.equal((await other.request.get(receiptPath, { headers: headersFor(secondMember.token) })).status(), 403);
    await page.waitForURL(base.href);
    await page.goto('/mypage');
    const receiptCard = page.getByRole('button', { name: /아트 영수증 보기/ });
    await receiptCard.waitFor();
    assert.equal(await receiptCard.count(), 1);
    const [opened] = await Promise.all([
      page.waitForResponse(response => isResponse(response, receiptPath, 'GET')),
      receiptCard.click(),
    ]);
    assert.equal((await body(opened)).id, savedReceipt.id);
    await page.waitForURL(`**/receipt/${savedReceipt.id}`);
    console.log('PASS password reset: email correction, 30s resend, identical acknowledgement, latest one-use link, same receipt and permissions');

    await page.goto('/mypage');
    await page.getByRole('link', { name: '계정 설정' }).click();
    await page.getByText('회원 탈퇴', { exact: true }).click();
    const currentPassword = page.getByLabel('현재 비밀번호', { exact: true });
    const withdrawalPath = `/api/users/${member.user.id}/withdrawal`;
    const withdraw = async (input) => {
      await currentPassword.fill(input);
      await button(page, '계정 탈퇴 완료').click();
      const [response] = await Promise.all([
        page.waitForResponse(r => isResponse(r, withdrawalPath, 'POST')),
        page.getByRole('alertdialog').getByRole('button', { name: '회원 탈퇴', exact: true }).click(),
      ]);
      return response;
    };
    assert.equal((await withdraw(password)).status(), 400);
    await page.getByRole('alert').filter({ hasText: '현재 비밀번호가 올바르지 않아요' }).waitFor();
    assert.equal(await currentToken(page), restored.token);
    assert.equal((await withdraw(newPassword)).status(), 204);
    await page.waitForURL(base.href);
    assert.equal(await currentToken(page), null);
    assert.equal((await page.request.get(receiptPath, { headers: headersFor(restored.token) })).status(), 401);
    assert.equal((await other.request.get('/api/auth/me', { headers: headersFor(secondMember.token) })).status(), 200);
    console.log('PASS account withdrawal: verified password, browser sign-out, receipt revoked and other member unaffected');
  } finally {
    await Promise.all([page.close(), other.close()]);
  }
}

async function spainNextArtwork(browser) {
  const slug = 'spain500-sac-2026';
  const exhibitionPath = '/exhibitions/' + slug;
  const old = 'spain-map-fixture-old';
  const recent = 'spain-map-fixture-recent';
  const page = await openPage(browser);
  const setLayout = (example, blocked) => fixtureCommand([
    'import json',
    'from arti.models import Artwork, Exhibition',
    'slug, old, recent, example, blocked = json.loads(os.environ["ARTI_SPAIN_MAP_FIXTURE"])',
    'assert not Exhibition.objects.filter(pk=slug).exclude(subtitle="Synthetic Spain map QA").exists()',
    'wall = [{"x":45,"y":4,"w":10,"h":92}] if blocked else []',
    'plan = {"file":"fixture-public.png","width":360,"height":360}',
    'region = {"x":4,"y":4,"w":92,"h":92}',
    'layout = {"floorPlanRevision":1,"example":example,"walkable":[region],"walls":wall,"pillars":[],"doors":[],"corridors":[],"waypoints":[]}',
    'Exhibition.objects.update_or_create(pk=slug, defaults={"title":"스페인 지도 합성 검수","subtitle":"Synthetic Spain map QA","start_date":"2020-01-01","end_date":"2099-12-31","status":"running","entrance_x":10,"entrance_y":20,"floor_plan":plan,"navigation_layout":layout,"direct_visit_order":[old,recent],"rooms":[{"id":"room","name":"검수 전시실",**region}]})',
    'for pk, x, year in ((old,20,"1549"),(recent,80,"1931")):',
    '    Artwork.objects.update_or_create(pk=pk, defaults={"exhibition_id":slug,"title":year+"년 합성 작품","year":year,"room_id":"room","position_x":x,"position_y":20,"review_status":"approved","description":"합성 근거"})',
  ], { ARTI_SPAIN_MAP_FIXTURE: JSON.stringify([slug, old, recent, example, blocked]) });
  try {
    setLayout(true, false);
    await page.setViewportSize({ width: 360, height: 760 });
    await page.goto(exhibitionPath);
    await button(page, '전시 순서로 바로 보기').click();
    await page.getByRole('heading', { name: '1549년 합성 작품', exact: true }).waitFor();
    await button(page, '다음 작품 안내').click();
    await button(page, '2번 작품 감상하기').waitFor();
    const heading = page.getByRole('heading', { name: /1931년 합성 작품/ });
    await heading.waitFor();
    assert.equal(await page.locator('.floor-map, .fm-route').count(), 0);
    await page.getByText('전체 관람 순서', { exact: true }).click();
    assert.equal(await page.locator('.floor-map, .fm-route').count(), 0);

    setLayout(false, false);
    await page.reload();
    await heading.waitFor();
    await page.locator('.floor-map').waitFor();
    await page.locator('.fm-route.active').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.fm-route').count(), 1);

    setLayout(false, true);
    await page.reload();
    await heading.waitFor();
    await page.getByText('이동 경로는 현장 안내를 따라가 주세요.', { exact: true }).waitFor();
    await page.getByText('전체 지도와 관람 순서', { exact: true }).click();
    await page.locator('.floor-map').waitFor();
    assert.equal(await page.locator('.fm-route').count(), 0);
    await button(page, '2번 작품 감상하기').click();
    await page.getByRole('heading', { name: '1931년 합성 작품', exact: true }).waitFor();
    console.log('PASS Spain next artwork: example hidden, verified leg only, blocked path omitted, visit continues');
  } finally {
    await page.close();
  }
}

(async () => {
  assert(['127.0.0.1', 'localhost'].includes(base.hostname), 'Use a dedicated local synthetic environment.');
  const suite = process.argv[2] || 'all';
  assert(['all', 'receipt-session', 'survey-map', 'recommendation-shortage', 'saved-v2', 'exhibition-order', 'map-variants', 'operations', 'password-reset'].includes(suite), 'Unknown Chrome suite');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    if (suite === 'recommendation-shortage') return await recommendationShortage(browser);
    if (suite === 'saved-v2') {
      await broadTasteTie(browser);
      return await savedV2(browser);
    }
    if (suite === 'map-variants') {
      await mapVariants(browser);
      return await spainNextArtwork(browser);
    }
    if (suite === 'operations') return await operationsLog(browser);
    if (suite === 'password-reset') return await passwordReset(browser);
    if (suite === 'exhibition-order') {
      await exhibitionOrder(browser, false);
      await exhibitionOrder(browser, true);
      await exhibitionOrderV2(browser);
      return await adminExhibitionOrder(browser);
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
