/** 독립 관리자 두 세션의 작품 확정·도면 교체·배치 충돌을 실제 API에서 검증합니다. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = new URL(process.env.ARTI_REVIEW_BASE ?? '');
assert.equal(base.protocol, 'http:');
assert.equal(base.hostname, '127.0.0.1');
const password = process.env.ARTI_BOOTSTRAP_PASSWORD;
assert(password, 'Set the synthetic administrator password.');

const exhibitPath = '/api/admin/exhibitions/fixture-ex01';
const workPath = '/api/admin/artworks/fixture-art01';
const floorPlanPath = `${exhibitPath}/floor-plan`;
const visitorExhibit = '/api/exhibitions/fixture-ex01';
const visitorWork = '/api/artworks/fixture-art01';
const description = page => page.getByLabel(/작품 해설 원문/);
const questions = page => page.getByLabel(/^관찰 질문/);
const button = (page, name) => page.getByRole('button', { name, exact: true });
const expectedResponse = (page, method, pathname) => page.waitForResponse(response =>
  new URL(response.url()).pathname === pathname && response.request().method() === method);

async function json(response, expected = 200) {
  assert.equal(response.status(), expected, response.url());
  return response.json();
}

async function signIn(browser, id) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 920 }, baseURL: base.href });
  context.setDefaultTimeout(10000);
  await context.route('**/*', route => (new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort()));
  const page = await context.newPage();
  await page.goto('/admin/login');
  await page.getByLabel('관리자 ID').fill(id);
  await page.getByLabel('비밀번호').fill(password);
  const login = expectedResponse(page, 'POST', '/api/admin/login');
  await button(page, '로그인').click();
  const { token } = await json(await login);
  await page.waitForURL('**/admin');
  return { page, request: context.request, headers: { 'X-Admin-Token': token } };
}

async function confirmReload(page, label, accept) {
  await button(page, label).click();
  await page.getByRole('alertdialog').getByRole('button', { name: accept ? '다시 불러오기' : '취소', exact: true }).click();
}

async function verifyEditorial(a, b, baseline) {
  const editorPath = '/admin/artworks/fixture-art01';
  const readCurrent = async () => json(await b.request.get(workPath, { headers: b.headers }));
  const before = await json(await b.request.put(workPath, {
    headers: b.headers, data: { ...baseline, guideStatus: 'suggested' },
  }));
  await Promise.all([a.page.goto(editorPath), b.page.goto(editorPath)]);
  await description(a.page).waitFor();
  await description(b.page).fill('두 번째 관리자의 새 합성 원문');
  const changed = expectedResponse(b.page, 'PUT', workPath);
  await button(b.page, '저장').click();
  const source = await json(await changed);
  assert.equal(source.sourceVersion, before.sourceVersion + 1);
  assert.equal(source.reviewStatus, 'source_check');
  assert.equal((await a.request.get(visitorWork)).status(), 404);

  await b.page.getByLabel('검수 상태').selectOption('approved');
  await questions(b.page).fill('새 질문인가요? | 새 힌트예요.');
  const confirmed = expectedResponse(b.page, 'PUT', workPath);
  await button(b.page, '가이드 확정 (수정 내용 포함 저장)').click();
  const guide = await json(await confirmed);
  assert.equal(guide.guideStatus, 'confirmed');
  assert.equal(guide.reviewStatus, 'approved');
  // The fixture doubles as a survey work. Reconfirm its unchanged reviewed tag after the source revision.
  assert.equal((await json(await b.request.post(`${exhibitPath}/confirm-ai`, {
    headers: b.headers, data: { items: [{ id: guide.id, version: guide.version, fields: ['tag'] }] },
  }))).confirmed, 1);
  const fresh = await readCurrent();

  const draft = '첫 관리자의 미저장 질문인가요? | 초안 힌트';
  await questions(a.page).fill(draft);
  const stale = expectedResponse(a.page, 'PUT', workPath);
  await button(a.page, '가이드 확정 (수정 내용 포함 저장)').click();
  assert.equal((await json(await stale, 409)).code, 'VERSION_CONFLICT');
  await confirmReload(a.page, '최신 작품 다시 불러오기', false);
  assert.equal(await questions(a.page).inputValue(), draft);
  assert.deepEqual(await readCurrent(), fresh);

  const reloaded = expectedResponse(a.page, 'GET', workPath);
  await confirmReload(a.page, '최신 작품 다시 불러오기', true);
  assert.equal((await json(await reloaded)).version, fresh.version);
  await questions(a.page).waitFor();
  assert.equal(await questions(a.page).inputValue(), '새 질문인가요? | 새 힌트예요.');
  const publicWork = await json(await a.request.get(visitorWork));
  assert.equal(publicWork.description, fresh.description);
  assert.deepEqual(publicWork.guidedLooking, ['새 질문인가요?']);
  assert.deepEqual(publicWork.guidedHints, ['새 힌트예요.']);

  const later = await json(await b.request.put(workPath, { headers: b.headers, data: { ...fresh, guideIntro: '둘째 관리자의 가이드 개정' } }));
  await description(a.page).fill('첫 관리자의 미저장 원문');
  const staleSource = expectedResponse(a.page, 'PUT', workPath);
  await button(a.page, '저장').click();
  assert.equal((await json(await staleSource, 409)).code, 'VERSION_CONFLICT');
  await confirmReload(a.page, '최신 작품 다시 불러오기', false);
  assert.equal(await description(a.page).inputValue(), '첫 관리자의 미저장 원문');
  const currentSource = expectedResponse(a.page, 'GET', workPath);
  await confirmReload(a.page, '최신 작품 다시 불러오기', true);
  assert.equal((await json(await currentSource)).version, later.version);
  console.log('PASS admin editorial: approved source and newer guide survive stale save, draft retained until explicit reload');
}

