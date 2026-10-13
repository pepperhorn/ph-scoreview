// The score editor demo (apps/reader /editor): keyboard entry engraves, undo, a click puts the cursor on a note, the touch
// palette enters notes on a phone-sized viewport, the ensemble fixture (5 staves) is refused, and the editor logs its
// change-to-redraw latency. Runs against the build (npm run build first). BROWSER=chromium|firefox|webkit.
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright-core';
import { serveDist } from './serve-dist.mjs';

const engine = process.env.BROWSER || 'chromium';
const launcher = { chromium, firefox, webkit }[engine];
if (!launcher) throw new Error(`BROWSER must be chromium, firefox or webkit (got "${engine}")`);
const server = await serveDist();
const browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
/** Pitched notes only: the viewer also marks rests (`.rest`, `.mRest`) as `.reader-note`. */
const NOTES = '.ps-editor .reader-note.note';
const noteCount = page => page.locator(NOTES).count();
const waitForNotes = (page, n) => page.waitForFunction(([selector, n]) => document.querySelectorAll(selector).length === n, [NOTES, n], { timeout: 30000 });
const musicXml = page => page.evaluate(() => window.__editor.ref.current.getMusicXml());
/** Clicks the centre of a notehead (the note group's own centre can fall on empty SVG). */
async function clickNote(page, index) {
  const box = await page.locator(`${NOTES} .notehead`).nth(index).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const renderTimes = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
    const match = /^ps-editor render ms (\d+)/.exec(message.text());
    if (match) renderTimes.push(Number(match[1]));
  });
  await page.goto(`${server.url}/editor`);
  await page.waitForSelector('.ps-editor .score-system svg', { timeout: 60000 });
  assert.equal(await page.locator('.ps-editor-banner.ps-editor-readonly').count(), 0, 'the dev licence makes the demo editable');
  assert.equal(await page.locator('.ps-editor-status').textContent(), '', 'no invariant errors');

  // 1. Keyboard entry: n (entry mode), 4 (quarter), c d e f.
  await page.locator('.ps-editor').focus();
  for (const key of ['n', '4', 'c', 'd', 'e', 'f']) await page.keyboard.press(key);
  await waitForNotes(page, 4);
  assert.match(await musicXml(page), /<step>F<\/step>/, 'the handle compiles the entered F');
  assert.equal(await page.locator('.ps-toolbar .ps-btn[aria-label="Toggle note entry"]').getAttribute('aria-pressed'), 'true', 'the toolbar shows entry mode');

  // 2. Undo removes the last note.
  await page.keyboard.press('Control+z');
  await waitForNotes(page, 3);
  assert.doesNotMatch(await musicXml(page), /<step>F<\/step>/, 'undo removed the F');

  // 3. A click on the first note puts the cursor (and the selection) on it.
  await clickNote(page, 0);
  await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains('ps-cursor'), NOTES, { timeout: 10000 });
  assert.match(await page.locator(NOTES).first().getAttribute('class'), /ps-selection/, 'the clicked note is selected');

  // 4. Popovers: k opens the key popover, a choice applies to the cursor bar, Escape closes it.
  await page.keyboard.press('k');
  await page.locator('.ps-popover-key').waitFor();
  await page.selectOption('.ps-popover-key .ps-select-fifths', '2');
  await page.keyboard.press('Escape');
  await page.locator('.ps-popover').waitFor({ state: 'detached' });
  assert.match(await musicXml(page), /<fifths>2<\/fifths>/, 'the key popover set D major');

  // 5. Export downloads <title or score>.musicxml.
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.ps-btn-export')]);
  assert.equal(download.suggestedFilename(), 'score.musicxml');

  // 6. Phone width: the palette shows, and its quarter and C buttons enter a note (in bar 2, so it adds one).
  await page.locator('.ps-editor').focus();
  await page.keyboard.press('Control+ArrowRight');
  await page.setViewportSize({ width: 390, height: 800 });
  const palette = page.locator('.ps-palette');
  await palette.waitFor({ state: 'visible' });
  const button = await palette.locator('.ps-palette-btn').first().boundingBox();
  assert.ok(button.width >= 44 && button.height >= 44, `palette buttons are 44px targets (${button.width}x${button.height})`);
  await palette.locator('button[aria-label="Quarter note"]').click();
  await palette.locator('button[aria-label="Note C"]').click();
  await waitForNotes(page, 4);
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await palette.isVisible(), false, 'the palette hides on a wide container');

  // 7. The ensemble fixture has 5 staves: refused, with nothing else rendered.
  await page.click('.editor-demo-ensemble');
  await page.locator('.ps-editor-error').waitFor();
  assert.equal(await page.locator('.ps-editor-error').textContent(), 'Editing is limited to 4 staves.');
  assert.equal(await page.locator('.ps-editor .ps-toolbar, .ps-editor .pepperscore').count(), 0, 'a refused score renders nothing else');
  await page.click('.editor-demo-new');
  await page.waitForSelector('.ps-editor .score-system svg', { timeout: 60000 });

  // 8. No licence: read-only banner, disabled toolbar, keys not bound.
  await page.goto(`${server.url}/editor?licence=`);
  await page.waitForSelector('.ps-editor .score-system svg', { timeout: 60000 });
  assert.equal(await page.locator('.ps-editor-banner.ps-editor-readonly').textContent(), 'Editing requires a licence.');
  assert.ok(await page.locator('.ps-toolbar .ps-btn[aria-label="Key signature"]').isDisabled(), 'the toolbar is disabled');
  await page.locator('.ps-editor').focus();
  for (const key of ['n', 'c']) await page.keyboard.press(key);
  assert.equal(await page.locator('.ps-editor').getAttribute('data-ps-mode'), 'select', 'n does not enter entry mode');
  assert.doesNotMatch(await musicXml(page), /<step>/, 'c entered nothing');

  assert.ok(renderTimes.length > 0, 'the editor reported its change-to-redraw time');
  assert.deepEqual(errors, [], 'no page or console errors');
  console.log(`Editor: entry, undo, click cursor, key popover, export, palette, staff cap and read-only pass (render ms: ${renderTimes.join(', ')})`);
  await context.close();
} finally {
  await browser.close();
  await server.close();
}
