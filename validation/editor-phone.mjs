// The score editor's phone shell (apps/reader /editor at 390x844 on a touch device): the two-row header collapses to a
// 28px strip after 4 s idle and a canvas scroll restores it; the Notes tab is three rows (durations; accidentals, octave
// and chord; a one-octave piano that fits 390px, switchable to letter buttons and remembered), and tapping quarter ->
// piano C enters a note, the black key C sharp, the letters' D; the header's Undo and Redo step through history; the
// header stays expanded while typing (each dispatch restarts the idle timer); a scroll the collapse itself causes (at the
// bottom of the score) does not reopen it; the Bar tab's repeat start adds a forward repeat; the Marks tab has tuplet,
// beam and Dyn (the dynamic strip); Escape closes the overflow menu, which holds the header open; Play then Stop leave
// focus on the editor, so after the collapse keys still enter notes;
// the Key chip opens an inline strip inside the toolbar; the toolbar stays put while the canvas scrolls; the Layout tab's
// swap chip opens the instrument swap as an inline strip (/tmp/editor-phone-layout.png). Screenshots go to
// /tmp/editor-phone.png (expanded), /tmp/editor-phone-collapsed.png and /tmp/editor-phone-notes.png (the Notes tab's
// piano). Runs against the build (npm run build first).
// BROWSER=chromium|firefox|webkit.
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
const waitForNotes = (page, n) => page.waitForFunction(([selector, n]) => document.querySelectorAll(selector).length === n, [NOTES, n], { timeout: 30000 });
const musicXml = page => page.evaluate(() => window.__editor.ref.current.getMusicXml());
const pause = ms => new Promise(done => setTimeout(done, ms));
const rectOf = (page, selector) => page.locator(selector).evaluate(element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });
const headerHeight = async page => (await rectOf(page, '.ps-phead')).height;
/** Taps the centre of the `index`th match of `selector` in the engraving (its SVG takes the pointer events). */
async function tapAt(page, selector, index) {
  const target = page.locator(selector).nth(index);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}
