import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const members = Array.from({ length: 12 }, (_, index) => ({
  id: String(index),
  email: index === 0 ? 'long-synthetic-member-address-for-the-table@example.test' : `member-${index}@example.test`,
  nickname: index === 0 ? '검수 회원' : `회원 ${index}`,
  createdAt: '2026-11-21T12:00:00Z',
  lastVisit: index === 0 ? '2026-11-22T00:00:00Z' : null,
  visitCount: index === 0 ? 1 : 0,
  status: index === 0 ? 'dormant' : 'active',
  tastes: [],
}));

const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: true } });
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 850 } });
  await page.addInitScript(() => {
    localStorage.setItem('arti.admin', JSON.stringify({ name: 'Synthetic admin' }));
    localStorage.setItem('arti.adminToken', JSON.stringify('fixture'));
  });
  let visitsRequested = 0;
  await page.route('**/api/admin/members**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/members/0/visits') {
      visitsRequested += 1;
      return route.fulfill({ json: [{ id: 'fixture-visit', date: '2026-11-22', viewedArtworkIds: ['one'], durationMin: 4 }] });
    }
    assert.equal(url.pathname, '/api/admin/members');
    const q = url.searchParams.get('q');
    const status = url.searchParams.get('status');
    const visits = url.searchParams.get('visits');
    const matching = members.filter(member => (!q || member.email.includes(q) || member.nickname.includes(q))
      && (!status || member.status === status)
      && (!visits || (visits === 'with') === Boolean(member.visitCount)));
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    return route.fulfill({ json: { total: matching.length, items: matching.slice(offset, offset + limit) } });
  });
  await page.goto(base + '/admin/members');
  const card = page.locator('.a-members-card');
  const first = page.getByRole('button', { name: members[0].email + ' 회원 상세 보기' });
  await first.waitFor();
  assert.equal(visitsRequested, 0);
  assert.equal(await card.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  assert.equal(await card.locator('tbody tr').count(), 10);
  await page.getByRole('button', { name: '다음 페이지' }).click();
  await page.getByRole('button', { name: /member-11@example/ }).waitFor();
  assert.equal(await card.locator('tbody tr').count(), 2);
  await page.getByLabel('계정 상태', { exact: true }).selectOption('dormant');
  await page.getByLabel('관람 기록', { exact: true }).selectOption('with');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await first.waitFor();
  assert.equal(await card.locator('tbody tr').count(), 1);
  await first.focus();
  await page.keyboard.press('Enter');
  const detail = page.getByRole('dialog', { name: '검수 회원' });
  await detail.getByText('작품 1점 · 4분', { exact: true }).waitFor();
  assert.equal(visitsRequested, 1);
  await page.keyboard.press('Escape');
  await detail.waitFor({ state: 'hidden' });
  assert.equal(await first.evaluate(el => document.activeElement === el), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await card.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  assert.equal(await card.locator('.a-member-row').evaluate(el => getComputedStyle(el).display), 'grid');
  await card.locator('tbody tr').first().locator('td').nth(1).click();
  await detail.getByRole('button', { name: '닫기', exact: true }).click();
  await detail.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await page.getByRole('button', { name: '다음 페이지' }).waitFor();
  await page.getByRole('searchbox').fill('없는 회원');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await card.getByText('검색 결과가 없어요.').waitFor();
  console.log('PASS member Chrome at 1024px and 390px: table, pagination, filters, dialog, keyboard focus and empty state');
} finally {
  await browser.close();
  await server.close();
}
