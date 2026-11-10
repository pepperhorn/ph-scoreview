// The score editor demo (apps/reader /editor): keyboard entry engraves in place (no paint reveal, scroll kept), undo, a click puts the cursor on a note, the
// ensemble fixture (5 staves) is refused, accidentals and chord entry,
// the time popover applies on Enter, unsaved work is guarded, the desktop shell (rail keycaps, layout selector, popovers
// beside the cursor bar, add/remove bar, title editing) works, the Layout tab's instrument swap highlights, reviews and
// copies moved notes and a custom layout hides staves (moving the cursor to a drawn staff), five arrow-key moves render
// the rail at most once, Escape closes a popover before the inspector drawer, the view follows the cursor (40 notes in
// Endless at 1400x900 keep it in view; an in-view arrow move, a click, a move during a momentum scroll and a move during playback do not scroll; Undo scrolls back to it), and the change-to-redraw latency the editor
// logs stays under PS_EDITOR_RENDER_MS (default 400; a warning above it, a failure above twice it). Runs against the
// build (npm run build first). BROWSER=chromium|firefox|webkit. VALIDATION_BUDGET_SCALE scales timing gates (default 1).
import assert from 'node:assert/strict';
import { budgetScale, assertTiming } from './lib/budgets.mjs';
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
const RENDER_MS = (Number(process.env.PS_EDITOR_RENDER_MS) || 400) * budgetScale;
/** Clicks the centre of a notehead (the note group's own centre can fall on empty SVG). */
async function clickNote(page, index) {
  // Layout changes can temporarily remove/hide the SVG. Read the target atomically once it has geometry.
  // Keep the coordinate click: overlapping stave paths can intercept a locator's actionability check.
  const target = await page.waitForFunction(([selector, index]) => {
    const box = document.querySelectorAll(selector)[index]?.getBoundingClientRect();
    return box?.width > 0 && box.height > 0 ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : false;
  }, [`${NOTES} .notehead`, index], { timeout: 30000 });
  const { x, y } = await target.jsonValue();
  await target.dispose();
  await page.mouse.click(x, y);
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

  assert.equal(await page.locator('[data-ps-plugin]').count(), 0, 'no plugins prop renders no plugin wrapper');

  // No-plugin phone baseline: title/composer are display-only, with no blank composer placeholder.
  {
    const phone = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const p = await phone.newPage();
    await p.goto(`${server.url}/editor`);
    await p.waitForSelector('.ps-shell-phone[data-header="full"]');
    assert.equal(await p.locator('[data-ps-plugin]').count(), 0);
    assert.equal(await p.locator('.ps-phead-composer').count(), 0, 'blank composer stays absent');
    await p.locator('.ps-phead-title').dblclick();
    assert.equal(await p.locator('.ps-meta-input').count(), 0, 'double-clicking phone title does not start editing');
    await p.waitForSelector('.ps-shell-phone[data-header="collapsed"]');
    assert.equal(await p.locator('.ps-phead-title').textContent(), 'Untitled score');
    assert.equal(await p.locator('.ps-meta-input').count(), 0, 'collapse never commits a title draft');
    await phone.close();
  }

  // Plugin host: exercise real session replacement, listeners, keyboard isolation and all targets in both shells.
  for (const width of [1280, 900, 390]) {
    const plugins = await browser.newContext({ viewport: { width, height: 900 } });
    const p = await plugins.newPage();
    p.on('pageerror', error => errors.push(error.message));
    await p.goto(`${server.url}/editor?stubPlugin=1`);
    await p.waitForSelector('.ps-editor[data-ps-editable] [data-ps-plugin]', { state: 'attached' });
    assert.equal(await p.locator('[data-ps-plugin]').count(), 1);
    assert.equal(await p.evaluate(() => window.__plugin.host.origin), 'opened');
    assert.equal(await p.evaluate(() => window.__plugin.host.shell), width <= 760 ? 'phone' : 'desktop');
    if (width === 900) assert.equal(await p.evaluate(() => window.__plugin.host.findTarget('clef')), null, 'closed drawer is not a visible target');
    if (width <= 760) assert.equal(await p.evaluate(() => window.__plugin.host.findTarget('composer')), null, 'empty phone composer has no display');
    await p.evaluate(() => window.__plugin.host.dispatch({ label: 'Target fixture', run: draft => { draft.document.meta.composer = 'A'; } }, {}));
    if (width <= 760) await p.waitForSelector('.ps-shell-phone[data-header="collapsed"]');
    else await p.evaluate(() => document.querySelector('.ps-inspector [data-tab="layout"]').click());
    for (const target of ['title', 'composer', 'key', 'time', 'tempo', 'clef', 'details', 'parts']) {
      await p.evaluate(target => window.__plugin.host.revealTarget(target), target);
      await p.waitForFunction(target => {
        const element = window.__plugin.host.findTarget(target);
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return rect.width > 0 && rect.height > 0 && hit && element.contains(hit);
      }, target);
      if (width === 900 && target === 'clef') {
        assert.equal(await p.locator('.ps-inspector').evaluate(el => el.classList.contains('is-open')), true, 'reveal opens the medium drawer');
        await p.locator('[aria-label="Plugin input"]').focus();
        await p.keyboard.press('Escape');
        assert.equal(await p.locator('.ps-inspector').evaluate(el => el.classList.contains('is-open')), true, 'plugin Escape preserves the inspector drawer');
      }
    }
    // Leave the menu and inspector drawer closed so shortcuts would reach note entry without isolation.
    await p.evaluate(() => window.__plugin.host.revealTarget('title'));
    await p.locator('.ps-editor').focus();
    await p.keyboard.press('Escape');
    const before = await musicXml(p);
    const mode = await p.locator('.ps-editor').getAttribute('data-ps-mode');
    await p.getByRole('button', { name: 'Plugin edit', exact: true }).focus();
    await p.keyboard.type('nc');
    await p.locator('[aria-label="Plugin input"]').focus();
    await p.keyboard.type('ncdefg');
    await p.keyboard.press('Escape');
    await p.keyboard.press('Control+z');
    assert.equal(await musicXml(p), before, 'plugin typing and shortcuts leave the document alone');
    assert.equal(await p.locator('.ps-editor').getAttribute('data-ps-mode'), mode);
    await p.evaluate(() => window.__plugin.host.openPopover('details'));
    await p.locator('.ps-popover-details').waitFor();
    await p.locator('[aria-label="Plugin input"]').focus();
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('.ps-popover-details').count(), 1, 'plugin Escape does not close editor popovers');
    await p.locator('[aria-label="Plugin input"]').fill('');
    // Real Details fields and Parts controls remain independently usable.
    await p.getByLabel('Description', { exact: true }).fill('A study');
    await p.getByLabel('Project', { exact: true }).fill('Album');
    await p.getByLabel('Project', { exact: true }).press('Tab');
    assert.equal(await p.evaluate(() => window.__plugin.host.getDocument().meta.description), 'A study');
    await p.evaluate(() => window.__plugin.host.openPopover('parts'));
    await p.locator('.ps-popover-parts').waitFor();
    await answerConfirm(p, true);
    // Use a real file input, which remounts EditorSession without replacing the outer demo.
    const unmounts = await p.evaluate(() => { window.__oldPluginHost = window.__plugin.host; return window.__plugin.unmounts; });
    if (width <= 760) await p.click('.ps-phead-more');
    await p.setInputFiles('.ps-open-input', { name: 'opened.musicxml', mimeType: 'application/xml', buffer: Buffer.from(before) });
    await p.waitForFunction(n => window.__plugin.unmounts === n + 1 && window.__plugin.active === 1, unmounts);
    assert.equal(await p.evaluate(() => window.__plugin.host.origin), 'opened');
    const pulses = await p.evaluate(() => window.__plugin.pulses);
    await p.evaluate(() => window.dispatchEvent(new Event('ps-stub-pulse')));
    assert.equal(await p.evaluate(() => window.__plugin.pulses), pulses + 1, 'only the new listener remains');
    const notifications = await p.evaluate(() => window.__plugin.notifications);
    await p.evaluate(() => window.__oldPluginHost.dispatch({ label: 'Old session edit', run: draft => { draft.document.meta.title = 'Old'; } }, {}));
    assert.equal(await p.evaluate(() => window.__plugin.notifications), notifications, 'old store subscription was removed');
    await p.getByRole('button', { name: 'Plugin edit', exact: true }).click();
    assert.equal(await p.evaluate(() => window.__plugin.notifications), notifications + 1, 'only one document subscription remains');
    await answerConfirm(p, true);
    if (width > 760) {
      await p.click('.editor-demo-new');
      await p.waitForFunction(() => window.__plugin.host.origin === 'new');
    } else {
      await p.click('.ps-phead-more');
      await p.click('.ps-btn-new');
      await p.waitForFunction(n => window.__plugin.unmounts > n, unmounts + 1);
      assert.equal(await p.evaluate(() => window.__plugin.host.origin), 'new', 'phone New starts a new session');
    }
    console.log(`Plugin host: ${width}px targets, key isolation, details, file-open cleanup and origin pass`);
    await plugins.close();
  }

  // 0. The desktop shell: rail keycaps are keycap-sized, and the layout selector lists the full score.
  const keycap = await page.locator('.ps-rail .ps-keycap[aria-label="Quarter note"]').boundingBox();
  assert.ok(keycap.height >= 52 && keycap.width >= 56, `rail keycaps are 56x52 (${keycap.width}x${keycap.height})`);
  assert.equal(await page.locator('.ps-rail .ps-keycap[aria-label="Quarter note"] .ps-tool-key').textContent(), '4', 'the keycap legend comes from the keymap');
  const layoutSelect = page.locator('.ps-canvas-head select[aria-label="Layout"]');
  assert.deepEqual(await layoutSelect.locator('option').allTextContents(), ['Full score'], 'the layout selector lists the full score');
  assert.equal(await page.locator('.ps-canvas-head .ps-zoom-readout').getAttribute('aria-hidden'), 'true', 'the zoom readout is a plain label');
  assert.equal(await page.locator('.ps-canvas-head button.ps-zoom, .ps-canvas-head button.ps-zoom-readout').count(), 0, 'the zoom readout is not a button');

  // 1. Keyboard entry: n (entry mode), 4 (quarter), c d e f.
  // Edits swap the engraving in place (paintTransition "none"): from here, no edit may fade the score out, show the
  // loading overlay or move the scroll position.
  await page.waitForFunction(() => !document.querySelector('.ps-editor .score-content.is-painting, .ps-editor .score-loading'), null, { timeout: 30000 });
  await page.evaluate(() => {
    const viewport = document.querySelector('.ps-editor .score-viewport');
    const flashes = window.__paintFlashes = [];
    window.__scrollBefore = viewport.scrollTop;
    const seen = () => { if (document.querySelector('.ps-editor .score-content.is-painting, .ps-editor .score-loading')) flashes.push(performance.now()); };
    window.__paintObserver = new MutationObserver(seen);
    window.__paintObserver.observe(document.querySelector('.ps-editor'), { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
  // The desktop starts in Edit (select-first); the pill and the status line call it Edit, never Select.
  const modePill = page.locator('.ps-canvas-head .ps-btn[aria-label="Toggle note entry"]');
  assert.equal((await modePill.textContent()).trim(), 'Edit', 'the canvas pill says Edit');
  assert.match(await page.locator('.ps-status-cursor').textContent(), /· edit$/, 'the status line says edit');
  await page.locator('.ps-editor').focus();
  for (const key of ['n', '4', 'c', 'd', 'e', 'f']) await page.keyboard.press(key);
  await waitForNotes(page, 4);
  assert.match(await musicXml(page), /<step>F<\/step>/, 'the handle compiles the entered F');
  // The first note goes in the octave nearest the treble middle line (B4): C5, not C4 below the staff.
  assert.match(await musicXml(page), /<step>C<\/step>\s*<octave>5<\/octave>/, 'the first C is C5 (nearest the middle line)');
  assert.equal(await modePill.getAttribute('aria-pressed'), 'true', 'the canvas header shows entry mode');
  assert.equal((await modePill.textContent()).trim(), 'Entry', 'the canvas pill says Entry');

  // 2. Undo removes the last note.
  await page.keyboard.press('Control+z');
  await waitForNotes(page, 3);
  assert.doesNotMatch(await musicXml(page), /<step>F<\/step>/, 'undo removed the F');
  const paint = await page.evaluate(() => { window.__paintObserver.disconnect(); return { flashes: window.__paintFlashes.length, scrollBefore: window.__scrollBefore, scrollAfter: document.querySelector('.ps-editor .score-viewport').scrollTop }; });
  assert.equal(paint.flashes, 0, 'edits swap the engraving in place, with no paint reveal or loading overlay');
  assert.equal(paint.scrollAfter, paint.scrollBefore, 'edits keep the scroll position');

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

  // 2c. Cursor moves re-render the viewer, not the shell: five arrow-key moves render the rail at most once.
  {
    const railRenders = () => page.evaluate(() => window.__editor.renderCounts.Rail ?? 0);
    const position = () => page.locator('.ps-status-cursor').textContent();
    const before = [await railRenders(), await position()];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(200);
    assert.notEqual(await position(), before[1], 'the arrow keys moved the cursor');
    const renders = (await railRenders()) - before[0];
    assert.ok(renders <= 1, `five cursor moves render the rail at most once (${renders})`);
  }

  // 3. A click on the first note puts the cursor (and the selection) on it.
  await clickNote(page, 0);
  await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains('ps-cursor'), NOTES, { timeout: 10000 });
  assert.match(await page.locator(NOTES).first().getAttribute('class'), /ps-selection/, 'the clicked note is selected');
  // 3a. A click on a note's own glyphs off the notehead (its box centre: the stem side) selects that note, not the
  // next one; a click in the staff space just right of a note puts the cursor on the note engraved nearest.
  {
    const cursorIndex = () => page.evaluate(selector => [...document.querySelectorAll(selector)].findIndex(note => note.classList.contains('ps-cursor')), NOTES);
    for (const index of [1, 0, 2]) {
      const box = await page.locator(NOTES).nth(index).boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(([selector, index]) => document.querySelectorAll(selector)[index]?.classList.contains('ps-cursor'), [NOTES, index], { timeout: 10000 });
      assert.equal(await cursorIndex(), index, `a click on note ${index}'s box centre highlights note ${index}`);
      assert.match(await page.locator(NOTES).nth(index).getAttribute('class'), /ps-selection/, `the box click selects note ${index}`);
    }
    const head = await page.locator(`${NOTES} .notehead`).nth(1).boundingBox();
    const next = await page.locator(`${NOTES} .notehead`).nth(2).boundingBox();
    const box = await page.locator(NOTES).nth(1).boundingBox();
    const x = box.x + box.width + Math.min(6, (next.x - box.x - box.width) / 3);
    await page.mouse.click(x, head.y + head.height / 2);
    await page.waitForFunction(selector => document.querySelectorAll(selector)[1]?.classList.contains('ps-cursor'), NOTES, { timeout: 10000 });
    assert.equal(await cursorIndex(), 1, 'a click in the staff space just right of note 1 puts the cursor on note 1');
    await clickNote(page, 0);
    await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains('ps-cursor'), NOTES, { timeout: 10000 });
  }

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
  // Key names use the glyphs (option values stay the fifths number).
  assert.equal(await page.locator('.ps-popover-key .ps-select-fifths option[value="-3"]').textContent(), 'E♭ major', 'the key options read E♭ major');
  assert.equal(await page.locator('.ps-popover-key .ps-select-fifths option[value="6"]').textContent(), 'F♯ major', 'the key options read F♯ major');
  await page.selectOption('.ps-popover-key .ps-select-fifths', '-3');
  await page.waitForFunction(() => /E♭ major/.test(document.querySelector('.ps-topbar .ps-btn[aria-label="Key signature"]')?.textContent ?? ''), null, { timeout: 5000 });
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
    assert.equal(await page.locator('.ps-swap-export-note').textContent(), 'Export writes Tenor Sax; Make a copy to export Alto Sax.', 'a full-score swap says what Export writes');
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
    assert.match(await page.locator('.ps-status-cursor').textContent(), /^Tenor Sax · /, 'the cursor starts on the Tenor Sax');
    await page.click('.ps-stave-item:has-text("Tenor Sax") .ps-stave-label');
    await page.locator('.ps-profile-chip.is-on:has-text("Custom")').waitFor();
    assert.equal(await scoreParts(), 2, 'hiding a stave leaves the full score (and the export) alone');
    const stavesPerSystem = () => page.evaluate(() => document.querySelector('.ps-editor .score-system svg .measure')?.querySelectorAll(':scope > .staff').length ?? 0);
    await page.waitForFunction(() => document.querySelector('.ps-editor .score-system svg .measure')?.querySelectorAll(':scope > .staff').length === 2, null, { timeout: 10000 });
    assert.equal(await stavesPerSystem(), 2, 'the custom layout draws the two piano staves');
    assert.equal(await count(TRANSPOSED), 0, 'the hidden swapped part leaves no highlights');
    // The cursor left the hidden Tenor Sax for the first drawn staff: c (no click first) enters on the piano.
    assert.match(await page.locator('.ps-status-cursor').textContent(), /^Piano · /, 'hiding the cursor stave moved the cursor to the piano');
    const pianoPitches = () => page.evaluate(() => (JSON.stringify(window.__editor.ref.current.getDocument().parts.find(p => p.name === 'Piano')).match(/"pitch"/g) ?? []).length);
    const saxPitches = () => page.evaluate(() => (JSON.stringify(window.__editor.ref.current.getDocument().parts.find(p => p.name === 'Tenor Sax')).match(/"pitch"/g) ?? []).length);
    const [piano0, sax0] = [await pianoPitches(), await saxPitches()];
    const xmlHidden = await musicXml(page);
    await page.locator('.ps-editor').focus();
    if (await page.locator('.ps-editor').getAttribute('data-ps-mode') !== 'enter') await page.keyboard.press('n');
    await page.keyboard.press('c');
    await page.waitForFunction(xml => window.__editor.ref.current.getMusicXml() !== xml, xmlHidden, { timeout: 10000 });
    assert.equal(await saxPitches(), sax0, 'nothing was entered on the hidden Tenor Sax');
    assert.notEqual(await pianoPitches(), piano0, 'c entered on the piano');
    await page.evaluate(() => window.__editor.ref.current.undo());
    await page.keyboard.press('Escape');
    await page.fill('.ps-save-view-input', 'Piano only');
    await page.click('.ps-save-layout');
    await page.locator('.ps-profile-chip.is-on:has-text("Piano only")').waitFor();
    assert.equal(await stavesPerSystem(), 2);
    const options = await layoutSelect.locator('option').allTextContents();
    assert.ok(options.includes('Piano only (custom)') && options.includes('Custom (custom)'), `the layout selector lists the custom layouts with their kind (${options})`);
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
    // With a popover open over the drawer, Escape closes the popover first, then the drawer.
    await page.keyboard.press('k');
    await page.locator('.ps-popover-key').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.ps-popover').waitFor({ state: 'detached' });
    assert.equal(await inspector.isVisible(), true, 'the first Escape closed only the popover');
    await page.keyboard.press('Escape');
    await inspector.waitFor({ state: 'hidden', timeout: 5000 });
    await medium.close();
  }

  // 8c. The view follows the cursor (1400x900, Endless): 40 typed notes (Ode to Joy) keep the cursor highlight inside
  // the viewport after every bar; an arrow move that stays in view does not scroll; a click on a note near the right
  // edge does not scroll; Undo brings the cursor back into view after the reader scrolled away.
  {
    const wide = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await wide.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.url}/editor`);
    await page.waitForSelector('.ps-editor .score-system svg', { timeout: 60000 });
    await page.click('.ps-view-toggle .ps-seg-item:has-text("Endless")');
    await page.waitForFunction(() => document.querySelector('.ps-editor .reader-area')?.classList.contains('ps-landscape') && !document.querySelector('.ps-editor .score-content.is-painting, .ps-editor .score-loading'), null, { timeout: 30000 });
    const scrollLeft = () => page.evaluate(() => document.querySelector('.ps-editor .score-viewport').scrollLeft);
    /** scrollLeft once a smooth scroll has landed (unchanged for 300 ms). */
    const settledScrollLeft = () => page.evaluate(() => new Promise(done => {
      const viewport = document.querySelector('.ps-editor .score-viewport');
      let last = viewport.scrollLeft, since = performance.now();
      const tick = () => {
        if (viewport.scrollLeft !== last) { last = viewport.scrollLeft; since = performance.now(); }
        if (performance.now() - since >= 300) done(last); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    /** The cursor highlight (the cursor notes, else the cursor bar's box) lies wholly inside the viewport. */
    const cursorInView = () => page.waitForFunction(() => {
      const viewport = document.querySelector('.ps-editor .score-viewport');
      const cursor = document.querySelector('.ps-editor [data-ps-highlight~="ps-cursor"], .ps-editor .ps-measure-highlight[data-ps-class~="ps-cursor-measure"]');
      if (!viewport || !cursor) return false;
      const v = viewport.getBoundingClientRect(), c = cursor.getBoundingClientRect();
      return c.width > 0 && c.left >= v.left - 1 && c.right <= v.left + viewport.clientWidth + 1 && c.top >= v.top - 1 && c.bottom <= v.top + viewport.clientHeight + 1;
    }, null, { timeout: 5000 });
    await page.locator('.ps-editor').focus();
    for (const key of ['n', '4']) await page.keyboard.press(key);
    const ode = 'eefggfedccdeeddeefggfedccdedccddecdefecdefedcdgeefggfedccdedcc';
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(ode[i]);
      await page.waitForFunction(n => (window.__editor.ref.current.getMusicXml().match(/<pitch>/g) ?? []).length === n, i + 1, { timeout: 10000 });
      if ((i + 1) % 4) continue;
      try { await cursorInView(); } catch { assert.fail(`after bar ${(i + 1) / 4} the cursor is in the viewport (scrollLeft ${await scrollLeft()})`); }
    }
    const followed = await settledScrollLeft();
    assert.ok(followed > 400, `entry scrolled the view along with the cursor (scrollLeft ${followed})`);
    // An arrow move that stays in view leaves the view alone (no re-centring on every keystroke).
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(400);
    assert.equal(await settledScrollLeft(), followed, 'an arrow move inside the view does not scroll');
    // Back to the start; a click on the rightmost note in view (inside the follow margin) must not scroll.
    await page.evaluate(() => document.querySelector('.ps-editor .score-viewport').scrollTo({ left: 0 }));
    await page.waitForFunction(() => document.querySelector('.ps-editor .score-viewport').scrollLeft === 0, null, { timeout: 5000 });
    const position = await page.locator('.ps-status-cursor').textContent();
    const rightmost = await page.evaluate(selector => {
      const viewport = document.querySelector('.ps-editor .score-viewport').getBoundingClientRect();
      // Only a notehead the pointer would reach (not under the canvas's overlay buttons, e.g. add bar).
      const reachable = head => { const r = head.getBoundingClientRect(); return head.closest('.reader-note')?.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); };
      const heads = [...document.querySelectorAll(`${selector} .notehead`)].filter(reachable).map(head => head.getBoundingClientRect()).filter(r => r.right < viewport.right - 4);
      const r = heads.sort((a, b) => b.right - a.right)[0];
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, edge: viewport.right - r.right };
    }, NOTES);
    await page.mouse.click(rightmost.x, rightmost.y);
    await page.waitForFunction(before => document.querySelector('.ps-status-cursor')?.textContent !== before, position, { timeout: 5000 });
    await page.waitForTimeout(1000);
    assert.equal(await scrollLeft(), 0, `a click (on a note ${Math.round(rightmost.edge)}px from the right edge) does not scroll`);
    // Undo restores the cursor to the end of the score, far out of view: the view follows it.
    await page.locator('.ps-editor').focus();
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => (window.__editor.ref.current.getMusicXml().match(/<pitch>/g) ?? []).length === 39, null, { timeout: 10000 });
    try { await cursorInView(); } catch { assert.fail(`Undo brought the cursor into view (scrollLeft ${await scrollLeft()})`); }
    assert.ok(await scrollLeft() > 400, 'Undo scrolled to the cursor');
    // A reader's momentum scroll (one wheel, then scroll events for 1.5 s, as iOS does after a flick) is never fought:
    // a cursor move 900 ms in (past the wheel's own 600 ms) does not scroll while the momentum runs.
    await settledScrollLeft();
    await page.evaluate(() => {
      const viewport = document.querySelector('.ps-editor .score-viewport');
      window.__followScrolls = 0;
      const original = viewport.scrollTo.bind(viewport);
      viewport.scrollTo = (...args) => { window.__followScrolls++; return original(...args); };
      const start = viewport.scrollLeft, t0 = performance.now();
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaX: -40, bubbles: true }));
      const step = () => {
        const t = performance.now() - t0;
        viewport.scrollLeft = Math.round(start * Math.max(0, 1 - t / 1500));
        if (t < 1500) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    await page.waitForTimeout(900);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.__followScrolls), 0, 'a cursor move during a momentum scroll does not scroll');
    assert.equal(await settledScrollLeft(), 0, 'the momentum scroll ran to its end');
    // Once it has stopped, a move follows again.
    await page.waitForTimeout(700);
    await page.keyboard.press('ArrowRight');
    try { await cursorInView(); } catch { assert.fail(`after the momentum a move follows the cursor (scrollLeft ${await scrollLeft()})`); }
    // Playback owns the view: a cursor move while playing does not scroll to the cursor (the playhead is in view).
    await page.evaluate(() => document.querySelector('.ps-editor .score-viewport').scrollTo({ left: 0 }));
    await page.waitForFunction(() => document.querySelector('.ps-editor .score-viewport').scrollLeft === 0, null, { timeout: 5000 });
    const first = await page.evaluate(selector => {
      const r = document.querySelector(`${selector} .notehead`).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, NOTES);
    await page.mouse.click(first.x, first.y);
    await page.waitForTimeout(700);
    await page.locator('.ps-editor').focus();
    await page.keyboard.press('Space');
    await page.waitForSelector('.ps-editor .ps-btn-play.is-playing', { timeout: 10000 });
    for (let i = 0; i < 9; i++) await page.keyboard.press('Control+ArrowRight');
    await page.waitForTimeout(1200);
    const duringPlayback = await scrollLeft();
    await page.keyboard.press('Space');
    await page.waitForSelector('.ps-editor .ps-btn-play:not(.is-playing)', { timeout: 10000 });
    assert.equal(duringPlayback, 0, 'a cursor move during playback does not scroll away from the playhead');
    await wide.close();
  }

  assert.ok(renderTimes.length > 0, 'the editor reported its change-to-redraw time');
  // A new score source skips the viewer's redraw fade, so an edit engraves well inside a quarter second. Slow machines
  // (CI) get a warning above PS_EDITOR_RENDER_MS and fail only above twice it.
  const slow = renderTimes.filter(ms => ms >= RENDER_MS);
  if (slow.length) console.warn(`Editor: ${slow.length} change-to-redraw time(s) at or over ${RENDER_MS} ms: ${slow.join(', ')}`);
  assertTiming(renderTimes.every(ms => ms < 2 * RENDER_MS), `every change-to-redraw time is under ${2 * RENDER_MS} ms (got ${renderTimes.join(', ')})`);
  assert.deepEqual(errors, [], 'no page or console errors');
  console.log(`Editor: shell (keycaps, layout selector, popover placement, add/remove bar, title edit and cancel, medium-width inspector drawer), Layout tab (swap to Alto Sax beginner, moved-note highlights and status, Review, Make a copy and undo, piano-only custom layout and its clicks), entry, undo, accidentals and chord entry, click cursor, follow the cursor (Endless entry, arrow, click, Undo), key and time popovers, export, save and reopen, unsaved-work guard, staff cap (open and initial) and read-only pass (the phone shell: validation/editor-phone.mjs) (render ms: ${renderTimes.join(', ')})`);
} finally {
  await browser.close();
  await server.close();
}
