/** 합성 전시·작품의 삭제, 관리자 확대, 이동 구조 저장을 실제 Django API에서 확인합니다. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = new URL(process.env.ARTI_REVIEW_BASE ?? '');
assert.equal(base.protocol, 'http:');
assert.equal(base.hostname, '127.0.0.1');
const password = process.env.ARTI_BOOTSTRAP_PASSWORD;
assert(password, 'Set ARTI_BOOTSTRAP_PASSWORD for admin-catalog-review.');

const exhibitionId = 'fixture-ex01';
const exhibitionsPath = '/api/admin/exhibitions';
const exhibitionPath = `${exhibitionsPath}/${exhibitionId}`;
const artworksPath = '/api/admin/artworks';
const mapPath = `${exhibitionPath}/navigation`;
const publicPath = `/api/exhibitions/${exhibitionId}`;
const visitorPath = `/exhibitions/${exhibitionId}`;
const button = (container, name) => container.getByRole('button', { name, exact: true });
const focused = locator => locator.evaluate(element => document.activeElement === element);
const match = (request, method, path) => request.method() === method && new URL(request.url()).pathname === path;
const expectedResponse = (page, method, path) => page.waitForResponse(response => match(response.request(), method, path));

async function json(response, status = 200) {
  assert.equal(response.status(), status, response.url());
  return response.json();
}

async function newContext(browser) {
  const context = await browser.newContext({ baseURL: base.href, viewport: { width: 1100, height: 850 }, serviceWorkers: 'block' });
  context.setDefaultTimeout(12000);
  await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  return context;
}

async function signIn(browser) {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.goto('/admin/login');
  await page.getByLabel('관리자 ID').fill('admin-catalog-review');
  await page.getByLabel('비밀번호').fill(password);
  const login = expectedResponse(page, 'POST', '/api/admin/login');
  await button(page, '로그인').click();
  const { token } = await json(await login);
  assert.equal(typeof token, 'string');
  await page.waitForURL('**/admin');
  return { page, request: context.request, headers: { 'X-Admin-Token': token } };
}

async function verifyExhibition({ page, request, headers }, original) {
  const created = await json(await request.post(exhibitionsPath, { headers, data: {
    title: '삭제 검수용 빈 전시', status: 'draft', subtitle: '', venue: '', rooms: [],
    startDate: original.startDate, endDate: original.endDate, entrance: original.entrance,
  } }));
  const path = `${exhibitionsPath}/${created.id}`;
  const requests = [];
  page.on('request', item => { if (match(item, 'DELETE', path)) requests.push(item.headers()['if-match']); });
  const edit = async title => {
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: title, exact: true }) });
    await button(row, '수정').click();
    return page.getByRole('dialog', { name: '전시 수정' });
  };
  const openConfirmation = async editor => {
    await button(editor, '전시 삭제').click();
    return page.getByRole('alertdialog', { name: '전시 삭제' });
  };

  await page.goto('/admin/exhibitions');
  let editor = await edit(original.title);
  assert(await button(editor, '전시 삭제').isDisabled());
  await button(editor, '취소').click();
  editor = await edit(created.title);
  await button(await openConfirmation(editor), '취소').click();
  assert.deepEqual(requests, []);
  assert(await focused(button(editor, '전시 삭제')));
  const updated = await json(await request.put(path, { headers, data: { ...created, title: '다른 관리자 수정본 전시' } }));
  const rejected = expectedResponse(page, 'DELETE', path);
  await button(await openConfirmation(editor), '전시 삭제').click();
  assert.equal((await json(await rejected, 409)).code, 'VERSION_CONFLICT');
  await editor.getByRole('alert').filter({ hasText: '전시가 변경됐어요.' }).waitFor();
  assert.equal((await json(await request.get(path, { headers }))).version, updated.version);
  assert(await button(editor, '전시 삭제').isDisabled());
  await button(editor, '취소').click();
  editor = await edit(updated.title);

  const deleted = expectedResponse(page, 'DELETE', path);
  await button(await openConfirmation(editor), '전시 삭제').click();
  assert.equal((await deleted).status(), 204);
  await editor.waitFor({ state: 'hidden' });
  await page.getByRole('link', { name: updated.title, exact: true }).waitFor({ state: 'hidden' });
  assert(await focused(button(page, '+ 전시 등록')));
  assert.equal((await request.get(path, { headers })).status(), 404);
  assert.deepEqual(requests, [`"${created.version}"`, `"${updated.version}"`]);
  console.log('PASS exhibition: running protection, cancel sends no request, stale DELETE 409, refreshed DELETE 204 and focus restored');
}

