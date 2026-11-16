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
    assert.deepEqual(errors, []);
    console.log('PASS admin image option: image bytes → text only → same image bytes; source and confirmed summary preserved');
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
