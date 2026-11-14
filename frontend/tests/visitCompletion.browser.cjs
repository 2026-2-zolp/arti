/** 로컬 Chrome에서 지도 복귀, 작품 완료, 영수증 저장 경계를 검증합니다. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const base = process.env.ARTI_REVIEW_BASE || 'http://127.0.0.1:5218';
const path = '/exhibitions/visit-test';
const user = { id: 'test-member', email: 'visitor@example.test', tastes: ['warm'] };
const works = ['a', 'b', 'c'].map((id, i) => ({
  id, title: `합성 작품 ${i + 1}`, artist: '시험', year: '', description: '합성 해설',
  tags: ['warm'], palette: ['#a65631', '#e1ad62'], position: { x: 20 + i * 25, y: 40 },
}));
const recommendations = works.map(({ id }) => ({ artworkId: id, matchedTags: ['warm'] }));

async function fixture(browser, width, member, current = 0, seedRecommendations = true) {
  const page = await browser.newPage({ viewport: { width, height: 812 } });
  page.setDefaultTimeout(8000);
  const requests = [];
  const errors = [];
  const failures = new Map();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ visitId, recommendations, user, current }) => {
    let dwellNow = 0;
    performance.now = () => dwellNow;
    window.advanceDwell = ms => { dwellNow += ms; };
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
  }, { visitId: randomUUID(), recommendations: seedRecommendations ? recommendations : [], user: member ? user : null, current });
  await page.route(base + '/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    if (failures.has(pathname)) return route.fulfill({ status: 503, json: { error: failures.get(pathname) } });
    if (pathname === '/api/auth/me') return route.fulfill({ json: user });
    if (pathname === '/api/exhibitions/visit-test') {
      return route.fulfill({ json: { id: 'visit-test', title: '합성 전시', rooms: [], entrance: { x: 5, y: 40 } } });
    }
    if (pathname === '/api/artworks') return route.fulfill({ json: works });
    if (pathname === '/api/recommendations') return route.fulfill({ json: recommendations });
    if (pathname.endsWith('/tag-coverage')) return route.fulfill({ json: { warm: 3 } });
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
  // 두 프레임을 기다려 작품 표시와 레이아웃 효과 적용 뒤에 감상 시간을 진행합니다.
  const spend = ms => page.evaluate(ms => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.advanceDwell(ms);
      resolve();
    }));
  }), ms);
  return { page, button, artwork, requests, errors, failures, spend };
}

async function recoverErrors(browser, member) {
  const { page, button, artwork, requests, errors, failures } = await fixture(browser, member ? 360 : 412, member, 0, false);
  const generic = '요청을 처리하지 못했어요.';
  const retry = button('다시 시도하기');
  const back = button('뒤로가기');
  const visit = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('arti.visit')));
  const checkProgress = async (id, viewed) => {
    const state = await visit();
    assert.equal(state.visitId, id);
    assert.equal(state.current, viewed.length);
    assert.deepEqual(state.viewed, viewed);
    assert.deepEqual(state.recommendations.map(rec => rec.artworkId), ['a', 'b', 'c']);
  };
  const errorCard = async (message) => {
    const alert = page.getByRole('alert').filter({ hasText: message });
    await alert.waitFor();
    assert(!((await alert.textContent()).includes(generic)), '중복 기본 오류 문구 생략');
  };
  try {
    failures.set('/api/recommendations', generic);
    await page.goto(base + path + '/recommend', { waitUntil: 'domcontentloaded' });
    await errorCard('추천 작품을 불러오지 못했어요.');
    const id = (await visit()).visitId;
    const headerHeight = await page.locator('.m-shell').evaluate(shell => ({
      measured: getComputedStyle(shell).getPropertyValue('--m-header-h').trim(),
      actual: `${shell.querySelector('.m-header').offsetHeight}px`,
    }));
    assert.equal(headerHeight.measured, headerHeight.actual);
    failures.delete('/api/recommendations');
    await retry.click();
    await button('2D 지도에서 경로 보기').click();
    await button('관람 시작하기').click();
    await artwork(1).waitFor();
    await checkProgress(id, []);

    failures.set('/api/exhibitions/visit-test', '합성 지도 장애');
    await button('다음 작품 안내').click();
    await errorCard('합성 지도 장애');
    await checkProgress(id, ['a']);
    await back.click();
    await page.waitForURL('**/recommend');
    await button('2D 지도에서 경로 보기').click();
    await errorCard('지도 정보를 불러오지 못했어요.');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/recommend');
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await errorCard('지도 정보를 불러오지 못했어요.');
    failures.delete('/api/exhibitions/visit-test');
    await retry.click();
    await checkProgress(id, ['a']);

    failures.set('/api/artworks/b', generic);
    await button('2번 작품 감상하기').click();
    await errorCard('작품 정보를 불러오지 못했어요.');
    assert.equal(await button('다음 작품 안내').count(), 0);
    await back.click();
    await button('2번 작품 감상하기').click();
    await errorCard('작품 정보를 불러오지 못했어요.');
    await page.getByRole('alert').getByRole('button', { name: '지도 보기' }).click();
    await button('감상으로 돌아가기').waitFor();
    await back.click();
    await errorCard('작품 정보를 불러오지 못했어요.');
    failures.delete('/api/artworks/b');
    await retry.click();
    await artwork(2).waitFor();
    await checkProgress(id, ['a']);

    failures.set('/api/artworks/b', generic);
    await button('이 부분 더 알아보기').click();
    await errorCard('작품 정보를 불러오지 못했어요.');
    await back.click();
    await errorCard('작품 정보를 불러오지 못했어요.');
    failures.delete('/api/artworks/b');
    await retry.click();
    await artwork(2).waitFor();
    await checkProgress(id, ['a']);
    await button('다음 작품 안내').click();
    await button('3번 작품 감상하기').click();
    await artwork(3).waitFor();
    await checkProgress(id, ['a', 'b']);
    await button('관람 마치기').click();
    await page.getByRole('heading', { name: '오늘의 관람이 완성됐어요' }).waitFor();
    if (member) await page.getByText('관람기록에 저장되었어요').waitFor();
    await checkProgress(id, ['a', 'b', 'c']);
    assert.equal(requests.length, member ? 1 : 0);
    if (member) assert.deepEqual(requests[0].viewedArtworkIds, ['a', 'b', 'c']);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