async function verifyArtwork({ page, request, headers }) {
  const protectedPath = `${artworksPath}/fixture-art12`;
  const protectedWork = await json(await request.get(protectedPath, { headers }));
  assert.equal(protectedWork.reviewStatus, 'approved');
  assert.equal(protectedWork.showImage, false);
  assert(protectedWork.imageFile);
  assert.equal((await request.get(`/api/uploads/${protectedWork.imageFile}`)).status(), 404);
  const refused = await request.delete(protectedPath, { headers: { ...headers, 'If-Match': `"${protectedWork.version}"` } });
  assert.equal((await json(refused, 409)).code, 'DELETE_BLOCKED');

  const loaded = expectedResponse(page, 'GET', `/api/admin/uploads/${protectedWork.imageFile}`);
  await page.goto(`/admin/artworks/${protectedWork.id}`);
  const preview = button(page, '작품 이미지 크게 보기');
  assert.equal((await loaded).status(), 200);
  await preview.locator('img').evaluate(image => image.decode());
  assert(await button(page, '작품 삭제').isDisabled());
  const image = await preview.locator('img').getAttribute('src');
  assert.match(image, /^blob:/);
  const zoom = page.getByRole('dialog', { name: `${protectedWork.title} 크게 보기` });
  const close = button(zoom, '크게 보기 닫기');
  await preview.press('Enter');
  await close.waitFor();
  await zoom.evaluate(async dialog => {
    await Promise.all(dialog.getAnimations().map(animation => animation.finished));
  });
  const box = await zoom.boundingBox();
  const viewport = page.viewportSize();
  assert(box && viewport && box.width < viewport.width && box.height < viewport.height);
  assert(Math.abs(box.x + box.width / 2 - viewport.width / 2) < 2);
  assert(Math.abs(box.y + box.height / 2 - viewport.height / 2) < 2);
  assert(await focused(close));
  assert.equal(await zoom.getByRole('img', { name: protectedWork.title }).getAttribute('src'), image);
  await zoom.locator('.zoom-stage').hover();
  await page.mouse.wheel(0, -470);
  await page.waitForFunction(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.zoom-content')).transform).m11 > 1);
  await page.keyboard.press('Escape');
  await zoom.waitFor({ state: 'hidden' });
  assert(await focused(preview));
  await preview.click();
  await close.click();
  assert(await focused(preview));

  const created = await json(await request.post(artworksPath, { headers, data: {
    ...protectedWork, title: '삭제 검수용 새 작품', reviewStatus: 'pending', position: null, roomId: '',
    imageUrl: '', showImage: false, summary: '', summaryKeywords: [], summaryStatus: 'none', guidedLooking: [],
    guidedHints: [], guideIntro: '', guideStatus: 'none', tags: [], tagStatus: 'none', emotionStatus: 'none',
  } }));
  const path = `${artworksPath}/${created.id}`;
  const requests = [];
  page.on('request', item => { if (match(item, 'DELETE', path)) requests.push(item.headers()['if-match']); });
  await page.goto(`/admin/artworks/${created.id}`);
  const remove = button(page, '작품 삭제');
  const confirmation = page.getByRole('alertdialog', { name: '작품 삭제' });
  await remove.click();
  await button(confirmation, '취소').click();
  assert.deepEqual(requests, []);
  assert(await focused(remove));
  const updated = await json(await request.put(path, { headers, data: { ...created, title: '다른 관리자 수정본 작품' } }));
  const rejected = expectedResponse(page, 'DELETE', path);
  await remove.click();
  await button(confirmation, '삭제').click();
  assert.equal((await json(await rejected, 409)).code, 'VERSION_CONFLICT');
  assert.equal((await json(await request.get(path, { headers }))).version, updated.version);
  const reload = button(page, '최신 작품 다시 불러오기');
  await reload.waitFor();
  assert(await remove.isDisabled());
  await reload.click();
  await button(page.getByRole('alertdialog'), '다시 불러오기').click();
  const title = page.getByRole('textbox', { name: '작품명', exact: true });
  await page.waitForFunction(expected => [...document.querySelectorAll('input')].some(input => input.value === expected), updated.title);
  assert.equal(await title.inputValue(), updated.title);

  const deleted = expectedResponse(page, 'DELETE', path);
  await remove.click();
  await button(confirmation, '삭제').click();
  assert.equal((await deleted).status(), 204);
  await page.waitForURL(url => url.pathname === '/admin/artworks' && url.searchParams.get('exhibition') === exhibitionId);
  await page.getByRole('heading', { name: '작품 관리', exact: true }).waitFor();
  assert.equal((await request.get(protectedPath, { headers })).status(), 200);
  assert.equal(await page.getByRole('link', { name: updated.title, exact: true }).count(), 0);
  assert.equal((await request.get(path, { headers })).status(), 404);
  assert.deepEqual(requests, [`"${created.version}"`, `"${updated.version}"`]);
  console.log('PASS artwork: protected image loads from admin media, zoom and both close controls restore focus, approved deletion blocked, draft cancel/409/204');
}

async function verifyMap(browser, { page, request, headers }, original) {
  const firstWall = { x: 22, y: 20, w: 3, h: 15 };
  const secondWall = { x: 58, y: 48, w: 4, h: 25 };
  const layout = { walkable: [{ x: 4, y: 4, w: 92, h: 92 }], walls: [firstWall, secondWall],
    pillars: [], doors: [], corridors: [], waypoints: [{ x: 32, y: 24 }] };
  const png = await request.get('/api/uploads/fixture-public.png');
  assert.equal(png.status(), 200);
  const plan = await json(await request.post(`${exhibitionPath}/floor-plan?width=1&height=1`, {
    headers: { ...headers, 'If-Match': `"${original.version}"`, 'Content-Type': 'image/png' }, data: await png.body(),
  }));
  const works = ['fixture-art02', 'fixture-art03'];
  for (const [index, id] of works.entries()) {
    const path = `${artworksPath}/${id}`;
    const artwork = await json(await request.get(path, { headers }));
    await json(await request.put(path, { headers, data: { ...artwork, position: { x: index ? 82 : 12, y: 42 } } }));
  }
  const prepared = await json(await request.put(exhibitionPath, { headers, data: { ...plan, entrance: { x: 10, y: 12 } } }));
  const initial = await json(await request.put(mapPath, { headers, data: {
    version: prepared.version, floorPlanRevision: prepared.floorPlanRevision, layout,
  } }));
  const updates = [];
  page.on('request', item => { if (match(item, 'PUT', mapPath)) updates.push(item.postDataJSON()); });
  await page.goto(`/admin/map?exhibition=${exhibitionId}`);
  const editor = page.getByRole('region', { name: '이동 구조 편집' });
  const structures = editor.getByLabel('등록된 구조물', { exact: true });
  const wallX = container => container.locator('rect.fm-wall').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('x'))));
  const openWallEditor = async () => {
    await page.getByText('이동 구조 등록', { exact: true }).click();
    await editor.getByLabel('이동 구조 종류').selectOption('walls');
  };

  await openWallEditor();
  await structures.getByText('등록된 구조물 2개', { exact: true }).click();
  assert.deepEqual(await wallX(editor), [firstWall.x, secondWall.x]);
  await button(structures, '벽 2번 지도에 표시').click();
  assert.equal(Number(await editor.locator('circle.fm-check-focus').getAttribute('cx')), 60);
  await button(structures, '벽 1번 삭제').click();
  await structures.getByText('등록된 구조물 1개', { exact: true }).waitFor();
  assert.deepEqual(await wallX(editor), [secondWall.x]);
  assert.equal(await editor.locator('circle.fm-check-focus').count(), 0);
  assert.deepEqual(updates, []);
  assert.deepEqual((await json(await request.get(publicPath))).navigationLayout.walls, layout.walls);

  const completed = expectedResponse(page, 'PUT', mapPath);
  await button(editor, '이동 구조 저장').click();
  const saved = await json(await completed);
  await editor.getByText('현재 도면 버전에 이동 구조를 저장했어요.', { exact: true }).waitFor();
  const expected = { ...layout, walls: [secondWall] };
  assert.deepEqual(updates, [{ version: initial.version, floorPlanRevision: plan.floorPlanRevision, layout: expected }]);
  assert.deepEqual(saved.navigationLayout, { ...expected, aspect: 1, floorPlanRevision: plan.floorPlanRevision });
  assert.deepEqual((await json(await request.get(publicPath))).navigationLayout, saved.navigationLayout);
  await page.reload();
  await openWallEditor();
  await structures.getByText('등록된 구조물 1개', { exact: true }).waitFor();
  assert.deepEqual(await wallX(editor), [secondWall.x]);
  assert.equal(updates.length, 1);

  const guest = await newContext(browser);
  try {
    const visitor = await guest.newPage();
    await visitor.goto(`${visitorPath}/taste`);
    for (let pair = 1; pair <= 5; pair++) {
      await visitor.getByText(`${pair}/5`, { exact: true }).waitFor();
      await visitor.locator('.duel-card').getByRole('button', { name: / 선택$/ }).first().click();
    }
    await button(visitor, '이 취향으로 계속').click();
    await visitor.getByRole('radio', { name: /30분/ }).click();
    await button(visitor, '추천 받기').click();
    await button(visitor, '지도에서 관람순서 보기').click();
    const map = visitor.locator('.route-map .floor-map');
    await map.locator('polyline.fm-route.active').waitFor();
    assert.deepEqual(await wallX(map), [secondWall.x]);
  } finally {
    await guest.close();
  }
  console.log('PASS A-05: draft-only deletion, 0 PUT before save, 1 PUT retains remaining layout, reload and visitor map use the saved wall');
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const admin = await signIn(browser);
  assert.equal((await json(await admin.request.get('/api/ready'))).database, 'postgresql');
  const ai = (await json(await admin.request.get('/api/health'))).aiConfiguration;
  assert.equal(ai.docent, 'disabled');
  assert.equal(ai.analysis, 'disabled');
  const original = await json(await admin.request.get(exhibitionPath, { headers: admin.headers }));
  assert.match(original.subtitle, /^ARTI DEVELOPMENT FIXTURE /);
  await verifyExhibition(admin, original);
  await verifyArtwork(admin);
  await verifyMap(browser, admin, original);
} finally {
  await browser.close();
}
