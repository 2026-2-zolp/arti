/** Exercise Kakao in Chrome against HTTPS Vite and Django/PostgreSQL, with a signed OIDC mock. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rmdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const port = Number(process.env.ARTI_KAKAO_BROWSER_PORT || 5593);
assert(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Choose a dedicated HTTPS loopback port.');
const base = 'https://127.0.0.1:' + port;
const provider = 'https://kauth.kakao.com/oauth/authorize';
const authPath = '/api/auth/kakao';
const callbackPath = authPath + '/callback';
const completePath = '/auth/kakao/complete';
const password = 'synthetic-password-1';
const termsVersion = process.env.ARTI_TEST_SIGNUP_TERMS_VERSION || '2026-11-18-draft.2';

function startApi(certificateDirectory) {
  const child = spawn(process.env.ARTI_TEST_PYTHON || 'python', [
    'backend-django/manage.py', 'shell', '-c',
    'from arti.tests.kakao_browser_server import serve; serve(' + port + ')',
  ], { cwd: root, env: { ...process.env, ARTI_KAKAO_BROWSER_TLS_DIR: certificateDirectory },
    stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  child.stdin.on('error', () => {});
  const closed = new Promise(resolve => child.once('close', resolve));
  const interfaceOutput = createInterface({ input: child.stdout });
  const apiPort = new Promise((resolve, reject) => {
    interfaceOutput.on('line', line => {
      const match = /^ARTI_KAKAO_BROWSER_API_PORT=(\d+)$/.exec(line);
      if (match) resolve(Number(match[1]));
    });
    child.once('error', reject);
    child.once('close', code => reject(new Error('Kakao mock API exited before startup (' + code + ').')));
  });
  return { child, closed, apiPort };
}

async function json(response, status = 200) {
  assert.equal(response.status(), status, 'Unexpected response for ' + new URL(response.url()).pathname);
  return response.json();
}

async function seedAccount(request) {
  const email = 'kakao-' + randomUUID() + '@example.test';
  const { user, token } = await json(await request.post('/api/auth/signup', {
    data: { email, password, nickname: '합성 카카오 회원', termsAccepted: true, termsVersion },
  }));
  const headers = { Authorization: 'Bearer ' + token };
  const pool = await json(await request.get('/api/taste-pool'));
  assert.equal(pool.ready, true);
  assert.equal(pool.pairs.length, 5);
  const tags = ['landscape'];
  const pickedProfile = {
    version: 2, source: 'picks', poolVersion: pool.poolVersion, tieContextVersion: pool.tieContext.tieContextVersion,
    selectedTags: tags, picks: pool.pairs.map((pair, pairIndex) => ({ pairIndex, artworkId: pair.leftId })),
  };
  const saved = await request.put('/api/users/' + user.id + '/tastes', {
    headers, data: {
      tasteProfile: pickedProfile, tastes: tags, expectedSavedProfileVersion: user.tasteProfileVersion,
      clientMutationId: randomUUID(), exhibitionId: 'fixture-ex01',
    },
  });
  assert.equal(saved.status(), 204);
  const account = await json(await request.get('/api/auth/me', { headers }));
  assert.equal(account.tasteProfile.version, 2);
  assert.equal(account.tasteProfileVersion, user.tasteProfileVersion + 1);
  const visitId = randomUUID();
  const savedProfile = {
    version: 2, source: 'saved', savedProfileVersion: account.tasteProfileVersion, selectedTags: tags,
  };
  const evidence = await json(await request.post('/api/taste-profiles/resolve', {
    headers, data: { tasteProfile: savedProfile, visitId, exhibitionId: 'fixture-ex01' },
  }));
  const receipt = await json(await request.post('/api/visits', {
    headers, data: {
      visitId, exhibitionId: 'fixture-ex01', viewedArtworkIds: ['fixture-art01'], date: new Date().toISOString(),
      durationMin: 5, recommendedCount: 3, selectedDuration: '30m', requestGeneration: 1, tastes: tags,
      tasteProfile: savedProfile, tasteEvidenceReceipt: evidence.visitEvidenceReceipt,
    },
  }), 201);
  return { account, receipt, email };
}

function responseFor(page, method, pathname) {
  return page.waitForResponse(response => response.request().method() === method
    && new URL(response.url()).pathname === pathname);
}

const continueButton = page => page.getByRole('button', { name: '계속', exact: true });
const kakaoLogin = page => page.getByRole('button', { name: '연결한 카카오 계정으로 로그인', exact: true });

async function finish(page, status = 200) {
  const response = responseFor(page, 'POST', authPath + '/finish');
  await continueButton(page).click();
  return json(await response, status);
}

async function verify() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ baseURL: base, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  context.setDefaultTimeout(10000);
  const browserErrors = [];
  const steps = ['cancel', 'allow', 'cancel', 'allow'];
  const observedStates = [];
  context.on('weberror', error => browserErrors.push(error.error().message));
  try {
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === base) return route.continue();
      if (url.origin + url.pathname !== provider) return route.abort();
      const params = url.searchParams;
      assert.equal(params.get('client_id'), 'test-kakao-app');
      assert.equal(params.get('response_type'), 'code');
      assert.equal(params.get('code_challenge_method'), 'S256');
      assert.equal(params.has('client_secret'), false);
      assert.equal(params.has('email'), false);
      assert.equal(params.has('scope'), false);
      const callback = new URL(params.get('redirect_uri'));
      assert.equal(callback.href, base + callbackPath);
      const authorization = { state: params.get('state'), nonce: params.get('nonce'), challenge: params.get('code_challenge') };
      assert(Object.values(authorization).every(value => /^[A-Za-z0-9_-]{43}$/.test(value)),
        'Mock authorization fields have an unexpected format.');
      observedStates.push(authorization.state);
      callback.searchParams.set('state', authorization.state);
      const outcome = steps.shift();
      if (outcome === 'cancel') callback.searchParams.set('error', 'access_denied');
      else {
        assert.equal(outcome, 'allow');
        callback.searchParams.set('code', Buffer.from(JSON.stringify(authorization)).toString('base64url'));
      }
      await route.fulfill({ status: 302, headers: { location: callback.href, 'cache-control': 'no-store' } });
    });

    const ready = await context.request.get('/api/ready');
    assert(ready.ok() && ready.headers()['x-arti-kakao-mock'] === '1', 'Use the isolated Kakao mock API.');
    const { account, receipt, email } = await seedAccount(context.request);

    const page = await context.newPage();
    await page.goto('/login?redirect=/mypage');
    await page.getByLabel('이메일', { exact: true }).fill(email);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    const emailLogin = responseFor(page, 'POST', '/api/auth/login');
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    const originalSession = await json(await emailLogin);
    await page.waitForURL(base + '/mypage');
    assert.deepEqual(originalSession.user, account);

    async function startAndWait(tab, startButton, index) {
      const callback = responseFor(tab, 'GET', callbackPath);
      await startButton.click();
      const redirected = await callback;
      assert.equal(redirected.status(), 302);
      const headers = await redirected.allHeaders();
      assert.equal(headers['cache-control'], 'no-store');
      assert.equal(headers['referrer-policy'], 'no-referrer');
      await tab.waitForURL(url => url.origin === base && url.pathname === completePath
        && url.hash === '#state=' + observedStates[index]);
      await continueButton(tab).waitFor();
      const flow = (await context.cookies(base)).find(cookie => cookie.name === '__Host-arti-kakao-flow');
      assert(flow?.secure && flow.httpOnly);
      assert.equal(flow.path, '/');
      assert.equal(flow.sameSite, 'Lax');
    }

    async function link(index) {
      await page.getByText('카카오 계정 연결', { exact: true }).click();
      await page.getByLabel('현재 ARTI 비밀번호').fill(password);
      await startAndWait(page, page.getByRole('button', { name: '카카오에서 본인 확인' }), index);
    }

    await link(0);
    const cancelled = await finish(page);
    assert(cancelled.status === 'cancelled' && cancelled.returnTo === '/mypage' && Object.keys(cancelled).length === 2,
      'Cancellation must return to the member page without new credentials.');
    await page.getByText('카카오 인증을 취소했어요.').waitFor();
    await page.getByRole('link', { name: '마이페이지로 돌아가기' }).click();
    await page.waitForURL(base + '/mypage');
    await page.getByText('카카오 계정 연결', { exact: true }).waitFor();
    assert(await page.evaluate(() => JSON.parse(localStorage.getItem('arti.token'))) === originalSession.token,
      'Cancellation must preserve the member session.');
    console.log('PASS Kakao link cancellation returns to the existing member session');

    await link(1);
    const linked = await finish(page);
    assert(linked.status === 'linked' && linked.returnTo === '/mypage' && Object.keys(linked).length === 2,
      'Linking must return to the member page without new credentials.');
    await page.waitForURL(base + '/mypage');
    await page.getByText('카카오 계정 연결됨').waitFor();
    const logout = responseFor(page, 'POST', '/api/auth/logout');
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    assert.equal((await logout).status(), 204);
    await page.waitForURL(base + '/');
    assert(await page.evaluate(() => localStorage.getItem('arti.token')) === null, 'Logout must clear the member session.');
    assert.equal((await context.request.get('/api/auth/me', {
      headers: { Authorization: 'Bearer ' + originalSession.token },
    })).status(), 401);

    await page.goto('/login');
    await startAndWait(page, kakaoLogin(page), 2);
    const newer = await context.newPage();
    await newer.goto('/login?redirect=/mypage');
    await startAndWait(newer, kakaoLogin(newer), 3);
    assert(observedStates[2] !== observedStates[3], 'Each browser authorization must have a different state.');
    assert.equal((await finish(page, 400)).code, 'KAKAO_INVALID_FLOW');
    await page.getByText('카카오 로그인 요청을 다시 시작해 주세요.').waitFor();
    assert(await page.evaluate(() => localStorage.getItem('arti.token')) === null,
      'The stale completion must not establish a session.');
    const loggedIn = await finish(newer);
    assert.equal(loggedIn.status, 'logged_in');
    assert.equal(loggedIn.returnTo, '/mypage');
    assert(loggedIn.token !== originalSession.token, 'Re-login must establish a new session.');
    assert.deepEqual(loggedIn.user, account);
    assert.equal(steps.length, 0);
    assert.equal((await context.cookies(base)).some(cookie => cookie.name === '__Host-arti-kakao-flow'), false);
    await newer.waitForURL(base + '/mypage');
    await newer.getByText('카카오 계정 연결됨').waitFor();
    await newer.getByRole('button', { name: /아트 영수증 보기/ }).click();
    await newer.waitForURL(base + '/receipt/' + receipt.id);
    await newer.locator('.receipt-works').getByText('1. ' + receipt.artworkSnapshots[0].title, { exact: true }).waitFor();
    const auth = { headers: { Authorization: 'Bearer ' + loggedIn.token } };
    assert.deepEqual(await json(await context.request.get('/api/auth/me', auth)), account);
    assert.deepEqual(await json(await context.request.get('/api/users/' + account.id + '/visits', auth)), [receipt]);
    assert.deepEqual(await json(await context.request.get('/api/visits/' + receipt.id, auth)), receipt);
    assert.deepEqual(browserErrors, []);
    console.log('PASS old Kakao completion rejected; newer login kept email account, V2 profile and one receipt');
  } finally {
    await browser.close();
  }
}

async function runWithVite() {
  const certificateDirectory = await mkdtemp(path.join(os.tmpdir(), 'arti-kakao-browser-'));
  const keyFile = path.join(certificateDirectory, 'key.pem');
  const certFile = path.join(certificateDirectory, 'cert.pem');
  let api;
  let web;
  try {
    api = startApi(certificateDirectory);
    const apiPort = await Promise.race([
      api.apiPort,
      delay(15000, undefined, { ref: false }).then(() => { throw new Error('Kakao mock API startup timed out.'); }),
    ]);
    process.env.VITE_API_TARGET = 'django';
    process.env.VITE_API_BASE = '/api';
    process.env.VITE_API_PROXY = 'http://127.0.0.1:' + apiPort;
    web = await preview({
      configFile: path.join(root, 'frontend', 'vite.config.ts'),
      build: { outDir: path.resolve(process.env.ARTI_BROWSER_DIST || path.join(root, 'frontend', 'dist')) },
      preview: { host: '127.0.0.1', port, strictPort: true, https: { key: await readFile(keyFile), cert: await readFile(certFile) } },
    });
    await verify();
  } finally {
    api?.child.stdin.end();
    try {
      await web?.close();
    } finally {
      if (api) {
        const stopped = await Promise.race([api.closed.then(() => true), delay(5000, false, { ref: false })]);
        if (!stopped) api.child.kill();
      }
      await Promise.all([rm(keyFile, { force: true }), rm(certFile, { force: true })]);
      await rmdir(certificateDirectory);
    }
  }
}

if (process.argv.includes('--external-proxy')) await verify();
else await runWithVite();
