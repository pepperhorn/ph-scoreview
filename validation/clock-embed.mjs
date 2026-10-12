// Clock mode and the 0.2 host API, against the build (apps/reader /embed-clock). A: clock-driven chrome="none" reader of
// the clock contract fixture; B: clock-driven Endless reader (follow); C: self-driven silent reader (audio={false}).
// BROWSER=chromium|firefox|webkit.
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
const near = (actual, expected) => typeof actual === 'number' && Math.abs(actual - expected) < 1e-3;
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
  await Promise.all(['.pepperscore.clock-a', '.pepperscore.clock-b', '.pepperscore.clock-c'].map(rendered));
  const events = (who, type) => page.evaluate(([who, type]) => window.__clockEvents.filter(([w, t]) => w === who && t === type).map(([, , value]) => value), [who, type]);
  const lastSeek = async who => (await events(who, 'seek')).at(-1);
  const playingIds = who => page.$$eval(`.pepperscore.clock-${who} .reader-note.is-playing`, elements => elements.map(element => element.getAttribute('data-note-id')));
  const waitPlaying = (who, test) => page.waitForFunction(([who, test]) => {
    const ids = [...document.querySelectorAll(`.pepperscore.clock-${who} .reader-note.is-playing`)].map(element => element.getAttribute('data-note-id'));
    return test.notIn ? ids.length === 1 && !test.notIn.includes(ids[0]) : test.same ? ids.join() === test.same.join() : ids.length === 1;
  }, [who, test], { timeout: 10000 });
  // A click on the highlighted note's notehead, dispatched so the target is exactly that note.
  const clickPlaying = who => page.$eval(`.pepperscore.clock-${who} .reader-note.is-playing`, element => (element.querySelector('.notehead') || element).dispatchEvent(new MouseEvent('click', { bubbles: true })));

  // 1. Count-in: a negative clock time shows no playhead (Review Focus 1); chrome="none" still shows it from 0 on.
  await page.evaluate(() => window.__clock.a.seek(-1));
  await page.waitForTimeout(200);
  assert.deepEqual(await playingIds('a'), [], 'no note is highlighted before time 0');
  assert.equal(await page.locator('.clock-a .playback-line').count(), 0, 'no playback line before time 0');
  await page.evaluate(() => window.__clock.a.seek(2.6));
  await waitPlaying('a', {});
  const atG4 = await playingIds('a');

  // 2. A click on a note reports its onset at the score tempo, and the playhead stays where the clock is.
  await clickPlaying('a');
  assert.ok(near(await lastSeek('a'), 2.5), `click on the bar-2 G4 reports 2.5 s (got ${await lastSeek('a')})`);
  await page.waitForTimeout(200);
  assert.deepEqual(await playingIds('a'), atG4, 'the click did not move the playhead');
  await page.evaluate(() => window.__clock.a.seek(7.7));
  await waitPlaying('a', { notIn: atG4 });
  await clickPlaying('a');
  assert.ok(near(await lastSeek('a'), 7.666667), `click on D5 after the mid-bar tempo change reports 7.666667 s (got ${await lastSeek('a')})`);

  // 3. A click on empty space in a measure reports that measure's start: bar index 2 starts at 2.5 s (Review Focus 4).
  await page.$eval('.pepperscore.clock-a', root => {
    const measure = root.querySelectorAll('g.measure')[2];
    const rect = measure.getBoundingClientRect();
    measure.ownerSVGElement.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
  });
  assert.ok(near(await lastSeek('a'), 2.5), `whitespace click in bar index 2 reports 2.5 s (got ${await lastSeek('a')})`);

  // 4. The handle in clock mode: currentTime() reads the clock; seek() reports through onSeek and moves nothing; stop() is a no-op.
  assert.equal(await page.evaluate(() => window.__clockRefs.a.current.currentTime()), 7.7);
  const beforeHandle = await playingIds('a');
  await page.evaluate(() => { window.__clockRefs.a.current.seek(1); window.__clockRefs.a.current.stop(); });
  assert.equal(await lastSeek('a'), 1, 'handle.seek(1) reports 1 s');
  await page.waitForTimeout(200);
  assert.deepEqual(await playingIds('a'), beforeHandle, 'handle.seek/stop did not move the playhead');

  // 5. Re-engraving while paused keeps the playhead at the clock's time (Review Focus 3).
  await page.evaluate(() => window.__clockSetViewA('endless'));
  await page.waitForFunction(() => document.querySelector('.clock-a .reader-area.ps-landscape .score-system svg .reader-note') && !document.querySelector('.clock-a .score-loading'), null, { timeout: 60000 });
  await waitPlaying('a', { same: beforeHandle });

  // 6. A new clock object on every host render keeps exactly one subscription (Review Focus 2).
  await page.evaluate(async () => {
    window.__clockFreshA(true);
    for (let i = 0; i < 20; i++) { window.__clockRerender(); await new Promise(resolve => requestAnimationFrame(() => resolve())); }
  });
  assert.equal(await page.evaluate(() => window.__clock.a.listeners()), 1, 'one live subscription after 20 re-renders with fresh adapters');
  await page.evaluate(() => window.__clock.a.seek(0.6));
  await waitPlaying('a', { notIn: beforeHandle });

  // 7. Endless follow runs off the clock: playing at 30 s scrolls B sideways.
  await page.evaluate(() => { window.__clock.b.play(); window.__clock.b.advance(30); });
  await page.waitForFunction(() => document.querySelector('.clock-b .score-viewport').scrollLeft > 100, null, { timeout: 15000 });
  await page.evaluate(() => window.__clock.b.pause());

  // 8. Self-driven silent reader C: seek/currentTime, onTimeUpdate about 10 Hz, seek while playing (Review Focus 5).
  await page.evaluate(() => window.__clockRefs.c.current.seek(3));
  assert.equal(await page.evaluate(() => window.__clockRefs.c.current.currentTime()), 3, 'currentTime() after seek(3) while stopped');
  await page.waitForFunction(() => document.querySelectorAll('.clock-c .reader-note.is-playing').length > 0, null, { timeout: 10000 });
  await page.evaluate(() => { window.__clockEvents.length = 0; return window.__clockRefs.c.current.play(); });
  await page.waitForTimeout(1500);
  const updates = await events('c', 'time');
  assert.ok(updates.length >= 8 && updates.length <= 25, `onTimeUpdate fired ${updates.length} times in 1.5 s (about 10 Hz expected)`);
  assert.ok(updates[0] >= 3 && updates.every((seconds, index) => index === 0 || seconds > updates[index - 1]), `time updates rise from 3 s: ${updates.join(', ')}`);
  await page.evaluate(() => window.__clockRefs.c.current.seek(1));
  await page.waitForTimeout(300);
  const afterSeek = await page.evaluate(() => window.__clockRefs.c.current.currentTime());
  assert.ok(afterSeek >= 1 && afterSeek < 1.8, `currentTime() ${afterSeek} after seek(1) while playing`);
  assert.deepEqual(await page.evaluate(() => window.__clockEvents.filter(([w, t]) => w === 'c' && (t === 'play' || t === 'stop')).map(([, t]) => t)), ['play'], 'one play edge and no stop across a seek while playing');
  await page.evaluate(() => window.__clockRefs.c.current.stop());
  assert.deepEqual(await events('a', 'play'), [], 'clock play/pause never fires onPlay');

  // 9. Nothing on the page created an AudioContext or fetched a sound, including clock reader B with audio left on (Review Focus 5).
  assert.equal(await page.evaluate(() => window.__contexts), 0, 'no AudioContext was created');
  assert.deepEqual(requests.filter(url => /pack\.json|\/soundfonts\/|\/instruments\//.test(url)), [], 'no sound asset was requested');
  assert.deepEqual(await page.evaluate(() => window.__clockEvents.filter(([, type]) => type.startsWith('error'))), [], 'no reader reported an error');
  assert.deepEqual(errors, [], 'no page errors');
  console.log(`${engine}: clock playhead and count-in, onSeek note/measure clicks, clock handle, re-engrave while paused, one subscription, Endless follow, silent self-driven playback, onTimeUpdate and seek passed`);
} finally {
  await browser.close();
  await server.close();
}
