// Public JS imports, exact fallback preservation, and real host-variable/computed-colour checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { root, serveDist } from './serve-dist.mjs';
import { THEME_TOKENS, BAR_ITEM_IDS, CRF_PITCH_COLOURS, mergeSkins, skinStyle, skinKey } from 'pepperscore';
assert.ok(THEME_TOKENS.includes('accent') && BAR_ITEM_IDS.includes('pdf'));
assert.equal(mergeSkins({ pitchColours: CRF_PITCH_COLOURS }, { bar: ['play'] }).pitchColours.C, '#f86e6e');
assert.deepEqual(skinStyle({ theme: { accent: 'var(--brand)' } }), { '--ps-accent': 'var(--brand)' });
assert.equal(skinKey(), skinKey({}));
// Compare against base 320bd6f after removing only the new var wrappers. Existing
// score-mark variables are deliberately retained. The native rules are proved below.
const nativeRules = `/* Native control colours: revert keeps the browser's own defaults when no token is set. */
.pepperscore input[type=range]{color:var(--ps-text-muted,revert);background-color:var(--ps-surface,revert)}
.pepperscore button,.pepperscore input[type=checkbox]{color:var(--ps-text,revert)}
.pepperscore input[type=checkbox]{accent-color:var(--ps-accent,revert)}
`;
const variables = THEME_TOKENS.map(t => t.replace(/[A-Z]/g, c => '-' + c.toLowerCase())).join('|');
const wrappers = new RegExp(`var\\(--ps-(?:${variables}),((?:rgba?\\([^)]*\\)|[^()])+?)\\)`, 'g');
for (const [file, hash] of [
  ['packages/pepperscore/src/styles.css', '551e263aea3425cecbfba09eac35176d55780a3f90397ea24d41619d63f4c1bd'],
  ['packages/pepperscore/src/components/open-score-dialog.css', 'fa812e197df2618f1b40e88e51f24beda080952f1e28f020c1b2404c027c069b'],
]) {
  const css = readFileSync(`${root}/${file}`, 'utf8').replace(nativeRules, '').replace(wrappers, '$1');
  assert.equal(createHash('sha256').update(css).digest('hex'), hash, `${file}: default CSS is unchanged`);
}
const server = await serveDist();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.url}/embed-skin`);
  await page.waitForFunction(() => window.__skin && document.querySelector('.skin-reader .score-system svg') && !document.querySelector('.skin-reader .score-loading'));
  await page.waitForFunction(() => window.__skin.renders > 0);
  await page.addStyleTag({ content: '.pepperscore,.pepperscore *{transition:none!important}' });
  const accent = () => page.locator('.skin-reader .play-button').evaluate(el => getComputedStyle(el).backgroundColor);
  assert.equal(await accent(), 'rgb(35, 90, 188)');
  await page.evaluate(() => { window.__originalSvg = document.querySelector('.skin-reader .score-system svg'); window.__renderCount = window.__skin.renders; document.querySelector('.skin-host').style.setProperty('--accent-ink', '#bc235a'); });
  assert.equal(await accent(), 'rgb(188, 35, 90)');
  const stable = async () => assert.ok(await page.evaluate(() => window.__originalSvg === document.querySelector('.skin-reader .score-system svg') && window.__renderCount === window.__skin.renders), 'theme updates do not re-engrave');
  await stable();
  await page.evaluate(() => window.__skin.setSkin({ theme: Object.fromEntries(window.__skin.tokens.map(token => [token, '#123456'])) }));
  await page.waitForFunction(() => document.querySelector('.skin-reader').style.getPropertyValue('--ps-accent') === '#123456');
  await stable();
  async function audit(label) {
    const result = await page.locator('.skin-reader').evaluate(root => {
      const failures = [];
      let visited = 0;
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (el.closest('svg') || !el.getClientRects().length) continue;
        visited++;
        for (const pseudo of [null, '::before', '::after', '::placeholder']) {
          if (pseudo === '::placeholder' && (!el.matches('input,textarea') || !el.getAttribute('placeholder'))) continue;
          const style = getComputedStyle(el, pseudo);
          if (pseudo && pseudo !== '::placeholder' && ['none', 'normal'].includes(style.content)) continue;
          for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'boxShadow', 'backgroundImage', 'accentColor', 'caretColor', 'textDecorationColor']) {
            if (prop.startsWith('border') && (style[prop.replace('Color', 'Width')] === '0px' || style[prop.replace('Color', 'Style')] === 'none')) continue;
            if (prop === 'outlineColor' && (style.outlineWidth === '0px' || style.outlineStyle === 'none')) continue;
            if (prop === 'color' && !el.textContent?.trim() && !el.matches('input,textarea,select')) continue;
            const value = style[prop];
            const colours = value.match(/rgba?\([^)]*\)/g) || [];
            for (const colour of colours) if (colour !== 'rgb(18, 52, 86)' && colour !== 'rgba(0, 0, 0, 0)') failures.push(`${el.className}${pseudo || ''} ${prop}: ${value}`);
          }
        }
      }
      return { failures: [...new Set(failures)], visited };
    });
    assert.ok(result.visited > 30, `${label}: populated UI audit`);
    assert.deepEqual(result.failures, [], `${label}: every visible interface colour is themed`);
  }
  await audit('header');
  await page.locator('.skin-reader .drawer-handle').click();
  await audit('drawer');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open score file', exact: true }).click();
  await page.locator('.open-dialog').waitFor();
  await audit('open dialog');
  await page.getByRole('button', { name: 'Close open score dialog' }).click();
  await page.getByRole('button', { name: 'Track mixer', exact: true }).click();
  await page.locator('.mixer-panel').waitFor();
  await audit('mixer');
  await page.getByRole('button', { name: 'Close track mixer', exact: true }).click();
  await page.locator('.skin-reader .instrument-control').first().click();
  await page.locator('.instrument-picker-panel').waitFor();
  await audit('instrument picker');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__skin.setSkin(undefined));
  await page.waitForFunction(() => !document.querySelector('.skin-reader').style.getPropertyValue('--ps-accent'));
  assert.equal(await accent(), 'rgb(52, 86, 66)');
  await stable();
  const nativeProof = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('.pepperscore button,.pepperscore input')];
    const snapshot = () => controls.map(el => { const s = getComputedStyle(el); return [s.color, s.backgroundColor, s.borderColor, s.accentColor]; });
    const before = snapshot();
    let removed = 0;
    for (const sheet of document.styleSheets) for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
      if (sheet.cssRules[i].cssText.includes('var(--ps-') && sheet.cssRules[i].cssText.includes('revert')) { sheet.deleteRule(i); removed++; }
    }
    const after = snapshot();
    return { removed, differences: controls.flatMap((el, i) => JSON.stringify(before[i]) === JSON.stringify(after[i]) ? [] : [[el.outerHTML.slice(0, 100), before[i], after[i]]]) };
  });
  assert.deepEqual(nativeProof.differences, [], 'native-control token rules preserve default computed colours exactly');
  assert.equal(nativeProof.removed, 3);
  // Reload restores the native rules before testing further theme changes.
  await page.reload();
  await page.waitForFunction(() => window.__skin?.renders > 0);
  await page.addStyleTag({ content: '.pepperscore,.pepperscore *{transition:none!important}' });
  await page.evaluate(() => { window.__originalSvg = document.querySelector('.skin-reader .score-system svg'); window.__renderCount = window.__skin.renders; });
  await page.evaluate(() => { document.querySelector('.skin-host').style.setProperty('--broken-brand', 'not-a-colour'); window.__skin.setSkin({ theme: { text: 'var(--broken-brand)' } }); });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.skin-reader')).getPropertyValue('--ps-text').trim() === 'not-a-colour');
  assert.equal(await page.locator('.skin-reader').evaluate(el => getComputedStyle(el).color), 'rgb(0, 0, 0)', 'invalid host colour falls back to inheritance, not the var fallback');
  await page.evaluate(() => window.__skin.setSkin({ theme: { accent: '#abcdef' } }));
  await page.waitForFunction(() => document.querySelector('.skin-reader').style.getPropertyValue('--ps-accent') === '#abcdef');
  await stable();
  for (const who of ['skin-reader', 'skin-minimal', 'skin-none']) assert.equal(await page.locator('.' + who).evaluate(el => getComputedStyle(el).getPropertyValue('--ps-accent').trim()), '#abcdef');
  await page.evaluate(() => window.__skin.setSkin({ theme: { accent: '#abcdef' } }));
  await stable();
  assert.deepEqual(errors, []);
  console.log('Skin: JS exports, typed fixture, literal CSS fallbacks, sentinel UI/drawer/dialog/mixer colours, live host variables and no re-engrave passed');
} finally { await browser.close(); await server.close(); }
