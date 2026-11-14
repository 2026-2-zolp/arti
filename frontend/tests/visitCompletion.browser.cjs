/** 로컬 Chrome에서 지도 복귀, 작품 완료, 영수증 저장 경계를 검증합니다. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const base = process.env.ARTI_REVIEW_BASE || 'http://127.0.0.1:5218';
const path = '/exhibitions/visit-test';
const user = { id: 'test-member', tastes: [] };
const works = ['a', 'b', 'c'].map((id, i) => ({
  id, title: `합성 작품 ${i + 1}`, artist: '시험', year: '', description: '합성 해설',
  tags: ['warm'], palette: ['#a65631', '#e1ad62'], position: { x: 20 + i * 25, y: 40 },
}));
const recommendations = works.map(({ id }) => ({ artworkId: id, matchedTags: ['warm'] }));

async function fixture(browser, width, member, current = 0) {
  const page = await browser.newPage({ viewport: { width, height: 812 } });
  page.setDefaultTimeout(8000);
  await page.clock.install();
  const requests = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ visitId, recommendations, user, current }) => {
    if (sessionStorage.getItem('arti.visit')) return;
    if (user) {
      localStorage.setItem('arti.user', JSON.stringify(user));
      localStorage.setItem('arti.token', JSON.stringify('synthetic-token'));
    }
    sessionStorage.setItem('arti.visit', JSON.stringify({
      visitId, ownerId: user?.id ?? null, exhibitionId: 'visit-test', requestGeneration: 1,
      duration: '30m', tastes: ['warm'], recommendations, current,
      viewed: recommendations.slice(0, current).map(rec => rec.artworkId),
      startedAt: current > 0 ? Date.now() - 60000 : null,
    }));
  }, { visitId: randomUUID(), recommendations, user: member ? user : null, current });
  await page.route(base + '/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/auth/me') return route.fulfill({ json: user });
    if (pathname === '/api/exhibitions/visit-test') {
      return route.fulfill({ json: { id: 'visit-test', title: '합성 전시', rooms: [], entrance: { x: 5, y: 40 } } });
    }
    if (pathname === '/api/artworks') return route.fulfill({ json: works });
    const work = works.find(work => `/api/artworks/${work.id}` === pathname);
    if (work) return route.fulfill({ json: work });
    if (pathname === '/api/visits' && route.request().method() === 'POST') {
      const record = route.request().postDataJSON();
      requests.push(record);
      return route.fulfill({ json: { ...record, id: record.visitId, persisted: true } });
    }
    return route.fulfill({ status: 404, json: { error: 'Unexpected route' } });
  });
  const button = name => page.getByRole('button', { name, exact: true });
  const artwork = n => page.getByRole('heading', { name: `합성 작품 ${n}`, exact: true });
  return { page, button, artwork, requests, errors };
}

async function prematureReceipt(browser, current) {
  const { page, button, requests, errors } = await fixture(browser, 360, true, current);
  try {
    await page.goto(base + path + '/receipt', { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/visit-test/route', { waitUntil: 'domcontentloaded' });
    await button(current ? '2번 작품 감상하기' : '관람 시작하기').waitFor();
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
  } catch (error) {
    throw new Error(`${error.message}\nURL ${page.url()} · 저장 요청 ${requests.length}회 · ${errors.join(' / ')}`);
  } finally { await page.close(); }
}

async function completeVisit(browser, member) {
  const { page, button, artwork, requests, errors } = await fixture(browser, member ? 360 : 412, member);
  try {
    await page.goto(base + path + '/route', { waitUntil: 'domcontentloaded' });
    await button('관람 시작하기').click();
    await artwork(1).waitFor();
    await page.clock.fastForward(2200);
    await button('지도 보기').click();
    await button('감상으로 돌아가기').waitFor();
    await page.clock.fastForward(12000);
    await button('감상으로 돌아가기').click();
    await artwork(1).waitFor();
    await page.clock.fastForward(2100);
    await button('다음 작품 안내').dblclick();
    await page.getByRole('heading', { name: '다음 작품 안내', exact: true }).waitFor();
    await button('2번 작품 감상하기').click();
    await artwork(2).waitFor();
    await button('뒤로가기').click();
    await page.getByRole('heading', { name: '추천 관람 경로', exact: true }).waitFor();
    await button('2번 작품 감상하기').click();
    await artwork(2).waitFor();
    await page.clock.fastForward(2100);
    await button('다음 작품 안내').click();
    await button('3번 작품 감상하기').click();
    await artwork(3).waitFor();
    await page.clock.fastForward(8000);
    if (member) {
      await page.evaluate(() => {
        const { visitId } = JSON.parse(sessionStorage.getItem('arti.visit'));
        sessionStorage.setItem(`arti.receipt.test-member.${visitId}`, JSON.stringify({
          visitId, viewedArtworkIds: ['a'], exhibitionId: 'visit-test',
        }));
      });
    }
    await button('관람 마치기').click();
    await page.waitForURL('**/visit-test/receipt');
    const longest = page.locator('.receipt dt').filter({ hasText: '가장 오래 본 작품' }).locator('..');
    assert.match(await longest.textContent(), /합성 작품 3/);
    if (member) await page.getByText('관람기록에 저장되었어요').waitFor();
    assert.equal(requests.length, member ? 1 : 0);
    if (member) {
      const { viewedArtworkIds, dwell } = requests[0];
      assert.deepEqual(viewedArtworkIds, ['a', 'b', 'c']);
      assert(dwell.a >= 4 && dwell.a < 10, '지도에 머문 시간과 중복 감상 시간은 제외');
      assert(dwell.b >= 2 && dwell.b < 6);
      assert(dwell.c >= 8 && dwell.c < 12, '마지막 감상 시간을 영수증 요청에 포함');
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.match(await longest.textContent(), /합성 작품 3/);
    if (member) {
      await page.getByText('관람기록에 저장되었어요').waitFor();
      assert.deepEqual(requests[1], requests[0], '새로고침 후 동일한 관람 ID와 저장 내용 유지');
    }
    assert.deepEqual(errors, []);
  } catch (error) {
    const body = await page.locator('body').innerText({ timeout: 1000 });
    throw new Error(`${error.message}\nURL ${page.url()} · ${body.slice(0, 400)} · ${errors.join(' / ')}`);
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [name, check] of [
      ['관람 시작 전 영수증 직접 진입', browser => prematureReceipt(browser, 0)],
      ['관람 도중 영수증 직접 진입', browser => prematureReceipt(browser, 1)],
      ['회원 3점 관람', browser => completeVisit(browser, true)],
      ['비회원 3점 관람', browser => completeVisit(browser, false)],
    ]) {
      try { await check(browser); console.log(`PASS ${name}`); }
      catch (error) { console.error(`FAIL ${name}`, error.message); process.exitCode = 1; }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