async function verifyPlacement(a, b, png) {
  const map = '/admin/map?exhibition=fixture-ex01&artwork=fixture-art01';
  const ex = await json(await b.request.get(exhibitPath, { headers: b.headers }));
  const older = await json(await b.request.post(`${floorPlanPath}?width=1&height=1`, {
    headers: { ...b.headers, 'If-Match': `"${ex.version}"`, 'Content-Type': 'image/png' }, data: png.buffer,
  }));
  const staleExhibits = await b.request.get('/api/admin/exhibitions', { headers: b.headers });
  assert.equal(staleExhibits.status(), 200);
  const olderList = await staleExhibits.json();
  // Keep the earlier exhibition read while fetching actual newer works, as two independent GETs can do.
  await a.page.route('**/api/admin/exhibitions', route => route.fulfill({ json: olderList }), { times: 1 });
  await b.page.goto(map);
  await b.page.locator('.floor-map.has-plan').waitFor();
  const replaced = expectedResponse(b.page, 'POST', floorPlanPath);
  await b.page.locator('input[type=file]').setInputFiles(png);
  const current = await json(await replaced);
  assert.notEqual(current.floorPlan.file, older.floorPlan.file);
  assert.equal(current.version, older.version + 1);

  await a.page.goto(map);
  const oldMap = a.page.locator('.floor-map.has-plan.clickable');
  await oldMap.click({ position: { x: 180, y: 150 } });
  const attempted = expectedResponse(a.page, 'PUT', workPath);
  await button(a.page, '위치 저장').click();
  const rejected = await attempted;
  const attemptedWork = rejected.request().postDataJSON();
  const currentWork = await json(await a.request.get(workPath, { headers: a.headers }));
  assert.equal(attemptedWork.version, currentWork.version);
  assert.equal(attemptedWork.mapVersion, older.version);
  assert.equal((await json(rejected, 409)).code, 'VERSION_CONFLICT');
  assert.equal((await json(await a.request.get(visitorWork))).position, null);
  const recommendations = async () => json(await a.request.post('/api/recommendations', {
    data: { exhibitionId: ex.id, duration: '30m', tastes: [] },
  }));
  assert.deepEqual(await recommendations(), []);

  const staleUpload = expectedResponse(a.page, 'POST', floorPlanPath);
  await a.page.locator('input[type=file]').setInputFiles(png);
  await a.page.getByRole('alertdialog').getByRole('button', { name: '확인하고 계속' }).click();
  const rejectedUpload = await staleUpload;
  assert.equal(rejectedUpload.request().headers()['if-match'], `"${older.version}"`);
  assert.equal((await json(rejectedUpload, 409)).code, 'VERSION_CONFLICT');
  await confirmReload(a.page, '최신 지도 다시 불러오기', false);
  assert.equal(await button(a.page, '위치 저장').isVisible(), true);
  const newMap = expectedResponse(a.page, 'GET', '/api/admin/exhibitions');
  await confirmReload(a.page, '최신 지도 다시 불러오기', true);
  assert.equal((await json(await newMap)).find(row => row.id === ex.id).floorPlan.file, current.floorPlan.file);
  await a.page.locator('.floor-map.has-plan.clickable').waitFor();
  assert.equal(await button(a.page, '위치 저장').count(), 0);
  await a.page.locator('.floor-map.has-plan.clickable').click({ position: { x: 250, y: 160 } });
  const placed = expectedResponse(a.page, 'PUT', workPath);
  await button(a.page, '위치 저장').click();
  const saved = await json(await placed);
  assert.equal((await placed).request().postDataJSON().mapVersion, current.version);
  assert.notDeepEqual(saved.position, attemptedWork.position);
  assert.deepEqual((await json(await a.request.get(visitorWork))).position, saved.position);
  assert.deepEqual((await json(await a.request.get(visitorExhibit))).floorPlan, current.floorPlan);
  assert.deepEqual((await recommendations()).map(item => item.artworkId), [saved.id]);
  console.log('PASS admin map: newer plan rejects mixed-version placement and stale upload; fresh placement matches the public API');
  return { saved, floorPlan: current.floorPlan };
}

