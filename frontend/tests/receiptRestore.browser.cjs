/** Run against the disposable PostgreSQL stacks created by runOpsPreflight.ps1. */
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { body, button, isResponse, choosePairs, recommend } = require('./visitBrowserHelpers.cjs');

const exhibition = '/exhibitions/fixture-ex01';
const fixtureMarker = 'ARTI DEVELOPMENT FIXTURE — NOT A REAL EXHIBITION';
const reason = '색감이 좋아요';
let step = 'configuration';

async function openPage(browser, base, saves, errors) {
  const page = await browser.newPage({ baseURL: base.href, viewport: { width: 390, height: 812 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(10000);
  await page.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  page.on('pageerror', error => errors.push(error));
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/visits') saves.push(request);
  });
  return page;
}

async function checkFixture(page) {
  assert.equal((await body(await page.request.get('/api' + exhibition))).subtitle, fixtureMarker);
  assert.equal((await body(await page.request.get('/api/ready'))).database, 'postgresql');
  assert.deepEqual((await body(await page.request.get('/api/health'))).aiConfiguration, {
    docent: 'disabled', analysis: 'disabled',
  });
}

async function readResponse(page, pathname, method, action) {
  const [response] = await Promise.all([page.waitForResponse(r => isResponse(r, pathname, method)), action()]);
  return response;
}

async function verifyReceiptArtwork(page, titles) {
  await page.getByRole('article', { name: '아트 영수증' }).waitFor();
  const visibleOrder = await page.locator('.receipt-works li > span:first-child').allTextContents();
  assert.deepEqual(visibleOrder.map(title => title.trim()), titles.map((title, index) => `${index + 1}. ${title}`));
}

async function createReceipt(browser, config, base) {
  const saves = [];
  const errors = [];
  const page = await openPage(browser, base, saves, errors);
  try {
    step = 'source-fixture';
    await checkFixture(page);
    step = 'source-signup';
    await page.goto(exhibition);
    await button(page, '관람 시작하기').click();
    await button(page, '회원가입').click();
    await page.getByLabel('이메일', { exact: true }).fill(config.ownerEmail);
    await page.getByLabel('비밀번호', { exact: true }).fill(config.password);
    await page.getByLabel('비밀번호 확인', { exact: true }).fill(config.password);
    await page.getByRole('checkbox', { name: /서비스 이용약관에 동의/ }).check();
    const signup = await readResponse(page, '/api/auth/signup', 'POST', () => button(page, '회원가입').click());
    const { user } = await body(signup);
    assert.equal(user.email, config.ownerEmail);

    step = 'source-recommendation';
    await choosePairs(page);
    await button(page, '취향 미리 확인').click();
    await button(page, '이번 관람만 적용').click();
    const recommendations = await recommend(page);
    const artworkIds = recommendations.map(item => item.artworkId);
    assert.equal(new Set(artworkIds).size, 3);
    const artworks = await Promise.all(artworkIds.map(async id => body(await page.request.get('/api/artworks/' + id))));
    const titles = artworks.map(artwork => artwork.title);

    step = 'source-visit';
    await button(page, '2D 지도에서 경로 보기').click();
    await button(page, '관람 시작하기').click();
    for (const [index, title] of titles.entries()) {
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
      if (index === 0) {
        await button(page, '좋아요').click();
        await button(page, reason).click();
      }
      if (index < titles.length - 1) {
        await button(page, '다음 작품 안내').click();
        await button(page, `${index + 2}번 작품 감상하기`).click();
      }
    }
    step = 'source-save';
    const saved = await readResponse(page, '/api/visits', 'POST', () => button(page, '관람 마치기').click());
    const record = await body(saved, 201);
    assert(record.id && record.visitId);
    assert.equal(record.visitId, saved.request().postDataJSON().visitId);
    assert.equal(record.userId, user.id);
    assert.deepEqual(record.viewedArtworkIds, artworkIds);
    assert.equal(record.reactionReasons[artworkIds[0]], reason);
    assert.equal(record.persisted, true);
    await page.getByText('관람기록에 저장되었어요', { exact: true }).waitFor();
    await verifyReceiptArtwork(page, titles);
    assert.equal(saves.length, 1);
    assert.equal(errors.length, 0);
    return { id: record.id, visitId: record.visitId, userId: user.id, artworkIds, titles, created: saved.status(), saveRequests: saves.length };
  } finally {
    await page.close();
  }
}

async function login(page, email, password) {
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  return body(await readResponse(page, '/api/auth/login', 'POST', () => button(page, '로그인').click()));
}

async function verifyRestoredReceipt(browser, config, base) {
  const saves = [];
  const errors = [];
  const pages = [];
  const newPage = async () => {
    const page = await openPage(browser, base, saves, errors);
    pages.push(page);
    return page;
  };
  const { expected, password } = config;
  const receiptRoute = '/receipt/' + encodeURIComponent(expected.id);
  const receiptApi = '/api/visits/' + encodeURIComponent(expected.id);
  const checkRecord = record => {
    assert.equal(record.id, expected.id);
    assert.equal(record.visitId, expected.visitId);
    assert.equal(record.userId, expected.userId);
    assert.deepEqual(record.viewedArtworkIds, expected.artworkIds);
    assert.equal(record.reactionReasons[expected.artworkIds[0]], reason);
  };
  try {
    step = 'restored-owner';
    const owner = await newPage();
    await checkFixture(owner);
    await owner.goto('/mypage');
    const list = owner.waitForResponse(r => isResponse(r, `/api/users/${expected.userId}/visits`, 'GET'));
    assert.equal((await login(owner, config.ownerEmail, password)).user.id, expected.userId);
    const records = await body(await list);
    assert.equal(records.length, 1);
    checkRecord(records[0]);
    const card = owner.getByRole('button', { name: /아트 영수증 보기/ });
    const ownerDetail = await readResponse(owner, receiptApi, 'GET', () => card.click());
    await owner.waitForURL(new URL(receiptRoute, base).href);
    checkRecord(await body(ownerDetail));
    await verifyReceiptArtwork(owner, expected.titles);

    step = 'restored-reload';
    const refreshed = await readResponse(owner, receiptApi, 'GET', () => owner.reload());
    assert.equal(refreshed.status(), 200);
    await owner.waitForURL(new URL(receiptRoute, base).href);
    await verifyReceiptArtwork(owner, expected.titles);

    step = 'restored-admin';
    const admin = await newPage();
    await admin.goto('/admin/login');
    await admin.getByLabel('관리자 ID').fill(config.adminId);
    await admin.getByLabel('비밀번호', { exact: true }).fill(password);
    const adminLogin = await readResponse(admin, '/api/admin/login', 'POST', () => button(admin, '로그인').click());
    const { token } = await body(adminLogin);
    await admin.waitForURL('**/admin');
    await admin.getByRole('link', { name: '회원 조회', exact: true }).click();
    const adminList = await readResponse(admin, `/api/admin/members/${expected.userId}/visits`, 'GET',
      () => button(admin, `${config.ownerEmail} 관람 기록 보기`).click());
    const adminRecords = await body(adminList);
    assert.equal(adminRecords.length, 1);
    checkRecord(adminRecords[0]);
    await admin.locator('.a-visit-list').getByText(/작품 3점/).waitFor();
    assert.equal(await admin.locator('.a-visit-list > li').count(), 1);
    const adminDetail = await admin.request.get(`/api/admin/visits/${expected.id}`, { headers: { 'X-Admin-Token': token } });
    checkRecord(await body(adminDetail));

    step = 'restored-other';
    const other = await newPage();
    await other.goto(receiptRoute);
    const rejected = other.waitForResponse(r => isResponse(r, receiptApi, 'GET') && r.status() !== 401);
    const otherUser = (await login(other, config.otherEmail, password)).user;
    assert.notEqual(otherUser.id, expected.userId);
    const denied = await rejected;
    assert.equal(denied.status(), 403);
    await other.getByRole('alert').getByText(/영수증을 불러오지 못했어요/).waitFor();
    assert.equal(await other.getByRole('article', { name: '아트 영수증' }).count(), 0);

    step = 'restored-guest';
    const guest = await newPage();
    await guest.goto(receiptRoute);
    await guest.waitForURL(url => url.pathname === '/login' && url.searchParams.get('redirect') === receiptRoute);
    const guestDetail = await guest.request.get(receiptApi);
    assert.equal(guestDetail.status(), 401);
    assert.equal(await guest.getByRole('article', { name: '아트 영수증' }).count(), 0);
    assert.equal(saves.length, 0);
    assert.equal(errors.length, 0);
    return { id: records[0].id, receipts: records.length, saveRequests: saves.length, reload: refreshed.status(),
      owner: ownerDetail.status(), admin: adminDetail.status(), other: denied.status(), guest: guestDetail.status() };
  } finally {
    await Promise.all(pages.map(page => page.close()));
  }
}

(async () => {
  const phase = process.argv[2];
  const config = JSON.parse(readFileSync(0, 'utf8'));
  const base = new URL(config.base);
  assert(['source', 'restored'].includes(phase));
  assert.equal(base.href, `${base.origin}/`);
  assert.equal(base.hostname, '127.0.0.1');
  assert.equal(base.protocol, 'http:');
  assert(config.ownerEmail.endsWith('@example.test') && config.password);
  if (phase === 'restored') assert(config.otherEmail.endsWith('@example.test'));
  step = 'launch';
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const result = phase === 'source' ? await createReceipt(browser, config, base) : await verifyRestoredReceipt(browser, config, base);
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch(() => {
  // Error messages can include browser fill() arguments and request bodies.
  console.error(`Chrome receipt step ${step} failed`);
  process.exitCode = 1;
});
