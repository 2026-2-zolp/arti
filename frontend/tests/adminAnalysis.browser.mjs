/** 관리자 분석 충돌과 이미지 선택을 Django·PostgreSQL과 함께 검증합니다. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const password = process.env.ARTI_BOOTSTRAP_PASSWORD;
assert(password, 'Set ARTI_BOOTSTRAP_PASSWORD for admin-analysis-admin.');

function startApi() {
  const child = spawn(process.env.ARTI_TEST_PYTHON || 'python', [
    'backend-django/manage.py', 'shell', '-c',
    'from arti.tests.admin_analysis_browser_server import serve; serve()',
  ], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  const closed = new Promise(resolve => child.once('close', resolve));
  child.stdin.on('error', () => {}); // Startup can fail before the parent closes the pipe.
  const stdout = createInterface({ input: child.stdout });
  const port = new Promise((resolve, reject) => {
    stdout.on('line', line => {
      const match = /^ARTI_ADMIN_ANALYSIS_BROWSER_PORT=(\d+)$/.exec(line);
      if (match) resolve(Number(match[1]));
    });
    child.once('error', reject);
    child.once('close', code => reject(new Error(`Admin fixture API exited before startup (${code}).`)));
  });
  return { child, closed, port };
}

const digest = text => createHash('sha256').update(text).digest('hex');
const description = page => page.getByLabel(/작품 해설 원문/);
const summary = page => page.getByLabel('요약 (직접 고칠 수 있어요)');

function pendingResponse(page, method, pathname) {
  return page.waitForResponse(response => new URL(response.url()).pathname === pathname
    && response.request().method() === method);
}

async function json(response, status = 200) {
  assert.equal(response.status(), status);
  return response.json();
}

async function verifyRegeneration(page, request, base, gate, headers) {
  const id = 'fixture-art01';
  const adminPath = `/api/admin/artworks/${id}`;
  const publicPath = `/api/artworks/${id}`;
  const baseline = await json(await request.get(base + adminPath, { headers }));
  const withSource = await json(await request.put(base + adminPath, {
    headers, data: { ...baseline, description: '파란 바탕 왼쪽 위에 작은 노란 원이 있다.' },
  }));
  const confirmed = await json(await request.put(base + adminPath, {
    headers,
    data: {
      ...withSource, reviewStatus: 'approved', summaryStatus: 'confirmed', summary: '공개 중인 쉬운 요약입니다.',
      tagStatus: baseline.tagStatus,
      guideStatus: 'confirmed', guideIntro: '공개 중인 안내입니다.',
      guidedLooking: ['공개 중인 관찰 질문입니다.'], guidedHints: ['공개 중인 힌트입니다.'],
    },
  }));
  const readPublic = async () => json(await request.get(base + publicPath));
  const original = await readPublic();
  const publicText = ({ summary, guideIntro, guidedLooking, guidedHints, contentVersion, summaryRevision, guideRevision }) =>
    ({ summary, guideIntro, guidedLooking, guidedHints, contentVersion, summaryRevision, guideRevision });
  const verifyOriginal = async () => assert.deepEqual(publicText(await readPublic()), publicText(original));
  await page.goto(`${base}/admin/artworks/${id}`);
  const draftImage = page.getByRole('checkbox', { name: '요약·가이드 Luna 생성에 도판 사용' });
  await draftImage.waitFor();
  assert.equal(await draftImage.isChecked(), false);
  await page.getByText('관람자 미리보기', { exact: true }).click();
  const live = page.getByRole('region', { name: '현재 공개본' });
  const draft = page.getByRole('region', { name: '편집 중인 내용' });
  const comparison = page.locator('details').filter({ has: live });
  const see = async (region, text) => region.getByText(text, { exact: true }).waitFor();
  const seeQuestion = async (region, text) => region.getByRole('listitem').filter({ hasText: text }).waitFor();
  await see(live, confirmed.summary);
  await see(live, confirmed.description);
  await see(live, '힌트 · ' + confirmed.guidedHints[0]);
  await see(live, confirmed.source);
  await see(live, `저장된 근거 버전 ${confirmed.sourceVersion}`);
  await see(draft, `저장된 근거 버전 ${confirmed.sourceVersion}`);
  await see(comparison, '공개본과 내용이 같아요.');
  const source = page.getByLabel('출처', { exact: true });
  const reference = page.getByLabel('참고자료 URL', { exact: true });
  await source.fill('합성 출처 수정 초안');
  await reference.fill('https://example.test/source-draft');
  await see(comparison, '공개본과 다른 항목 · 출처 · 참고자료 URL');
  await see(draft, '합성 출처 수정 초안');
  await see(draft, 'https://example.test/source-draft');
  await see(live, confirmed.source);
  await source.fill('');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '검수 완료로 저장하려면 출처 항목을 채워 주세요.' }).waitFor();
  assert.equal((await readPublic()).source, confirmed.source);
  await source.fill(confirmed.source);
  await reference.fill(confirmed.referenceUrl);
  await summary(page).fill('아직 저장하지 않은 미리보기 요약입니다.');
  await see(comparison, '공개본과 다른 항목 · 쉬운 요약');
  await see(draft, '아직 저장하지 않은 미리보기 요약입니다.');
  await see(live, confirmed.summary);
  await summary(page).fill(confirmed.summary);

  const mock = phase => request.post(gate + '?regeneration=' + phase);
  await mock('start');
  async function start(label) {
    const result = pendingResponse(page, 'POST', adminPath + '/analyze');
    await page.getByRole('button', { name: label, exact: true }).click();
    return { result };
  }
  try {
    const { result } = await start('쉬운 요약 다시 생성');
    for (let i = 0; i < 100; i++) {
      if ((await json(await request.get(gate))).textRequests.length) break;
      await delay(40);
    }
    assert.deepEqual((await json(await request.get(gate))).textRequests, ['summary']);
    await verifyOriginal();
    await mock('release');
    const saved = await result;
    assert.deepEqual(saved.request().postDataJSON().regenerateFields, ['summary']);
    assert.equal((await json(saved)).artwork.summaryStatus, 'suggested');
    await see(draft, '새 요약 제안입니다.');
    await see(comparison, '공개본과 다른 항목 · 쉬운 요약');
    await see(live, confirmed.summary);
    await verifyOriginal();

    await draftImage.check();
    const beforeInvalid = await json(await request.get(base + adminPath, { headers }));
    const { result: guide } = await start('관람가이드 다시 생성');
    assert.equal((await json(await guide, 502)).code, 'PROVIDER_ERROR');
    assert.equal((await guide).request().postDataJSON().useDraftImage, true);
    assert.deepEqual(await json(await request.get(base + adminPath, { headers })), beforeInvalid);
    await verifyOriginal();
    await draftImage.uncheck();
    const { result: unsupported } = await start('분석 다시 시도');
    const blocked = await unsupported;
    assert.equal((await json(blocked, 502)).code, 'GUIDE_UNSUPPORTED');
    assert.equal(blocked.request().postDataJSON().useDraftImage, true);
    await page.getByRole('alert').filter({ hasText: '가이드의 위치나 작가 의도를 작품 자료에서 확인하지 못했어요.' }).waitFor();
    assert.deepEqual(await json(await request.get(base + adminPath, { headers })), beforeInvalid);
    await seeQuestion(live, confirmed.guidedLooking[0]);
    await verifyOriginal();
    const { result: retry } = await start('분석 다시 시도');
    const recovered = await retry;
    assert.deepEqual(recovered.request().postDataJSON().regenerateFields, ['guide']);
    assert.equal(recovered.request().postDataJSON().useDraftImage, true);
    assert.equal((await json(recovered)).artwork.guideStatus, 'suggested');
    await seeQuestion(draft, '새 관찰 질문입니다.');
    await see(draft, '힌트 · 새 힌트입니다.');
    await see(comparison, '공개본과 다른 항목 · 쉬운 요약 · 관람가이드');
    await seeQuestion(live, confirmed.guidedLooking[0]);
    await verifyOriginal();
    assert.deepEqual((await json(await request.get(gate))).textRequests, ['summary', 'guide', 'guide', 'guide']);
    assert.deepEqual((await json(await request.get(gate))).draftImageRequests, [false, true, true, true]);

    const asked = await json(await request.post(base + publicPath + '/ask', {
      data: { question: '합성 질문', entryContext: { tab: 'guided', kind: 'guide', contentVersion: original.contentVersion, questionIndex: 0 } },
    }));
    assert.equal(asked.answer, confirmed.guidedLooking[0]);
    assert.equal(asked.sourceRefs[0].revision, original.guideRevision);

    const summarySave = pendingResponse(page, 'PUT', adminPath);
    await page.getByRole('button', { name: '요약 확정 (수정 내용 포함 저장)', exact: true }).click();
    await json(await summarySave);
    await see(live, '새 요약 제안입니다.');
    await seeQuestion(live, confirmed.guidedLooking[0]);
    const guideSave = pendingResponse(page, 'PUT', adminPath);
    await page.getByRole('button', { name: '가이드 확정 (수정 내용 포함 저장)', exact: true }).click();
    await json(await guideSave);
    await seeQuestion(live, '새 관찰 질문입니다.');
    await see(live, '힌트 · 새 힌트입니다.');
    console.log('PASS admin preview: live and draft stay separate; regeneration and 502 retry keep the published text until confirmation');

    const beforeWithdrawal = await readPublic();
    const { result: pending } = await start('관람가이드 다시 생성');
    assert.equal((await json(await pending)).artwork.guideStatus, 'suggested');
    await seeQuestion(live, beforeWithdrawal.guidedLooking[0]);
    assert.deepEqual(publicText(await readPublic()), publicText(beforeWithdrawal));

    const saveReview = async (value, expected) => {
      await page.getByLabel('검수 상태').selectOption(value);
      const saved = pendingResponse(page, 'PUT', adminPath);
      await page.getByRole('button', { name: '저장', exact: true }).click();
      assert.equal((await json(await saved)).reviewStatus, expected);
    };
    await saveReview('source_check', 'source_check');
    await see(live, '현재 관람자에게 공개된 작품 내용이 없어요.');
    assert.equal((await request.get(base + publicPath)).status(), 404);
    assert.equal((await request.post(base + publicPath + '/ask', {
      data: { question: '철회한 가이드 질문', entryContext: {
        tab: 'guided', kind: 'guide', contentVersion: beforeWithdrawal.contentVersion, questionIndex: 0,
      } },
    })).status(), 404);

    await saveReview('approved', 'approved');
    await see(live, '기본 감상 팁');
    const reopened = await readPublic();
    assert.equal(reopened.guideStatus, 'none');
    assert.deepEqual(reopened.guidedLooking, []);
    assert.deepEqual(reopened.guidedHints, []);
    assert.equal(reopened.summary, beforeWithdrawal.summary);
    console.log('PASS admin withdrawal: retained guide and docent access removed; reapproving the work does not republish the guide');
  } finally {
    await mock('release').catch(() => {});
  }
}

async function verifyProposalDiscard(page, request, base, headers) {
  const adminPath = '/api/admin/artworks/fixture-art01';
  const publicPath = '/api/artworks/fixture-art01';
  const readAdmin = async () => json(await request.get(base + adminPath, { headers }));
  const readPublic = async () => json(await request.get(base + publicPath));
  const question = tab => tab.getByLabel(/관찰 질문 — 한 줄에 하나/);
  const discardButton = tab => tab.getByRole('button', { name: '관람가이드 제안 폐기', exact: true });
  const requestDiscard = async (tab, status) => {
    await discardButton(tab).click();
    const response = pendingResponse(tab, 'POST', adminPath + '/discard-ai');
    await tab.getByRole('alertdialog').getByRole('button', { name: '제안 폐기', exact: true }).click();
    return json(await response, status);
  };
  const regenerate = async () => {
    const response = pendingResponse(page, 'POST', adminPath + '/analyze');
    await page.getByRole('button', { name: '관람가이드 다시 생성', exact: true }).click();
    return (await json(await response)).artwork;
  };
  const confirmGuide = async (tab, status) => {
    const response = pendingResponse(tab, 'PUT', adminPath);
    await tab.getByRole('button', { name: '가이드 확정 (수정 내용 포함 저장)', exact: true }).click();
    return json(await response, status);
  };
  const reloadLatest = async tab => {
    await tab.getByRole('button', { name: '최신 작품 다시 불러오기' }).click();
    await tab.getByRole('alertdialog').getByRole('button', { name: '다시 불러오기', exact: true }).click();
    await tab.getByRole('alertdialog').waitFor({ state: 'hidden' });
  };
  const original = await readAdmin();
  const second = await page.context().newPage();
  try {
    const firstProposal = await regenerate();
    await discardButton(page).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '취소', exact: true }).click();
    assert.deepEqual(await readAdmin(), firstProposal);
    const none = await requestDiscard(page, 200);
    assert.equal(none.guideStatus, 'none');
    await discardButton(page).waitFor({ state: 'hidden' });
    assert.deepEqual((await readPublic()).guidedLooking, []);

    const proposal = await regenerate();
    await second.goto(base + '/admin/artworks/fixture-art01');
    await discardButton(second).waitFor();
    await question(second).fill('두 번째 탭이 확정한 질문 | 확정한 힌트');
    const newer = await confirmGuide(second, 200);
    assert.equal(newer.version, proposal.version + 1);
    await description(page).fill('폐기 실패 후 남아 있어야 할 미저장 해설');
    assert.equal((await requestDiscard(page, 409)).code, 'VERSION_CONFLICT');
    assert.deepEqual(await readAdmin(), newer);
    assert.equal(await description(page).inputValue(), '폐기 실패 후 남아 있어야 할 미저장 해설');
    await reloadLatest(page);
    await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some(field =>
      field.labels[0]?.textContent.includes('관찰 질문') && field.value.includes('두 번째 탭이 확정한 질문')));
    assert.equal(await discardButton(page).count(), 0);

    const nextProposal = await regenerate();
    const published = await readPublic();
    assert.deepEqual(published.guidedLooking, ['두 번째 탭이 확정한 질문']);
    await second.reload();
    await discardButton(second).waitFor();
    await description(page).fill('성공한 폐기와 함께 저장되면 안 되는 해설');
    const restored = await requestDiscard(page, 200);
    assert.equal(restored.version, nextProposal.version + 1);
    assert.equal(restored.guideStatus, 'confirmed');
    assert.equal(restored.description, original.description);
    assert.equal(await description(page).inputValue(), '성공한 폐기와 함께 저장되면 안 되는 해설');
    assert.equal((await confirmGuide(second, 409)).code, 'VERSION_CONFLICT');
    assert.deepEqual(await readAdmin(), restored);
    const current = await readPublic();
    for (const field of ['guidedLooking', 'guidedHints', 'guideRevision', 'contentVersion', 'summary', 'description']) {
      assert.deepEqual(current[field], published[field]);
    }
    const answer = await json(await request.post(base + publicPath + '/ask', {
      data: { question: '기존 가이드 문맥으로 재질문', entryContext: {
        tab: 'guided', kind: 'guide', contentVersion: published.contentVersion, questionIndex: 0,
      } },
    }));
    assert.equal(answer.answer, published.guidedLooking[0]);
    assert.equal(answer.sourceRefs[0].revision, published.guideRevision);
    console.log('PASS admin proposal discard: cancel, empty guide, stale discard and stale confirmation, preserved publication and guide reference');
  } finally {
    await second.close();
  }
}

async function verifyPublicLifecycle(admin, base, headers, artworkTemplate, imageBytes) {
  const setup = admin.request;
  const seed = await json(await setup.get(base + '/api/admin/exhibitions/fixture-ex01', { headers }));
  const exhibition = await json(await setup.post(base + '/api/admin/exhibitions', {
    headers, data: { ...seed, title: `공개 수명 검증용 합성 전시 ${randomUUID()}` },
  }));
  const artwork = await json(await setup.post(base + '/api/admin/artworks', {
    headers, data: {
      ...artworkTemplate, exhibitionId: exhibition.id, title: '공개 수명 검증용 합성 작품', position: null,
      summary: '', summaryKeywords: [], summaryStatus: 'none',
      guideIntro: '', guidedLooking: [], guidedHints: [], guideStatus: 'none',
    },
  }));
  const adminPath = '/api/admin/artworks/' + artwork.id;
  const publicPath = '/api/artworks/' + artwork.id;
  const tour = '/exhibitions/' + exhibition.id;
  const lookup = () => setup.get(base + publicPath);
  const recommendations = async () => (await json(await setup.post(base + '/api/recommendations', {
    data: { exhibitionId: exhibition.id, duration: '30m', tastes: [] },
  }))).map(item => item.artworkId);
  const button = (page, name) => page.getByRole('button', { name, exact: true });
  const adminAction = async (label, method, pathname) => {
    const response = pendingResponse(admin, method, pathname);
    await button(admin, label).click();
    return json(await response);
  };
  const guideQuestion = '확정한 작품의 왼쪽에서 어떤 모양이 보이나요?';
  const guideHint = '왼쪽의 큰 색 덩어리를 살펴보세요.';

  await admin.goto(base + '/admin/exhibitions');
  await admin.getByRole('link', { name: exhibition.title, exact: true }).press('Enter');
  await admin.getByRole('link', { name: artwork.title, exact: true }).press('Enter');
  await admin.waitForURL('**/admin/artworks/' + artwork.id);
  await adminAction('관람가이드 다시 생성', 'POST', adminPath + '/analyze');
  await admin.getByLabel(/관찰 질문 — 한 줄에 하나/).fill(guideQuestion + ' | ' + guideHint);
  const approved = await adminAction('가이드 확정 (수정 내용 포함 저장)', 'PUT', adminPath);
  const beforePlacement = await json(await lookup());
  assert.deepEqual(beforePlacement.guidedLooking, [guideQuestion]);
  assert.equal(beforePlacement.guideRevision, approved.guideRevision);
  assert.deepEqual(await recommendations(), []);

  await admin.getByRole('main').getByRole('link', { name: '위치·지도 관리', exact: true }).click();
  await admin.waitForURL(url => url.pathname === '/admin/map' && url.searchParams.get('artwork') === artwork.id);
  const planResponse = pendingResponse(admin, 'POST', `/api/admin/exhibitions/${exhibition.id}/floor-plan`);
  await admin.locator('.a-map-layout input[type=file]').setInputFiles({ name: 'synthetic-plan.png', mimeType: 'image/png', buffer: imageBytes });
  const plan = await json(await planResponse);
  assert.ok(plan.floorPlan.file);
  await admin.locator('.a-pos-list').getByRole('button', { name: new RegExp(artwork.title) }).click();
  const adminMap = admin.locator('.floor-map.has-plan.clickable');
  await adminMap.click({ position: { x: 170, y: 140 } });
  const placed = await adminAction('위치 저장', 'PUT', adminPath);
  const published = await json(await lookup());
  assert.deepEqual(published.position, placed.position);
  assert.equal(published.guideRevision, approved.guideRevision);
  assert.equal(published.sourceVersion, approved.sourceVersion);
  assert.deepEqual(await recommendations(), [artwork.id]);
  await admin.getByRole('link', { name: '작품 관리로 이동', exact: true }).click();

  const visitor = await admin.context().browser().newPage({ viewport: { width: 360, height: 740 } });
  visitor.setDefaultTimeout(10000);
  try {
    await visitor.goto(base + tour + '/taste');
    for (let pair = 1; pair <= 5; pair++) {
      await visitor.getByText(`${pair}/5`, { exact: true }).waitFor();
      await visitor.locator('.duel-card').getByRole('button', { name: / 선택$/ }).first().click();
    }
    await button(visitor, '취향 미리 확인').click();
    await button(visitor, '이 취향으로 계속').click();
    await visitor.getByRole('radio', { name: /30분/ }).click();
    const recommendation = pendingResponse(visitor, 'POST', '/api/recommendations');
    await button(visitor, '추천 받기').click();
    assert.deepEqual((await json(await recommendation)).map(item => item.artworkId), [artwork.id]);
    await button(visitor, '지도에서 관람순서 보기').click();
    const marker = visitor.locator('.floor-map.has-plan .fm-marker.current');
    await marker.waitFor();
    assert.equal(await marker.locator('title').textContent(), artwork.title);
    const height = 100 / (plan.floorPlan.width / plan.floorPlan.height);
    assert.equal(await marker.getAttribute('transform'), `translate(${placed.position.x} ${placed.position.y * height / 100})`);
    assert.equal(await visitor.locator('.floor-map image').getAttribute('href'), '/api/uploads/' + plan.floorPlan.file);
    await button(visitor, '관람 시작하기').click();
    await visitor.getByRole('heading', { name: artwork.title, exact: true }).waitFor();
    await visitor.getByRole('tab', { name: '관람가이드', exact: true }).click();
    await visitor.locator('.guided-list li').filter({ hasText: guideQuestion }).waitFor();
    await button(visitor, '1번 질문으로 대화하기').click();
    const askPath = publicPath + '/ask';
    const input = visitor.getByRole('textbox', { name: '질문 입력' });
    const submit = async (question, status = 200) => {
      await input.fill(question);
      const response = pendingResponse(visitor, 'POST', askPath);
      await button(visitor, '보내기').click();
      const request = await response;
      assert.equal(request.request().postDataJSON().entryContext.contentVersion, published.contentVersion);
      return json(request, status);
    };
    const before = await submit('확정 가이드를 기준으로 먼저 질문합니다.');
    assert.equal(before.answer, guideQuestion);
    assert.deepEqual(before.sourceRefs, [{ artworkId: artwork.id, sourceVersion: published.sourceVersion, kind: 'guide', revision: published.guideRevision }]);
    await visitor.getByRole('log').getByText(guideQuestion, { exact: false }).waitFor();

    await adminAction('관람가이드 다시 생성', 'POST', adminPath + '/analyze');
    await button(admin, '관람가이드 제안 폐기').click();
    const discarded = pendingResponse(admin, 'POST', adminPath + '/discard-ai');
    await admin.getByRole('alertdialog').getByRole('button', { name: '제안 폐기', exact: true }).click();
    await json(await discarded);
    const afterDiscard = await json(await lookup());
    for (const key of ['position', 'guidedLooking', 'guidedHints', 'sourceVersion', 'contentVersion', 'guideRevision']) {
      assert.deepEqual(afterDiscard[key], published[key]);
    }
    assert.deepEqual(await recommendations(), [artwork.id]);
    const repeat = await submit('같은 공개본을 기준으로 다시 질문합니다.');
    assert.deepEqual(repeat.sourceRefs, before.sourceRefs);

    await admin.getByLabel('검수 상태').selectOption('source_check');
    await adminAction('저장', 'PUT', adminPath);
    assert.equal((await lookup()).status(), 404);
    assert.deepEqual(await json(await setup.get(base + '/api/artworks?exhibitionId=' + exhibition.id)), []);
    assert.deepEqual(await recommendations(), []);
    // An already open visitor tab still has its old guide until the first rejected request.
    const draft = '철회 뒤에도 보존할 질문입니다.';
    assert.equal((await submit(draft, 404)).code, 'NOT_FOUND');
    await visitor.getByRole('alert').getByText('이 작품을 더 이상 볼 수 없어요. 작품 화면으로 돌아가 주세요.', { exact: true }).waitFor();
    assert.equal(await input.inputValue(), draft);
    assert.equal(await button(visitor, '보내기').isEnabled(), false);
    assert.equal(await visitor.getByRole('log').getByText(guideQuestion, { exact: false }).count(), 0);
    await button(visitor, '작품으로 돌아가기').click();
    await button(visitor, '이 작품 건너뛰기').waitFor();
    console.log('PASS public lifecycle: admin navigation, placement, guide confirmation, discard, withdrawal, recommendation and guest docent references');
  } finally {
    await visitor.close();
  }
}

