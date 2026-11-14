/** 합성 API로 관리자 목록·상세 재시도와 회원 전환 중 늦은 응답을 검증합니다. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.ARTI_REVIEW_BASE || 'http://127.0.0.1:5215';

(async () => {
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const members = ['a', 'b', 'c'].map(id => ({
    id, email: `${id}@example.test`, nickname: `합성 회원 ${id}`, tastes: [],
    createdAt: '2026-11-14', visitCount: id === 'a' ? 1 : 0, lastVisit: null, status: 'active',
  }));
  let listFails = true, detailFails = true;
  const releases = [];
  const paths = [];
  try {
    await page.addInitScript(() => {
      localStorage.setItem('arti.admin', JSON.stringify({name: '합성 관리자'}));
      localStorage.setItem('arti.adminToken', JSON.stringify('synthetic-only-admin'));
    });
    await page.route(base + '/api/**', async route => {
      const url = new URL(route.request().url());
      paths.push(url.pathname);
      assert.equal(route.request().headers()['x-admin-token'], 'synthetic-only-admin');
      if (url.pathname === '/api/admin/members') {
        if (listFails) return route.fulfill({status: 503, json: {error: '합성 목록 오류'}});
        return route.fulfill({json: url.searchParams.get('q') === 'no-match' ? [] : members});
      }
      if (url.pathname === '/api/admin/members/a/visits') {
        if (detailFails) return route.fulfill({status: 503, json: {error: '합성 상세 오류'}});
        return route.fulfill({json: [{id: 'visit-a', date: '2026-11-14', viewedArtworkIds: ['work-a'], durationMin: 11}]});
      }
      if (url.pathname === '/api/admin/members/b/visits') {
        await new Promise(resolve => {releases.push(resolve);});
        return route.fulfill({json: [{id: 'visit-b', date: '2026-11-13', viewedArtworkIds: ['work-b'], durationMin: 99}]});
      }
      if (url.pathname === '/api/admin/members/c/visits') return route.fulfill({json: []});
      throw new Error('Unexpected request ' + url.pathname);
    });
    await page.goto(base + '/admin/members', {waitUntil: 'domcontentloaded'});
    await page.getByRole('button', {name: '회원 목록 다시 불러오기'}).waitFor();
    listFails = false;
    await page.getByRole('button', {name: '회원 목록 다시 불러오기'}).click();
    await page.getByRole('button', {name: 'a@example.test 관람 기록 보기'}).click();
    await page.getByRole('alert').filter({hasText: '합성 상세 오류'}).waitFor();
    assert.equal(await page.getByText('기록 없음', {exact: true}).count(), 0);
    detailFails = false;
    await page.getByRole('button', {name: '관람 기록 다시 불러오기'}).click();
    await page.getByText('작품 1점 · 11분', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'b@example.test 관람 기록 보기'}).click();
    await page.getByRole('status').filter({hasText: '관람 기록을 불러오는 중'}).waitFor();
    await page.getByRole('button', {name: 'c@example.test 관람 기록 보기'}).click();
    await page.getByText('기록 없음', {exact: true}).waitFor();
    const lateResponse = page.waitForResponse(response => response.url().endsWith('/members/b/visits'));
    releases.forEach(resolve => resolve());
    await lateResponse;
    assert.equal(await page.getByText('작품 1점 · 99분', {exact: true}).count(), 0);
    await page.getByLabel('회원 검색').fill('no-match');
    await page.getByRole('button', {name: '검색', exact: true}).click();
    await page.getByText('검색 결과가 없어요.', {exact: true}).waitFor();
    await page.getByText('회원을 선택하면 상세 정보가 표시됩니다.', {exact: true}).waitFor();
    assert(paths.every(path => path.startsWith('/api/admin/')));
    assert.deepEqual(errors, []);
    console.log('PASS admin members: list/detail retry, protected route, empty/search, late response isolation');
  } finally {
    releases.forEach(resolve => resolve());
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
