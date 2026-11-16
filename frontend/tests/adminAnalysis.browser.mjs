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
  const confirmed = await json(await request.put(base + adminPath, {
    headers,
    data: {
      ...baseline, summaryStatus: 'confirmed', summary: '공개 중인 쉬운 요약입니다.',
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
  await page.getByText('관람자 미리보기', { exact: true }).click();
  const live = page.getByRole('region', { name: '현재 공개본' });
  const draft = page.getByRole('region', { name: '편집 중인 내용' });
  const see = async (region, text) => region.getByText(text, { exact: true }).waitFor();
  const seeQuestion = async (region, text) => region.getByRole('listitem').filter({ hasText: text }).waitFor();
  await see(live, confirmed.summary);
  await see(live, confirmed.description);
  await see(live, '힌트 · ' + confirmed.guidedHints[0]);
  await summary(page).fill('아직 저장하지 않은 미리보기 요약입니다.');
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
    await see(live, confirmed.summary);
    await verifyOriginal();

    const beforeInvalid = await json(await request.get(base + adminPath, { headers }));
    const { result: guide } = await start('관람가이드 다시 생성');
    assert.equal((await json(await guide, 502)).code, 'PROVIDER_ERROR');
    assert.deepEqual(await json(await request.get(base + adminPath, { headers })), beforeInvalid);
    await verifyOriginal();
    const { result: retry } = await start('분석 다시 시도');
    const recovered = await retry;
    assert.deepEqual(recovered.request().postDataJSON().regenerateFields, ['guide']);
    assert.equal((await json(recovered)).artwork.guideStatus, 'suggested');
    await seeQuestion(draft, '새 관찰 질문입니다.');
    await see(draft, '힌트 · 새 힌트입니다.');
    await seeQuestion(live, confirmed.guidedLooking[0]);
    await verifyOriginal();
    assert.deepEqual((await json(await request.get(gate))).textRequests, ['summary', 'guide', 'guide']);

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
