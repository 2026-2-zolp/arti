/** 실제 Django API와 루프백 제공자를 거쳐 관람 중 도슨트 장애를 검증합니다. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const baseURL = process.env.ARTI_REVIEW_BASE || 'http://127.0.0.1:5239';
assert.equal(new URL(baseURL).hostname, '127.0.0.1', 'use a local preview');
const exhibition = '/exhibitions/fixture-ex01';
const answer = '합성 답변입니다. 밝은 부분을 살펴보세요. <img src=x>';
const isAsk = url => /^\/api\/artworks\/[^/]+\/ask$/.test(new URL(url).pathname);

async function inspectJourney(browser, status, code) {
  const page = await browser.newPage({ baseURL, viewport: { width: 360, height: 812 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(10000);
  const button = name => page.getByRole('button', { name, exact: true });
  const input = page.getByRole('textbox', { name: '질문 입력' });
  const send = button('보내기');
  const chat = page.getByRole('log', { name: '도슨트 대화' });
  const askRequests = [];
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (isAsk(request.url())) askRequests.push(request);
  });
  const respondTo = async action => {
    const [response] = await Promise.all([page.waitForResponse(r => isAsk(r.url())), action()]);
    assert.equal(response.headers()['x-arti-docent-mock'], '1');
    return response;
  };
  const visit = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('arti.visit')));
  const artwork = title => page.getByRole('heading', { name: title, exact: true });

  try {
    const ready = await page.request.get('/api/ready', { maxRedirects: 0 });
    assert.equal(ready.headers()['x-arti-docent-mock'], '1', 'use only the synthetic Django server');
    await page.route('**/*', route => {
      return new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort();
    });
    if (status === 429) await page.clock.install();
    await page.goto(exhibition, { waitUntil: 'domcontentloaded' });
    await button('관람 시작하기').click();
    await button('비회원으로 계속').click();
    for (let i = 1; i <= 5; i++) {
      await page.getByText(i + '/5', { exact: true }).waitFor();
      await page.locator('button.duel-card').first().click();
    }
    await button('취향 미리 확인').click();
    await button('이 취향으로 계속').click();
    await page.getByRole('radio', { name: /30분/ }).click();
    const [recommendation] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/recommendations')),
      button('추천 받기').click(),
    ]);
    assert.equal(recommendation.status(), 200);
    assert.equal(recommendation.request().postDataJSON().tasteProfile.version, 2);
    const recommendations = (await recommendation.json()).map(item => item.artworkId);
    assert.equal(recommendations.length, 3);
    const cards = page.locator('.rec-list .rec-card strong');
    await cards.last().waitFor();
    const titles = (await cards.allTextContents()).map(title => title.replace(/^\d+\.\s*/, ''));
    await button('2D 지도에서 경로 보기').click();
    await page.locator('.fm-route.active').waitFor();
    await button('관람 시작하기').click();
    await artwork(titles[0]).waitFor();
    const before = await visit();
    await button('이 부분 더 알아보기').click();
    await page.locator('.chat-artwork').getByText(titles[0], { exact: true }).waitFor();

    const first = '이 작품은 어디부터 보면 좋을까요?';
    await input.fill(first);
    const firstResponse = await respondTo(() => send.click());
    assert.equal(firstResponse.status(), 200);
    await chat.locator('.bubble.ai').getByText(answer, { exact: false }).waitFor();
    const prior = await firstResponse.json();
    assert.equal(prior.answer, answer);

    const question = `[합성 ${status} ${randomUUID()} 시험] 밝은 부분은 어떻게 볼까요?`;
    const draft = `  ${question}  `;
    await input.fill(draft);
    const failed = await respondTo(() => send.click());
    assert.equal(failed.status(), status);
    assert.equal((await failed.json()).code, code);
    const error = page.getByRole('alert');
    await error.waitFor();
    assert.doesNotMatch(await error.textContent(), /upstream-private-debug/);
    const retry = button('다시 시도');
    await retry.waitFor();
    assert.equal(await input.inputValue(), draft);
    assert.equal(await chat.locator('.bubble.user').count(), 1);
    assert.equal(askRequests.length, 2);

    if (status === 429) {
      const seconds = Number(failed.headers()['retry-after']);
      assert.equal(seconds, 30);
      assert.equal(await retry.isDisabled(), true, 'Retry-After blocks retry');
      assert.equal(await send.isDisabled(), true, 'Retry-After blocks a new submission');
      assert.match(await error.textContent(), /30초/);
      await input.press('Enter');
      await page.clock.fastForward((seconds - 1) * 1000);
      assert.equal(await retry.isDisabled(), true);
      assert.equal(askRequests.length, 2);
      await page.clock.fastForward(2000);
      await retry.waitFor();
      assert.equal(await retry.isEnabled(), true);
      assert.equal(await input.inputValue(), draft);
      assert.equal(askRequests.length, 2, 'retry requires a user action');
    }

    const newDraft = '다음에 물어볼 새 질문';
    if (status === 504) await input.fill(newDraft);
    const recovered = await respondTo(() => (status === 504 ? button('이전 질문 다시 시도') : retry).click());
    assert.equal(recovered.status(), 200);
    assert.equal(new URL(recovered.url()).pathname, `/api/artworks/${recommendations[0]}/ask`);
    const payload = failed.request().postDataJSON();
    assert.deepEqual(recovered.request().postDataJSON(), payload);
    assert.equal(payload.question, question);
    assert.equal(payload.visitId, before.visitId);
    assert.equal(payload.entryContext.kind, 'original');
    assert.ok(Number.isInteger(payload.entryContext.contentVersion));
    assert.deepEqual(payload.history, [{ role: 'user', text: first }, { role: 'assistant', text: answer }]);
    const reply = await recovered.json();
    assert.equal(reply.mode, 'llm');
    assert.equal(reply.answer, answer);
    assert.deepEqual(reply.sourceRefs, prior.sourceRefs);
    assert.equal(reply.sourceRefs.length, 1);
    assert.equal(reply.sourceRefs[0].artworkId, recommendations[0]);
    assert.equal(reply.sourceRefs[0].kind, 'original');
    assert.ok(reply.sourceRefs[0].sourceVersion > 0);
    assert.equal(reply.sourceRefs[0].revision, reply.sourceRefs[0].sourceVersion);
    await chat.locator('.bubble.user').filter({ hasText: question }).waitFor();
    assert.equal(await chat.locator('.bubble.ai').count(), 2);
    assert.equal(await chat.locator('img').count(), 0, 'provider text stays inert');
    assert.equal(await input.inputValue(), status === 504 ? newDraft : '');
    assert.equal(askRequests.length, 3);

    if (status === 429) {
      const refreshDraft = `[합성 429 ${randomUUID()} 시험] 새로고침 뒤에도 입력이 남나요?`;
      await input.fill(refreshDraft);
      const limited = await respondTo(() => send.click());
      assert.equal(limited.status(), 429);
      await error.waitFor();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await error.filter({ hasText: '30초' }).waitFor();
      assert.equal(await input.inputValue(), refreshDraft);
      assert.equal(await send.isDisabled(), true);
      await page.clock.fastForward(31000);
      assert.equal(await send.isEnabled(), true);
      assert.equal(askRequests.length, 4);
      const resumed = await respondTo(() => send.click());
      assert.equal(resumed.status(), 200);
      assert.deepEqual(resumed.request().postDataJSON(), limited.request().postDataJSON());
      await chat.locator('.bubble.user').filter({ hasText: refreshDraft }).waitFor();
      assert.equal(askRequests.length, 5);
    }

    await button('뒤로가기').click();
    await artwork(titles[0]).waitFor();
    for (let i = 1; i < titles.length; i++) {
      await button('다음 작품 안내').click();
      await button(`${i + 1}번 작품 감상하기`).click();
      await artwork(titles[i]).waitFor();
    }
    await button('관람 마치기').click();
    const receipt = page.getByRole('article', { name: '아트 영수증' });
    await receipt.getByRole('heading', { name: 'ART RECEIPT' }).waitFor();
    const after = await visit();
    assert.equal(after.visitId, before.visitId);
    assert.deepEqual(after.viewed, recommendations);
    const receivedTitles = (await receipt.locator('.receipt-works li span:first-child').allTextContents())
      .map(title => title.replace(/^\d+\.\s*/, ''));
    assert.deepEqual(receivedTitles, titles);
    assert.deepEqual(pageErrors, []);
    console.log(`PASS ${status} → 200 · 동일 질문/맥락 · 출처 · 작품 복귀와 영수증`);
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [status, code] of [[502, 'PROVIDER_ERROR'], [429, 'RATE_LIMITED'], [504, 'AI_TIMEOUT']]) {
      try { await inspectJourney(browser, status, code); }
      catch (error) {
        console.error(`FAIL ${status}`, error);
        process.exitCode = 1;
      }
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
