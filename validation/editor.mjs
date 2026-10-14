// The score editor demo (apps/reader /editor): keyboard entry engraves, undo, a click puts the cursor on a note, the
// ensemble fixture (5 staves) is refused, accidentals and chord entry,
// the time popover applies on Enter, unsaved work is guarded, the desktop shell (rail keycaps, layout selector, popovers
// beside the cursor bar, add/remove bar, title editing) works, the Layout tab's instrument swap highlights, reviews and
// copies moved notes and a custom layout hides staves, and the change-to-redraw latency the editor logs stays under
// PS_EDITOR_RENDER_MS (default 250; a warning above it, a failure above twice it). Runs against the build (npm run build
// first). BROWSER=chromium|firefox|webkit.
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
const waitForNotes = (page, n) => page.waitForFunction(([selector, n]) => document.querySelectorAll(selector).length === n, [NOTES, n], { timeout: 30000 });
const musicXml = page => page.evaluate(() => window.__editor.ref.current.getMusicXml());
const isDirty = page => page.evaluate(() => window.__editor.ref.current.isDirty());
const pitchCount = xml => (xml.match(/<pitch>/g) ?? []).length;
const barCount = xml => (xml.match(/<measure\b/g) ?? []).length;
/** What window.confirm answers from now on (the editor asks before discarding unsaved changes). */
const answerConfirm = (page, answer) => page.evaluate(answer => { window.__confirms = []; window.confirm = message => { window.__confirms.push(message); return answer; }; }, answer);
const RENDER_MS = Number(process.env.PS_EDITOR_RENDER_MS) || 250;
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
  assert.equal(await page.locator('.ps-status-check').textContent(), 'Score check: no problems', 'no invariant errors');

  // 0. The desktop shell: rail keycaps are keycap-sized, and the layout selector lists the full score.
  const keycap = await page.locator('.ps-rail .ps-keycap[aria-label="Quarter note"]').boundingBox();
  assert.ok(keycap.height >= 52 && keycap.width >= 56, `rail keycaps are 56x52 (${keycap.width}x${keycap.height})`);
  assert.equal(await page.locator('.ps-rail .ps-keycap[aria-label="Quarter note"] .ps-tool-key').textContent(), '4', 'the keycap legend comes from the keymap');
  const layoutSelect = page.locator('.ps-canvas-head select[aria-label="Layout"]');
  assert.deepEqual(await layoutSelect.locator('option').allTextContents(), ['Full score'], 'the layout selector lists the full score');

  // 1. Keyboard entry: n (entry mode), 4 (quarter), c d e f.
  await page.locator('.ps-editor').focus();
  for (const key of ['n', '4', 'c', 'd', 'e', 'f']) await page.keyboard.press(key);
  await waitForNotes(page, 4);
  assert.match(await musicXml(page), /<step>F<\/step>/, 'the handle compiles the entered F');
  assert.equal(await page.locator('.ps-canvas-head .ps-btn[aria-label="Toggle note entry"]').getAttribute('aria-pressed'), 'true', 'the canvas header shows entry mode');

  // 2. Undo removes the last note.
  await page.keyboard.press('Control+z');
  await waitForNotes(page, 3);
  assert.doesNotMatch(await musicXml(page), /<step>F<\/step>/, 'undo removed the F');

  // 2b. Accidentals from the rail act on the last entered note (E); "Add to chord" makes letters add to its chord.
  await page.click('.ps-rail .ps-btn[aria-label="Sharp"]');
  await page.waitForFunction(() => /<step>E<\/step>\s*<alter>1<\/alter>/.test(window.__editor.ref.current.getMusicXml()), null, { timeout: 10000 });
  await page.click('.ps-rail .ps-btn[aria-label="Natural"]');
  await page.waitForFunction(() => !/<alter>/.test(window.__editor.ref.current.getMusicXml()), null, { timeout: 10000 });
  const chordToggle = page.locator('.ps-rail .ps-btn[aria-label="Add to chord"]');
  await chordToggle.click();
  assert.equal(await chordToggle.getAttribute('aria-pressed'), 'true', 'the chord toggle shows it is on');
  await page.keyboard.press('g');
  await page.waitForFunction(() => /<chord\/>/.test(window.__editor.ref.current.getMusicXml()), null, { timeout: 10000 });
  assert.equal(pitchCount(await musicXml(page)), 4, 'g added a chord note to the E instead of entering a fourth note');
  await chordToggle.click();
  assert.equal(await chordToggle.getAttribute('aria-pressed'), 'false');
  await page.evaluate(() => window.__editor.ref.current.undo());
  await page.waitForFunction(() => !/<chord\/>/.test(window.__editor.ref.current.getMusicXml()), null, { timeout: 10000 });
  await page.locator('.ps-editor').focus();

  // 3. A click on the first note puts the cursor (and the selection) on it.
  await clickNote(page, 0);
  await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains('ps-cursor'), NOTES, { timeout: 10000 });
  assert.match(await page.locator(NOTES).first().getAttribute('class'), /ps-selection/, 'the clicked note is selected');

  // 4. Popovers: k opens the key popover, a choice applies to the cursor bar, Escape closes it.
  await page.keyboard.press('k');
  await page.locator('.ps-popover-key').waitFor();
  // The popover opens beside the cursor bar (the bar holding the cursor note), never over it.
  await page.waitForFunction(() => document.querySelector('.ps-popover-key')?.dataset.side, null, { timeout: 5000 });
  const overlap = await page.evaluate(() => {
    const note = document.querySelector('.ps-editor [data-ps-highlight~="ps-cursor"]');
    const bar = document.querySelector('.ps-editor [data-ps-highlight~="ps-cursor-measure"]') ?? note?.closest('.measure');
    const a = bar.getBoundingClientRect(), b = document.querySelector('.ps-popover-key').getBoundingClientRect();
    return { side: document.querySelector('.ps-popover-key').dataset.side, bar: [a.left, a.top, a.right, a.bottom], popover: [b.left, b.top, b.right, b.bottom],
      intersects: a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom };
  });
  assert.equal(overlap.intersects, false, `the key popover avoids the cursor bar (${JSON.stringify(overlap)})`);
  await page.selectOption('.ps-popover-key .ps-select-fifths', '2');
  await page.keyboard.press('Escape');
  await page.locator('.ps-popover').waitFor({ state: 'detached' });
  assert.match(await musicXml(page), /<fifths>2<\/fifths>/, 'the key popover set D major');

  // 4b. The time popover applies on Enter, not per keystroke: typing 12 never passes through 1/4 (which would cut notes).
  const pitchesBefore = pitchCount(await musicXml(page));
  await page.locator('.ps-editor').focus();
  await page.keyboard.press('q');
  await page.locator('.ps-popover-time .ps-input-count').waitFor();
  await page.keyboard.type('12');
  assert.match(await musicXml(page), /<beats>4<\/beats>/, 'typing does not apply the time signature');
  await page.keyboard.press('Enter');
  await page.locator('.ps-popover').waitFor({ state: 'detached' });
  const twelve = await musicXml(page);
  assert.match(twelve, /<beats>12<\/beats>/, 'Enter applied 12/4');
  assert.equal(pitchCount(twelve), pitchesBefore, 'every original note remains');
  await page.evaluate(() => window.__editor.ref.current.undo());
  assert.match(await musicXml(page), /<beats>4<\/beats>/, 'one undo restores 4/4');
  await page.locator('.ps-editor').focus();

  // 5. Export downloads <title or score>.musicxml.
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.ps-btn-export')]);
  assert.equal(download.suggestedFilename(), 'score.musicxml');

  // 5b. Save downloads a .pepperscore file; opening it again restores the same score.
  assert.equal(await isDirty(page), true, 'edits make the score dirty');
  const [saved] = await Promise.all([page.waitForEvent('download'), page.click('.ps-btn-save')]);
  assert.equal(saved.suggestedFilename(), 'score.pepperscore');
  await page.waitForFunction(() => !window.__editor.ref.current.isDirty(), null, { timeout: 10000 });
  const savedPath = await saved.path();
  const savedFile = JSON.parse(await readFile(savedPath, 'utf8'));
  assert.deepEqual(savedFile.pepperscore, { version: 1 }, 'the file has the version header');
  assert.ok(savedFile.editor?.cursor, 'the file records the cursor');
  const xmlSaved = await musicXml(page);
  await page.evaluate(() => window.__editor.ref.current.undo()); // drop the D major key, so the reopen visibly restores it
  assert.doesNotMatch(await musicXml(page), /<fifths>2<\/fifths>/);
  assert.equal(await isDirty(page), true, 'undo away from the saved state is dirty');
  await answerConfirm(page, true);
  await page.setInputFiles('.ps-open-input', { name: 'score.pepperscore', mimeType: 'application/vnd.pepperscore+json', buffer: await readFile(savedPath) });
  await page.waitForFunction(() => /<fifths>2<\/fifths>/.test(window.__editor.ref.current?.getMusicXml() ?? ''), null, { timeout: 10000 });
  assert.equal(await musicXml(page), xmlSaved, 'the reopened .pepperscore compiles to the same MusicXML');
  assert.deepEqual(await page.evaluate(() => window.__confirms), ['Discard unsaved changes?'], 'Open asked before discarding');
  assert.equal(await isDirty(page), false, 'a reopened score is clean');
  await page.locator('.ps-editor').focus();

  // 6b. A popover's own top-bar chip toggles it.
  const keyButton = page.locator('.ps-topbar .ps-btn[aria-label="Key signature"]');
  await keyButton.click();
  await page.locator('.ps-popover-key').waitFor();
  await keyButton.click();
  await page.locator('.ps-popover').waitFor({ state: 'detached' });

  // 7a. Opening a 5-staff file through Open is refused in a banner and keeps the open score.
  const xmlBefore = await musicXml(page);
  await page.setInputFiles('.ps-open-input', join(root, 'validation/fixtures/ensemble.musicxml'));
  await page.locator('.ps-editor-banner.ps-editor-notice').waitFor();
  assert.match(await page.locator('.ps-editor-banner.ps-editor-notice').textContent(), /Editing is limited to 4 staves\./);
  assert.equal(await page.locator('.ps-editor .ps-topbar').count(), 1, 'the editor is still there');
  assert.equal(await musicXml(page), xmlBefore, 'the open score is kept');
  await page.click('.ps-editor-banner-close');

  // 7b. As the initial score (the demo's fixture button), the 5-staff ensemble shows only the refusal.
  await page.click('.editor-demo-ensemble');
  await page.locator('.ps-editor-error').waitFor();
  assert.equal(await page.locator('.ps-editor-error').textContent(), 'Editing is limited to 4 staves.');
  assert.equal(await page.locator('.ps-editor .ps-topbar, .ps-editor .pepperscore').count(), 0, 'a refused score renders nothing else');
  await page.click('.editor-demo-new');
  await page.waitForSelector('.ps-editor .score-system svg', { timeout: 60000 });

  // 7c. New with unsaved changes asks first; declining keeps the score.
  await page.locator('.ps-editor').focus();
  for (const key of ['n', 'c']) await page.keyboard.press(key);
  await page.waitForFunction(() => /<step>C<\/step>/.test(window.__editor.ref.current.getMusicXml()), null, { timeout: 10000 });
  assert.equal(await isDirty(page), true);
  const unsaved = await musicXml(page);
  await answerConfirm(page, false);
  await page.click('.editor-demo-new');
  assert.deepEqual(await page.evaluate(() => window.__confirms), ['Discard unsaved changes?']);
  assert.equal(await musicXml(page), unsaved, 'declining the prompt keeps the score');
  await answerConfirm(page, true);
  await page.click('.editor-demo-new');
  await page.waitForFunction(() => !/<step>/.test(window.__editor.ref.current?.getMusicXml() ?? '<step>'), null, { timeout: 10000 });
  assert.equal(await isDirty(page), false, 'a new score is clean');

  // 7d. The add-bar "+" at the end of the score appends a bar; "−" removes the last one.
  const bars = barCount(await musicXml(page));
  await page.click('.ps-add-bar .ps-btn[aria-label="Add bar"]');
  await page.waitForFunction(n => (window.__editor.ref.current.getMusicXml().match(/<measure\b/g) ?? []).length === n, bars + 1, { timeout: 10000 });
  await page.click('.ps-add-bar .ps-btn[aria-label="Remove bar"]');
  await page.waitForFunction(n => (window.__editor.ref.current.getMusicXml().match(/<measure\b/g) ?? []).length === n, bars, { timeout: 10000 });

  // 7e. Double-clicking the title edits it; Enter commits, and the export carries it (file name included).
  await page.dblclick('.ps-topbar .ps-score-title');
  await page.fill('.ps-topbar .ps-meta-input-title', 'Evening Song');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.ps-topbar .ps-score-title').textContent(), 'Evening Song');
  assert.match(await musicXml(page), /<work-title>Evening Song<\/work-title>/, 'the title is in the MusicXML');
  const [titled] = await Promise.all([page.waitForEvent('download'), page.click('.ps-btn-export')]);
  assert.equal(titled.suggestedFilename(), 'Evening Song.musicxml');
  // Escape cancels an edit (the blur from refocusing must not commit it).
  await page.dblclick('.ps-topbar .ps-score-title');
  await page.fill('.ps-topbar .ps-meta-input-title', 'Discarded');
  await page.keyboard.press('Escape');
  await page.locator('.ps-topbar .ps-meta-input-title').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.ps-topbar .ps-score-title').textContent(), 'Evening Song', 'Escape kept the title');
  assert.doesNotMatch(await musicXml(page), /Discarded/, 'Escape committed nothing');
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__editor.ref.current.undo());
  assert.equal(await isDirty(page), false, 'undoing the title and bar edits returns to the clean new score');

  // 7f. Layout tab and instrument swap (the demo's Tenor Sax + Piano fixture): Tenor Sax shown as Alto Sax at beginner
  // moves its high phrases 8vb (ps-transposed noteheads and the status line count them); Review selects them; Make a copy
  // adds a part and clears the highlights, undo restores both; a custom layout of only the piano shows two staves.
  {
    const TRANSPOSED = `${NOTES}.ps-transposed`;
    const count = selector => page.locator(selector).count();
    const scoreParts = async () => ((await musicXml(page)).match(/<score-part\b/g) ?? []).length;
    await page.click('.editor-demo-tenor');
    await page.waitForFunction(() => /Tenor Sax/.test(window.__editor.ref.current?.getMusicXml() ?? ''), null, { timeout: 10000 });
    await waitForNotes(page, 17);
    await page.click('.ps-inspector .ps-tab[data-tab="layout"]');
    assert.deepEqual(await page.locator('.ps-stave-list .ps-stave-name').allTextContents(), ['Tenor Sax', 'Piano RH', 'Piano LH'], 'the stave list names every staff');
    await page.selectOption('.ps-swap-card .ps-swap-instrument', 'alto-saxophone');
    await page.click('.ps-swap-card .ps-swap-level .ps-seg-item:has-text("Beginner")');
    await page.waitForFunction(selector => document.querySelectorAll(selector).length > 0, TRANSPOSED, { timeout: 10000 });
    await page.locator('.ps-editor .score-loading').waitFor({ state: 'detached', timeout: 10000 }); // the swapped engraving, not the last one
    assert.match(await page.locator(`${TRANSPOSED} .notehead`).count().then(String), /^[1-9]/, 'the moved notes are highlighted in the new engraving');
    const moved = await count(TRANSPOSED);
    assert.equal(moved, 6, 'the two high phrases (six notes) moved');
    assert.match(await page.locator('.ps-status-moved').textContent(), new RegExp(`^${moved} notes moved 8vb for Alto Sax · beginner$`), 'the status line counts the moved notes');
    assert.match(await page.locator('.ps-moved-text').textContent(), new RegExp(`Moved 8vb to fit range · ${moved} notes`));
    assert.equal(await page.locator('.ps-stave-item[data-staff="1"] .ps-stave-meta').first().textContent(), 'as Alto Sax', 'the stave list shows the swap');
    assert.match(await page.locator('.ps-swap-link-text').textContent(), /Linked to Tenor Sax · changes affect both/);
    await page.click('.ps-moved-review');
    await page.waitForFunction(selector => [...document.querySelectorAll(selector)].every(n => n.classList.contains('ps-selection')), TRANSPOSED, { timeout: 10000 });
    assert.equal(await count(`${NOTES}.ps-selection`), moved, 'Review selects exactly the moved notes');
    await page.locator('.ps-editor .score-loading').waitFor({ state: 'detached', timeout: 10000 });
    await page.locator('.ps-inspector .ps-insp-body').evaluate(body => { body.scrollTop = 0; });
    await page.screenshot({ path: '/tmp/editor-layout.png' });

    assert.equal(await scoreParts(), 2);
    await page.click('.ps-swap-copy');
    await page.waitForFunction(() => (window.__editor.ref.current.getMusicXml().match(/<score-part\b/g) ?? []).length === 3, null, { timeout: 10000 });
    await page.waitForFunction(selector => document.querySelectorAll(selector).length === 0, TRANSPOSED, { timeout: 10000 });
    assert.match(await musicXml(page), /<part-name>Alto Saxophone \(from Tenor Sax\)<\/part-name>/, 'the copy is a part of its own');
    assert.equal(await page.locator('.ps-status-moved').count(), 0, 'a copy moves nothing');
    await page.evaluate(() => window.__editor.ref.current.undo());
    await page.waitForFunction(() => (window.__editor.ref.current.getMusicXml().match(/<score-part\b/g) ?? []).length === 2, null, { timeout: 10000 });
    await page.waitForFunction(([selector, n]) => document.querySelectorAll(selector).length === n, [TRANSPOSED, moved], { timeout: 10000 });

    // Hiding the Tenor Sax in the full score makes a "Custom" layout instead (export, which writes the full score, keeps
    // both parts): only the two piano staves are drawn. Saving it under a name makes a second custom layout.
    assert.equal(await page.locator('.ps-stave-hint').textContent(), 'Hiding a stave makes a custom layout.');
    await page.click('.ps-stave-item:has-text("Tenor Sax") .ps-stave-label');
    await page.locator('.ps-profile-chip.is-on:has-text("Custom")').waitFor();
    assert.equal(await scoreParts(), 2, 'hiding a stave leaves the full score (and the export) alone');
    const stavesPerSystem = () => page.evaluate(() => document.querySelector('.ps-editor .score-system svg .measure')?.querySelectorAll(':scope > .staff').length ?? 0);
    await page.waitForFunction(() => document.querySelector('.ps-editor .score-system svg .measure')?.querySelectorAll(':scope > .staff').length === 2, null, { timeout: 10000 });
    assert.equal(await stavesPerSystem(), 2, 'the custom layout draws the two piano staves');
    assert.equal(await count(TRANSPOSED), 0, 'the hidden swapped part leaves no highlights');
    await page.fill('.ps-save-view-input', 'Piano only');
    await page.click('.ps-save-layout');
    await page.locator('.ps-profile-chip.is-on:has-text("Piano only")').waitFor();
    assert.equal(await stavesPerSystem(), 2);
    const options = await layoutSelect.locator('option').allTextContents();
    assert.ok(options.some(t => /Piano only/.test(t)) && options.some(t => /^Custom/.test(t)), `the layout selector lists the custom layouts (${options})`);
    // A click on the first drawn staff (the piano's right hand) puts the cursor there, not on the hidden Tenor Sax.
    await clickNote(page, 0);
    await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains('ps-cursor'), NOTES, { timeout: 10000 });
    assert.match(await page.locator('.ps-status-cursor').textContent(), /^Piano · /, 'the click mapped to the piano');
    for (let i = 0; i < 10 && await isDirty(page); i++) await page.evaluate(() => window.__editor.ref.current.undo());
    assert.equal(await isDirty(page), false, 'undo returns to the clean fixture');
  }

  // 8. No licence: read-only banner, disabled toolbar, keys not bound.
  await page.goto(`${server.url}/editor?licence=`);
  await page.waitForSelector('.ps-editor .score-system svg', { timeout: 60000 });
  assert.equal(await page.locator('.ps-editor-banner.ps-editor-readonly').textContent(), 'Editing requires a licence.');
  assert.ok(await page.locator('.ps-topbar .ps-btn[aria-label="Key signature"]').isDisabled(), 'the top bar chips are disabled');
  assert.ok(await page.locator('.ps-rail .ps-btn[aria-label="Sharp"]').isDisabled(), 'the rail is disabled');
  await page.locator('.ps-editor').focus();
  for (const key of ['n', 'c']) await page.keyboard.press(key);
  assert.equal(await page.locator('.ps-editor').getAttribute('data-ps-mode'), 'select', 'n does not enter entry mode');
  assert.doesNotMatch(await musicXml(page), /<step>/, 'c entered nothing');

  await context.close();

  // 8b. A medium-width editor (761-960px): the inspector is a drawer over the canvas; it toggles a repeat start and
  // Escape closes it.
  {
    const medium = await browser.newContext({ viewport: { width: 900, height: 900 } });
    const page = await medium.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.url}/editor`);
    await page.waitForSelector('.ps-editor .score-system svg', { timeout: 60000 });
    const inspector = page.locator('.ps-editor .ps-inspector');
    assert.equal(await inspector.isVisible(), false, 'the inspector drawer starts closed');
    await page.click('.ps-canvas-head .ps-inspector-toggle');
    await page.waitForFunction(() => { const r = document.querySelector('.ps-editor .ps-inspector').getBoundingClientRect(); return r.right <= window.innerWidth + 1 && r.width > 200; }, null, { timeout: 5000 });
    await page.click('.ps-inspector .ps-glyph-btn[aria-label="Repeat start"]');
    await page.waitForFunction(() => /<repeat direction="forward"\/>/.test(window.__editor.ref.current.getMusicXml()), null, { timeout: 10000 });
    await page.keyboard.press('Escape');
    await inspector.waitFor({ state: 'hidden', timeout: 5000 });
    await medium.close();
  }

  assert.ok(renderTimes.length > 0, 'the editor reported its change-to-redraw time');
  // A new score source skips the viewer's redraw fade, so an edit engraves well inside a quarter second. Slow machines
  // (CI) get a warning above PS_EDITOR_RENDER_MS and fail only above twice it.
  const slow = renderTimes.filter(ms => ms >= RENDER_MS);
  if (slow.length) console.warn(`Editor: ${slow.length} change-to-redraw time(s) at or over ${RENDER_MS} ms: ${slow.join(', ')}`);
  assert.ok(renderTimes.every(ms => ms < 2 * RENDER_MS), `every change-to-redraw time is under ${2 * RENDER_MS} ms (got ${renderTimes.join(', ')})`);
  assert.deepEqual(errors, [], 'no page or console errors');
  console.log(`Editor: shell (keycaps, layout selector, popover placement, add/remove bar, title edit and cancel, medium-width inspector drawer), Layout tab (swap to Alto Sax beginner, moved-note highlights and status, Review, Make a copy and undo, piano-only custom layout and its clicks), entry, undo, accidentals and chord entry, click cursor, key and time popovers, export, save and reopen, unsaved-work guard, staff cap (open and initial) and read-only pass (the phone shell: validation/editor-phone.mjs) (render ms: ${renderTimes.join(', ')})`);
} finally {
  await browser.close();
  await server.close();
}