async function verifyVisitor(browser, { saved, floorPlan }) {
  const page = await browser.newPage({ baseURL: base.href });
  page.setDefaultTimeout(10000);
  await page.route('**/*', route => (new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort()));
  try {
    const pool = await json(await page.request.get('/api/taste-pool'));
    assert.equal(pool.ready, true);
    assert.equal(pool.tasteTieV2Enabled, true);
    await page.goto('/exhibitions/fixture-ex01/taste');
    for (let i = 1; i <= 5; i++) {
      await page.getByText(`${i}/5`, { exact: true }).waitFor();
      await page.locator('.duel-card').getByRole('button', { name: / 선택$/ }).first().click();
    }
    await button(page, '취향 미리 확인').click();
    await button(page, '이 취향으로 계속').click();
    await page.getByRole('radio', { name: /30분/ }).click();
    const recommendation = expectedResponse(page, 'POST', '/api/recommendations');
    await button(page, '추천 받기').click();
    assert.deepEqual((await json(await recommendation)).map(item => item.artworkId), [saved.id]);
    await button(page, '2D 지도에서 경로 보기').click();
    const marker = page.locator('.floor-map.has-plan .fm-marker');
    await marker.waitFor();
    assert.equal(await marker.locator('title').textContent(), saved.title);
    const mapHeight = 100 / (floorPlan.width / floorPlan.height);
    assert.equal(await marker.getAttribute('transform'), `translate(${saved.position.x} ${saved.position.y * mapHeight / 100})`);
    assert.equal(await page.locator('.floor-map image').getAttribute('href'), `/api/uploads/${floorPlan.file}`);
    console.log('PASS guest V2: new recommendation, current floor plan and saved coordinate agree in the visitor map');
  } finally {
    await page.close();
  }
}

