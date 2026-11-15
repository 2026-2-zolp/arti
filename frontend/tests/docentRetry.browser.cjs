/** 실제 Django API와 루프백 제공자를 거쳐 관람 중 도슨트 장애를 검증합니다. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const baseURL = process.env.ARTI_REVIEW_BASE || 'http://127.0.0.1:5239';
const exhibition = '/exhibitions/fixture-ex01';
const answer = '합성 답변입니다. 밝은 부분을 살펴보세요. <img src=x>';
const isAsk = url => /^\/api\/artworks\/[^/]+\/ask$/.test(new URL(url).pathname);
const requestIdFormat = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const version = value => Number.isSafeInteger(value) && value > 0 ? value : null;

let failureDetails = [];
let evidenceReads = [];

async function reportFailure() {
  await Promise.allSettled(evidenceReads);
  const entries = failureDetails.length ? failureDetails : [{ requestId: null, status: null, evidenceVersion: null }];
  for (const entry of entries) console.error(JSON.stringify(entry));
  process.exitCode = 1;
}

async function checkViewerKeyboard(page, trigger, closeKey) {
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: /크게 보기$/ });
  const close = dialog.getByRole('button', { name: '전체 화면 닫기' });
  await close.waitFor();
  for (const key of ['Tab', 'Shift+Tab']) {
    assert.equal(await close.evaluate(el => document.activeElement === el), true);
    await page.keyboard.press(key);
  }
  assert.equal(await close.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press(closeKey);
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
}

async function journey(page, { useClock = false, enterDocent = true, checkViewer = false } = {}) {
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

  const ready = await page.request.get('/api/ready', { maxRedirects: 0 });
  assert.equal(ready.headers()['x-arti-docent-mock'], '1', 'use only the synthetic Django server');
  await page.route('**/*', route => {
    return new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort();
  });
  if (useClock) await page.clock.install();
  await page.goto(exhibition, { waitUntil: 'domcontentloaded' });
  await button('관람 시작하기').click();
  await button('비회원으로 계속').click();
  for (let i = 1; i <= 5; i++) {
    await page.getByText(i + '/5', { exact: true }).waitFor();
    if (checkViewer && i === 1) {
      await checkViewerKeyboard(page, page.locator('.duel-card').getByRole('button', { name: / 크게 보기$/ }).first(), 'Enter');
      assert.equal(await page.getByText('1/5', { exact: true }).isVisible(), true);
    }
    await page.locator('.duel-card').getByRole('button', { name: / 선택$/ }).first().click();
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
  if (checkViewer) {
    await checkViewerKeyboard(page, button('전체 화면'), 'Escape');
    assert.equal(await artwork(titles[0]).isVisible(), true);
  }
  const before = await visit();
  if (enterDocent) {
    await button('이 부분 더 알아보기').click();
    await page.locator('.chat-artwork').getByText(titles[0], { exact: true }).waitFor();
  }
  return { button, input, send, chat, askRequests, pageErrors, respondTo, visit, artwork, recommendations, titles, before };
}

async function newPage(browser) {
  const page = await browser.newPage({ baseURL, viewport: { width: 360, height: 812 }, reducedMotion: 'reduce' });
  const recordAttempt = (request, response) => {
    if (!isAsk(request.url())) return;
    const id = response?.headers()['x-request-id'];
    const detail = {
      requestId: requestIdFormat.test(id ?? '') ? id : null,
      status: response?.status() ?? null,
      evidenceVersion: { contentVersion: null, sourceVersion: null, revision: null },
    };
    failureDetails.push(detail);
    try {
      detail.evidenceVersion.contentVersion = version(request.postDataJSON()?.entryContext?.contentVersion);
    } catch {
      // A malformed request has no readable evidence version.
    }
    if (response?.ok()) {
      evidenceReads.push(response.json().then(body => {
        detail.evidenceVersion.sourceVersion = version(body?.sourceRefs?.[0]?.sourceVersion);
        detail.evidenceVersion.revision = version(body?.sourceRefs?.[0]?.revision);
      }).catch(() => {}));
    }
  };
  page.on('response', response => recordAttempt(response.request(), response));
  page.on('requestfailed', async request => {
    if (isAsk(request.url()) && !await request.response()) recordAttempt(request);
  });
  return page;
}

