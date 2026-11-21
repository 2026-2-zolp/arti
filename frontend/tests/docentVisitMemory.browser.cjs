/** Visit as a synthetic member, then reopen a liked work and visit a different exhibition. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');

const baseURL = process.env.ARTI_REVIEW_BASE || 'http://127.0.0.1:5690';
const firstExhibition = '/exhibitions/fixture-ex01';
const nextExhibition = '/exhibitions/fixture-ex-memory';
const firstArtwork = 'fixture-art03';
const demoQuestion = '그림에서 빛과 색감을 쉽게 설명해 주세요.';
const recapPath = '/api/artworks/' + firstArtwork + '/liked-recap';
let lastDocentResponse = { requestId: null, status: null, evidenceVersion: null };

async function signedInTab(browser) {
  const context = await browser.newContext({ baseURL, viewport: { width: 360, height: 812 }, reducedMotion: 'reduce' });
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const ready = await page.request.get('/api/ready');
  assert.equal(ready.headers()['x-arti-docent-mock'], '1');
  const account = await page.request.post('/api/auth/signup', { data: {
    email: 'visit-memory-' + randomUUID() + '@example.test', nickname: '합성 검수회원',
    password: 'synthetic-only-2026', termsAccepted: true, termsVersion: '2026-11-18-draft.2',
  } });
  assert.equal(account.status(), 200);
  const { user, token } = await account.json();
  await page.goto('/');
  await page.evaluate(({ user, token }) => {
    localStorage.setItem('arti.user', JSON.stringify(user));
    localStorage.setItem('arti.token', JSON.stringify(token));
  }, { user, token });
  return { page, context, token, userId: user.id };
}

function ui(page) {
  const button = name => page.getByRole('button', { name, exact: true });
  const entry = button('이 부분 더 알아보기');
  const textbox = page.getByRole('textbox', { name: '질문 입력' });
  const chat = page.getByRole('log', { name: '도슨트 대화' });
  async function send(artworkId, action, status = 200) {
    const [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/artworks/' + artworkId + '/ask' &&
        r.request().method() === 'POST'),
      action(),
    ]);
    lastDocentResponse = { requestId: null, status: response.status(), evidenceVersion: null };
    const body = await response.json();
    if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.requestId ?? '')) {
      lastDocentResponse.requestId = body.requestId;
    }
    const version = body.sourceRefs?.[0]?.sourceVersion;
    if (Number.isSafeInteger(version) && version > 0) lastDocentResponse.evidenceVersion = version;
    assert.equal(response.status(), status);
    assert.equal(response.headers()['x-arti-docent-mock'], '1');
    if (status === 200) await chat.locator('.bubble.ai').filter({ hasText: body.answer }).last().waitFor();
    return { request: response.request().postDataJSON(), body };
  }
  return {
    button, entry, textbox,
    async ask(id, question, status) {
      await textbox.fill(question);
      return send(id, () => button('보내기').click(), status);
    },
    retry(id) { return send(id, () => button('다시 시도').click()); },
  };
}

async function check(browser) {
  const { page, context, userId, token } = await signedInTab(browser);
  const { button, entry, ask, retry, textbox } = ui(page);
  const tokenHeader = { Authorization: 'Bearer ' + token };
  const receiptPosts = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/visits') receiptPosts.push(request.postDataJSON());
  });
  try {
    await page.goto(firstExhibition);
    await button('전시 순서로 바로 보기').click();
    await button('좋아요').click();
    await page.getByRole('group', { name: '좋아요 이유' }).getByRole('button', { name: '닫기', exact: true }).click();
    await entry.click();
    const first = await ask(firstArtwork, demoQuestion);
    assert.deepEqual(first.body.interestSignal, { topics: ['light', 'color'], style: 'simple' });
    assert.equal(await page.getByText('이 관람에 메모 남기기').count(), 0);
    await page.reload();
    await button('뒤로가기').click();
    await button('다음 작품 안내').click();
    await button('2번 작품 감상하기').click();
    await entry.click();

    const secondArtwork = 'fixture-art01';
    const second = await ask(secondArtwork, '이 작품은 어디부터 보면 좋을까요?');
    assert(second.body.answer.includes('앞 작품에서 살펴본 빛과 명암'));
    assert(second.body.answer.includes('풍경'));
    assert.deepEqual(second.request.visitorMemory.earlier.map(item => item.artworkId), [firstArtwork]);
    assert(!JSON.stringify(second.request).includes(demoQuestion));
    assert.deepEqual([...new Set(second.body.sourceRefs.map(ref => ref.artworkId))], [secondArtwork]);

    const faultQuestion = '[합성 502 ' + randomUUID() + ' 시험] 구도를 자세히 설명해 주세요.';
    const failed = await ask(secondArtwork, faultQuestion, 502);
    assert.equal(await textbox.inputValue(), faultQuestion);
    const retried = await retry(secondArtwork);
    assert.deepEqual(retried.request, failed.request);
    assert.deepEqual(retried.body.interestSignal, { topics: ['composition'], style: 'detailed' });

    const light = await ask(secondArtwork, '[합성 근거 부족] 빛을 자세히 설명해 주세요.');
    assert.equal(light.body.mode, 'fallback');
    assert(light.body.answer.includes('색이나 밝기가 비슷한지'));
    assert.deepEqual(light.body.sourceRefs, []);

    const otherTab = await context.newPage();
    await otherTab.goto(firstExhibition);
    assert.equal(await otherTab.evaluate(() => sessionStorage.getItem('arti.scope.visitMemory')), null);
    await otherTab.close();

    await button('뒤로가기').click();
    await button('다음 작품 안내').click();
    await button('3번 작품 감상하기').click();
    await button('관람 마치기').click();
    await page.getByText('관람기록에 저장되었어요', { exact: true }).waitFor();
    assert.equal(receiptPosts.length, 1);
    assert.deepEqual(receiptPosts[0].docentInterests.map(item => item.artworkId), [firstArtwork, secondArtwork]);
    assert(!JSON.stringify(receiptPosts[0]).includes(demoQuestion));
    assert(!JSON.stringify(receiptPosts[0]).includes(faultQuestion));
    const records = await page.request.get('/api/users/' + userId + '/visits', { headers: tokenHeader });
    assert.equal((await records.json()).length, 1);

    await page.goto('/mypage');
    await page.getByRole('tab', { name: '좋아요 목록' }).click();
    const likeCard = page.getByRole('link', { name: '검증용 작품 03 다시 보기' });
    await likeCard.click();
    await page.getByRole('heading', { name: '작품 해설' }).waitFor();
    await page.getByRole('heading', { name: '도슨트 대화 요약' }).waitFor();
    await page.getByText('빛과 명암 · 색감에 관해 질문했어요.', { exact: true }).waitFor();
    const enlarge = button('도판 크게 보기');
    await enlarge.focus();
    await page.keyboard.press('Enter');
    const viewer = page.getByRole('dialog', { name: '검증용 작품 03 크게 보기' });
    await viewer.waitFor();
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'hidden' });
    assert.equal(await enlarge.evaluate(el => document.activeElement === el), true);
    await button('뒤로가기').click();
    await likeCard.waitFor();
    await likeCard.click();
    await page.getByRole('heading', { name: '도슨트 대화 요약' }).waitFor();
    await page.goBack();
    await likeCard.waitFor();

    await page.goto(nextExhibition);
    await button('전시 순서로 바로 보기').click();
    await entry.click();
    const next = await ask('fixture-memory-art01', '이 작품에서 볼 지점을 알려주세요.');
    assert(next.body.answer.includes('지난 전시에서는 빛과 명암'));
    assert.equal(next.body.usedPreviousVisitMemory, true);
    assert.deepEqual(next.request.visitorMemory.earlier, []);
    assert(!JSON.stringify(next.request).includes(firstArtwork));
    const nextDocentPath = new URL(page.url()).pathname;
    async function openMemorySettings() {
      await page.goto('/mypage');
      await page.getByRole('link', { name: '계정 설정' }).click();
      await page.getByText('지난 전시 기억', { exact: true }).click();
    }
    await openMemorySettings();
    await button('기억 끄기').click();
    await page.getByText('지난 전시 기억을 껐어요.', { exact: true }).waitFor();
    await page.goto(nextDocentPath);
    const afterOff = await ask('fixture-memory-art01', '이 작품에서 볼 지점을 다시 알려주세요.');
    assert.equal(afterOff.body.usedPreviousVisitMemory, undefined);
    assert(!JSON.stringify(afterOff.request.history).includes(next.body.answer));
    assert(!afterOff.body.answer.includes('지난 전시에서는'));

    await openMemorySettings();
    await button('기억 켜기').click();
    await page.getByText('지난 전시 기억을 켰어요.', { exact: true }).waitFor();
    await button('지난 전시 기억 지우기').click();
    await page.getByRole('alertdialog').getByRole('button', { name: '취소' }).click();
    const beforeReset = await page.request.get('/api/users/' + userId + '/docent-memory', { headers: tokenHeader });
    assert.equal((await beforeReset.json()).resetAt, null);
    await button('지난 전시 기억 지우기').click();
    await page.getByRole('alertdialog').getByRole('button', { name: '기억 지우기' }).click();
    await page.getByText('지난 전시 기억을 지웠어요.', { exact: true }).waitFor();
    await page.goto(nextDocentPath);
    const afterReset = await ask('fixture-memory-art01', '이 작품에서 볼 지점을 추천해 주세요.');
    assert.equal(afterReset.body.usedPreviousVisitMemory, undefined);
    const retainedLikes = await page.request.get(recapPath, { headers: tokenHeader });
    assert.deepEqual((await retainedLikes.json()).recap.topics, ['빛과 명암', '색감']);
    assert.deepEqual(errors, []);

    const other = await signedInTab(browser);
    try {
      const denied = await other.page.request.get(recapPath, { headers: { Authorization: 'Bearer ' + other.token } });
      assert.equal(denied.status(), 404);
      await other.page.goto('/mypage?tab=likes&artwork=' + firstArtwork);
      await other.page.getByText('지금 볼 수 있는 좋아요 작품이 없어요.').waitFor();
      assert.equal(await other.page.getByRole('heading', { name: '도슨트 대화 요약' }).count(), 0);
      await other.page.getByRole('link', { name: '좋아요 목록으로' }).click();
      await other.page.getByText('아직 좋아요한 작품이 없어요.').waitFor();
      await other.page.goto(nextExhibition);
      const otherUI = ui(other.page);
      await otherUI.button('전시 순서로 바로 보기').click();
      await otherUI.entry.click();
      const clean = await otherUI.ask('fixture-memory-art01', '이 작품에서 볼 지점을 알려주세요.');
      assert(!clean.body.answer.includes('지난 전시에서는'));
    } finally {
      await other.context.close();
    }
    // A new visit must show its own date and empty recap instead of reusing a previous conversation.
    const latest = receiptPosts[0];
    const likedAt = new Date(Date.parse(latest.date) + 1000).toISOString();
    const revisit = await page.request.post('/api/visits', { headers: tokenHeader, data: {
      ...latest, visitId: randomUUID(), date: likedAt, viewedArtworkIds: [firstArtwork],
      reactions: { [firstArtwork]: 'like' }, reactionReasons: {}, dwell: {},
      artworkReceiptEvidence: {}, docentInterests: [],
    } });
    assert.equal(revisit.status(), 201);
    const recap = await (await page.request.get(recapPath, { headers: tokenHeader })).json();
    assert.equal(recap.likedAt, likedAt);
    assert.equal(recap.recap, null);
    await page.goto('/mypage?tab=likes');
    await likeCard.waitFor();
    assert.equal(await likeCard.count(), 1);
    await likeCard.click();
    await page.getByText('이 관람에서 요약할 도슨트 대화가 없어요.').waitFor();
    assert.equal(await page.getByText('빛과 명암 · 색감에 관해 질문했어요.', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ automaticTopics: true, sameExhibition: true, matchingTag: true,
      retry: [502, 200], rawDialogueInReceipt: false, memberReceipts: 1,
      likedArtworkRecap: true, recapZoomAndBack: true, latestRevisitWithoutChat: true,
      secondExhibition: true, separateTabIsolated: true, otherAccountIsolated: true,
      lightFallback: true, crossExhibitionControls: true, resetPreservedLikedRecap: true }));
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    await check(browser);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(process.env.CI === 'true' ? JSON.stringify(lastDocentResponse) : error);
  process.exitCode = 1;
});
