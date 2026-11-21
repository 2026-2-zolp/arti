/** The browser uses real signed audio requests against the synthetic loopback API. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');

const baseURL = process.env.ARTI_REVIEW_BASE || 'http://127.0.0.1:5239';
const origin = new URL(baseURL).origin;
const artworkPath = '/api/artworks/fixture-art03';
const answerPath = artworkPath + '/ask';
const audioPath = artworkPath + '/answer-audio';
const narrationPath = '/test-setup/narration/';
const guidePath = narrationPath + 'guide-ci.mp3';
const wav = Buffer.alloc(44 + 48000 * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(24000, 24);
wav.writeUInt32LE(48000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(wav.length - 44, 40);
let last = { requestId: null, status: null, evidenceVersion: null };

function evidence(response, requestId, version) {
  last = {
    requestId: /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId ?? '') ? requestId : null,
    status: response.status(),
    evidenceVersion: Number.isSafeInteger(version) && version > 0 ? version : null,
  };
}

function hold() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

async function fixture(browser) {
  const context = await browser.newContext({
    baseURL, viewport: { width: 390, height: 812 }, isMobile: true, hasTouch: true,
    reducedMotion: 'reduce',
  });
  const ready = await context.request.get('/api/ready', { maxRedirects: 0 });
  assert.equal(ready.headers()['x-arti-docent-listening-mock'], '1');
  const artwork = await context.request.get(artworkPath, { maxRedirects: 0 }).then(response => response.json());
  assert.equal(artwork.docentListeningAvailable, true);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const attempts = [];
  const externalWrites = [];
  const failed = new Set();

  await page.addInitScript(path => {
    window.voiceTest = { played: [], rejectGuide: false };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      const url = new URL(this.src);
      const guide = url.pathname === path;
      if (guide && window.voiceTest.rejectGuide) {
        return Promise.reject(new DOMException('Synthetic playback rejection', 'NotAllowedError'));
      }
      this.addEventListener('playing', () => window.voiceTest.played.push(this.src), { once: true });
      return play.apply(this, args);
    };
  }, guidePath);

  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === audioPath) failed.add(request);
  });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === 'blob:') return route.continue();
    if (url.origin !== origin) {
      if (!['GET', 'HEAD'].includes(request.method())) externalWrites.push(request.method());
      return route.abort();
    }
    if (url.pathname === narrationPath + 'manifest.json') {
      return route.fulfill({ json: {
        contentVersion: artwork.contentVersion, openingQuestion: '어디부터 감상할까요?',
        original: { text: artwork.description, clip: 'guide-ci.mp3' },
        guide: { text: [artwork.guideIntro, ...artwork.guidedLooking].filter(Boolean).join(' '), clip: 'guide-ci.mp3' },
        answers: [],
      } });
    }
    if (url.pathname === guidePath) return route.fulfill({ contentType: 'audio/wav', body: wav });
    if (url.pathname !== audioPath) return route.continue();

    const gate = hold();
    const attempt = { request, body: request.postDataJSON(), release: gate.release, verified: false };
    attempts.push(attempt);
    try {
      const response = await route.fetch({ maxRedirects: 0 });
      const headers = response.headers();
      evidence(response, headers['x-request-id'], last.evidenceVersion);
      attempt.verified = response.status() === 200 && headers['x-arti-docent-listening-mock'] === '1'
        && headers['content-type'] === 'audio/wav' && /(?:^|,\s*)no-store(?:,|$)/.test(headers['cache-control']);
      await gate.promise;
      if (!failed.has(request)) await route.fulfill({ response });
    } catch {
      // The browser may discard a pending response when leaving the chat.
    }
  });
  const button = name => page.getByRole('button', { name, exact: true });
  const turnOffPreparation = button('답변 음성 미리 준비 끄기');
  const reply = n => page.getByRole('log', { name: '도슨트 대화' }).locator('.docent-message.is-ai').nth(n - 1);
  const countPlayed = () => page.evaluate(() => window.voiceTest.played.filter(url => url.startsWith('blob:')).length);
  const audioURLs = () => page.evaluate(() => window.voiceTest.played.filter(url => url.startsWith('blob:')));
  async function waitPlayed(count) {
    await page.waitForFunction(expected => window.voiceTest.played.filter(url => url.startsWith('blob:')).length === expected, count);
  }
  async function frames() {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function waitAttempt(n, intent) {
    const deadline = Date.now() + 5000;
    while (!attempts[n - 1]?.verified && Date.now() < deadline) {
      await delay(30);
    }
    const attempt = attempts[n - 1];
    assert.equal(attempt?.verified, true);
    assert.equal(attempt.body.intent, intent);
    assert.deepEqual(Object.keys(attempt.body).sort(), ['answer', 'audioGrant', 'intent', 'visitId']);
    return attempt;
  }
  async function ask(n) {
    const input = page.getByRole('textbox', { name: '질문 입력' });
    await input.fill('합성 음성 검수 질문 ' + n);
    const [response] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === answerPath && response.request().method() === 'POST'),
      button('보내기').click(),
    ]);
    const body = await response.json();
    evidence(response, body.requestId, body.sourceRefs?.[0]?.sourceVersion);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['x-arti-docent-listening-mock'], '1');
    assert.equal(body.mode, 'llm');
    assert.equal(typeof body.audioGrant, 'string');
    await reply(n).getByRole('button', { name: '답변 듣기' }).waitFor();
  }

  await page.goto('/exhibitions/fixture-ex01');
  await button('전시 순서로 바로 보기').click();
  return { page, button, turnOffPreparation, reply, ask, waitAttempt, countPlayed, waitPlayed, audioURLs, frames, attempts, failed,
    async close() {
      for (const attempt of attempts) attempt.release();
      await context.close();
      assert.deepEqual(externalWrites, []);
    },
  };
}

async function explicitAndNavigation(browser) {
  const review = await fixture(browser);
  const { page, button, turnOffPreparation, reply, ask, waitAttempt, waitPlayed, countPlayed, audioURLs, frames, attempts, failed } = review;
  try {
    await button('이 부분 더 알아보기').click();
    await ask(1);
    assert.equal(await page.getByRole('switch', { name: '듣기 모드' }).count(), 0);
    assert.equal(await page.getByText('일부 답변은 AI 음성으로 들을 수 있어요.').count(), 0);
    await frames();
    assert.equal(attempts.length, 0);
    assert.equal(await countPlayed(), 0);

    await reply(1).getByRole('button', { name: '답변 듣기' }).click();
    const direct = await waitAttempt(1, 'play');
    await reply(1).getByText('음성을 만들고 있어요', { exact: true }).waitFor();
    const tampered = await page.request.post(audioPath, {
      data: { ...direct.body, visitId: randomUUID() }, maxRedirects: 0,
    });
    assert.equal(tampered.status(), 409);
    direct.release();
    await waitPlayed(1);
    await reply(1).getByRole('button', { name: '재생 중지' }).click();
    await reply(1).getByRole('button', { name: '답변 듣기' }).click();
    await waitPlayed(2);
    assert.equal(new Set(await audioURLs()).size, 1);
    assert.equal(attempts.length, 1);
    await reply(1).getByRole('button', { name: '재생 중지' }).click();

    await button('뒤로가기').click();
    await button('음성 설명 듣기').click();
    await turnOffPreparation.waitFor();
    await button('이 부분 더 알아보기').click();
    await ask(2);
    const inFlight = await waitAttempt(2, 'prepare');
    assert.equal(await countPlayed(), 2);
    await reply(2).getByRole('button', { name: '답변 듣기' }).click();
    await reply(2).getByText('음성을 만들고 있어요', { exact: true }).waitFor();
    assert.equal(attempts.length, 2);
    inFlight.release();
    await waitPlayed(3);
    assert.equal(attempts.length, 2);
    await reply(2).getByRole('button', { name: '재생 중지' }).click();

    await page.reload();
    await reply(2).getByRole('button', { name: '답변 듣기' }).waitFor();
    await frames();
    assert.equal(attempts.length, 2);
    assert.equal(await countPlayed(), 0);

    await ask(3);
    const replaced = await waitAttempt(3, 'prepare');
    const abortNext = page.waitForEvent('requestfailed', { predicate: request => request === replaced.request });
    await ask(4);
    await abortNext;
    const newest = await waitAttempt(4, 'prepare');
    assert.equal(failed.has(replaced.request), true);
    replaced.release();
    assert.equal(await countPlayed(), 0);

    const abortMove = page.waitForEvent('requestfailed', { predicate: request => request === newest.request });
    await button('뒤로가기').click();
    await abortMove;
    newest.release();
    await button('다음 작품 안내').click();
    await button('2번 작품 감상하기').click();
    await page.getByText('검증용 작품 01', { exact: true }).first().waitFor();
    assert.equal(attempts.length, 4);
    assert.equal(await countPlayed(), 0);
  } finally {
    await review.close();
  }
}

async function guideOptIn(browser) {
  const review = await fixture(browser);
  const { page, button, turnOffPreparation, ask, waitAttempt, countPlayed, frames, attempts } = review;
  try {
    const guide = page.getByRole('tab', { name: '관람가이드' });
    await guide.click();
    await page.getByText(/음성 설명을 재생하면 새 도슨트 답변을 OpenAI/).waitFor();
    await page.evaluate(() => { window.voiceTest.rejectGuide = true; });
    await button('음성 설명 듣기').click();
    await page.getByText('한국어 음성을 재생하지 못했어요. 다시 시도해 주세요.', { exact: true }).waitFor();
    assert.equal(await turnOffPreparation.count(), 0);
    await button('작품에 대해 질문하기').click();
    await ask(1);
    await frames();
    assert.equal(attempts.length, 0);
    await button('뒤로가기').click();
    await guide.click();
    await page.evaluate(() => { window.voiceTest.rejectGuide = false; });
    await button('음성 설명 듣기').click();
    await turnOffPreparation.waitFor();
    await button('작품에 대해 질문하기').click();
    await ask(2);
    const attempt = await waitAttempt(1, 'prepare');
    const abort = page.waitForEvent('requestfailed', { predicate: request => request === attempt.request });
    await button('뒤로가기').click();
    await abort;
    attempt.release();
    await guide.click();
    await turnOffPreparation.click();
    await page.getByRole('status').filter({ hasText: '답변 음성을 미리 준비하지 않아요.' }).waitFor();
    const alreadyPlayed = await page.evaluate(() => window.voiceTest.played.length);
    await button('음성 설명 듣기').click();
    await page.waitForFunction(count => window.voiceTest.played.length > count, alreadyPlayed);
    await button('작품에 대해 질문하기').click();
    await ask(3);
    await frames();
    assert.equal(attempts.length, 1);
    assert.equal(await countPlayed(), 0);
  } finally {
    await review.close();
  }
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    await explicitAndNavigation(browser);
    await guideOptIn(browser);
    console.log('Docent listening Chrome passed');
  } finally {
    await browser.close();
  }
}

main().catch(() => {
  console.error(JSON.stringify(last));
  process.exitCode = 1;
});
