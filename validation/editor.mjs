// The score editor demo (apps/reader /editor): keyboard entry engraves, undo, a click puts the cursor on a note, the touch
// palette enters notes on a phone-sized viewport, the ensemble fixture (5 staves) is refused, and the editor logs its
// change-to-redraw latency. Runs against the build (npm run build first). BROWSER=chromium|firefox|webkit.
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, serveDist } from './serve-dist.mjs';

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

  // 5b. Save downloads a .pepperscore file; opening it again restores the same score.
  const [saved] = await Promise.all([page.waitForEvent('download'), page.click('.ps-btn-save')]);
  assert.equal(saved.suggestedFilename(), 'score.pepperscore');
  const savedPath = await saved.path();
  const savedFile = JSON.parse(await readFile(savedPath, 'utf8'));
  assert.deepEqual(savedFile.pepperscore, { version: 1 }, 'the file has the version header');
  assert.ok(savedFile.editor?.cursor, 'the file records the cursor');
  const xmlSaved = await musicXml(page);
  await page.evaluate(() => window.__editor.ref.current.undo()); // drop the D major key, so the reopen visibly restores it
  assert.doesNotMatch(await musicXml(page), /<fifths>2<\/fifths>/);
  await page.setInputFiles('.ps-open-input', { name: 'score.pepperscore', mimeType: 'application/vnd.pepperscore+json', buffer: await readFile(savedPath) });
  await page.waitForFunction(() => /<fifths>2<\/fifths>/.test(window.__editor.ref.current?.getMusicXml() ?? ''), null, { timeout: 10000 });
  assert.equal(await musicXml(page), xmlSaved, 'the reopened .pepperscore compiles to the same MusicXML');
  await page.locator('.ps-editor').focus();

  // 6. The palette hides on a wide container (the phone-width palette is tested on a touch device below).
  assert.equal(await page.locator('.ps-palette').isVisible(), false, 'the palette hides on a wide container');

  // 6b. A popover's own toolbar button toggles it.
  const keyButton = page.locator('.ps-toolbar .ps-btn[aria-label="Key signature"]');
  await keyButton.click();
  await page.locator('.ps-popover-key').waitFor();
  await keyButton.click();
  await page.locator('.ps-popover').waitFor({ state: 'detached' });

  // 7a. Opening a 5-staff file through Open is refused in a banner and keeps the open score.
  const xmlBefore = await musicXml(page);
  await page.setInputFiles('.ps-open-input', join(root, 'validation/fixtures/ensemble.musicxml'));
  await page.locator('.ps-editor-banner.ps-editor-notice').waitFor();
  assert.match(await page.locator('.ps-editor-banner.ps-editor-notice').textContent(), /Editing is limited to 4 staves\./);
  assert.equal(await page.locator('.ps-editor .ps-toolbar').count(), 1, 'the toolbar is still there');
  assert.equal(await musicXml(page), xmlBefore, 'the open score is kept');
  await page.click('.ps-editor-banner-close');

  // 7b. As the initial score (the demo's fixture button), the 5-staff ensemble shows only the refusal.
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

  await context.close();

  // 9. Phone width on a touch device: the palette shows, and tapping its quarter and C buttons enters a note.
  {
    const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: engine === 'chromium' });
    const page = await phone.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.url}/editor`);
    await page.waitForSelector('.ps-editor .score-system svg', { timeout: 60000 });
    const palette = page.locator('.ps-palette');
    await palette.waitFor({ state: 'visible' });
    const button = await palette.locator('.ps-palette-btn').first().boundingBox();
    assert.ok(button.width >= 44 && button.height >= 44, `palette buttons are 44px targets (${button.width}x${button.height})`);
    assert.equal(await noteCount(page), 0);
    await palette.locator('button[aria-label="Quarter note"]').tap();
    await palette.locator('button[aria-label="Note C"]').tap();
    await waitForNotes(page, 1);
    assert.match(await musicXml(page), /<step>C<\/step>/, 'the tapped C is in the score');
    await phone.close();
  }

  assert.ok(renderTimes.length > 0, 'the editor reported its change-to-redraw time');
  assert.deepEqual(errors, [], 'no page or console errors');
  console.log(`Editor: entry, undo, click cursor, key popover, export, save and reopen, staff cap (open and initial), read-only and touch palette pass (render ms: ${renderTimes.join(', ')})`);
} finally {
  await browser.close();
  await server.close();
}
