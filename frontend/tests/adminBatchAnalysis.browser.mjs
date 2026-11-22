/** Chrome with a disposable Django/PostgreSQL database and controlled worker ticks. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const base = new URL(process.env.ARTI_REVIEW_BASE ?? '');
assert.equal(base.protocol, 'http:');
assert.equal(base.hostname, '127.0.0.1');
assert.equal(process.env.ARTI_ENV, 'test');
assert.equal(process.env.ARTI_BACKGROUND_BATCH_ANALYSIS, 'true');
assert.equal(process.env.ARTI_BACKGROUND_EMOTION, 'true');
const password = process.env.ARTI_BOOTSTRAP_PASSWORD;
assert(password);

const root = fileURLToPath(new URL('../../', import.meta.url));
const ids = ['fixture-art01', 'fixture-art02', 'fixture-art03', 'fixture-art04'];
const titles = ids.map((_, index) => `일괄 검수용 작품 ${index + 1}`);
const approved = '유지할 기존 공개 요약';
const excludedTitle = '선택에서 뺄 작품';
const secondTitle = '다른 전시의 작품';
const queuePath = '/api/admin/analysis-batches';
const button = (parent, name) => parent.getByRole('button', { name, exact: true });
const responseFor = (page, method, path) => page.waitForResponse(response =>
  response.request().method() === method && path.test(new URL(response.url()).pathname));

function tick(mode) {
  const script = `
from unittest.mock import patch
from django.conf import settings
from django.utils import timezone
from arti import batch_analysis, emotion_jobs
from arti.http import ContractError
from arti.models import Artwork, ArtworkAnalysisBatch, ArtworkAnalysisItem
from arti.tests.test_batch_analysis import proposal
from arti.tests.test_model_service import result
from time import sleep
assert settings.ARTI_ENV == 'test' and settings.ALLOW_TEST_FIXTURES
assert settings.DATABASES['default']['NAME'].startswith('arti_batch')
ids = ${JSON.stringify(ids)}
titles = ${JSON.stringify(titles)}
mode = ${JSON.stringify(mode)}
if mode == 'setup':
    assert not ArtworkAnalysisBatch.objects.exists()
    Artwork.objects.filter(exhibition_id='fixture-ex01').exclude(pk__in=ids).update(review_status='pending')
    for artwork_id, title in zip(ids, titles):
        assert Artwork.objects.filter(pk=artwork_id, exhibition_id='fixture-ex01').update(
            title=title, summary=${JSON.stringify(approved)}, summary_status='confirmed',
            review_status='approved', description='합성 테스트를 위한 작품 해설', source='ARTI DEVELOPMENT FIXTURE BATCH',
            guide_status='none', tag_status='none', emotion_status='none',
        ) == 1
    assert Artwork.objects.filter(pk='fixture-art05').update(
        title=${JSON.stringify(excludedTitle)}, review_status='approved',
        guide_status='none', tag_status='none', emotion_status='none',
    ) == 1
    assert Artwork.objects.filter(pk='fixture-art13').update(title=${JSON.stringify(secondTitle)}) == 1
elif mode == 'emotion':
    with patch('arti.model_service.analyze', return_value=result()):
        assert emotion_jobs.process_next()
    ArtworkAnalysisItem.objects.filter(state='emotion').update(due_at=timezone.now())
    assert batch_analysis.sync_emotion()
else:
    calls = []
    def generate(kind, snapshot, **context):
        calls.append((snapshot['id'], kind))
        assert kind != 'summary'
        if mode == 'first' and kind == 'guide':
            sleep(4)
        if mode == 'fail' and kind == 'guide':
            raise ContractError(504, 'AI_TIMEOUT', '합성 실패')
        return proposal(kind, snapshot, **context)
    with patch('arti.providers.generate', side_effect=generate):
        assert batch_analysis.process_next()
    assert calls
    if mode.startswith('retry'):
        assert calls == [(ids[int(mode[-1])], 'guide')], calls
`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.ARTI_REVIEW_PYTHON ?? 'python', [
      'backend-django/manage.py', 'shell', '-c', script,
    ], { cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Worker ${mode} failed with ${code}\n${stderr}`)));
  });
}

await tick('setup');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ baseURL: base.href, viewport: { width: 1100, height: 850 } });
  context.setDefaultTimeout(20000);
  await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto('/admin/login');
  await page.getByLabel('관리자 ID').fill('admin-edit-a');
  await page.getByLabel('비밀번호').fill(password);
  await button(page, '로그인').click();
  await page.waitForURL('**/admin');
  await page.goto('/admin/artworks');
  const filter = page.getByLabel('전시 필터', { exact: true });
  const dialog = page.getByRole('dialog');
  const requests = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === queuePath) requests.push(request);
  });
  await filter.selectOption('fixture-ex01');
  await button(page, '전시 일괄 분석').click();
  await dialog.getByRole('heading', { name: 'ARTI 개발 검증 전시' }).waitFor();
  assert.equal(await dialog.getByRole('heading', { name: '비공개 검증 전시' }).count(), 0);
  await button(dialog, '취소').click();
  assert.equal(requests.length, 0);
  await filter.selectOption('');

  const start = responseFor(page, 'POST', new RegExp(`^${queuePath}$`));
  await page.setViewportSize({ width: 390, height: 640 });
  await button(page, '전체 전시 일괄 분석').click();
  await dialog.getByRole('heading', { name: '비공개 검증 전시' }).waitFor();
  assert.equal(await dialog.getByRole('checkbox', { name: secondTitle, exact: true }).isChecked(), true);
  const screen = await dialog.boundingBox();
  assert(screen && screen.x >= 0 && screen.x + screen.width <= 390 && screen.y + screen.height <= 640);
  await dialog.getByRole('checkbox', { name: excludedTitle, exact: true }).uncheck();
  const first = dialog.getByRole('group', { name: titles[0] });
  assert.equal(await first.getByRole('checkbox', { name: '요약', exact: true }).count(), 0);
  await first.getByRole('checkbox', { name: '태그', exact: true }).uncheck();
  assert.equal(requests.length, 0);
  await button(dialog, '분석 시작').click();
  const enrolled = await start;
  assert.equal(enrolled.status(), 202);
  const payload = enrolled.request().postDataJSON();
  assert.equal(payload.scope, 'all');
  assert.deepEqual(payload.selections.map(item => item.artworkId).sort(), [...ids, 'fixture-art13'].sort());
  assert.deepEqual(payload.selections.find(item => item.artworkId === ids[0]).fields, ['guide', 'emotion']);
  assert.equal(await filter.inputValue(), '');
  const batches = (await enrolled.json()).batches;
  const { id: batchId, items, runId } = batches.find(batch => batch.exhibitionId === 'fixture-ex01');
  const secondBatch = batches.find(batch => batch.exhibitionId === 'fixture-draft');
  assert(runId && secondBatch.runId === runId);
  assert.deepEqual(items.map(item => item.artworkId), ids);
  const panel = target => target.getByRole('region', { name: '분석 작업' });
  const toggle = target => panel(target).getByRole('button', { name: /^분석 작업/ });
  const row = (target, index) => panel(target).getByRole('listitem').filter({ hasText: titles[index] });
  const finished = (target, index) => row(target, index).getByRole('img', { name: '완료', exact: true });
  const failed = (target, index) => row(target, index).getByRole('img', { name: '실패', exact: true });
  const retryAll = target => button(panel(target), '실패한 작품 모두 재시도');
  const confirm = page.getByRole('alertdialog');
  const draft = panel(page).getByRole('region', { name: '비공개 검증 전시', exact: true });
  await draft.getByRole('progressbar', { name: '비공개 검증 전시 처리 작품' }).waitFor();
  assert.equal(await button(panel(page), '진행 중인 분석 취소').isVisible(), true);
  await button(draft, '비공개 검증 전시 분석 취소').click();
  const cancelDraft = responseFor(page, 'POST', new RegExp(`^${queuePath}/${secondBatch.id}/cancel$`));
  await button(confirm, '확인하고 계속').click();
  assert.equal((await cancelDraft).status(), 200);
  await draft.getByRole('img', { name: '취소됨', exact: true }).waitFor();
  await page.setViewportSize({ width: 1100, height: 850 });
  await row(page, 0).getByRole('img', { name: '대기', exact: true }).waitFor();
  assert.equal(await retryAll(page).count(), 0);

  const running = tick('first');
  await row(page, 0).getByRole('img', { name: '분석 중', exact: true }).waitFor();
  await page.getByRole('link', { name: '전시 관리', exact: true }).click();
  await page.reload();
  await toggle(page).click();
  await running;
  await row(page, 0).getByText('감정 분석 중', { exact: true }).waitFor();
  const compact = await context.newPage();
  await compact.setViewportSize({ width: 390, height: 640 });
  await compact.goto('/admin/operations');
  await toggle(compact).click();
  await row(compact, 0).getByText('감정 분석 중', { exact: true }).waitFor();
  const bounds = await panel(compact).boundingBox();
  assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 640);

  await row(page, 0).getByRole('link', { name: `${titles[0]} 검수` }).click();
  await page.waitForURL('**/admin/artworks/fixture-art01');
  await page.getByLabel('쉬운 설명 (그림을 보기 전에 읽는 2~3문장)').waitFor();
  assert.equal(await page.getByLabel('쉬운 설명 (그림을 보기 전에 읽는 2~3문장)').inputValue(), '합성 관람 가이드');
  const publicWork = async index => (await page.request.get(`/api/artworks/${ids[index]}`)).json();
  assert.equal((await publicWork(0)).summary, approved);

  await tick('emotion');
  await finished(page, 0).waitFor();
  for (let index = 1; index < ids.length; index++) {
    await tick('fail');
    await tick('emotion');
    await failed(page, index).waitFor();
  }
  await retryAll(page).waitFor();
  const retryPath = new RegExp(`^${queuePath}/${batchId}/retry$`);
  const individual = responseFor(page, 'POST', retryPath);
  await button(row(page, 1), `${titles[1]} 재시도`).click();
  const itemRequest = await individual;
  assert.equal(itemRequest.status(), 202);
  assert.deepEqual(itemRequest.request().postDataJSON(), { artworkId: ids[1] });
  assert.deepEqual((await itemRequest.json()).batches[0].items.map(item => item.state), ['completed', 'queued', 'failed', 'failed']);
  await tick('retry1');
  await finished(page, 1).waitFor();
  const group = responseFor(page, 'POST', new RegExp(`^/api/admin/analysis-runs/${runId}/retry$`));
  await retryAll(page).click();
  const groupRequest = await group;
  assert.equal(groupRequest.status(), 202);
  assert.deepEqual(groupRequest.request().postDataJSON(), {});
  const retried = (await groupRequest.json()).batches;
  assert.deepEqual(retried.find(batch => batch.id === batchId).items.map(item => item.state),
    ['completed', 'completed', 'queued', 'queued']);
  assert.equal(retried.find(batch => batch.id === secondBatch.id).items[0].state, 'canceled');
  await tick('retry2');
  await tick('retry3');
  await finished(page, 3).waitFor();
  assert.equal(await finished(page, 3).textContent(), '○');
  assert.equal(await retryAll(page).count(), 0);
  assert.equal((await publicWork(0)).summary, approved);
  assert.equal((await publicWork(1)).summary, approved);
  console.log('PASS batch: all-exhibition modal, field exclusions, per-exhibition progress/cancel, reload, early review, failed-only retries and confirmed copy');
} finally {
  await browser.close();
}