async function verify(base) {
  const gate = `${base}/api/__admin_analysis_test__/gate`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  context.setDefaultTimeout(10000);
  const errors = [];
  context.on('weberror', error => errors.push(error.error().message));
  try {
    const a = await context.newPage();
    await a.goto(`${base}/admin/login`);
    await a.getByLabel('관리자 ID').fill('admin-analysis-admin');
    await a.getByLabel('비밀번호').fill(password);
    const login = pendingResponse(a, 'POST', '/api/admin/login');
    await a.getByRole('button', { name: '로그인', exact: true }).click();
    const { token } = await json(await login);
    await a.waitForURL('**/admin');
    const headers = { 'X-Admin-Token': token };

    const catalog = `${base}/api/admin/artworks`;
    const template = await json(await context.request.get(`${catalog}/fixture-art01`, { headers }));
    assert.match(template.source, /^ARTI DEVELOPMENT FIXTURE /);
    const initial = await json(await context.request.post(catalog, {
      headers,
      data: {
        ...template, title: `합성 분석 ${randomUUID()}`, summary: '첫 확정 요약', summaryStatus: 'confirmed',
        guideIntro: '첫 확정 가이드', guidedLooking: ['어느 곳을 먼저 보나요?'], guidedHints: ['색을 살펴보세요.'],
        guideStatus: 'confirmed',
      },
    }));
    // The create API deliberately excludes imageFile; upload fixture bytes via the normal image route.
    const image = await context.request.get(`${base}/api/admin/uploads/fixture-public.png`, { headers });
    assert.equal(image.status(), 200);
    const imageBytes = await image.body();
    const imageHash = digest(imageBytes);
    const artwork = await json(await context.request.post(`${catalog}/${initial.id}/image`, {
      headers: { ...headers, 'If-Match': `"${initial.version}"`, 'Content-Type': 'image/png' }, data: imageBytes,
    }));
    // Uploading new source marks prior confirmations for review; restore the initial confirmations via the API.
    const baseline = await json(await context.request.put(`${catalog}/${initial.id}`, {
      headers, data: { ...artwork, reviewStatus: 'approved', summaryStatus: 'confirmed', guideStatus: 'confirmed' },
    }));
    const editor = `/admin/artworks/${initial.id}`;
    await a.goto(base + editor);
    const b = await context.newPage();
    await b.goto(base + editor);

    const analysis = `/api${editor}/analyze`;
    const stale = pendingResponse(a, 'POST', analysis);
    await a.getByRole('button', { name: 'AI 다시 분석', exact: true }).click();
    const entered = Date.now() + 5000;
    let gateState;
    do {
      gateState = await json(await context.request.get(gate));
      if (gateState.inputs.length) break;
      await delay(40);
    } while (Date.now() < entered);
    const titleHash = digest(baseline.title);
    const expectedInputs = [{ title: titleHash, source: digest(baseline.description), image: imageHash }];
    assert.deepEqual(gateState.inputs, expectedInputs);

    const changedSource = '두 번째 탭에서 검수한 최신 합성 원문입니다.';
    await a.getByLabel('작가', { exact: true }).fill('첫 탭의 미저장 편집');
    await description(b).fill(changedSource);
    await summary(b).fill('두 번째 탭이 확정할 요약');
    const saved = pendingResponse(b, 'PUT', `/api${editor}`);
    await b.getByRole('button', { name: '저장', exact: true }).click();
    const sourceRevision = await json(await saved);
    assert.equal(sourceRevision.sourceVersion, baseline.sourceVersion + 1);
    assert.equal(sourceRevision.reviewStatus, 'source_check');
    assert.equal(sourceRevision.summaryStatus, 'suggested');

    await b.getByLabel('검수 상태').selectOption('approved');
    const confirmed = pendingResponse(b, 'PUT', `/api${editor}`);
    await b.getByRole('button', { name: /요약 확정/ }).click();
    const current = await json(await confirmed);
    assert.equal(current.reviewStatus, 'approved');
    assert.equal(current.summaryStatus, 'confirmed');

    await context.request.post(gate);
    const conflict = await stale;
    assert.equal(conflict.request().postDataJSON().version, baseline.version);
    assert.equal((await json(conflict, 409)).code, 'VERSION_CONFLICT');
    await a.getByRole('alert').filter({ hasText: '다른 수정이 먼저 저장됐어요.' }).waitFor();
    assert.equal(await a.getByLabel('작가', { exact: true }).inputValue(), '첫 탭의 미저장 편집');
    assert.deepEqual(await json(await context.request.get(base + '/api' + editor, { headers })), current);
    assert.equal(await a.getByRole('button', { name: '분석 다시 시도' }).count(), 0);
    const analyze = a.getByRole('button', { name: 'AI 다시 분석', exact: true });
    assert.equal(await analyze.isEnabled(), false);

    const refresh = a.getByRole('button', { name: '최신 작품 다시 불러오기' });
    await refresh.click();
    await a.getByRole('alertdialog').getByRole('button', { name: '취소' }).click();
    assert.equal(await a.getByLabel('작가', { exact: true }).inputValue(), '첫 탭의 미저장 편집');
    assert.equal(await analyze.isEnabled(), false);
    const staleEdit = pendingResponse(a, 'PUT', `/api${editor}`);
    await a.locator('.ai-box').filter({ has: a.getByRole('heading', { name: /^요약 / }) })
      .getByRole('button', { name: '확정 해제', exact: true }).click();
    assert.equal((await json(await staleEdit, 409)).code, 'VERSION_CONFLICT');
    assert.equal(await analyze.isEnabled(), false);

    const loaded = pendingResponse(a, 'GET', `/api${editor}`);
    await refresh.click();
    await a.getByRole('alertdialog').getByRole('button', { name: '다시 불러오기' }).click();
    assert.equal((await json(await loaded)).version, current.version);
    await description(a).filter({ visible: true }).waitFor();
    assert.equal(await description(a).inputValue(), changedSource);
    assert.equal(await summary(a).inputValue(), current.summary);
    assert.equal(await analyze.isEnabled(), true);

    const retried = pendingResponse(a, 'POST', analysis);
    await analyze.click();
    const fresh = await retried;
    assert.equal(fresh.request().postDataJSON().version, current.version);
    assert.equal(fresh.request().postDataJSON().useImage, true);
    const result = await json(fresh);
    assert.equal(result.artwork.version, current.version + 1);
    assert.equal(result.artwork.sourceVersion, current.sourceVersion);
    assert.equal(result.artwork.summary, current.summary);
    assert.equal(result.artwork.summaryStatus, 'confirmed');
    assert.equal(result.artwork.analysis.emotions.calm, .8);
    assert.equal(result.artwork.tagScores.landscape, .5);
    assert.equal(result.artwork.tagStatus, 'suggested');
    const sourceHash = digest(changedSource);
    expectedInputs.push({ title: titleHash, source: sourceHash, image: imageHash });
    assert.deepEqual((await json(await context.request.get(gate))).inputs, expectedInputs);
    const results = a.getByRole('status', { name: 'AI 항목별 처리 결과' });
    await results.getByRole('listitem').filter({ hasText: /취향 태그.*제안 생성 완료/ }).waitFor();
    await results.getByRole('listitem').filter({ hasText: /감정 분석.*제안 생성 완료/ }).waitFor();
    await results.getByRole('listitem').filter({ hasText: /쉬운 요약.*기존 확정 유지/ }).waitFor();
    await results.getByRole('listitem').filter({ hasText: /관람가이드.*연결 확인 필요/ }).waitFor();
    assert.equal(await results.getByRole('listitem').count(), 4);
    await a.getByRole('button', { name: '감정 분석 확정' }).waitFor();
    assert.equal(await summary(a).inputValue(), current.summary);
    assert.deepEqual(await json(await context.request.get(base + '/api' + editor, { headers })), result.artwork);
    console.log('PASS admin analysis: original delayed → current source/confirmed summary → 409 → reload → current-source 200');

    const imageOption = a.getByRole('checkbox', { name: '이미지도 분석' });
    assert.equal(await imageOption.isChecked(), true);
    assert.equal(result.artwork.analysis.usedImage, true);
    let savedVersion = result.artwork.version;
    for (const useImage of [false, true]) {
      await imageOption.setChecked(useImage);
      const requested = pendingResponse(a, 'POST', analysis);
      await analyze.click();
      const analyzed = await requested;
      assert.deepEqual(analyzed.request().postDataJSON(), { useImage, version: savedVersion });
      const { artwork: updated } = await json(analyzed);
      assert.equal(updated.version, savedVersion + 1);
      savedVersion = updated.version;
      assert.equal(updated.analysis.usedImage, useImage);
      assert.equal(updated.analysis.tagSource, useImage ? 'image' : 'text');
      assert.equal(updated.sourceVersion, current.sourceVersion);
      assert.equal(updated.summaryStatus, 'confirmed');
      assert.equal(updated.summary, current.summary);
      assert.equal(updated.imageFile, result.artwork.imageFile);
      expectedInputs.push({ title: titleHash, source: sourceHash, image: useImage ? imageHash : null });
      assert.deepEqual((await json(await context.request.get(gate))).inputs, expectedInputs);
      await a.getByText(useImage ? /분석 재료: 이미지 \+ 해설/ : /분석 재료: 해설 ·/).waitFor();
    }
    console.log('PASS admin image option: image bytes → text only → same image bytes; source and confirmed summary preserved');
    await verifyRegeneration(a, context.request, base, gate, headers);
    await verifyProposalDiscard(a, context.request, base, headers);
    await verifyPublicLifecycle(a, base, headers, template, imageBytes);
    assert.deepEqual(errors, []);
  } finally {
    await context.request.post(gate).catch(() => {});
    await browser.close();
  }
}