/** Waits until the header is expanded (two rows) or collapsed (the strip), its height transition included. */
const headerSettles = (page, state, timeout = 2000) => page.waitForFunction(state => {
  const header = document.querySelector('.ps-phead'), shell = document.querySelector('.ps-shell-phone');
  const height = header?.getBoundingClientRect().height ?? 0;
  return shell?.dataset.header === state && (state === 'full' ? height > 60 : height <= 30);
}, state, { timeout });
/** Scrolls the score's viewport by `px` along whichever axis overflows; false when nothing scrolls. */
const scrollCanvas = (page, px) => page.evaluate(px => {
  const viewport = document.querySelector('.ps-editor .score-viewport');
  const before = [viewport.scrollLeft, viewport.scrollTop];
  if (viewport.scrollWidth > viewport.clientWidth) viewport.scrollBy({ left: px }); else viewport.scrollBy({ top: px });
  return before[0] !== viewport.scrollLeft || before[1] !== viewport.scrollTop;
}, px);

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: engine === 'chromium' });
  const page = await context.newPage();
  // Counts viewer removals: the phone shell must be chosen before the first paint, so no shell (and no viewer) is
  // mounted only to be replaced. A swap inside one task leaves only the removal in the mutation records.
  await page.addInitScript(() => {
    window.__viewerRemovals = 0;
    new MutationObserver(records => {
      for (const record of records) for (const node of record.removedNodes) {
        if (node.nodeType === 1) window.__viewerRemovals += (node.matches('.ps-editor-viewer') ? 1 : 0) + node.querySelectorAll('.ps-editor-viewer').length;
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${server.url}/editor`);
  await page.waitForSelector('.ps-editor .ps-shell-phone .score-system svg', { timeout: 60000 });
  assert.equal(await page.locator('.ps-editor .ps-shell-desktop').count(), 0, 'a phone-sized container gets the phone shell only');
  assert.equal(await page.locator('.ps-editor .ps-rail, .ps-editor .ps-inspector, .ps-editor .ps-palette').count(), 0, 'no rail, inspector or palette on a phone');
  assert.equal(await page.evaluate(() => window.__viewerRemovals), 0, 'the viewer mounts once (no desktop shell first)');

  // 0. Ten more bars (the Bar tab's insert), so the Page view overflows and the canvas can scroll.
  await page.locator('.ps-ptab[data-tab="bar"]').tap();
  for (let i = 0; i < 10; i++) await page.locator('.ps-ptoolbar button[aria-label="Insert measure"]').tap();
  await page.waitForFunction(() => (window.__editor.ref.current.getMusicXml().match(/<measure\b/g) ?? []).length === 18, null, { timeout: 10000 });
  await page.locator('.ps-ptab[data-tab="value"]').tap();
  await page.waitForFunction(() => { const v = document.querySelector('.ps-editor .score-viewport'); return v && v.scrollHeight > v.clientHeight + 100; }, null, { timeout: 30000 });

  // 1. The header: two rows, at most 88px; 4.5 s idle collapses it to a strip of at most 30px.
  await page.locator('.ps-phead .ps-phead-crumb').tap(); // a header tap expands it and restarts the idle timer
  await headerSettles(page, 'full');
  const expanded = await headerHeight(page);
  assert.ok(expanded > 60 && expanded <= 88, `the expanded header is two rows, at most 88px (${expanded})`);
  assert.equal(await page.locator('.ps-phead-main .ps-phead-title').isVisible(), true, 'row 1 shows the title');
  assert.equal(await page.locator('.ps-phead-meta .ps-chip-key').isVisible(), true, 'row 2 shows the key chip');
  await page.screenshot({ path: '/tmp/editor-phone.png' });
  await pause(4500);
  const collapsed = await headerHeight(page);
  assert.ok(collapsed <= 30, `4.5 s idle collapses the header to at most 30px (${collapsed})`);
  assert.equal(await page.locator('.ps-shell-phone').getAttribute('data-header'), 'collapsed');
  assert.equal(await page.locator('.ps-phead-meta .ps-chip-key').isVisible(), true, 'the collapsed strip keeps the key chip');
  assert.equal(await page.locator('.ps-phead-main').evaluate(element => element.inert), true, 'the hidden first row is inert');
  await page.screenshot({ path: '/tmp/editor-phone-collapsed.png' });

  // 2. Scrolling the canvas restores the header; the toolbar does not move while the canvas scrolls.
  const toolbarBefore = await rectOf(page, '.ps-ptoolbar');
  assert.ok(toolbarBefore.bottom <= 844 + 0.5 && toolbarBefore.bottom >= 844 - 2, `the toolbar sits at the bottom of the screen (${JSON.stringify(toolbarBefore)})`);
  // A user scroll (the wheel here; a swipe on a phone) wakes the header.
  const canvas = await rectOf(page, '.ps-editor .score-viewport');
  await page.mouse.move(canvas.left + canvas.width / 2, canvas.top + canvas.height / 2);
  await page.mouse.wheel(0, 160);
  await headerSettles(page, 'full');
  assert.ok(await scrollCanvas(page, 40), 'the canvas scrolls');
  assert.deepEqual(await rectOf(page, '.ps-ptoolbar'), toolbarBefore, 'the toolbar rect is unchanged after the canvas scrolled');
  const tabs = await rectOf(page, '.ps-ptabs');
  assert.ok(tabs.height <= 32, `the tab strip is at most 32px (${tabs.height})`);

  // 2b. At the bottom of the score, the collapse grows the viewport and clamps scrollTop (a scroll event): the header
  // must not reopen for it, so it stays collapsed.
  await page.evaluate(() => { const v = document.querySelector('.ps-editor .score-viewport'); v.scrollTop = v.scrollHeight; });
  await headerSettles(page, 'collapsed', 6000);
  await pause(2000);
  assert.equal(await page.locator('.ps-shell-phone').getAttribute('data-header'), 'collapsed', 'the header stays collapsed at the bottom of the score');
  await page.evaluate(() => { document.querySelector('.ps-editor .score-viewport').scrollTop = 0; });

  // 3. Value -> quarter -> C enters a note; the dispatches keep the header expanded past the 4 s idle time.
  await page.locator('.ps-ptab[data-tab="value"]').tap();
  // The Entry/Edit switch sits in the toolbar (not the header), in reach on every tab.
  assert.equal(await page.locator('.ps-phead [aria-label="Toggle note entry"]').count(), 0, 'no mode switch in the header');
  const modeSwitch = page.locator('.ps-ptoolbar .ps-pmode[aria-label="Toggle note entry"]');
  if (await page.locator('.ps-editor').getAttribute('data-ps-mode') !== 'enter') await modeSwitch.tap();
  assert.equal((await modeSwitch.textContent()).trim(), 'Entry', 'the switch shows Entry');
  const quarter = page.locator('.ps-ptoolbar button[aria-label="Quarter note"]');
  const size = await quarter.boundingBox();
  assert.ok(size.width >= 44 && size.height >= 44, `toolbar buttons are 44px targets (${size.width}x${size.height})`);
  const rows = await page.locator('.ps-prows .ps-prow').count();
  assert.equal(rows, 3, `the Notes tab has three rows (${rows})`);
  for (const label of ['Sharp', 'Natural', 'Flat', 'Octave down', 'Octave up', 'Add to chord']) assert.equal(await page.locator(`.ps-prows button[aria-label="${label}"]`).count(), 1, `the Notes tab has ${label}`);
  assert.equal(await page.locator('.ps-prows button[aria-label="Undo"], .ps-prows button[aria-label="Redo"]').count(), 0, 'Undo and Redo moved to the header');
  // The piano (the default entry row) fits the 390px screen: 7 white and 5 black keys, all finger-sized.
  assert.equal(await page.locator('.ps-piano .ps-piano-key-white').count(), 7);
  assert.equal(await page.locator('.ps-piano .ps-piano-key-black').count(), 5);
  const toolbarRect = await rectOf(page, '.ps-ptoolbar');
  for (const key of await page.locator('.ps-piano .ps-piano-key, .ps-pbtn-entry-switch').all()) {
    const box = await key.boundingBox();
    const black = await key.evaluate(element => element.classList.contains('ps-piano-key-black'));
    assert.ok(box.x >= toolbarRect.left && box.x + box.width <= toolbarRect.right + 0.5, `a piano key lies within the screen (${JSON.stringify(box)})`);
    assert.ok(box.height >= 44 && box.width >= (black ? 30 : 38), `piano keys are finger-sized (${box.width}x${box.height})`);
  }
  // The toolbar's measured height pads the canvas, so the taller Notes tab never covers the score.
  const bodyPadding = await page.locator('.ps-phone-body').evaluate(element => parseFloat(getComputedStyle(element).paddingBottom));
  assert.ok(Math.abs(bodyPadding - toolbarRect.height) <= 1, `the canvas is padded by the toolbar height (${bodyPadding} vs ${toolbarRect.height})`);
  await quarter.tap();
  await pause(3000);
  await page.locator('.ps-piano button[aria-label="Piano C"]').tap();
  await waitForNotes(page, 1);
  assert.match(await musicXml(page), /<step>C<\/step>/, 'the tapped C is in the score');
  await page.screenshot({ path: '/tmp/editor-phone-notes.png' });
  await pause(2000);
  assert.ok((await headerHeight(page)) > 60, 'the header stays expanded while typing (5 s after the first tap, 2 s after the last)');
  // A black key in C major enters C sharp.
  await page.locator('.ps-piano button[aria-label="Piano C sharp"]').tap();
  await waitForNotes(page, 2);
  assert.match(await musicXml(page), /<step>C<\/step>\s*<alter>1<\/alter>/, 'the black key entered C sharp');
  // The header's Undo removes it, Redo restores it.
  await headerSettles(page, 'full');
  const undo = page.locator('.ps-phead .ps-phead-undo');
  assert.equal(await undo.isEnabled(), true, 'Undo is enabled after an edit');
  await undo.tap();
  await waitForNotes(page, 1);
  await headerSettles(page, 'full');
  await page.locator('.ps-phead .ps-phead-redo').tap();
  await waitForNotes(page, 2);
  // The switch shows letter buttons instead, remembered across a reload's storage read.
  await page.locator('.ps-pbtn-entry-switch[aria-label="Use letter buttons"]').tap();
  assert.equal(await page.locator('.ps-piano').count(), 0, 'the letter buttons replace the piano');
  assert.equal(await page.evaluate(() => localStorage.getItem('pepperscore-editor:phone-entry-input')), 'letters', 'the choice is stored');
  await page.locator('.ps-ptoolbar button[aria-label="Note D"]').tap();
  await waitForNotes(page, 3);
  await page.locator('.ps-pbtn-entry-switch[aria-label="Use piano keys"]').tap();
  await page.locator('.ps-piano').waitFor();

  // 3b. Tapping a note in the score switches to Edit (the toolbar switch says so), where a piano key repitches that
  // note instead of entering one; tapping a rest in an empty bar switches back to Entry.
  await tapAt(page, `${NOTES} .notehead`, 0);
  await page.waitForFunction(() => document.querySelector('.ps-editor')?.dataset.psMode === 'select', null, { timeout: 10000 });
  assert.equal((await page.locator('.ps-ptoolbar .ps-pmode').textContent()).trim(), 'Edit', 'the switch shows Edit');
  await page.locator('.ps-piano button[aria-label="Piano E"]').tap();
  await page.waitForFunction(() => /<step>E<\/step>/.test(window.__editor.ref.current.getMusicXml()), null, { timeout: 10000 });
  assert.equal(await page.locator(NOTES).count(), 3, 'Edit repitched the tapped note; nothing was entered');
  await page.locator('.ps-ptab[data-tab="value"]').tap();
  await tapAt(page, '.ps-editor .reader-note:is(.rest, .mRest)', 0); // the rest after the last note
  await page.waitForFunction(() => document.querySelector('.ps-editor')?.dataset.psMode === 'enter', null, { timeout: 10000 });
  assert.equal((await page.locator('.ps-ptoolbar .ps-pmode').textContent()).trim(), 'Entry', 'the switch shows Entry');

  // 4. The Bar tab's repeat start toggles a forward repeat on the cursor bar.
  await page.locator('.ps-ptab[data-tab="bar"]').tap();
  const repeat = page.locator('.ps-ptoolbar button[aria-label="Repeat start"]');
  await repeat.tap();
  await page.waitForFunction(() => /<repeat direction="forward"/.test(window.__editor.ref.current.getMusicXml()), null, { timeout: 10000 });
  assert.equal(await repeat.getAttribute('aria-pressed'), 'true', 'the repeat start button shows it is on');
  await repeat.tap();
  await page.waitForFunction(() => !/<repeat direction="forward"/.test(window.__editor.ref.current.getMusicXml()), null, { timeout: 10000 });

  // 4b. The Marks tab has tie, slur, tuplet, beam and articulation keycaps, and its Dyn chip opens the dynamic strip.
  await page.locator('.ps-ptab[data-tab="marks"]').tap();
  for (const label of ['Tie', 'Slur', 'Tuplet (3)', 'Beam grouping 2/3/4/auto', 'Dynamic', 'Staccato']) assert.equal(await page.locator(`.ps-ptoolbar button[aria-label="${label}"]`).count(), 1, `the Marks tab has ${label}`);
  await page.locator('.ps-ptoolbar button[aria-label="Dynamic"]').tap();
  await page.locator('.ps-ptoolbar .ps-pstrip[aria-label="Dynamic"]').waitFor();
  await page.locator('.ps-pstrip .ps-pstrip-close').tap();
  await page.locator('.ps-pstrip').waitFor({ state: 'detached' });

  // 5. The header's Key chip opens the key fields as an inline strip inside the toolbar, never over the score.
  await page.locator('.ps-phead .ps-chip-key').tap();
  const strip = page.locator('.ps-ptoolbar .ps-pstrip[aria-label="Key signature"]');
  await strip.waitFor();
  assert.equal(await page.locator('.ps-popover').count(), 0, 'no floating popover on a phone');
  const [stripBox, toolbarBox] = [await rectOf(page, '.ps-ptoolbar .ps-pstrip'), await rectOf(page, '.ps-ptoolbar')];
  assert.ok(stripBox.left >= toolbarBox.left && stripBox.right <= toolbarBox.right && stripBox.top >= toolbarBox.top && stripBox.bottom <= toolbarBox.bottom,
    `the key strip lies inside the toolbar (${JSON.stringify({ stripBox, toolbarBox })})`);
  await page.selectOption('.ps-pstrip .ps-select-fifths', '2');
  await page.waitForFunction(() => /<fifths>2<\/fifths>/.test(window.__editor.ref.current.getMusicXml()), null, { timeout: 10000 });
  await page.locator('.ps-pstrip .ps-pstrip-apply').tap();
  await strip.waitFor({ state: 'detached' });
  await page.locator('.ps-phead .ps-chip-key').tap();
  await strip.waitFor();
  await page.locator('.ps-pstrip .ps-pstrip-close').tap();
  await strip.waitFor({ state: 'detached' });

  // 6. The overflow menu focuses its first item and holds the header open; Escape closes it without leaving entry mode.
  await page.locator('.ps-phead .ps-phead-crumb').tap(); // the header's centre now lands on the key chip
  await headerSettles(page, 'full');
  const mode = await page.locator('.ps-editor').getAttribute('data-ps-mode');
  await page.locator('.ps-phead-more').tap();
  await page.locator('.ps-pmenu').waitFor();
  assert.match(await page.evaluate(() => document.activeElement?.className ?? ''), /ps-pmenu-item/, 'the menu focuses its first item');
  await pause(4500);
  assert.equal(await page.locator('.ps-shell-phone').getAttribute('data-header'), 'full', 'the header stays open while the menu is');
  await page.keyboard.press('Escape');
  await page.locator('.ps-pmenu').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.ps-editor').getAttribute('data-ps-mode'), mode, 'Escape closed the menu only');

  // 6b. Play then Stop from the header return focus to the editor, so the collapse (which makes the first row inert)
  // never strands it: 4.5 s later the root still has focus, entry mode holds and c enters a note.
  await page.locator('.ps-phead .ps-phead-crumb').tap();
  await headerSettles(page, 'full');
  if (await page.locator('.ps-editor').getAttribute('data-ps-mode') !== 'enter') await page.locator('.ps-ptoolbar .ps-pmode').tap();
  assert.equal(await page.locator('.ps-editor').getAttribute('data-ps-mode'), 'enter');
  const pitchesBefore = ((await musicXml(page)).match(/<pitch>/g) ?? []).length;
  await page.locator('.ps-phead-play').tap();
  await page.locator('.ps-phead-play[aria-label="Stop"]').waitFor({ timeout: 30000 });
  await page.locator('.ps-phead-play').tap();
  await page.locator('.ps-phead-play[aria-label="Play"]').waitFor({ timeout: 10000 });
  await pause(4500);
  assert.equal(await page.locator('.ps-shell-phone').getAttribute('data-header'), 'collapsed', 'the header collapsed after Stop');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('ps-editor') ?? false), true, `focus is on the editor root (${await page.evaluate(() => document.activeElement?.className)})`);
  assert.equal(await page.locator('.ps-editor').getAttribute('data-ps-mode'), 'enter', 'still in entry mode');
  await page.keyboard.press('c');
  await page.waitForFunction(n => (window.__editor.ref.current.getMusicXml().match(/<pitch>/g) ?? []).length === n + 1, pitchesBefore, { timeout: 10000 });

  assert.equal(await page.evaluate(() => window.__viewerRemovals), 0, 'the viewer never remounted');
  // 7. The Layout tab on the Tenor Sax + Piano fixture: row 1 toggles staves, row 2's swap chip opens the swap card
  // as an inline strip in the toolbar; Alto Sax at beginner highlights the moved notes.
  await page.evaluate(() => { window.confirm = () => true; });
  await page.evaluate(() => document.querySelector('.editor-demo-tenor').click()); // the demo hides its header buttons on a phone
  await page.waitForFunction(() => /Tenor Sax/.test(window.__editor.ref.current?.getMusicXml() ?? ''), null, { timeout: 10000 });
  await page.locator('.ps-ptab[data-tab="layout"]').tap();
  assert.equal(await page.locator('.ps-prow-staves .ps-pchip-stave').count(), 3, 'one stave chip per staff');
  await page.locator('.ps-pchip-swap').tap();
  const swapStrip = page.locator('.ps-ptoolbar .ps-pstrip-swap');
  await swapStrip.waitFor();
  await page.selectOption('.ps-pstrip-swap .ps-swap-instrument', 'alto-saxophone');
  await page.locator('.ps-pstrip-swap .ps-swap-level .ps-seg-item:has-text("Beginner")').tap();
  await page.waitForFunction(() => document.querySelectorAll('.ps-editor .reader-note.note.ps-transposed').length > 0, null, { timeout: 10000 });
  await page.locator('.ps-editor .score-loading').waitFor({ state: 'detached', timeout: 10000 });
  const [swapBox, barBox] = [await rectOf(page, '.ps-pstrip-swap'), await rectOf(page, '.ps-ptoolbar')];
  assert.ok(swapBox.top >= barBox.top && swapBox.bottom <= barBox.bottom, 'the swap strip lies inside the toolbar');
  await page.screenshot({ path: '/tmp/editor-phone-layout.png' });
  await page.locator('.ps-pstrip-swap .ps-pstrip-close').tap();
  await swapStrip.waitFor({ state: 'detached' });
  assert.match(await page.locator('.ps-pchip-swap').textContent(), /Tenor Sax → Alto Sax · Beginner · Fit on/, 'the swap chip summarises the swap');

  assert.deepEqual(errors, [], 'no page or console errors');
  await context.close();
  console.log(`Editor phone: one viewer mount, two-row header (${expanded}px) collapses to ${collapsed}px, a user scroll restores it and a clamp scroll does not, three-row Notes tab with a 390px piano (keys, black-key spelling, letters switch remembered), header Undo/Redo, toolbar Entry/Edit switch and tap-to-Edit/Entry, toolbar entry keeps it expanded, repeat start, tuplet/beam/dynamic, inline key strip in the toolbar, menu Escape and hold, Play/Stop keeps focus through the collapse, fixed toolbar, Layout tab stave chips and swap strip pass`);
} finally {
  await browser.close();
  await server.close();
}
