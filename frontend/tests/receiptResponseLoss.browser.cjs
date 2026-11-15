/** Run against a loopback Django API loaded with the synthetic fixture. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const base = process.env.ARTI_REVIEW_BASE || 'http://127.0.0.1:5219';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Use a local synthetic environment.');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 360, height: 812 } });
  page.setDefaultTimeout(10000);
  try {
    const fixture = await page.request.get(`${base}/api/exhibitions/fixture-ex01`);
    assert(fixture.ok(), 'Load the synthetic exhibition fixture first.');
    assert.equal((await fixture.json()).subtitle, 'ARTI DEVELOPMENT FIXTURE — NOT A REAL EXHIBITION');
    const visitId = randomUUID();
    const account = await page.request.post(`${base}/api/auth/signup`, { data: {
      email: `lost-response-${visitId}@example.test`, password: 'Fixture-visit-2026!',
      termsAccepted: true, termsVersion: '2026-11-14-draft.1',
    } });
    assert(account.ok(), await account.text());
    const { user, token } = await account.json();
    await page.addInitScript(({ user, token, visitId }) => {
      if (sessionStorage.getItem('arti.visit')) return;
      localStorage.setItem('arti.user', JSON.stringify(user));
      localStorage.setItem('arti.token', JSON.stringify(token));
      sessionStorage.setItem('arti.visit', JSON.stringify({
        visitId, ownerId: user.id, exhibitionId: 'fixture-ex01', requestGeneration: 1,
        duration: '30m', tastes: ['warm'], recommendations: [{ artworkId: 'fixture-art01' }],
        current: 1, viewed: ['fixture-art01'], startedAt: Date.now() - 60000,
        reactions: { 'fixture-art01': 'like' }, reactionReasons: { 'fixture-art01': '합성 반응' },
        dwell: { 'fixture-art01': 21 },
      }));
    }, { user, token, visitId });

    const attempts = [];
    await page.route(`${base}/api/visits`, async route => {
      const payload = route.request().postDataJSON();
      const upstream = await route.fetch({ maxRetries: 0 });
      attempts.push({ payload, status: upstream.status(), record: await upstream.json() });
      if (attempts.length === 1) await route.abort('connectionreset');
      else await route.fulfill({ response: upstream });
    });

    const list = async () => {
      const response = await page.request.get(`${base}/api/users/${user.id}/visits`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status(), 200);
      return response.json();
    };
    await page.goto(`${base}/exhibitions/fixture-ex01/receipt`, { waitUntil: 'domcontentloaded' });
    await page.getByText('관람기록을 저장하지 못했어요', { exact: true }).waitFor();
    assert.equal(attempts[0].status, 201);
    assert.deepEqual(await list(), [attempts[0].record]);
    const pendingKey = `arti.pendingReceipt.${user.id}.${visitId}`;
    const pending = () => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), pendingKey);
    assert.deepEqual(await pending(), attempts[0].payload);
    await page.getByRole('button', { name: '다시 저장', exact: true }).click();
    await page.getByText('관람기록에 저장되었어요', { exact: true }).waitFor();
    assert.deepEqual(attempts.map(item => item.status), [201, 200]);
    assert.deepEqual(attempts[1].payload, attempts[0].payload);
    assert.deepEqual(attempts[1].record, attempts[0].record);
    assert.deepEqual(await list(), [attempts[0].record]);
    assert.equal(await pending(), null);
    console.log(JSON.stringify({ visitId, recordId: attempts[0].record.id, statuses: [201, 200], visitCount: 1 }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
