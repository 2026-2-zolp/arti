const assert = require('node:assert/strict');

async function body(response, status = 200) {
  assert.equal(response.status(), status, await response.text());
  return response.json();
}

const button = (page, name) => page.getByRole('button', { name, exact: true });
const isResponse = (response, pathname, method) =>
  new URL(response.url()).pathname === pathname && response.request().method() === method;

async function choosePairs(page, start = 1, sides = []) {
  for (let index = start; index <= 5; index++) {
    await page.getByText(index + '/5', { exact: true }).waitFor();
    await page.locator('.duel-card').getByRole('button', { name: / 선택$/ }).nth(sides[index - 1] ?? 0).click();
  }
}

async function recommend(page, duration = /30분/, status = 200) {
  await page.getByRole('radio', { name: duration }).click();
  const [response] = await Promise.all([
    page.waitForResponse(r => isResponse(r, '/api/recommendations', 'POST')),
    button(page, '추천 받기').click(),
  ]);
  assert.equal(response.request().postDataJSON().tasteProfile.version, 2);
  return body(response, status);
}

module.exports = { body, button, isResponse, choosePairs, recommend };
