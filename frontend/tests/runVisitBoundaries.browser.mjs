/** Start a fresh Django process and production preview for each visit Chrome run. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const python = process.env.ARTI_TEST_PYTHON || 'python';
const suite = process.argv[2] || 'all';
assert(['all', 'receipt-session', 'survey-map', 'recommendation-shortage'].includes(suite), 'Unknown Chrome suite');
assert(process.env.ARTI_BOOTSTRAP_PASSWORD, 'Set ARTI_BOOTSTRAP_PASSWORD for visit-boundaries-admin.');

function startApi() {
  const child = spawn(python, [
    'backend-django/manage.py', 'shell', '-c',
    'from arti.tests.visit_browser_server import serve; serve()',
  ], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  const closed = new Promise(resolve => child.once('close', resolve));
  const stdout = createInterface({ input: child.stdout });
  const port = new Promise((resolve, reject) => {
    stdout.on('line', line => {
      const match = /^ARTI_VISIT_BROWSER_PORT=(\d+)$/.exec(line);
      if (match) resolve(Number(match[1]));
    });
    child.once('error', reject);
    child.once('close', code => reject(new Error(`Visit fixture API exited before startup (${code}).`)));
  });
  return { child, port, closed };
}

async function runChrome(base) {
  const child = spawn(process.execPath, ['frontend/tests/visitBoundaries.browser.cjs', suite], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, ARTI_REVIEW_BASE: base },
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Visit Chrome failed (${signal || code}).`));
    });
  });
}

const api = startApi();
api.child.stdin.on('error', () => {}); // A startup failure may close the shutdown pipe first.
let web;
try {
  const apiPort = await Promise.race([
    api.port,
    delay(15000, undefined, { ref: false }).then(() => { throw new Error('Visit fixture API startup timed out.'); }),
  ]);
  process.env.VITE_API_TARGET = 'django';
  process.env.VITE_API_BASE = '/api';
  process.env.VITE_API_PROXY = `http://127.0.0.1:${apiPort}`;
  const outDir = process.env.ARTI_BROWSER_DIST
    ? path.resolve(process.env.ARTI_BROWSER_DIST)
    : path.join(root, 'frontend', 'dist');
  web = await preview({
    configFile: path.join(root, 'frontend', 'vite.config.ts'),
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: true },
  });
  const base = `http://127.0.0.1:${web.httpServer.address().port}`;
  const ready = await fetch(`${base}/api/ready`, { signal: AbortSignal.timeout(5000) });
  assert(ready.ok, `Visit fixture API is not ready (HTTP ${ready.status}).`);
  await runChrome(base);
} finally {
  api.child.stdin.end();
  try {
    await web?.close();
  } finally {
    const stopped = await Promise.race([api.closed.then(() => true), delay(5000, false, { ref: false })]);
    if (!stopped) {
      api.child.kill();
      throw new Error('Visit fixture API did not shut down.');
    }
  }
}
