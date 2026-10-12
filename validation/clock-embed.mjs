// Clock mode and the 0.2 host API, against the build (apps/reader /embed-clock). Task 3: C, a self-driven silent reader
// (audio={false}): onTimeUpdate about 10 Hz, seek/currentTime, a seek while playing without a stop/play pair, and no
// sound loaded. BROWSER=chromium|firefox|webkit.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';
import { root, serveDist } from './serve-dist.mjs';

const engine = process.env.BROWSER || 'chromium';
const launcher = { chromium, firefox, webkit }[engine];
if (!launcher) throw new Error(`BROWSER must be chromium, firefox or webkit (got "${engine}")`);
const server = await serveDist();
const browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
const sounds = join(root, 'packages/pepperscore-sounds-complete');
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/poppins/i, route => route.abort());
  const requests = [];
  context.on('request', request => requests.push(request.url()));
  await context.route('**/custom-assets/**', async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/custom-assets\//, ''));
    try { return route.fulfill({ status: 200, body: await readFile(join(sounds, path)) }); } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await context.addInitScript(() => {
    window.__contexts = 0;
    const Native = window.AudioContext;
    if (Native) window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__contexts++; } };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.url}/embed-clock`);
  const rendered = selector => page.waitForFunction(selector => { const root = document.querySelector(selector); return root && root.querySelector('.score-system svg .reader-note') && !root.querySelector('.score-loading'); }, selector, { timeout: 60000 });
  await rendered('.pepperscore.clock-c');
  const events = (who, type) => page.evaluate(([who, type]) => window.__clockEvents.filter(([w, t]) => w === who && t === type).map(([, , value]) => value), [who, type]);
  const handle = (who, call) => page.evaluate(([who, call]) => { const h = window.__clockRefs[who].current; return call === 'time' ? h.currentTime() : call === 'stop' ? h.stop() : null; }, [who, call]);

  // 1. Seek while stopped: currentTime() reports it and the playhead shows there (3 s at 120 = bar 2, beat 3).
  await page.evaluate(() => window.__clockRefs.c.current.seek(3));
  assert.equal(await handle('c', 'time'), 3, 'currentTime() after seek(3) while stopped');
  await page.waitForFunction(() => document.querySelectorAll('.clock-c .reader-note.is-playing').length > 0, null, { timeout: 10000 });

  // 2. Silent playback on wall time: onPlay once, onTimeUpdate about 10 Hz, rising from the seek point.
  await page.evaluate(() => { window.__clockEvents.length = 0; return window.__clockRefs.c.current.play(); });
  await page.waitForTimeout(1500);
  const updates = await events('c', 'time');
  assert.ok(updates.length >= 8 && updates.length <= 25, `onTimeUpdate fired ${updates.length} times in 1.5 s (about 10 Hz expected)`);
  assert.ok(updates[0] >= 3 && updates.every((seconds, index) => index === 0 || seconds > updates[index - 1]), `time updates rise from 3 s: ${updates.join(', ')}`);
  assert.ok(await handle('c', 'time') > 3.5, 'currentTime() advances while playing');

  // 3. Seek while playing restarts from there, with no onStop/onPlay pair (Review Focus 5).
  await page.evaluate(() => window.__clockRefs.c.current.seek(1));
  await page.waitForTimeout(300);
  const afterSeek = await handle('c', 'time');
  assert.ok(afterSeek >= 1 && afterSeek < 1.8, `currentTime() ${afterSeek} after seek(1) while playing`);
  assert.deepEqual(await page.evaluate(() => window.__clockEvents.filter(([w, t]) => w === 'c' && (t === 'play' || t === 'stop')).map(([, t]) => t)), ['play'], 'one play edge and no stop across a seek while playing');
  await handle('c', 'stop');

  // 4. Nothing on the page created an AudioContext or fetched a sound (Review Focus 5).
  assert.equal(await page.evaluate(() => window.__contexts), 0, 'no AudioContext was created');
  assert.deepEqual(requests.filter(url => /pack\.json|\/soundfonts\/|\/instruments\//.test(url)), [], 'no sound asset was requested');
  assert.deepEqual(await page.evaluate(() => window.__clockEvents.filter(([, type]) => type.startsWith('error'))), [], 'no reader reported an error');
  assert.deepEqual(errors, [], 'no page errors');
  console.log(`${engine}: silent self-driven playback, onTimeUpdate, seek/currentTime and seek-while-playing passed`);
} finally {
  await browser.close();
  await server.close();
}
