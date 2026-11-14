/** 실행 중인 로컬 프론트에서 합성 API로 영수증 실패 복구와 실제 PNG 갱신을 검증합니다.
 * ARTI_REVIEW_BASE, PLAYWRIGHT_MODULE, ARTI_REVIEW_OUTPUT은 필요할 때 지정합니다.
 * 실제 AI·회원 데이터는 사용하지 않습니다. npm test와 별도로 실행합니다.
 */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {mkdir, writeFile} = require('node:fs/promises');
const path = require('node:path');

const base = process.env.ARTI_REVIEW_BASE || 'http://127.0.0.1:5215';
const output = process.env.ARTI_REVIEW_OUTPUT;
const oldText = '이전에 성공한 합성 해석입니다. 따뜻한 색면을 오래 보았어요.';
const newText = '재시도에 성공한 새로운 합성 해석입니다. 작품의 넓은 면과 작은 형태를 비교했어요. '.repeat(5);

async function check(browser, width, member, seeded = true) {
  const page = await browser.newPage({viewport: {width, height: 812}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const id = randomUUID();
  const user = member ? {id: 'synthetic-member', nickname: '합성 회원', email: 'receipt@example.test', tastes: []} : null;
  let interpretCalls = 0;
  let saveCalls = 0;
  let respond;
  const waits = [];
  const work = {id: 'synthetic-art', title: '합성 작품', artist: '시험', year: '', tags: ['warm']};
  await page.route(base + '/api/**', async route => {
    const url = new URL(route.request().url());
    const json = data => route.fulfill({json: data});
    if (url.pathname === '/api/auth/me') return json(user);
    if (url.pathname === '/api/exhibitions/receipt-test') return json({id: 'receipt-test', title: '합성 영수증 검수', venue: '가상 전시실'});
    if (url.pathname === '/api/artworks') return json([work]);
    if (url.pathname === '/api/visits') {
      saveCalls++;
      return json({...route.request().postDataJSON(), id, persisted: true});
    }
    if (url.pathname === '/api/visits/interpret') {
      interpretCalls++;
      await new Promise(resolve => { respond = resolve; waits.push(resolve); });
      if (interpretCalls === 1) return route.fulfill({status: 503, json: {error: '합성 장애', code: 'AI_UNAVAILABLE'}});
      return json({text: newText, emotionProfile: null});
    }
    throw new Error('Unexpected API ' + url.pathname);
  });
  await page.addInitScript(({id, user, oldText, seeded}) => {
    if (!sessionStorage.getItem('arti.visit')) {
      if (user) {
        localStorage.setItem('arti.user', JSON.stringify(user));
        localStorage.setItem('arti.token', JSON.stringify('synthetic-only-token'));
      }
      sessionStorage.setItem('arti.visit', JSON.stringify({
        visitId: id, exhibitionId: 'receipt-test', ownerId: user?.id ?? null, requestGeneration: 1,
        duration: '30m', tastes: ['warm'], tasteDone: true,
        recommendations: [{artworkId: 'synthetic-art'}], current: 1, viewed: ['synthetic-art'],
        reactions: {'synthetic-art': 'like'}, reactionReasons: {}, dwell: {'synthetic-art': 20},
        startedAt: Date.now() - 60000,
      }));
      if (seeded) sessionStorage.setItem(`arti.receipt.${user?.id ?? 'guest'}.${id}.interpretation`, JSON.stringify({text: oldText, emotionProfile: null}));
    }
    window.savedPngs = [];
    window.showSaveFilePicker = async () => ({createWritable: async () => ({
      write: async blob => window.savedPngs.push(Array.from(new Uint8Array(await blob.arrayBuffer()))),
      close: async () => {},
    })});
  }, {id, user, oldText, seeded});
  const saveButton = () => page.getByRole('button', {name: /이미지 저장·공유|이미지를 저장했어요/});
  const capture = async () => {
    const before = await page.evaluate(() => window.savedPngs.length);
    await saveButton().click();
    await page.waitForFunction(count => window.savedPngs.length > count, before);
    return Buffer.from(await page.evaluate(() => window.savedPngs.at(-1)));
  };
  try {
    await page.goto(base + '/exhibitions/receipt-test/receipt');
    if (member) await page.getByText('관람기록에 저장되었어요').waitFor();
    if (seeded) await page.locator('.receipt-ai').filter({hasText: oldText}).waitFor();
    const originalPng = await capture();
    assert.equal(originalPng.subarray(1, 4).toString(), 'PNG');
    await page.getByRole('button', {name: seeded ? '다시 해석하기' : '취향 해석 보기', exact: true}).click();
    await page.waitForFunction(() => document.body.textContent.includes('해석하는 중…'));
    if (seeded) assert.equal(await page.locator('.receipt-ai').textContent(), oldText, 'pending regeneration keeps the last interpretation');
    else assert.equal(await page.locator('.receipt-ai').count(), 0);
    assert.equal(interpretCalls, 1);
    assert.deepEqual(await capture(), originalPng, 'pending regeneration can save the previous PNG');
    respond();
    await page.getByRole('button', {name: '다시 시도', exact: true}).waitFor();
    if (seeded) assert.equal(await page.locator('.receipt-ai').textContent(), oldText, 'failed regeneration keeps the last interpretation');
    else assert.equal(await page.locator('.receipt-ai').count(), 0);
    assert.deepEqual(await capture(), originalPng, 'failure does not change the PNG');
    await page.getByRole('button', {name: '다시 시도', exact: true}).click();
    await page.waitForFunction(() => document.body.textContent.includes('해석하는 중…'));
    assert.equal(interpretCalls, 2);
    respond();
    await page.waitForFunction(text => document.querySelector('.receipt-ai')?.textContent === text, newText);
    const updatedPng = await capture();
    assert.notDeepEqual(updatedPng, originalPng, 'successful regeneration refreshes the exported PNG');
    assert(updatedPng.readUInt32BE(20) > originalPng.readUInt32BE(20), 'PNG contains the longer replacement text');
    assert.equal(saveCalls, member ? 1 : 0, 'interpretation retry does not resave the visit');
    await page.reload();
    await page.waitForFunction(text => document.querySelector('.receipt-ai')?.textContent === text, newText);
    assert.equal(interpretCalls, 2, 'reload reuses the cached successful interpretation');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    if (output) {
      await mkdir(output, {recursive: true});
      const name = `${width}-${member ? 'member' : 'guest'}-${seeded ? 'retry' : 'first'}`;
      await writeFile(path.join(output, `receipt-${name}.png`), updatedPng);
      await page.screenshot({path: path.join(output, `screen-${name}.png`), fullPage: true});
    }
    console.log(`PASS ${width}px ${member ? 'member' : 'guest'} ${seeded ? 'regeneration' : 'first request'}: pending/failure/retry/cache/PNG`);
  } finally {
    waits.forEach(resolve => resolve());
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  try {
    for (const [width, member, seeded] of [[320, false, true], [360, true, true], [412, false, true], [412, true, true], [360, false, false], [360, true, false]]) await check(browser, width, member, seeded);
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
