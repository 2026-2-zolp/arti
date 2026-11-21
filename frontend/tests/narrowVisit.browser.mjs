/** 합성 전시에서 좁은 PC Chrome의 비교·지도·영수증을 검증합니다. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = new URL(process.env.ARTI_REVIEW_BASE ?? 'http://127.0.0.1:5773');
assert.equal(base.origin, `http://127.0.0.1:${base.port}`);
const fixturePath = '/exhibitions/fixture-ex01';
const fixtureMarker = 'ARTI DEVELOPMENT FIXTURE';
const longTitle = '긴 합성 제목 ChromatographicInterrelationshipsInMonochrome';
const layoutFailures = [];

async function json(response) {
  assert.equal(response.status(), 200, response.url());
  return response.json();
}

async function checkWidth(page, label) {
  const size = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  if (size[0] > size[1]) layoutFailures.push(`${label}: ${size[0]} > ${size[1]}`);
}

async function checkText(locator, label, container) {
  const clipped = await locator.evaluate((element, ancestor) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const bounds = element.closest(ancestor).getBoundingClientRect();
    return [...range.getClientRects()].some(rect => rect.left < Math.max(0, bounds.left) - 1 || rect.right > Math.min(innerWidth, bounds.right) + 1);
  }, container);
  if (clipped) layoutFailures.push(`${label}: text extends beyond its visible container`);
}

async function verifyImageRetry(page, imageFile) {
  const imagePath = '/api/uploads/' + encodeURIComponent(imageFile);
  const matchesImage = url => url.pathname === imagePath;
  const choices = page.getByRole('button', { name: / 선택$/ });
  let release;
  const delay = new Promise(resolve => { release = resolve; });
  await page.route(matchesImage, async route => {
    if (new URL(route.request().url()).searchParams.has('retry')) return route.continue();
    await delay;
    await route.fulfill({ status: 503, body: 'synthetic image failure' });
  });
  try {
    await page.goto(fixturePath + '/taste', { waitUntil: 'domcontentloaded' });
    await page.getByText('도판을 불러오는 중…', { exact: true }).first().waitFor();
    assert.deepEqual(await choices.evaluateAll(buttons => buttons.map(button => button.disabled)), [true, true]);
  } finally {
    release();
  }
  await page.getByRole('alert').filter({ hasText: '도판을 불러오지 못했어요.' }).waitFor();
  assert.deepEqual(await choices.evaluateAll(buttons => buttons.map(button => button.disabled)), [true, true]);
  const [retried] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === imagePath && response.ok()),
    page.getByRole('button', { name: `${longTitle} 도판 다시 시도` }).click(),
  ]);
  assert(new URL(retried.url()).searchParams.has('retry'));
  await page.waitForFunction(() => document.querySelectorAll('.duel-card-hit:enabled').length === 2);
  await page.unroute(matchesImage);
}

async function verify(browser, width) {
  const page = await browser.newPage({ baseURL: base.href, viewport: { width, height: 740 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(12000);
  const button = name => page.getByRole('button', { name, exact: true });
  const errors = [];
  let guestSaves = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/visits') guestSaves++;
  });
  await page.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  await page.addInitScript(() => {
    // PC 파일 선택창 대신 실제로 생성된 PNG를 받습니다.
    window.savedReceiptPng = null;
    window.showSaveFilePicker = async () => ({ createWritable: async () => ({
      write: async blob => { window.savedReceiptPng = [...new Uint8Array(await blob.arrayBuffer())]; },
      close: async () => {},
    }) });
  });
  try {
    const exhibition = await json(await page.request.get('/api' + fixturePath));
    assert.ok(exhibition.subtitle.startsWith(fixtureMarker));
    assert.ok(exhibition.floorPlan.height > exhibition.floorPlan.width);
    assert.equal((await json(await page.request.get('/api/ready'))).database, 'postgresql');
    assert.deepEqual((await json(await page.request.get('/api/health'))).aiConfiguration, { docent: 'disabled', analysis: 'disabled' });
    const works = new Map((await json(await page.request.get(`/api/artworks?exhibitionId=${exhibition.id}`))).map(work => [work.id, work]));
    assert.equal(works.get('fixture-art01').title, longTitle);

    if (width === 320) await verifyImageRetry(page, works.get('fixture-art01').imageFile);
    else await page.goto(fixturePath + '/taste');
    const portrait = button(`${longTitle} 크게 보기`);
    await portrait.waitFor();
    const portraitImage = page.locator('.duel-card').filter({ has: portrait }).locator('img');
    await portraitImage.evaluate(image => image.decode());
    assert.deepEqual(await portraitImage.evaluate(image => [image.naturalWidth, image.naturalHeight, getComputedStyle(image).objectFit]), [160, 320, 'contain']);
    assert.deepEqual(await page.locator('.duel-card').evaluateAll(cards => cards.map(card => {
      const bounds = card.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= innerHeight;
    })), [true, true]);
    const title = page.locator('.duel-title').filter({ hasText: longTitle });
    assert.equal(await title.evaluate(element => element.scrollWidth > element.clientWidth && getComputedStyle(element).textOverflow === 'ellipsis'), true);
    await checkWidth(page, `${width}px U-05`);
    await page.getByText('작가·연도', { exact: true }).click();
    await page.locator('.duel-metadata').getByText(longTitle, { exact: true }).waitFor();
    await page.getByText('작가·연도', { exact: true }).click();
    const viewer = page.getByRole('dialog');
    await portrait.click();
    await viewer.waitFor();
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'hidden' });
    assert.equal(await page.getByText('1/5', { exact: true }).isVisible(), true);
    await portrait.focus();
    await page.keyboard.press('Enter');
    await viewer.waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '전체 화면 닫기');
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'hidden' });
    assert.equal(await portrait.evaluate(element => document.activeElement === element), true);

    const imageRect = await portraitImage.boundingBox();
    await page.mouse.click(imageRect.x + imageRect.width / 2, imageRect.y + imageRect.height / 2);
    for (let pair = 2; pair <= 5; pair++) {
      await page.getByText(`${pair}/5`, { exact: true }).waitFor();
      assert.equal(await viewer.count(), 0, 'Selecting a card must not open the artwork viewer');
      await page.locator('.duel-card').getByRole('button', { name: / 선택$/ }).first().click();
    }
    await button('이 취향으로 계속').click();
    await page.waitForURL('**/time');
    await page.getByRole('radio', { name: /30분/ }).click();
    const [recommendation] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/recommendations')),
      button('추천 받기').click(),
    ]);
    assert.equal(recommendation.request().postDataJSON().tasteProfile.version, 2);
    const ids = (await json(recommendation)).map(item => item.artworkId);
    assert.equal(ids.length, 3);
    assert.equal(ids[0], 'fixture-art01');
    const artworkTitles = ids.map(id => works.get(id).title);
    await page.locator('.rec-list li').last().waitFor();
    await checkWidth(page, `${width}px U-08`);
    await checkText(page.locator('.rec-info strong').first(), `${width}px U-08 recommendation title`, '.rec-card');
    await button('지도에서 관람순서 보기').click();
    await page.locator('.route-list li').last().waitFor();
    assert.equal(await page.getByRole('heading', { name: '추천 관람순서', exact: true }).isVisible(), true);
    await checkWidth(page, `${width}px U-09 overview`);
    await checkText(page.locator('.route-title').first(), `${width}px U-09 route title`, '.route-list');
    assert.equal(await page.locator('.floor-map .fm-marker.current title').textContent(), artworkTitles[0]);
    await button('관람 시작하기').click();
    const firstArtwork = page.getByRole('heading', { name: artworkTitles[0], exact: true });
    await firstArtwork.waitFor();
    await checkWidth(page, `${width}px U-10`);
    await checkText(firstArtwork, `${width}px U-10 artwork title`, '.m-body');
    const like = button('좋아요');
    await like.click();
    const reasons = page.getByRole('group', { name: '좋아요 이유' });
    await reasons.getByRole('button', { name: '닫기', exact: true }).click();
    await reasons.waitFor({ state: 'hidden' });
    assert.equal(await like.getAttribute('aria-pressed'), 'true');
    await page.reload();
    await like.waitFor();
    assert.equal(await like.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByText('고른 이유', { exact: true }).count(), 0);
    const guideTitle = page.getByRole('heading', { name: '다음 작품 안내', exact: true });
    const mapRequest = `**/api/exhibitions/${exhibition.id}`;
    let releaseMap;
    const mapDelay = new Promise(resolve => { releaseMap = resolve; });
    await page.route(mapRequest, async route => {
      await mapDelay;
      await route.fulfill({ status: 503, json: { message: '시험용 지도 지연' } });
    }, { times: 1 });
    try {
      const requested = page.waitForRequest(request => new URL(request.url()).pathname === `/api/exhibitions/${exhibition.id}`);
      await button('다음 작품 안내').click();
      await requested;
      await page.getByText('불러오는 중…', { exact: true }).waitFor();
      assert.equal(await guideTitle.isVisible(), true);
    } finally {
      releaseMap();
    }
    await page.getByRole('alert').getByText(/지도 정보를 불러오지 못했어요/).waitFor();
    assert.equal(await guideTitle.isVisible(), true);
    await button('다시 시도하기').click();
    await page.getByText('추천 작품 2/3').waitFor();
    assert.equal(await guideTitle.isVisible(), true);
    const map = page.locator('.floor-map.has-plan');
    const details = page.locator('.route-details');
    const mapHeight = () => map.evaluate(element => element.getBoundingClientRect().height);
    assert.equal(await details.evaluate(element => element.open), false);
    assert.equal(await page.locator('.floor-map .fm-marker.current title').textContent(), artworkTitles[1]);
    assert.equal(await page.locator('.floor-map .fm-marker.done title').textContent(), artworkTitles[0]);
    assert.equal(await page.locator('.next-thumb').count(), 1);
    const leg = ids.slice(0, 2).map(id => {
      const { x, y } = works.get(id).position;
      return `${x},${y * exhibition.floorPlan.height / exhibition.floorPlan.width}`;
    }).join(' ');
    assert.equal(await map.locator('polyline.active').getAttribute('points'), leg);
    const focusedHeight = await mapHeight();
    await details.locator('summary').click();
    assert.equal(await details.evaluate(element => element.open), true);
    // The native details element opens before React handles its toggle event.
    const markers = map.locator('.fm-marker');
    await markers.nth(2).waitFor();
    assert.equal(await markers.count(), 3);
    assert.ok(Math.abs(await mapHeight() - focusedHeight) < 1);
    await checkWidth(page, `${width}px U-09 expanded leg`);
    await map.locator('.fm-marker.done').click();
    const focusedTitle = page.locator('.next-row strong').filter({ hasText: longTitle });
    await checkText(focusedTitle, `${width}px U-09 selected marker title`, '.next-card');
    await checkWidth(page, `${width}px U-09 selected marker`);
    await button('2번 작품 정보 보기').click();
    await button('뒤로가기').click();
    await page.getByRole('heading', { name: artworkTitles[0], exact: true }).waitFor();
    await page.goForward();
    await page.getByText('추천 작품 2/3').waitFor();
    await page.reload();
    await page.getByText('추천 작품 2/3').waitFor();
    assert.equal(await page.locator('.floor-map .fm-marker.current title').textContent(), artworkTitles[1]);
    assert.equal(await map.locator('polyline.active').getAttribute('points'), leg);
    await button('2번 작품 감상하기').click();
    await page.getByRole('heading', { name: artworkTitles[1], exact: true }).waitFor();
    await button('다음 작품 안내').click();
    await button('3번 작품 감상하기').click();
    await page.getByRole('heading', { name: artworkTitles[2], exact: true }).waitFor();
    await button('관람 마치기').click();

    const receipt = page.getByRole('article', { name: '아트 영수증' });
    await receipt.waitFor();
    const rows = receipt.locator('.receipt-works li span:first-child');
    assert.deepEqual(await rows.allTextContents(), artworkTitles.map((artTitle, index) => `${index + 1}. ${artTitle}`));
    assert.equal(await receipt.locator('.receipt-works li').first().locator('span').last().textContent(), '👍');
    await checkWidth(page, `${width}px U-12`);
    await checkText(rows.first(), `${width}px U-12 receipt title`, '.receipt-works');
    const durationRow = receipt.locator('.receipt-rows div').filter({ has: page.getByText('관람 시간', { exact: true }) });
    const [label, minutes] = await Promise.all([durationRow.locator('dt').boundingBox(), durationRow.locator('dd').boundingBox()]);
    assert.equal(label.y, minutes.y);
    assert.equal(label.height, minutes.height);
    await button('이미지 저장·공유').click();
    await page.waitForFunction(() => Array.isArray(window.savedReceiptPng));
    const png = Buffer.from(await page.evaluate(() => window.savedReceiptPng));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const size = await receipt.evaluate(element => [element.offsetWidth, element.offsetHeight]);
    const pngSize = [png.readUInt32BE(16), png.readUInt32BE(20)];
    // DOM offsets and the scaled canvas round fractional line heights at different points.
    assert.ok(pngSize.every((side, index) => Math.abs(side - (size[index] + 40) * 3) <= 2));
    assert.equal(guestSaves, 0);
    assert.deepEqual(errors, []);
    console.log(`${width}px card/zoom → one-step V2 → like without reason after reload → map, receipt and PNG ${pngSize.join(' × ')}`);
  } catch (error) {
    const detail = `${width}px at ${page.url()}: ${error.message}`;
    layoutFailures.push(detail);
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [320, 360, 412]) await verify(browser, width);
  assert.deepEqual(layoutFailures, []);
} finally {
  await browser.close();
}