async function recoverNewErrorCards(browser) {
  const { page, button, failures, requests, errors } = await fixture(browser, 360, true, 1);
  const generic = '요청을 처리하지 못했어요.';
  const retry = button('다시 시도하기');
  const issue = async text => {
    const alert = page.getByRole('alert').filter({ hasText: text });
    await alert.waitFor();
    assert(!(await alert.textContent()).includes(generic));
  };
  const survey = Array.from({ length: 10 }, (_, i) => ({ ...works[i % 3], id: `survey-${i}`, title: `조사 작품 ${i}` }));
  const pool = {
    ready: true, poolVersion: 'synthetic-pool', artworks: survey,
    pairs: Array.from({ length: 5 }, (_, i) => ({ leftId: survey[i * 2].id, rightId: survey[i * 2 + 1].id })),
  };
  const saved = {
    id: 'test-history', exhibitionTitle: '지난 합성 관람', venue: '합성 장소', date: '2026-11-14T00:00:00Z',
    viewedArtworkIds: ['a'], recommendedCount: 3, durationMin: 5, reactions: { a: 'like' },
    keywords: ['따뜻한 색감'], artworkSnapshots: works.slice(0, 1),
  };
  const routes = {
    '/api/taste-pool': pool,
    '/api/auth/kakao/status': { enabled: false, linked: false },
    '/api/users/test-member/visits': [saved],
    '/api/visits/test-history': saved,
  };
  await page.route(base + '/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (!(pathname in routes) || failures.has(pathname)) return route.fallback();
    return route.fulfill({ json: routes[pathname] });
  });
  try {
    failures.set('/api/taste-pool', generic);
    await page.goto(base + path + '/taste', { waitUntil: 'domcontentloaded' });
    await issue('취향 조사 작품을 불러오지 못했어요.');
    const visitId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('arti.visit')).visitId);
    failures.delete('/api/taste-pool');
    await retry.click();
    await button('조사 작품 0').click();
    await button('조사 작품 2').waitFor();
    failures.set('/api/taste-pool', generic);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await issue('취향 조사 작품을 불러오지 못했어요.');
    failures.delete('/api/taste-pool');
    await retry.click();
    await button('조사 작품 2').waitFor();
    await page.getByRole('link', { name: '현재 관람으로 돌아가기' }).click();
    await button('2D 지도에서 경로 보기').click();
    await button('2번 작품 감상하기').waitFor();

    failures.set('/api/users/test-member/visits', generic);
    await page.goto(base + '/mypage', { waitUntil: 'domcontentloaded' });
    await issue('관람기록을 불러오지 못했어요.');
    failures.delete('/api/users/test-member/visits');
    await retry.click();
    const history = page.getByRole('button', { name: /지난 합성 관람/ });
    failures.set('/api/visits/test-history', generic);
    await history.click();
    await issue('영수증을 불러오지 못했어요.');
    failures.delete('/api/visits/test-history');
    await retry.click();
    await page.getByText('ART RECEIPT', { exact: true }).waitFor();
    await button('뒤로가기').click();
    await history.waitFor();
    failures.set('/api/artworks', generic);
    await page.getByRole('tab', { name: '좋아요 목록' }).click();
    await issue('좋아요한 작품을 불러오지 못했어요.');
    failures.delete('/api/artworks');
    await retry.click();
    await page.getByText('합성 작품 1', { exact: true }).waitFor();
    const progress = await page.evaluate(() => JSON.parse(sessionStorage.getItem('arti.visit')));
    assert.equal(progress.visitId, visitId);
    assert.equal(progress.current, 1);
    assert.deepEqual(progress.viewed, ['a']);
    assert.deepEqual(requests, []);

    await page.goto(base + path + '/taste/saved', { waitUntil: 'domcontentloaded' });
    await button('이 취향으로 관람 시작').waitFor();
    failures.set('/api/auth/me', generic);
    await button('이 취향으로 관람 시작').click();
    await issue('저장된 취향을 적용하지 못했어요.');
    failures.delete('/api/auth/me');
    await button('이 취향으로 관람 시작').click();
    await page.getByRole('button', { name: '취소', exact: true }).click();

    await page.evaluate(() => {
      const state = JSON.parse(sessionStorage.getItem('arti.visit'));
      state.tasteProfile = { version: 2, source: 'manual', selectedTags: ['warm'], picks: [], counts: {}, poolVersion: null };
      sessionStorage.setItem('arti.visit', JSON.stringify(state));
    });
    await page.goto(base + path + '/time', { waitUntil: 'domcontentloaded' });
    await page.getByRole('radio', { name: /1시간/ }).click();
    failures.set('/api/taste-profiles/resolve', generic);
    await button('추천 받기').click();
    await button('확인하고 계속').click();
    await issue('관람 시간을 적용하지 못했어요.');
    const afterFailure = await page.evaluate(() => JSON.parse(sessionStorage.getItem('arti.visit')));
    assert.equal(afterFailure.visitId, visitId);
    assert.equal(afterFailure.duration, '30m');
    assert.deepEqual(afterFailure.viewed, ['a']);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