const api = startApi();
let web;
try {
  const apiPort = await Promise.race([
    api.port,
    delay(15000, undefined, { ref: false }).then(() => { throw new Error('Admin fixture API startup timed out.'); }),
  ]);
  process.env.VITE_API_TARGET = 'django';
  process.env.VITE_API_BASE = '/api';
  process.env.VITE_API_PROXY = `http://127.0.0.1:${apiPort}`;
  web = await preview({
    configFile: path.join(root, 'frontend', 'vite.config.ts'),
    build: { outDir: path.resolve(process.env.ARTI_BROWSER_DIST || path.join(root, 'frontend', 'dist')) },
    preview: { host: '127.0.0.1', port: 0, strictPort: true },
  });
  const base = `http://127.0.0.1:${web.httpServer.address().port}`;
  const ready = await fetch(`${base}/api/ready`, { signal: AbortSignal.timeout(5000) });
  assert(ready.ok && ready.headers.get('x-arti-admin-analysis-mock') === '1', 'Use the isolated administrator analysis fixture.');
  await verify(base);
} finally {
  api.child.stdin.end();
  try {
    await web?.close();
  } finally {
    const stopped = await Promise.race([api.closed.then(() => true), delay(5000, false, { ref: false })]);
    if (!stopped) {
      api.child.kill();
      throw new Error('Admin fixture API did not shut down.');
    }
  }
}