async function verifyBulkConfirmation(a, b) {
  const ids = ['fixture-art02', 'fixture-art03'];
  const artworkPath = id => `/api/admin/artworks/${id}`;
  const read = async id => json(await b.request.get(artworkPath(id), { headers: b.headers }));
  const proposed = [];
  for (const id of ids) {
    const work = await read(id);
    proposed.push(await json(await b.request.put(artworkPath(id), {
      headers: b.headers,
      data: {
        ...work, summary: `일괄 확정 검수용 요약 ${id}`, summaryStatus: 'suggested',
        guideStatus: 'none', tagStatus: 'none', emotionStatus: 'none',
      },
    })));
  }

  await a.page.goto('/admin/artworks?exhibition=fixture-ex01');
  const checks = proposed.map(work => a.page.getByRole('checkbox', {
    name: `${work.title} 제안 내용 검토 완료`, exact: true,
  }));
  const openConfirmation = async () => {
    for (const check of checks) await check.check();
    await button(a.page, '체크한 검토 항목 확정').click();
    await a.page.getByRole('alertdialog').waitFor();
  };
  const confirm = async (works, status) => {
    const pending = expectedResponse(a.page, 'POST', `${exhibitPath}/confirm-ai`);
    await button(a.page.getByRole('alertdialog'), '확인하고 계속').click();
    const response = await pending;
    const items = response.request().postDataJSON().items;
    assert.equal(items.length, works.length);
    assert.deepEqual(
      new Map(items.map(item => [item.id, item])),
      new Map(works.map(({ id, version }) => [id, { id, version, fields: ['summary'] }])),
    );
    return json(response, status);
  };

  await openConfirmation();
  await b.page.goto(`/admin/artworks/${ids[1]}`);
  const newestSummary = '두 번째 관리자가 저장한 최신 요약';
  await b.page.getByPlaceholder('「AI 분석 실행」으로 공식 해설을 요약하거나 직접 입력하세요.').fill(newestSummary);
  const saved = expectedResponse(b.page, 'PUT', artworkPath(ids[1]));
  await button(b.page, '저장').click();
  const latest = await json(await saved);
  assert.equal(latest.version, proposed[1].version + 1);
  assert.equal(latest.summary, newestSummary);
  assert.equal(latest.summaryStatus, 'suggested');

  assert.equal((await confirm(proposed, 409)).code, 'VERSION_CONFLICT');
  await a.page.getByText(/최신 자료를 다시 조회하고 내용을 재검토해 주세요/).waitFor();
  for (const check of checks) assert.equal(await check.isChecked(), false);
  assert.deepEqual(await Promise.all(ids.map(read)), [proposed[0], latest]);

  const reloaded = expectedResponse(a.page, 'GET', '/api/admin/artworks');
  await button(a.page, '최신 자료 다시 조회').click();
  const refreshed = await json(await reloaded);
  assert.equal(refreshed.find(work => work.id === latest.id).summary, newestSummary);
  await openConfirmation();
  const current = [proposed[0], latest];
  assert.equal((await confirm(current, 200)).confirmed, ids.length);
  for (const work of current) {
    const confirmed = await read(work.id);
    assert.equal(confirmed.version, work.version + 1);
    assert.equal(confirmed.summaryStatus, 'confirmed');
    assert.equal(confirmed.summary, work.summary);
  }
  console.log('PASS admin bulk confirmation: 409, 0 partial writes; reload and retry confirm both latest summaries');
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const a = await signIn(browser, 'admin-edit-a');
  const b = await signIn(browser, 'admin-edit-b');
  assert.notEqual(a.headers['X-Admin-Token'], b.headers['X-Admin-Token']);
  assert.equal((await json(await a.request.get('/api/ready'))).database, 'postgresql');
  const ai = (await json(await a.request.get('/api/health'))).aiConfiguration;
  assert.equal(ai.docent, 'disabled');
  assert.equal(ai.analysis, 'disabled');
  const baseline = await json(await a.request.get(workPath, { headers: a.headers }));
  assert.match(baseline.source, /^ARTI DEVELOPMENT FIXTURE /);
  const image = await a.request.get('/api/uploads/fixture-public.png');
  assert.equal(image.status(), 200);
  await verifyEditorial(a, b, baseline);
  const map = await verifyPlacement(a, b, { name: 'synthetic-floor-plan.png', mimeType: 'image/png', buffer: await image.body() });
  await verifyVisitor(browser, map);
  await verifyBulkConfirmation(a, b);
} finally {
  await browser.close();
}