async function visitHistory(browser) {
  const { page, button, artwork, requests, errors } = await fixture(browser, 360, true);
  try {
    const nextGuide = page.getByRole('heading', { name: '다음 작품 안내', exact: true });
    await page.goto(base + path + '/recommend', { waitUntil: 'domcontentloaded' });
    await button('2D 지도에서 경로 보기').click();
    await button('관람 시작하기').click();
    await artwork(1).waitFor();

    await button('지도 보기').click();
    await button('감상으로 돌아가기').waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/recommend');
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await button('감상으로 돌아가기').waitFor();
    await button('뒤로가기').click();
    await artwork(1).waitFor();

    await button('다음 작품 안내').click();
    await nextGuide.waitFor();
    await button('2번 작품 감상하기').waitFor();
    const guideKey = await page.evaluate(() => history.state.key);
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await nextGuide.waitFor();
    await button('2번 작품 감상하기').waitFor();
    assert.equal(await page.evaluate(() => history.state.key), guideKey, '닫은 지도가 앞으로가기에 남지 않음');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await nextGuide.waitFor();
    await button('2번 작품 감상하기').waitFor();
    await button('뒤로가기').click();
    await page.waitForURL('**/recommend');
    await button('2D 지도에서 경로 보기').click();
    await button('2번 작품 감상하기').click();
    await artwork(2).waitFor();
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/recommend');
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await artwork(2).waitFor();

    await button('뒤로가기').click();
    await button('2번 작품 감상하기').click();
    await artwork(2).waitFor();
    await button('다음 작품 안내').click();
    await button('3번 작품 감상하기').waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await button('3번 작품 감상하기').click();
    await artwork(3).waitFor();
    await button('관람 마치기').click();
    await page.getByText('관람기록에 저장되었어요').waitFor();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].viewedArtworkIds, ['a', 'b', 'c']);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
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
  const { page, button, artwork, requests, errors, spend } = await fixture(browser, member ? 360 : 412, member);
  try {
    await page.goto(base + path + '/route', { waitUntil: 'domcontentloaded' });
    await button('관람 시작하기').click();
    await artwork(1).waitFor();
    await spend(2200);
    await button('지도 보기').click();
    await button('감상으로 돌아가기').waitFor();
    const firstDwell = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('arti.visit')).dwell.a);
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('arti.visit')).dwell.a === 2);
    await spend(120000);
    assert.equal(await firstDwell(), 2);
    await button('감상으로 돌아가기').click();
    await artwork(1).waitFor();
    await spend(2100);
    await button('다음 작품 안내').evaluate(element => { element.click(); element.click(); });
    await page.getByRole('heading', { name: '다음 작품 안내', exact: true }).waitFor();
    await button('2번 작품 감상하기').click();
    await artwork(2).waitFor();
    await button('뒤로가기').click();
    await page.getByRole('heading', { name: '추천 관람 경로', exact: true }).waitFor();
    await button('2번 작품 감상하기').click();
    await artwork(2).waitFor();
    await spend(2100);
    await button('다음 작품 안내').click();
    await button('3번 작품 감상하기').click();
    await artwork(3).waitFor();
    await spend(60000);
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
      assert.deepEqual(dwell, { a: 4, b: 2, c: 60 });
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
    const dwell = await page.evaluate(() => JSON.parse(sessionStorage.getItem('arti.visit')).dwell);
    throw new Error(`${error.message}\nURL ${page.url()} · ${JSON.stringify(dwell)} · ${body.slice(0, 400)} · ${errors.join(' / ')}`);
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [name, check] of [
      ['관람 시작 전 영수증 직접 진입', browser => prematureReceipt(browser, 0)],
      ['관람 도중 영수증 직접 진입', browser => prematureReceipt(browser, 1)],
      ['지도와 다음 작품 안내의 뒤로가기·새로고침', visitHistory],
      ['회원 오류 복구와 관람 순서', browser => recoverErrors(browser, true)],
      ['비회원 오류 복구와 관람 순서', browser => recoverErrors(browser, false)],
      ['취향 조사·확인, 관람 시간, 마이페이지·과거 영수증 오류 복구', recoverNewErrorCards],
      ['회원 3점 관람', browser => completeVisit(browser, true)],
      ['비회원 3점 관람', browser => completeVisit(browser, false)],
    ]) {
      try { await check(browser); console.log(`PASS ${name}`); }
      catch (error) { console.error(`FAIL ${name}`, error.message); process.exitCode = 1; }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