async function inspectJourney(browser, status, code) {
  const page = await newPage(browser);
  try {
    const { button, input, send, chat, askRequests, pageErrors, respondTo, visit, artwork, recommendations, titles, before } =
      await journey(page, { useClock: status === 429, checkViewer: status === 502 });
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
      await button('다시 시도').and(page.locator(':enabled')).waitFor();
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
      await send.and(page.locator(':enabled')).waitFor();
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

async function delayedQuestion(page, input, send, question = `[합성 대기 ${randomUUID()} 시험] 이 작품에서 무엇을 살펴볼까요?`) {
  const gate = '/api/__docent_test__/gate/' + question.split(' ')[2];
  const waiting = page.waitForResponse(r => isAsk(r.url()) && r.request().postDataJSON().question === question,
    { timeout: 24000 });
  // 초기 화면 검사가 실패한 경우에도 대기 중인 응답의 rejection을 처리합니다.
  const result = waiting.catch(error => ({ error }));
  try {
    await input.fill(question);
    await send.click();
    const startedBy = Date.now() + 5000;
    while (true) {
      const response = await page.request.get(gate);
      assert.equal(response.headers()['x-arti-docent-mock'], '1');
      if ((await response.json()).started) break;
      assert.ok(Date.now() < startedBy, 'provider never received the question');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return {
      question,
      finish: async () => {
        assert.equal((await page.request.post(gate)).status(), 200);
        const response = await result;
        if (response.error) throw response.error;
        await response.finished();
        return response;
      },
    };
  } catch (error) {
    await page.request.post(gate);
    throw error;
  }
}

async function inspectEvidenceLimits(browser) {
  const page = await newPage(browser);
  try {
    const { button, input, send, chat, pageErrors, respondTo, recommendations, titles, artwork } = await journey(page);
    await input.fill('[합성 근거 부족] 이 작품을 그리던 날 작가에게 어떤 사건이 있었나요?');
    const refused = await respondTo(() => send.click());
    assert.equal(refused.status(), 200);
    const refusal = await refused.json();
    assert.equal(refusal.mode, 'refusal');
    assert.deepEqual(refusal.sourceRefs, []);
    assert.match(refusal.answer, /등록된 작품 자료에서 확인할 수 없어요/);
    const notice = chat.locator('.bubble.ai').filter({ hasText: refusal.answer });
    await notice.getByText('안내', { exact: true }).waitFor();
    assert.equal(await chat.getByText(/다른 합성 작품/).count(), 0);
    assert.equal(await button('다시 시도').count(), 0);
    assert.equal(await input.inputValue(), '');

    await input.fill('이 작품은 어디부터 보면 좋을까요?');
    const recovered = await respondTo(() => send.click());
    assert.equal(recovered.status(), 200);
    assert.deepEqual(recovered.request().postDataJSON().history, []);
    const reply = await recovered.json();
    assert.equal(reply.mode, 'llm');
    const [reference] = reply.sourceRefs;
    assert.equal(reply.sourceRefs.length, 1);
    assert.equal(reference.artworkId, recommendations[0]);
    assert.equal(reference.kind, 'original');
    assert.ok(reference.sourceVersion > 0 && reference.sourceVersion < 99);
    assert.equal(reference.revision, reference.sourceVersion);
    await chat.locator('.bubble.ai').filter({ hasText: reply.answer }).getByText('AI 도슨트', { exact: true }).waitFor();
    await button('뒤로가기').click();
    await artwork(titles[0]).waitFor();
    assert.deepEqual(pageErrors, []);
    console.log('PASS 근거 부족 안내와 다른 작품 출처 배제');
  } finally {
    await page.close();
  }
}

async function inspectContentUpdate(browser) {
  const page = await newPage(browser);
  let restoreArtwork;
  try {
    const { button, input, send, chat, recommendations, titles, artwork, respondTo, pageErrors } = await journey(page);
    const adminPassword = process.env.ARTI_BOOTSTRAP_PASSWORD;
    assert.ok(adminPassword, 'set the synthetic admin password');
    const login = await page.request.post('/api/admin/login', {
      data: { id: 'docent-race-admin', password: adminPassword },
    });
    assert.equal(login.status(), 200);
    const headers = { 'X-Admin-Token': (await login.json()).token };
    const adminPath = '/api/admin/artworks/' + recommendations[0];
    const current = await page.request.get(adminPath, { headers });
    assert.equal(current.status(), 200);
    const original = await current.json();
    restoreArtwork = async () => {
      const current = await page.request.get(adminPath, { headers });
      assert.equal(current.status(), 200);
      const saved = await current.json();
      if (saved.description === original.description) return;
      const restored = await page.request.put(adminPath, { headers, data: { ...original, version: saved.version } });
      assert.equal(restored.status(), 200);
      const data = { ...original, version: (await restored.json()).version };
      assert.equal((await page.request.put(adminPath, { headers, data })).status(), 200);
    };
    const warmup = '이 작품은 어디부터 보면 좋을까요?';
    await input.fill(warmup);
    assert.equal((await respondTo(() => send.click())).status(), 200);
    await chat.locator('.bubble.user').getByText(warmup).waitFor();

    const delayed = await delayedQuestion(page, input, send);
    let latest;
    let stale;
    try {
      const description = '합성 원문 갱신 ' + randomUUID();
      const edit = await page.request.put(adminPath, { headers, data: { ...original, description } });
      assert.equal(edit.status(), 200);
      const saved = await edit.json();
      assert.equal(saved.reviewStatus, 'source_check');
      const approval = await page.request.put(adminPath, {
        headers,
        data: { ...saved, reviewStatus: 'approved', tagStatus: original.tagStatus },
      });
      assert.equal(approval.status(), 200);
      latest = await approval.json();
      assert.ok(latest.contentVersion > original.contentVersion);
    } finally {
      stale = await delayed.finish();
    }
    assert.equal(stale.status(), 409, 'a successful model response with old artwork data must be discarded');
    const rejected = await stale.json();
    assert.equal(rejected.code, 'CONTENT_CHANGED');
    assert.equal(rejected.answer, undefined);
    await button('작품으로 돌아가기').waitFor();
    assert.equal(await input.inputValue(), delayed.question);
    assert.equal(await chat.locator('.bubble.user').count(), 0);
    await button('작품으로 돌아가기').click();
    await artwork(titles[0]).waitFor();
    await page.getByText(latest.description, { exact: true }).waitFor();
    await button('이 부분 더 알아보기').click();
    assert.equal(await input.inputValue(), delayed.question);
    assert.equal(await chat.locator('.bubble.user').count(), 0);
    const renewed = await delayedQuestion(page, input, send, delayed.question);
    const fresh = await renewed.finish();
    assert.equal(fresh.status(), 200);
    assert.equal(fresh.request().postDataJSON().entryContext.contentVersion, latest.contentVersion);
    assert.deepEqual(fresh.request().postDataJSON().history, []);
    const reply = await fresh.json();
    assert.equal(reply.answer, '합성 지연 답변 · ' + latest.description);
    assert.equal(reply.sourceRefs[0].sourceVersion, latest.sourceVersion);
    await chat.getByText(reply.answer, { exact: false }).waitFor();
    assert.deepEqual(pageErrors, []);
    console.log('PASS 관리자 자료 갱신 · 지연 답변 409 · 초안 복구 · 새 원문 답변');
  } finally {
    try { await restoreArtwork?.(); }
    finally { await page.close(); }
  }
}

async function inspectArtworkChange(browser) {
  const page = await newPage(browser);
  try {
    const { button, input, send, chat, before, recommendations, titles, artwork, visit, respondTo, pageErrors } = await journey(page);
    const delayed = await delayedQuestion(page, input, send);
    const draft = '  원래 작품에서 이어서 물어보고 싶어요.  ';
    let late;
    try {
      await input.fill(draft);
      await button('뒤로가기').click();
      await artwork(titles[0]).waitFor();
      await button('이 부분 더 알아보기').click();
      assert.equal(await input.inputValue(), draft);
      await button('뒤로가기').click();
      await artwork(titles[0]).waitFor();
      await button('다음 작품 안내').click();
      await button('2번 작품 감상하기').click();
      await artwork(titles[1]).waitFor();
      await button('이 부분 더 알아보기').click();
      await page.locator('.chat-artwork').getByText(titles[1], { exact: true }).waitFor();
      assert.equal(await input.inputValue(), '');
      assert.deepEqual((await visit()).viewed, recommendations.slice(0, 1));
    } finally {
      late = await delayed.finish();
    }
    assert.equal(late.status(), 200);
    const oldReply = await late.json();
    assert.equal(oldReply.sourceRefs[0].artworkId, recommendations[0]);
    assert.equal(await chat.getByText(oldReply.answer, { exact: false }).count(), 0);
    assert.equal(await input.inputValue(), '');
    const secondQuestion = '두 번째 작품은 어디부터 볼까요?';
    await input.fill(secondQuestion);
    const second = await respondTo(() => send.click());
    assert.equal(second.status(), 200);
    assert.equal(new URL(second.url()).pathname, `/api/artworks/${recommendations[1]}/ask`);
    assert.deepEqual(second.request().postDataJSON().history, []);
    assert.equal((await second.json()).sourceRefs[0].artworkId, recommendations[1]);
    await chat.locator('.bubble.user').getByText(secondQuestion).waitFor();
    assert.equal(await chat.getByText(oldReply.answer, { exact: false }).count(), 0);
    await button('뒤로가기').click();
    await artwork(titles[1]).waitFor();

    // 실제 브라우저 뒤로가기로 두 번째 안내에, 앱 화살표로 첫 작품에 돌아갑니다.
    await page.goBack();
    await button('2번 작품 감상하기').waitFor();
    await button('뒤로가기').click();
    await artwork(titles[0]).waitFor();
    const resumed = await visit();
    assert.equal(resumed.visitId, before.visitId);
    assert.equal(resumed.current, 0);
    assert.deepEqual(resumed.viewed, recommendations.slice(0, 1));
    await button('이 부분 더 알아보기').click();
    await page.locator('.chat-artwork').getByText(titles[0], { exact: true }).waitFor();
    assert.equal(await input.inputValue(), draft);
    assert.equal(await chat.locator('.bubble.user').count(), 0);
    assert.equal(await chat.getByText(oldReply.answer, { exact: false }).count(), 0);
    assert.deepEqual(pageErrors, []);
    console.log('PASS 다음 작품 이동 · 지연 답변 격리 · 원래 작품 초안 보존');
  } finally {
    await page.close();
  }
}

async function inspectEntryContexts(browser) {
  const page = await newPage(browser);
  let restoreArtwork;
  try {
    const { button, input, send, chat, recommendations, titles, artwork, respondTo, before, askRequests, pageErrors } =
      await journey(page, { enterDocent: false });
    const adminPassword = process.env.ARTI_BOOTSTRAP_PASSWORD;
    assert.ok(adminPassword, 'set the synthetic admin password');
    const login = await page.request.post('/api/admin/login', {
      data: { id: 'docent-race-admin', password: adminPassword },
    });
    assert.equal(login.status(), 200);
    const headers = { 'X-Admin-Token': (await login.json()).token };
    const artworkId = recommendations[0];
    const path = '/api/admin/artworks/' + artworkId;
    const current = await page.request.get(path, { headers });
    assert.equal(current.status(), 200);
    const original = await current.json();
    const fixtureId = randomUUID();
    const selectedQuestion = '합성 관찰 질문 ' + fixtureId;
    const confirmedHint = '합성 힌트 · 화면 왼쪽을 살펴보세요.';
    const summary = '합성 쉬운 요약 · 파란 바탕과 노란 원을 함께 보세요.';
    assert.equal(original.reviewStatus, 'approved');
    const updated = await page.request.put(path, {
      headers,
      data: {
        ...original,
        guidedLooking: ['합성 첫 관찰 질문', selectedQuestion],
        guidedHints: ['합성 첫 힌트', confirmedHint],
        guideStatus: 'confirmed',
        summary,
        summaryStatus: 'confirmed',
      },
    });
    assert.equal(updated.status(), 200);
    let work = await updated.json();
    restoreArtwork = async () => {
      const restored = await page.request.put(path, { headers, data: { ...original, version: work.version } });
      assert.equal(restored.status(), 200);
    };
    assert.equal(work.reviewStatus, 'approved');
    assert.equal(work.sourceVersion, original.sourceVersion);
    assert.ok(work.guideRevision > original.guideRevision);
    assert.ok(work.summaryRevision > original.summaryRevision);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await artwork(titles[0]).waitFor();

    const expectedHistory = [];
    const verifyRetry = async ({ action, question, draft, remains, entry, revision, evidence }) => {
      const requestCount = askRequests.length;
      const failed = await respondTo(action);
      assert.equal(failed.status(), 502);
      assert.equal((await failed.json()).code, 'PROVIDER_ERROR');
      const retry = button('다시 시도');
      await retry.waitFor();
      assert.equal(await input.inputValue(), draft);
      assert.equal(await chat.locator('.bubble.user').count(), expectedHistory.length / 2);
      assert.equal(askRequests.length, requestCount + 1);
      const recovered = await respondTo(() => retry.click());
      assert.equal(recovered.status(), 200);
      assert.equal(new URL(recovered.url()).pathname, `/api/artworks/${artworkId}/ask`);
      const payload = failed.request().postDataJSON();
      assert.deepEqual(payload, {
        question, entryContext: entry, visitId: before.visitId, history: expectedHistory,
      });
      assert.deepEqual(recovered.request().postDataJSON(), payload);
      const reply = await recovered.json();
      assert.equal(reply.answer, '합성 근거 · ' + evidence);
      assert.equal(reply.mode, 'llm');
      assert.deepEqual(reply.sourceRefs, [{
        artworkId, kind: entry.kind, revision, sourceVersion: work.sourceVersion,
      }]);
      await chat.locator('.bubble.user').filter({ hasText: question }).waitFor();
      expectedHistory.push({ role: 'user', text: question }, { role: 'assistant', text: reply.answer });
      assert.equal(await chat.locator('.bubble.user').count(), expectedHistory.length / 2);
      assert.equal(await input.inputValue(), remains);
      assert.equal(askRequests.length, requestCount + 2);
    };

    const guideEntry = { tab: 'guided', kind: 'guide', contentVersion: work.contentVersion, questionIndex: 1 };
    const guideQuestion = `[합성 502 ${randomUUID()} 시험] 방금 본 색에 관해 더 알고 싶어요.`;
    await page.getByRole('tab', { name: '관람가이드' }).click();
    const selected = page.locator('.guided-list li').filter({ hasText: selectedQuestion });
    await selected.getByRole('button', { name: '힌트 보기' }).click();
    await selected.getByText(confirmedHint, { exact: false }).waitFor();
    await button('2번 질문으로 대화하기').click();
    await page.getByText(selectedQuestion, { exact: true }).waitFor();
    await input.fill(guideQuestion);
    await verifyRetry({
      action: () => send.click(), question: guideQuestion, draft: guideQuestion, remains: '',
      entry: guideEntry, revision: work.guideRevision, evidence: selectedQuestion,
    });
    console.log('PASS 관람가이드 2번 질문 · 동일 질문과 가이드 리비전');

    const hintQuestion = '이 관찰 질문에 답할 수 있도록 작품에서 볼 지점 하나를 힌트로 알려 주세요.';
    const hintDraft = '힌트를 읽고 이어서 보낼 방문자 초안';
    await input.fill(hintDraft);
    await verifyRetry({
      action: () => button('힌트 받기').click(), question: hintQuestion, draft: hintDraft, remains: hintDraft,
      entry: guideEntry, revision: work.guideRevision, evidence: selectedQuestion,
    });
    await button('뒤로가기').click();
    await artwork(titles[0]).waitFor();
    await selected.getByText(confirmedHint, { exact: false }).waitFor();
    console.log('PASS AI 힌트 · 동일 질문과 가이드 리비전 · 별도 입력 초안 보존');

    await page.getByRole('tab', { name: '작품 해설' }).click();
    await button('AI 요약 보기').click();
    await page.getByText(summary, { exact: true }).waitFor();
    await button('이 부분 더 알아보기').click();
    assert.equal(await input.inputValue(), hintDraft);
    const summaryQuestion = `[합성 502 ${randomUUID()} 시험] 이 요약을 조금 더 쉽게 설명해 주세요.`;
    const summaryDraft = '  ' + summaryQuestion + '  ';
    await input.fill(summaryDraft);
    await verifyRetry({
      action: () => send.click(), question: summaryQuestion, draft: summaryDraft, remains: '',
      entry: { tab: 'desc', kind: 'summary', contentVersion: work.contentVersion },
      revision: work.summaryRevision, evidence: summary,
    });
    await button('뒤로가기').click();
    await page.getByText(summary, { exact: true }).waitFor();
    console.log('PASS 쉬운 요약 · 동일 질문과 요약 리비전');

    const verifyRetryAfterEdit = async kind => {
      const guide = kind === 'guide';
      const tab = guide ? 'guided' : 'desc';
      const revisionKey = guide ? 'guideRevision' : 'summaryRevision';
      const evidence = item => guide ? item.guidedLooking[1] : item.summary;
      const enter = async item => {
        await page.getByRole('tab', { name: guide ? '관람가이드' : '작품 해설' }).click();
        if (guide) {
          const question = page.locator('.guided-list li').filter({ hasText: evidence(item) });
          await question.getByRole('button', { name: '2번 질문으로 대화하기' }).click();
        } else {
          if (await button('AI 요약 보기').isVisible()) await button('AI 요약 보기').click();
          await page.getByText(evidence(item), { exact: true }).waitFor();
          await button('이 부분 더 알아보기').click();
        }
      };
      const previous = work;
      const oldAnswer = '합성 근거 · ' + evidence(previous);
      await enter(previous);
      await input.fill('이 자료에서 어떤 요소를 살펴볼까요?');
      assert.equal((await respondTo(() => send.click())).status(), 200);
      await chat.getByText(oldAnswer, { exact: false }).first().waitFor();

      const question = `[합성 갱신 ${randomUUID()} 시험] 방금 본 내용을 더 설명해 주세요.`;
      const draft = '  ' + question + '  ';
      await input.fill(draft);
      const failed = await respondTo(() => send.click());
      assert.equal(failed.status(), 502);
      assert.equal((await failed.json()).code, 'PROVIDER_ERROR');
      const initial = failed.request().postDataJSON();
      const entry = { tab, kind, contentVersion: previous.contentVersion, ...(guide ? { questionIndex: 1 } : {}) };
      assert.deepEqual(initial.entryContext, entry);
      assert.equal(initial.question, question);
      assert.ok(initial.history.some(message => message.role === 'assistant' && message.text === oldAnswer));
      assert.equal(await input.inputValue(), draft);

      const newEvidence = `갱신된 합성 자료 ${randomUUID()}`;
      const fields = guide ? { guidedLooking: [previous.guidedLooking[0], newEvidence] } : { summary: newEvidence };
      const edited = await page.request.put(path, { headers, data: { ...previous, ...fields } });
      assert.equal(edited.status(), 200);
      work = await edited.json();
      assert.ok(work.contentVersion > previous.contentVersion);
      assert.ok(work[revisionKey] > previous[revisionKey]);
      assert.equal(work.sourceVersion, previous.sourceVersion);
      assert.equal(evidence(work), newEvidence);

      const stale = await respondTo(() => button('다시 시도').click());
      assert.equal(stale.status(), 409);
      assert.deepEqual(stale.request().postDataJSON(), initial);
      const rejected = await stale.json();
      assert.equal(rejected.code, 'CONTENT_CHANGED');
      assert.equal(rejected.answer, undefined);
      assert.equal(rejected.sourceRefs, undefined);
      await button('작품으로 돌아가기').waitFor();
      await chat.getByText(oldAnswer, { exact: false }).first().waitFor({ state: 'hidden' });
      assert.equal(await chat.getByText(oldAnswer, { exact: false }).count(), 0);
      assert.equal(await input.inputValue(), draft);
      await button('다시 시도').waitFor({ state: 'hidden' });

      await button('작품으로 돌아가기').click();
      await artwork(titles[0]).waitFor();
      await enter(work);
      assert.equal(await input.inputValue(), draft);
      assert.equal(await chat.locator('.bubble.user').count(), 0);
      const fresh = await respondTo(() => send.click());
      assert.equal(fresh.status(), 200);
      assert.deepEqual(fresh.request().postDataJSON(), {
        question, entryContext: { ...entry, contentVersion: work.contentVersion },
        visitId: before.visitId, history: [],
      });
      const reply = await fresh.json();
      assert.equal(reply.answer, '합성 근거 · ' + newEvidence);
      assert.deepEqual(reply.sourceRefs, [{
        artworkId, kind, revision: work[revisionKey], sourceVersion: work.sourceVersion,
      }]);
      await chat.getByText(reply.answer, { exact: false }).waitFor();
      assert.equal(await chat.getByText(oldAnswer, { exact: false }).count(), 0);
      assert.equal(await input.inputValue(), '');
      await button('뒤로가기').click();
      await artwork(titles[0]).waitFor();
      console.log(`PASS ${guide ? '관람가이드' : '쉬운 요약'} · 502 뒤 자료 갱신 · 409 · 초안과 최신 근거 복구`);
    };

    await verifyRetryAfterEdit('guide');
    await verifyRetryAfterEdit('summary');
    await button('다음 작품 안내').click();
    await button('2번 작품 감상하기').click();
    await artwork(titles[1]).waitFor();
    assert.deepEqual(pageErrors, []);
    console.log('PASS 자료 변경 복구 뒤 관람 이어가기');
  } finally {
    try { await restoreArtwork?.(); }
    finally { await page.close(); }
  }
}

(async () => {
  assert.equal(new URL(baseURL).hostname, '127.0.0.1', 'use a local preview');
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const checks = process.env.ARTI_DOCENT_RACE_TESTS === '1'
      ? [['작품 자료 갱신', inspectContentUpdate], ['다음 작품 이동', inspectArtworkChange]]
      : process.env.ARTI_DOCENT_ENTRY_TESTS === '1'
        ? [['관람가이드·힌트·쉬운 요약', inspectEntryContexts]]
        : [
          ...[[502, 'PROVIDER_ERROR'], [429, 'RATE_LIMITED'], [504, 'AI_TIMEOUT']]
            .map(([status, code]) => [status, browser => inspectJourney(browser, status, code)]),
          ['근거 부족과 혼합 출처', inspectEvidenceLimits],
        ];
    for (const [, check] of checks) {
      failureDetails = [];
      evidenceReads = [];
      try { await check(browser); }
      catch { await reportFailure(); }
      finally { failureDetails = []; evidenceReads = []; }
    }
  } finally {
    await browser.close();
  }
})().catch(reportFailure);
