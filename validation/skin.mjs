// Public JS imports, exact fallback preservation, and real host-variable/computed-colour checks.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import postcss from 'postcss';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { root, serveDist } from './serve-dist.mjs';
import { THEME_TOKENS, BAR_ITEM_IDS, CRF_PITCH_COLOURS, mergeSkins, skinStyle, skinKey } from 'pepperscore';
assert.ok(THEME_TOKENS.includes('accent') && BAR_ITEM_IDS.includes('pdf'));
assert.equal(mergeSkins({ pitchColours: CRF_PITCH_COLOURS }, { bar: ['play'] }).pitchColours.C, '#f86e6e');
assert.deepEqual(skinStyle({ theme: { accent: 'var(--brand)' } }), { '--ps-accent': 'var(--brand)' });
assert.equal(skinKey(), skinKey({}));
// Persistent guard: future CSS additions must use a PepperScore colour variable.
// Transparent/currentColor are semantic paint values, not fixed colour choices.
const engravedColours = new Set(['.pepperscore .note-label', '.pepperscore .count-label', '.pepperscore .chord-symbol']);
function outsideThemeVariables(value) {
  let result = '';
  for (let i = 0; i < value.length;) {
    if (value.slice(i).startsWith('var(')) {
      let end = i + 4, depth = 1;
      while (end < value.length && depth) { if (value[end] === '(') depth++; if (value[end] === ')') depth--; end++; }
      if (/^var\(\s*--ps-/.test(value.slice(i, end))) { result += ' '; i = end; continue; }
    }
    result += value[i++];
  }
  return result.replace(/url\([^)]*\)/gi, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
}
function scanColours(css) {
  const candidates = [];
  postcss.parse(css).walkDecls(decl => {
    if (engravedColours.has(decl.parent.selector)) return;
    if (!/^(?:--|color$|background(?:-|$)|border(?:-|$)|outline(?:-|$)|(?:box|text)-shadow$|(?:fill|stroke)(?:-|$)|filter$|accent-color$|caret-color$|text-decoration(?:-|$)|(?:stop|flood|lighting)-color$|column-rule(?:-|$))/.test(decl.prop)) return;
    const value = outsideThemeVariables(decl.value);
    const literals = value.match(/#[a-f\d]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi) || [];
    for (const literal of literals) candidates.push({ selector: decl.parent.selector, property: decl.prop, literal, fixed: true });
    for (const word of value.match(/[a-z][a-z-]*/gi) || []) {
      if (!['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(word.toLowerCase())) candidates.push({ selector: decl.parent.selector, property: decl.prop, literal: word, fixed: false });
    }
  });
  return candidates;
}
const stylesheetCandidates = ['packages/pepperscore/src/styles.css', 'packages/pepperscore/src/components/open-score-dialog.css'].flatMap(file => scanColours(readFileSync(`${root}/${file}`, 'utf8')).map(candidate => ({ file, ...candidate })));
// Role separation matters even when the all-token sentinel is the same colour.
for (const file of ['packages/pepperscore/src/styles.css', 'packages/pepperscore/src/components/open-score-dialog.css']) {
  postcss.parse(readFileSync(`${root}/${file}`, 'utf8')).walkRules(rule => rule.walkDecls(decl => {
    if (/:hover|:focus-visible/.test(rule.selector) && /^background/.test(decl.prop)) assert.ok(!decl.value.includes('--ps-surface-raised'), `${rule.selector}: interactive wash is an accent role`);
    if (/is-selected/.test(rule.selector) && /^(?:border|box-shadow)/.test(decl.prop)) assert.ok(!/--ps-(?:border|shadow)[,)]/.test(decl.value), `${rule.selector}: selected edges use an accent role`);
    if (rule.selector === '.pepperscore .staff-focus.is-focused' && decl.prop === 'color') assert.match(decl.value, /--ps-accent,/);
    if (rule.selector.includes('.playback-line') && /^(?:background|box-shadow)$/.test(decl.prop)) assert.ok(!/--ps-(?:shadow|surface|warning)/.test(decl.value), 'playback owns its line and glow');
  }));
}
const packageCode = readFileSync(`${root}/packages/pepperscore/dist/index.js`, 'utf8');
assert.ok(packageCode.includes('Invalid theme colour') && packageCode.includes('process.env.NODE_ENV'), 'the built package retains consumer-development diagnostics');
const hostCode = readdirSync(`${root}/apps/reader/dist/_astro`).filter(file => file.endsWith('.js')).map(file => readFileSync(`${root}/apps/reader/dist/_astro/${file}`, 'utf8')).join('\n');
assert.ok(!hostCode.includes('Invalid theme colour'), 'a production host eliminates theme diagnostics');
const server = await serveDist();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const warnings = [];
  page.on('console', event => { if (event.type() === 'warning' && event.text().includes('Invalid theme colour')) warnings.push(event.text()); });
  async function literalLeaks(candidates) {
    return page.evaluate(candidates => candidates.filter(candidate => candidate.fixed || CSS.supports('color', candidate.literal)), candidates);
  }
  assert.deepEqual(await literalLeaks(stylesheetCandidates), [], 'all interface colour literals are inside var(--ps-*, fallback)');
  assert.equal((await literalLeaks(scanColours('.pepperscore .leak{color:rebeccapurple;background:color(srgb 1 0 0);border-color:#123}'))).length, 3, 'the static guard rejects named, hex and modern colour literals');
  assert.deepEqual(await literalLeaks(scanColours('.pepperscore .safe{color:var(--ps-accent,color(srgb 1 0 0));background:transparent}')), [], 'nested theme fallbacks are allowed');
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.url}/embed-skin`);
  await page.waitForFunction(() => window.__skin && document.querySelector('.skin-reader .score-system svg') && !document.querySelector('.skin-reader .score-loading'));
  await page.waitForFunction(() => window.__skin.renders > 0);
  await page.addStyleTag({ content: '.pepperscore,.pepperscore *{transition:none!important}' });
  const accent = () => page.locator('.skin-reader .play-button').evaluate(el => getComputedStyle(el).backgroundColor);
  assert.equal(await accent(), 'rgb(35, 90, 188)');
  await page.locator('.skin-reader .header-open-file').hover();
  assert.equal(await page.locator('.skin-reader .header-open-file').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(224, 236, 255)', 'the blue host reaches hover washes');
  await page.locator('.skin-reader .instrument-control').first().click();
  const selected = page.locator('.instrument-picker-grid button.is-selected,.instrument-chooser-option.is-selected').first();
  await selected.waitFor();
  assert.equal(await selected.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(187, 212, 255)', 'selection uses the strong host wash');
  assert.equal(await selected.evaluate(el => getComputedStyle(el).borderColor), 'rgb(35, 90, 188)', 'selection edges use the host accent');
  assert.equal(await page.locator('.instrument-picker-panel').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)', 'neutral panels remain neutral');
  await page.keyboard.press('Escape');
  const playback = await page.locator('.skin-reader').evaluate(root => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    function rgba(colour) {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = colour; ctx.fillRect(0, 0, 1, 1);
      const alpha = ctx.getImageData(0, 0, 1, 1).data[3];
      ctx.fillStyle = `rgb(from ${colour} r g b / 1)`; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3), alpha];
    }
    const colours = value => (value.match(/(?:rgba?|color)\([^)]*\)/g) || []).map(rgba);
    const note = root.querySelector('.reader-note'); note.classList.add('is-playing');
    const line = document.createElement('div'); line.className = 'playback-line'; root.append(line);
    const dialog = document.createElement('div'); dialog.className = 'open-dialog'; root.append(dialog);
    const original = { note: getComputedStyle(note).fill, filter: getComputedStyle(note).filter, line: getComputedStyle(line).backgroundColor };
    root.style.setProperty('--ps-playback', '#2060a0'); root.style.setProperty('--ps-shadow', '#d02040');
    const themed = { note: getComputedStyle(note).fill, stroke: getComputedStyle(note).stroke, filter: colours(getComputedStyle(note).filter), line: getComputedStyle(line).backgroundColor, glow: colours(getComputedStyle(line).boxShadow), button: colours(getComputedStyle(root.querySelector('.play-button')).boxShadow), dialog: colours(getComputedStyle(dialog).boxShadow) };
    note.classList.remove('is-playing');
    note.classList.add('ps-cursor'); root.style.setProperty('--ps-cursor', '#ff0066');
    const cursor = getComputedStyle(note).fill;
    note.classList.remove('is-playing', 'ps-cursor'); line.remove(); dialog.remove();
    for (const token of ['--ps-playback', '--ps-shadow', '--ps-cursor']) root.style.removeProperty(token);
    return { original, themed, cursor };
  });
  assert.equal(playback.original.note, 'rgb(184, 114, 24)');
  assert.ok(playback.original.filter.includes('rgb(230, 170, 79)'));
  assert.equal(playback.original.line, 'rgb(200, 121, 37)');
  assert.equal(playback.themed.note, 'rgb(32, 96, 160)');
  assert.equal(playback.themed.stroke, 'rgb(32, 96, 160)');
  assert.deepEqual(playback.themed.filter, [[32, 96, 160, 255]]);
  assert.equal(playback.themed.line, 'rgb(32, 96, 160)');
  assert.deepEqual(playback.themed.glow, [[32, 96, 160, 153], [32, 96, 160, 128]], 'playback glow keeps both original alpha levels');
  assert.deepEqual(playback.themed.button, [[208, 32, 64, 36]]);
  assert.deepEqual(playback.themed.dialog, [[208, 32, 64, 64]], 'shadow alpha levels stay distinct under an opaque token');
  assert.equal(playback.cursor, 'rgb(255, 0, 102)', 'legacy cursor overrides still win');
  await page.evaluate(() => { window.__originalSvg = document.querySelector('.skin-reader .score-system svg'); window.__renderCount = window.__skin.renders; document.querySelector('.skin-host').style.setProperty('--accent-ink', '#bc235a'); });
  assert.equal(await accent(), 'rgb(188, 35, 90)');
  const stable = async () => assert.ok(await page.evaluate(() => window.__originalSvg === document.querySelector('.skin-reader .score-system svg') && window.__renderCount === window.__skin.renders), 'theme updates do not re-engrave');
  await stable();
  await page.evaluate(() => window.__skin.setSkin({ theme: Object.fromEntries(window.__skin.tokens.map(token => [token, '#123456'])) }));
  await page.waitForFunction(() => document.querySelector('.skin-reader').style.getPropertyValue('--ps-accent') === '#123456');
  await stable();
  async function audit(label) {
    const result = await page.locator('.skin-reader,.skin-minimal,.skin-none').evaluateAll(roots => {
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      function allowedColour(colour) {
        ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = colour; ctx.fillRect(0, 0, 1, 1);
        if (ctx.getImageData(0, 0, 1, 1).data[3] === 0) return true;
        ctx.fillStyle = `rgb(from ${colour} r g b / 1)`; ctx.fillRect(0, 0, 1, 1);
        const pixel = ctx.getImageData(0, 0, 1, 1).data;
        return [18, 52, 86].every((v, i) => Math.abs(pixel[i] - v) <= 1);
      }
      function coloursIn(value) {
        const colours = [];
        const functions = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/gi;
        let match;
        while ((match = functions.exec(value))) {
          let end = functions.lastIndex, depth = 1;
          while (end < value.length && depth) { if (value[end] === '(') depth++; if (value[end] === ')') depth--; end++; }
          colours.push(value.slice(match.index, end)); functions.lastIndex = end;
        }
        return colours;
      }
      const failures = [];
      let visited = 0;
      for (const root of roots) for (const el of [root, ...root.querySelectorAll('*')]) {
        if (el.closest('svg') || !el.getClientRects().length) continue;
        visited++;
        for (const pseudo of [null, '::before', '::after', '::placeholder']) {
          if (pseudo === '::placeholder' && (!el.matches('input,textarea') || !el.getAttribute('placeholder'))) continue;
          const style = getComputedStyle(el, pseudo);
          if (pseudo && pseudo !== '::placeholder' && ['none', 'normal'].includes(style.content)) continue;
          for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'boxShadow', 'backgroundImage', 'accentColor', 'caretColor', 'textDecorationColor']) {
            if (prop.startsWith('border') && (style[prop.replace('Color', 'Width')] === '0px' || style[prop.replace('Color', 'Style')] === 'none')) continue;
            if (prop === 'outlineColor' && (style.outlineWidth === '0px' || style.outlineStyle === 'none')) continue;
            const value = style[prop];
            const colours = coloursIn(value);
            for (const colour of colours) if (!allowedColour(colour)) failures.push(`${el.className}${pseudo || ''} ${prop}: ${value}`);
          }
        }
      }
      return { failures: [...new Set(failures)], visited };
    });
    assert.ok(result.visited > 40, `${label}: populated UI audit`);
    if (label === 'intentional icon leak') return result.failures;
    assert.deepEqual(result.failures, [], `${label}: every visible interface colour is themed`);
  }
  await audit('header, minimal and none');
  await page.locator('.skin-reader .stop-button').evaluate(el => { el.style.color = 'color(srgb 1 0 0)'; });
  assert.ok((await audit('intentional icon leak')).some(failure => failure.includes('stop-button')), 'icon-only modern-colour leaks are detected');
  await page.locator('.skin-reader .stop-button').evaluate(el => el.style.removeProperty('color'));
  await page.locator('.skin-reader .header-open-file').hover();
  await audit('hover');
  await page.keyboard.press('Tab');
  await audit('keyboard focus');
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.skin-reader .header-more-toggle').click();
  await page.locator('.skin-reader .header-secondary-panel').waitFor({ state: 'visible' });
  await audit('390px More, minimal and none');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.__skin.setSkin(undefined));
  await page.waitForFunction(() => !document.querySelector('.skin-reader').style.getPropertyValue('--ps-accent'));
  assert.equal(await accent(), 'rgb(52, 86, 66)');
  await stable();
  const nativeProof = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('.pepperscore button,.pepperscore input')];
    const snapshot = () => controls.map(el => { const s = getComputedStyle(el); return [s.color, s.backgroundColor, s.borderColor, s.accentColor, s.outlineColor, s.outlineStyle, s.outlineWidth]; });
    document.querySelector('.skin-reader .stop-button').focus();
    const before = snapshot();
    let removed = 0;
    for (const sheet of document.styleSheets) for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
      if (sheet.cssRules[i].cssText.includes('var(--ps-') && sheet.cssRules[i].cssText.includes('revert')) { sheet.deleteRule(i); removed++; }
    }
    const after = snapshot();
    return { removed, differences: controls.flatMap((el, i) => JSON.stringify(before[i]) === JSON.stringify(after[i]) ? [] : [[el.outerHTML.slice(0, 100), before[i], after[i]]]) };
  });
  assert.deepEqual(nativeProof.differences, [], 'native-control token rules preserve default computed colours exactly');
  assert.ok(nativeProof.removed >= 2);
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
  assert.deepEqual(warnings, [], 'production host never emits theme warnings');
  await assertDevelopmentWarning(browser);
  assert.deepEqual(errors, []);
  console.log('Skin: JS exports, typed fixture, static colour guard, desktop/mobile/all-chrome/icon and modern-colour audit, consumer dev/prod diagnostics, live host variables and no re-engrave passed');
} finally { await browser.close(); await server.close(); }

async function assertDevelopmentWarning(browser) {
  const host = await createServer({
    configFile: false, root, logLevel: 'error',
    server: { host: '0.0.0.0', port: 5211, strictPort: true },
    optimizeDeps: { include: ['react', 'react-dom/client', 'pepperscore'] },
    plugins: [{ name: 'skin-warning-consumer', configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/skin-warning-host.html') return next();
        try {
          const html = await server.transformIndexHtml('/skin-warning-host.html', `<!doctype html><html><head><title>Built package development consumer</title></head><body style="--bad-brand:not-a-colour"><div id="root"></div><script type="module">
            import React from 'react'; import { createRoot } from 'react-dom/client'; import { PepperScore } from 'pepperscore';
            createRoot(document.getElementById('root')).render(React.createElement(PepperScore, { chrome: 'none', persist: false, skin: { theme: { accent: 'var(--bad-brand)' } } }));
          </script></body></html>`);
          response.setHeader('Content-Type', 'text/html'); response.end(html);
        } catch (error) { next(error); }
      });
    } }],
  });
  try {
    await host.listen();
    const page = await browser.newPage();
    const diagnostic = page.waitForEvent('console', { predicate: event => event.type() === 'warning' && event.text().includes('Invalid theme colour for accent'), timeout: 30000 });
    await page.goto('http://127.0.0.1:5211/skin-warning-host.html');
    assert.match((await diagnostic).text(), /var\(--bad-brand\)/, 'the real built package warns in a development host');
    await page.close();
  } finally { await host.close(); }
}
