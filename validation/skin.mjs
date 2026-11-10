// Public JS imports, exact fallback preservation, and real host-variable/computed-colour checks.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import postcss from 'postcss';
import ts from 'typescript';
import { build, createServer } from 'vite';
import { chromium } from 'playwright-core';
import { root, serveDist } from './serve-dist.mjs';
import { THEME_TOKENS, BAR_ITEM_IDS, CRF_PITCH_COLOURS, mergeSkins, skinStyle, skinKey, tokenVariable } from 'pepperscore';
execFileSync(process.execPath, [`${root}/node_modules/vitest/vitest.mjs`, 'run', 'src/lib/bar-items.test.ts', 'src/lib/pitch-colours.test.ts'], { cwd: `${root}/packages/pepperscore`, stdio: 'inherit' });
assert.ok(THEME_TOKENS.includes('accent') && BAR_ITEM_IDS.includes('pdf'));
assert.equal(mergeSkins({ pitchColours: CRF_PITCH_COLOURS }, { bar: ['play'] }).pitchColours.C, '#f86e6e');
assert.deepEqual(skinStyle({ theme: { accent: 'var(--brand)' } }), { '--ps-accent': 'var(--brand)' });
assert.equal(skinKey(), skinKey({}));
// Persistent guard: future CSS additions must use a PepperScore colour variable.
// Transparent/currentColor are semantic paint values, not fixed colour choices.
const engravedColours = new Set(['.pepperscore .note-label', '.pepperscore .count-label', '.pepperscore .chord-symbol']);
const stylesheetFiles = ['packages/pepperscore/src/styles.css', 'packages/pepperscore/src/components/open-score-dialog.css'];
const knownVariables = new Set([
  ...THEME_TOKENS.map(tokenVariable),
  ...Object.keys(CRF_PITCH_COLOURS).map(pitch => '--ps-pitch-' + pitch.toLowerCase().replace('#', '-sharp')),
  '--ps-pitch-outline', '--ps-pitch-letter', '--ps-pitch-letter-outline',
  '--ps-bottom-toolbar-h', '--ps-cursor', '--ps-selection', '--ps-transposed', '--ps-out-of-range',
  '--ps-note-name-scale', '--ps-count-scale', '--ps-subdivision-scale', '--ps-chord-symbol-scale',
]);
for (const file of stylesheetFiles) postcss.parse(readFileSync(`${root}/${file}`, 'utf8')).walkRules(rule => {
  if (rule.selector !== '.pepperscore') return;
  rule.walkDecls(decl => {
    if (/^--ps-.*-a[0-9a-f]{2}$/.test(decl.prop)) {
      assert.ok(knownVariables.has(decl.prop.replace(/-a[0-9a-f]{2}$/, '')), `${decl.prop}: derived alpha base is registered`);
      knownVariables.add(decl.prop);
    }
  });
});
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
    const names = [...decl.value.matchAll(/var\(\s*(--ps-[\w-]+)/g)].map(match => match[1]);
    if (decl.prop.startsWith('--ps-')) names.push(decl.prop);
    for (const name of names) if (!knownVariables.has(name)) candidates.push({ selector: decl.parent.selector, property: decl.prop, literal: name, fixed: true });
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
    if (/is-selected/.test(rule.selector) && /^background/.test(decl.prop)) assert.ok(!/--ps-surface(?:-raised)?[,)]/.test(decl.value), `${rule.selector}: selected backgrounds use an accent role`);
    if (/is-selected/.test(rule.selector) && /^(?:border|box-shadow)/.test(decl.prop)) assert.ok(!/--ps-(?:border|shadow)[,)]/.test(decl.value), `${rule.selector}: selected edges use an accent role`);
    if (rule.selector === '.pepperscore .staff-focus.is-focused' && decl.prop === 'color') assert.match(decl.value, /--ps-accent,/);
    if (decl.prop === 'accent-color') assert.match(decl.value, /--ps-accent,/, `${rule.selector}: native fills use the accent role`);
    if (rule.selector === '.pepperscore .open-dialog-dropzone.is-drag-over') {
      if (decl.prop === 'background') assert.match(decl.value, /--ps-accent-wash,/);
      if (decl.prop === 'border-color') assert.match(decl.value, /--ps-accent,/);
    }
    if (rule.selector === '.pepperscore .open-dialog-drop-overlay' && decl.prop === 'background') assert.match(decl.value, /--ps-accent-wash,/);
    if (rule.selector === '.pepperscore .octave-toolbar-button.is-primary' && decl.prop === 'border') assert.match(decl.value, /--ps-accent,/);
    if (rule.selector.includes('.playback-line') && /^(?:background|box-shadow)$/.test(decl.prop)) assert.ok(!/--ps-(?:shadow|surface|warning)/.test(decl.value), 'playback owns its line and glow');
  }));
}
function assertProcessGuards() {
  const unguarded = [];
  function hasGuard(node) {
    if (!ts.isBinaryExpression(node)) return false;
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return hasGuard(node.left) || hasGuard(node.right);
    return node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken && ts.isTypeOfExpression(node.left) && ts.isIdentifier(node.left.expression) && node.left.expression.text === 'process' && ts.isStringLiteral(node.right) && node.right.text === 'undefined';
  }
  for (const file of readdirSync(`${root}/packages/pepperscore/src`, { recursive: true }).filter(file => /\.[jt]sx?$/.test(file))) {
    const source = ts.createSourceFile(file, readFileSync(`${root}/packages/pepperscore/src/${file}`, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isIdentifier(node) && node.text === 'process') {
        const parent = node.parent;
        const declaration = ts.isVariableDeclaration(parent) && parent.name === node && parent.parent.parent.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword);
        const propertyName = ts.isPropertyAccessExpression(parent) && parent.name === node;
        if (!declaration && !propertyName && !ts.isTypeOfExpression(parent)) {
          let guarded = false;
          for (let child = node, ancestor = parent; ancestor; child = ancestor, ancestor = ancestor.parent) {
            if (ts.isBinaryExpression(ancestor) && ancestor.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && ancestor.right === child && hasGuard(ancestor.left)) guarded = true;
            if (ts.isTryStatement(ancestor) && ancestor.tryBlock === child && ancestor.catchClause) guarded = true;
          }
          if (!guarded) unguarded.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(unguarded, [], 'every free package process read is protected by a short-circuit guard or try/catch');
}
assertProcessGuards();
const packageCode = readFileSync(`${root}/packages/pepperscore/dist/index.js`, 'utf8');
assert.ok(packageCode.includes('Invalid theme colour') && packageCode.includes('process.env.NODE_ENV'), 'the built package retains consumer-development diagnostics');
const hostCode = readdirSync(`${root}/apps/reader/dist/_astro`).filter(file => file.endsWith('.js')).map(file => readFileSync(`${root}/apps/reader/dist/_astro/${file}`, 'utf8')).join('\n');
assert.ok(!hostCode.includes('Unknown bar item'), 'production eliminates unknown-bar diagnostics');
assert.ok(!hostCode.includes('Invalid theme colour'), 'a production host eliminates theme diagnostics');
const server = await serveDist({ mounts: { '/native-dist/': `${root}/packages/pepperscore/dist` } });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  await assertLegacyPhoneChrome(browser, server);
  // Run the plain dev host before the dependency-only build initialises Vite build-mode state.
  await assertDevelopmentWarning(browser);
  await assertNativeHost(browser, server);
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
  for (const css of [
    '.pepperscore .typo{color:var(--ps-acent,#345642)}',
    '.pepperscore .nested{color:var(--ps-accent,var(--ps-acent,#345642))}',
    '.pepperscore .alpha{color:var(--ps-shadow-aff,#345642)}',
    '.pepperscore .note-label{font-size:calc(1px * var(--ps-note-nam-scale,1))}',
  ]) assert.equal((await literalLeaks(scanColours(css))).length, 1, 'unknown public/derived/scale names are rejected, including nested and SVG references');
  assert.deepEqual(await literalLeaks(scanColours('.pepperscore .valid{fill:var(--ps-cursor,#123);font-size:calc(1px * var(--ps-note-name-scale,1));box-shadow:0 1px var(--ps-shadow-a24,#34564224)}')), [], 'registered marks, scales and declared alpha variables are valid');
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.url}/embed-skin`);
  await page.waitForFunction(() => window.__skin && document.querySelector('.skin-reader .score-system svg') && !document.querySelector('.skin-reader .score-loading'));
  await page.waitForFunction(() => window.__skin.renders > 0);
  await page.addStyleTag({ content: '.pepperscore,.pepperscore *{transition:none!important}' });
  const accent = () => page.locator('.skin-reader .play-button').evaluate(el => getComputedStyle(el).backgroundColor);
  assert.equal(await accent(), 'rgb(35, 90, 188)');
  await page.locator('.skin-reader .header-open-file').hover();
  assert.equal(await page.locator('.skin-reader .header-open-file').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(224, 236, 255)', 'the blue host reaches hover washes');
  assert.equal(await page.locator('.skin-reader .mode-toggle button.is-selected').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(187, 212, 255)', 'selected segments use the host wash');
  for (const control of await page.locator('.skin-reader input[type=range],.skin-reader input[type=checkbox]').all()) assert.equal(await control.evaluate(el => getComputedStyle(el).accentColor), 'rgb(35, 90, 188)', 'native fill follows the host accent');
  await page.getByRole('button', { name: 'Open score file', exact: true }).click();
  const drag = await page.evaluateHandle(() => { const data = new DataTransfer(); data.items.add(new File(['X:1'], 'theme.abc', { type: 'text/plain' })); return data; });
  await page.locator('.open-dialog-dropzone').dispatchEvent('dragenter', { dataTransfer: drag });
  await page.locator('.open-dialog-dropzone').dispatchEvent('dragover', { dataTransfer: drag });
  await page.locator('.open-dialog-dropzone.is-drag-over').waitFor();
  assert.equal(await page.locator('.open-dialog-dropzone').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(224, 236, 255)', 'drag state uses the host wash');
  assert.equal(await page.locator('.open-dialog-drop-overlay').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(224, 236, 255)', 'the visible drag overlay uses the host wash');
  assert.equal(await page.locator('.open-dialog-dropzone').evaluate(el => getComputedStyle(el).borderColor), 'rgb(35, 90, 188)', 'drag state uses the host accent');
  await drag.dispose();
  await page.getByRole('button', { name: 'Close open score dialog' }).click();
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
    const themed = { note: getComputedStyle(note).fill, stroke: getComputedStyle(note).stroke, filter: colours(getComputedStyle(note).filter), line: getComputedStyle(line).backgroundColor, glow: colours(getComputedStyle(line).boxShadow), button: colours(getComputedStyle(root.querySelector('.play-button')).boxShadow), dialog: colours(getComputedStyle(dialog).boxShadow), segment: colours(getComputedStyle(root.querySelector('.mode-toggle button.is-selected')).boxShadow) };
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
  assert.deepEqual(playback.themed.segment, [[208, 32, 64, 22]], 'selected ambient shadows keep their alpha and shadow role');
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
  async function tabControls(label, expectedOutline) {
    const expected = await page.locator('.skin-reader').evaluate(root => {
      const controls = [...root.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(el => el.tabIndex >= 0 && !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      controls.forEach((el, index) => el.dataset.skinTabId = String(index));
      root.focus({ preventScroll: true });
      return controls.map(el => el.dataset.skinTabId);
    });
    assert.ok(expected.length > 15, `${label}: populated keyboard traversal`);
    const visited = new Map();
    for (let step = 0; step < expected.length + 5 && visited.size < expected.length; step++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el.closest('.skin-reader') || !el.hasAttribute('data-skin-tab-id')) return null;
        const style = getComputedStyle(el);
        const kind = el.matches('.header-stave-scale-input') ? 'header range' : el.matches('.ps-range') ? 'drawer range' : el.matches('input[type=checkbox]') ? 'checkbox' : el.tagName.toLowerCase();
        return { id: el.dataset.skinTabId, kind, focusVisible: el.matches(':focus-visible'), outline: [style.outlineColor, style.outlineStyle, style.outlineWidth, style.outlineOffset], paints: [style.color, style.backgroundColor, style.borderColor, style.accentColor, style.boxShadow] };
      });
      if (!focused) continue;
      assert.ok(focused.focusVisible, `${label}: Tab produced keyboard focus on ${focused.kind}`);
      if (expectedOutline && focused.outline[1] !== 'none' && focused.outline[2] !== '0px') assert.equal(focused.outline[0], expectedOutline, `${label}: ${focused.kind} outline is themed`);
      visited.set(focused.id, focused);
    }
    assert.deepEqual([...visited.keys()].sort(), [...expected].sort(), `${label}: every focusable control was reached by Tab`);
    const kinds = new Set([...visited.values()].map(control => control.kind));
    for (const kind of ['button', 'select', 'header range', 'drawer range', 'checkbox', 'textarea', 'a']) assert.ok(kinds.has(kind), `${label}: actually focused ${kind}`);
    return [...visited.values()].sort((a, b) => Number(a.id) - Number(b.id));
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
  await tabControls('all-token drawer traversal', 'rgb(18, 52, 86)');
  await audit('focused drawer controls');
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
  await page.locator('.skin-reader .drawer-handle').click();
  for (const [label, theme] of [['no skin', undefined], ['accent without focusRing', { theme: { accent: '#235abc' } }]]) {
    await page.evaluate(theme => window.__skin.setSkin(theme), theme);
    await page.waitForFunction(theme => { const style = document.querySelector('.skin-reader').style; return !style.getPropertyValue('--ps-focus-ring') && style.getPropertyValue('--ps-accent') === (theme?.theme.accent ?? ''); }, theme);
    const before = await tabControls(`${label}, native rules present`);
    const removed = await page.evaluate(() => {
      const removed = [];
      for (const [sheetIndex, sheet] of [...document.styleSheets].entries()) for (let index = sheet.cssRules.length - 1; index >= 0; index--) {
        const rule = sheet.cssRules[index];
        if (rule.cssText.includes('var(--ps-') && rule.cssText.includes('revert')) { removed.push({ sheetIndex, index, text: rule.cssText }); sheet.deleteRule(index); }
      }
      return removed;
    });
    try {
      assert.ok(removed.length >= 3, 'native-rule comparison removed the colour and focus overrides');
      const baseline = await tabControls(`${label}, original native defaults`);
      assert.deepEqual(before, baseline, `${label}: every focused outline/paint matches the original defaults`);
    } finally {
      await page.evaluate(removed => { for (const rule of [...removed].reverse()) document.styleSheets[rule.sheetIndex].insertRule(rule.text, rule.index); }, removed);
    }
  }
  console.log('Skin focus: Tab reaches every focusable control including select, both ranges, checkbox, textarea and link; no-skin and accent-only outlines match original defaults');
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
  await page.evaluate(() => window.__skin.setSkin({ theme: Object.fromEntries(window.__skin.tokens.map(token => [token, '#123456'])) }));
  await page.waitForFunction(() => document.querySelector('.skin-reader').style.getPropertyValue('--ps-accent') === '#123456');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.skin-reader .header-more-toggle').click();
  await page.locator('.skin-reader .header-secondary-panel').waitFor({ state: 'visible' });
  await audit('390px More, minimal and none');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.deepEqual(warnings, [], 'production host never emits theme warnings');
  assert.deepEqual(errors, []);
  console.log('Skin: JS exports, typed fixture, static colour guard, desktop/mobile/all-chrome/icon and modern-colour audit, consumer dev/prod diagnostics, live host variables and no re-engrave passed');
  // T2: live bar composition shares all actions with the existing header/drawer.
  await page.goto(`${server.url}/embed-skin?bar`);
  await page.waitForFunction(() => window.__skin && document.querySelector('.skin-reader .score-system svg') && document.querySelector('.skin-minimal .instrument-switch'));
  const expectedBar = ['play', 'tempo', 'instrumentSwitch', 'noteNames', 'counts', 'chordSymbols', 'options'];
  for (const root of ['.skin-reader', '.skin-minimal']) {
    assert.deepEqual(await page.locator(`${root} [data-bar-item]`).evaluateAll(nodes => nodes.map(el => el.dataset.barItem)), expectedBar);
    assert.equal(await page.locator(`${root} .ps-compact-play`).count(), 0);
    await page.locator(`${root} .instrument-switch`).click();
    const menu = page.locator(`${root} .instrument-menu`);
    await menu.waitFor({ state: 'visible' });
    const rect = await menu.boundingBox();
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1280 && rect.y + rect.height <= 900, 'switch menu stays on screen');
    await menu.locator('.instrument-chooser-option').filter({ hasText: 'Flute' }).first().click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(`${root} .instrument-switch`).getAttribute('aria-expanded'), 'false');
  }
  assert.equal(await page.locator('.skin-none [data-bar-item],.skin-none .topbar').count(), 0);
  assert.ok(await page.locator('.skin-minimal').evaluate(root => {
    const box = root.getBoundingClientRect(), header = root.querySelector('.topbar').getBoundingClientRect(), viewport = root.querySelector('.score-viewport').getBoundingClientRect();
    return header.height > 0 && viewport.top >= header.bottom - 1 && viewport.bottom <= box.bottom + 1;
  }), 'natural-height minimal includes its skin header and score');

  for (const [name, pref, label, mark] of [['Note names', 'names', 'Note names', '.note-label'], ['Counts', 'counts', 'Beat counts', '.count-label'], ['Chord symbols', 'chordSymbols', 'Chord symbols', '.chord-symbol']]) {
    const toggle = page.locator('.skin-reader .skin-bar').getByRole('button', { name, exact: true });
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    await page.locator(`.skin-reader ${mark}`).first().waitFor();
    await page.locator('.skin-reader .skin-options').click();
    const drawerToggle = page.locator('.skin-reader .bottom-drawer').getByRole('switch', { name: label, exact: true });
    assert.equal(await drawerToggle.getAttribute('aria-checked'), 'true');
    await drawerToggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    await drawerToggle.click();
    await page.locator('.skin-reader .bottom-drawer').getByRole('button', { name: 'Close options', exact: true }).click();
  }
  for (const [name, label] of [['Note names', 'Note names'], ['Counts', 'Beat counts'], ['Chord symbols', 'Chord symbols']]) {
    const toggle = page.locator('.skin-minimal .skin-bar').getByRole('button', { name, exact: true });
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    await page.locator('.skin-minimal .skin-options').click();
    const drawerToggle = page.locator('.skin-minimal .bottom-drawer').getByRole('switch', { name: label, exact: true });
    assert.equal(await drawerToggle.getAttribute('aria-checked'), 'true');
    await drawerToggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    await page.locator('.skin-minimal .bottom-drawer').getByRole('button', { name: 'Close options', exact: true }).click();
  }
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.skin-reader .skin-chord-symbols')?.getAttribute('aria-pressed') === 'true');
  for (const selector of ['.skin-note-names', '.skin-counts', '.skin-chord-symbols']) assert.equal(await page.locator('.skin-reader ' + selector).getAttribute('aria-pressed'), 'true', 'prefs survive reload');
  // A visible item can still be covered by the drawer tab: prove pointer reachability.
  const hitItems = async (root, label) => {
    await root.locator('.skin-playback-toolbar').scrollIntoViewIfNeeded();
    const hits = await root.locator('.skin-playback-toolbar [data-bar-item]').evaluateAll(items => items.map(item => {
      const r = item.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { id: item.dataset.barItem, reachable: Boolean(hit && item.contains(hit)) };
    }));
    assert.ok(hits.length > 0 && hits.every(item => item.reachable), `${label}: ${JSON.stringify(hits)}`);
  };
  for (const width of [320, 390, 580]) {
    await page.setViewportSize({ width, height: 844 });
    for (const selector of ['.skin-reader', '.skin-minimal']) {
      const root = page.locator(selector);
      await root.locator('.skin-playback-toolbar .play-button').waitFor({ state: 'visible' });
      await hitItems(root, `${width}px ${selector}`);
      const play = root.locator('.skin-playback-toolbar .play-button');
      await play.click();
      await root.getByRole('button', { name: 'Pause playback', exact: true }).waitFor();
      await root.locator('.reader-note.is-playing').first().waitFor();
      await play.click();
      await root.getByRole('button', { name: 'Play score', exact: true }).waitFor();
    }
  }
  // Exercise a genuinely wrapped five-action toolbar, plus its floating UI.
  await page.setViewportSize({ width: 320, height: 844 });
  await page.evaluate(() => {
    window.__skin.setControls({ octaveTool: true, openFile: true });
    window.__skin.setSkin({ bar: ['play', 'stop', 'tempo', 'transpose', 'keyFlip', 'instrumentSwitch', 'options', 'octaveTool'] });
  });
  for (const selector of ['.skin-reader', '.skin-minimal']) {
    const root = page.locator(selector);
    await hitItems(root, `wrapped ${selector}`);
    assert.ok(await root.locator('.skin-playback-toolbar').evaluate(el => el.getBoundingClientRect().height > 65), 'toolbar wraps to multiple rows');
    // Enabling the existing octave entry closes its options drawer.
    await root.locator('.drawer-handle').click();
    await root.locator('.octave-tool-entry-drawer button').click();
    await root.locator('.bottom-drawer').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
    await root.locator('.octave-tool-dock').waitFor({ state: 'visible' });
    const assertAbove = async selector => {
      assert.ok(await root.evaluate((el, selector) => {
        const toolbar = el.querySelector('.skin-playback-toolbar').getBoundingClientRect();
        const floating = el.querySelector(selector).getBoundingClientRect();
        return floating.bottom <= toolbar.top - 8;
      }, selector), `${selector} clears the actual wrapped toolbar`);
    };
    await assertAbove('.octave-tool-dock');
    await hitItems(root, `octave dock ${selector}`);
    // Drawer availability can change without changing a fixed-height root or toolbar size.
    await page.evaluate(() => window.__skin.setControls({ octaveTool: true, openFile: true, drawer: false }));
    await page.waitForFunction(selector => {
      const el = document.querySelector(selector), toolbar = el.querySelector('.skin-playback-toolbar');
      return el.querySelector('.app-shell.no-drawer') && Math.abs(parseFloat(el.style.getPropertyValue('--ps-bottom-toolbar-h')) - (el.getBoundingClientRect().bottom - toolbar.getBoundingClientRect().top)) < 1;
    }, selector);
    await assertAbove('.octave-tool-dock');
    // Trigger an actual error toast without changing the loaded score.
    await root.locator('input[type=file]').setInputFiles({ name: 'broken.musicxml', mimeType: 'application/xml', buffer: Buffer.from('<score-partwise><part') });
    await root.locator('.ps-toast').waitFor({ state: 'visible' });
    await assertAbove('.ps-toast');
    await hitItems(root, `toast ${selector}`);
    await root.locator('.ps-toast-dismiss').click();
    await root.getByRole('button', { name: 'Done', exact: true }).click();
    await page.evaluate(() => window.__skin.setControls({ octaveTool: true, openFile: true }));
  }
  await page.evaluate(bar => { window.__skin.setControls({}); window.__skin.setSkin({ bar }); }, expectedBar);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.skin-reader .skin-playback-toolbar .play-button').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.skin-reader .topbar .play-button').count(), 0, 'phone play is mounted only in the bottom toolbar');
  assert.equal(await page.locator('.skin-reader .topbar .instrument-switch').isVisible(), true, 'occasional instrument control stays in the header');
  assert.equal(await page.locator('.skin-reader .skin-playback-toolbar .bpm-control').isVisible(), true, 'tempo accompanies playback');
  assert.ok(await page.locator('.skin-reader').evaluate(root => {
    const toolbar = root.querySelector('.skin-playback-toolbar').getBoundingClientRect();
    const viewport = root.querySelector('.score-viewport').getBoundingClientRect();
    return toolbar.top >= viewport.bottom - 1 && toolbar.width <= root.clientWidth;
  }), 'phone playback toolbar sits below the score without clipping');
  await page.locator('.skin-reader .header-more-toggle').click();
  await page.locator('.skin-reader .skin-options').waitFor({ state: 'visible' });
  assert.ok(await page.locator('.skin-reader').evaluate(el => el.scrollWidth <= el.clientWidth), '390px bar does not clip');
  await page.locator('.skin-reader .skin-options').click();
  await page.locator('.skin-reader .bottom-drawer.is-open').waitFor();
  await page.locator('.skin-reader .bottom-drawer').getByRole('button', { name: 'Close options', exact: true }).click();
  await page.evaluate(() => window.__skin.setSkin({ bar: ['counts', 'future-control', 'play', 'counts'] }));
  await page.waitForFunction(() => document.querySelectorAll('.skin-reader [data-bar-item]').length === 2);
  assert.deepEqual(await page.locator('.skin-reader [data-bar-item]').evaluateAll(nodes => nodes.map(el => el.dataset.barItem)), ['counts', 'play']);
  await page.setViewportSize({ width: 640, height: 900 });
  await page.evaluate(() => window.__skin.setSkin({ bar: ['play', 'tempo', 'noteNames', 'counts', 'instrumentSwitch'] }));
  await page.locator('.skin-reader .header-more-toggle').click();
  await page.locator('.skin-reader .instrument-switch').click();
  await page.locator('.skin-reader .instrument-menu .instrument-chooser-option-flute').click();
  assert.equal(await page.locator('.skin-reader .header-more').getAttribute('data-open'), 'true', 'instrument popover interaction keeps its More anchor visible');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__skin.setSkin({ bar: ['play', 'options', 'instrumentSwitch', 'counts'] }); window.__skin.setControls({ transport: false, drawer: false, instrumentSwitch: false }); });
  await page.waitForFunction(() => document.querySelectorAll('.skin-reader [data-bar-item]').length === 1);
  for (const root of ['.skin-reader', '.skin-minimal']) {
    assert.deepEqual(await page.locator(`${root} [data-bar-item]`).evaluateAll(nodes => nodes.map(el => el.dataset.barItem)), ['counts'], 'explicit false wins');
    assert.equal(await page.locator(`${root} .bottom-drawer`).count(), 0);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { window.__skin.setControls({}); window.__skin.setSkin({ bar: ['options'] }); });
  const extras = page.locator('.skin-reader .playback-view-panel');
  await page.locator('.skin-reader .skin-options').click();
  await extras.waitFor({ state: 'visible' });
  assert.deepEqual(await extras.locator('[data-drawer-control]').evaluateAll(nodes => nodes.map(el => el.dataset.drawerControl)), ['stop', 'viewToggle', 'bars', 'zoom', 'mixer', 'openFile']);
  assert.equal(await page.locator('.skin-reader input[type=file]').count(), 1, 'one input even when Open is omitted from the bar');
  assert.equal(await page.locator('.skin-reader .header-stave-scale-input').count(), 1, 'one zoom ref');
  await extras.getByRole('button', { name: 'Endless view', exact: true }).click();
  await page.locator('.skin-reader .ps-landscape').waitFor();
  assert.equal(await extras.getByLabel('Bars per line', { exact: true }).isDisabled(), true);
  await extras.getByRole('button', { name: 'Vertical view', exact: true }).click();
  await extras.getByLabel('Bars per line', { exact: true }).selectOption('2');
  assert.equal(await extras.getByLabel('Bars per line', { exact: true }).inputValue(), '2');
  const zoomSlider = extras.getByRole('slider', { name: 'Stave scale', exact: true });
  const oldZoom = await zoomSlider.inputValue();
  await zoomSlider.focus();
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await zoomSlider.inputValue(), oldZoom, 'drawer zoom updates the scale');
  await extras.getByRole('button', { name: 'Stop playback', exact: true }).click();
  await extras.getByRole('button', { name: 'Track mixer', exact: true }).click();
  await page.locator('.skin-reader .mixer-panel').waitFor({ state: 'visible' });
  await page.locator('.skin-reader').getByRole('button', { name: 'Close track mixer', exact: true }).click();
  await page.locator('.skin-reader .skin-options').click();
  await extras.getByRole('button', { name: 'Open score file', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.skin-reader').getByRole('button', { name: /browse/i }).click();
  await chooser;
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__skin.setSkin({ bar: ['pdf'] }));
  await page.waitForFunction(() => document.querySelector('.skin-reader .topbar:not(.skin-topbar)') && document.querySelector('.skin-minimal .ps-compact-play'));
  assert.equal(await page.locator('.skin-reader .playback-view-panel').count(), 0, 'unshowable bars restore the default drawer too');
  await page.evaluate(() => window.__skin.setControls({ instrumentSwitch: true }));
  await page.locator('.skin-minimal .ps-corner-controls .instrument-switch').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.skin-minimal .ps-compact-play').isVisible(), true, 'empty-bar fallback also retains explicitly enabled default controls');
  await page.evaluate(() => window.__skin.setControls({}));
  await page.evaluate(() => window.__skin.setSkin(undefined));
  await page.waitForFunction(() => !document.querySelector('.skin-reader .playback-view-panel'));
  assert.deepEqual(errors, []);
  console.log('Skin phone r1: full/minimal 320/390/580px item-centre hit tests and playback; wrapped dock/toast offsets passed');
  console.log('Skin drawer: omitted actions, single refs, mode/bars/zoom/stop/mixer/file chooser, empty-bar preset fallback and no-skin restoration passed');
  console.log('Skin bar: ordered full/minimal bars, instrument selection, drawer sync, derived chords, persisted toggles, 390px More and unknown/duplicate ids passed');
} finally { await browser.close(); await server.close(); }

async function assertDevelopmentWarning(browser) {
  const host = await createServer({
    configFile: false, root, logLevel: 'error', mode: 'development',
    server: { host: '0.0.0.0', port: 0 },
    optimizeDeps: { include: ['react', 'react-dom/client', 'pepperscore'], force: true },
    plugins: [{ name: 'skin-warning-consumer', configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/skin-warning-host.html') return next();
        try {
          const html = await server.transformIndexHtml('/skin-warning-host.html', `<!doctype html><html><head><title>Built package development consumer</title></head><body style="--bad-brand:not-a-colour"><div id="root"></div><script type="module">
            import React from 'react'; import { createRoot } from 'react-dom/client'; import { PepperScore } from 'pepperscore';
            createRoot(document.getElementById('root')).render(React.createElement(PepperScore, { chrome: 'none', persist: false, skin: { theme: { accent: 'var(--bad-brand)' }, bar: ['future-control'] } }));
          </script></body></html>`);
          response.setHeader('Content-Type', 'text/html'); response.end(html);
        } catch (error) { next(error); }
      });
    } }],
  });
  try {
    await host.listen();
    const page = await browser.newPage();
    const barDiagnostic = page.waitForEvent('console', { predicate: event => event.type() === 'warning' && event.text().includes('Unknown bar item: future-control'), timeout: 30000 });
    const diagnostic = page.waitForEvent('console', { predicate: event => event.type() === 'warning' && event.text().includes('Invalid theme colour for accent'), timeout: 30000 });
    await page.goto(`http://127.0.0.1:${host.httpServer.address().port}/skin-warning-host.html`);
    assert.equal(await page.evaluate(() => typeof process), 'undefined', 'plain development host has no process shim');
    assert.match((await diagnostic).text(), /var\(--bad-brand\)/, 'the real built package warns in a development host');
    assert.match((await barDiagnostic).text(), /Unknown bar item/);
    await page.close();
  } finally { await host.close(); }
}

/** Only dependencies are prebuilt; the package under test is served byte-for-byte. */
async function assertNativeHost(browser, server) {
  const entries = { react: 'react', reactDom: 'react-dom', reactClient: 'react-dom/client', jsx: 'react/jsx-runtime', icons: 'lucide-react', zip: 'fflate' };
  const names = Object.fromEntries(await Promise.all(Object.values(entries).map(async id => [id, Object.keys(await import(id)).filter(name => name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name))])));
  const result = await build({
    configFile: false, root, logLevel: 'error', define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [{ name: 'native-host-dependencies',
      resolveId(id) { const index = id.indexOf('virtual:skin-dep/'); if (index >= 0) return '\0' + id.slice(index); },
      load(id) { if (id.startsWith('\0virtual:skin-dep/')) { const dependency = id.slice('\0virtual:skin-dep/'.length); return `export { ${names[dependency].join(', ')} } from ${JSON.stringify(dependency)};`; } },
    }],
    build: { write: false, lib: { entry: Object.fromEntries(Object.entries(entries).map(([name, id]) => [name, `virtual:skin-dep/${id}`])), formats: ['es'], fileName: (_format, name) => `${name}.js` } },
  });
  const assets = new Map((Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output).map(file => [file.fileName, file.type === 'chunk' ? file.code : file.source]));
  const imports = Object.fromEntries(Object.entries(entries).map(([name, id]) => [id, `${server.url}/native-deps/${name}.js`]));
  imports.pepperscore = `${server.url}/native-dist/index.js`;
  const cases = [
    { name: 'no process, no skin' },
    { name: 'no process, with skin', skin: { theme: { accent: 'var(--native-brand)' } } },
    { name: 'development shim, invalid skin', environment: 'development', skin: { theme: { accent: 'not-a-colour' } }, warns: true },
    { name: 'production shim, invalid skin', environment: 'production', skin: { theme: { accent: 'not-a-colour' } } },
  ];
  for (const fixture of cases) {
    const page = await browser.newPage();
    const errors = [], warnings = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', event => { if (event.type() === 'warning' && event.text().includes('Invalid theme colour')) warnings.push(event.text()); });
    try {
      const response = await page.request.get(imports.pepperscore);
      assert.equal(await response.text(), packageCode, 'native host receives the original dist/index.js bytes');
      await page.route('**/native-deps/**', route => {
        const name = new URL(route.request().url()).pathname.slice('/native-deps/'.length);
        assert.ok(assets.has(name), `dependency asset ${name} exists`);
        return route.fulfill({ contentType: 'text/javascript', body: assets.get(name) });
      });
      await page.route('**/native-skin-host.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><title>Native ESM consumer</title><script type="importmap">${JSON.stringify({ imports })}</script></head><body style="--native-brand:#235abc"><div id="root"></div><script>${fixture.environment ? `globalThis.process = { env: { NODE_ENV: ${JSON.stringify(fixture.environment)} } };` : ''}</script><script type="module">
        import * as React from 'react'; import { createRoot } from 'react-dom/client'; import { PepperScore } from 'pepperscore';
        createRoot(document.getElementById('root')).render(React.createElement(React.Fragment, null,
          React.createElement('p', { id: 'host-sibling' }, 'Host remains mounted'),
          React.createElement(PepperScore, ${JSON.stringify({ chrome: 'none', height: '120px', persist: false, skin: fixture.skin })})));
        setTimeout(() => { window.__nativeSettled = true; }, 100);
      </script></body></html>` }));
      await page.goto(`${server.url}/native-skin-host.html`);
      await page.waitForFunction(() => window.__nativeSettled, null, { timeout: 10000 }).catch(error => { assert.deepEqual(errors, [], fixture.name + ': native module load errors'); throw error; });
      assert.deepEqual(errors, [], fixture.name + ': no runtime error');
      assert.equal(await page.locator('.pepperscore').count(), 1, fixture.name + ': player stays mounted after effects');
      assert.equal(await page.locator('#host-sibling').textContent(), 'Host remains mounted', fixture.name + ': host tree stays mounted');
      assert.equal(await page.evaluate(() => typeof process), fixture.environment ? 'object' : 'undefined', fixture.name + ': actual global environment');
      assert.equal(warnings.length > 0, fixture.warns ?? false, fixture.name + ': diagnostics respect the runtime environment');
      if (fixture.name === 'no process, with skin') assert.equal(await page.locator('.pepperscore').evaluate(el => getComputedStyle(el).getPropertyValue('--ps-accent').trim()), '#235abc');
    } finally { await page.close(); }
  }
  console.log('Skin native ESM: unchanged dist mounts with/without skin and no process global; explicit development/production shims gate diagnostics');
}


/** AC1: visibility, rather than a constructed JSX node, owns the legacy toolbar. */
async function assertLegacyPhoneChrome(browser, server) {
  for (const { width, hasTouch } of [{ width: 390, hasTouch: false }, { width: 850, hasTouch: false }, { width: 1280, hasTouch: true }]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch });
    try {
      const page = await context.newPage();
      await page.goto(`${server.url}/embed-skin`);
      await page.waitForFunction(() => window.__skin && document.querySelector('.skin-reader .score-system svg') && !document.querySelector('.skin-reader .score-loading'));
      for (const skin of [undefined, { bar: ['pdf'] }]) {
        await page.evaluate(skin => window.__skin.setSkin(skin), skin);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const full = page.locator('.skin-reader');
        const label = `${width}px touch=${hasTouch} ${skin ? 'PDF fallback' : 'no skin'}`;
        assert.equal(await full.locator('.ps-embed-toolbar').count(), 0, `${label}: full has no bottom toolbar`);
        assert.equal(await full.locator('.instrument-switch').count(), 0, `${label}: full has no compact switcher`);
        assert.equal(await full.locator('.topbar:not(.skin-topbar) .play-button').count(), 1, `${label}: full keeps normal transport`);
      }
      // The same gate must retain the existing minimal phone toolbar and working menu.
      await page.evaluate(() => { window.__skin.setSkin(undefined); window.__skin.setControls({ instrumentSwitch: true }); });
      const minimal = page.locator('.skin-minimal');
      const button = minimal.locator('.ps-embed-toolbar .instrument-switch');
      await button.waitFor({ state: 'visible' });
      await button.click();
      await minimal.locator('.instrument-menu').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      assert.equal(await button.getAttribute('aria-expanded'), 'false', 'minimal menu still opens and closes');
      if (width === 390) {
        await page.goto(server.url);
        await page.waitForFunction(() => document.querySelector('.score-system svg') && !document.querySelector('.score-loading'));
        assert.equal(await page.locator('.pepperscore .ps-embed-toolbar').count(), 0, "390px main reader retains main's absence of an embed toolbar");
        assert.equal(await page.locator('.pepperscore .instrument-switch').count(), 0, "390px main reader retains main's absence of a compact switcher");
        assert.equal(await page.locator('.pepperscore .topbar .play-button').count(), 1, '390px main reader retains header playback');
        assert.equal(await page.locator('.pepperscore .drawer-handle').isVisible(), true, '390px main reader retains its Options tab');
      }
    } finally { await context.close(); }
  }
  console.log('Skin r2: no-skin/PDF full chrome at 390/850px and wide touch has no embed toolbar or switcher; minimal menu and 390px main reader defaults preserved');
}

// Real reader acceptance for pitch tiles, displayed chord heads and lazy systems.
{
  const host = await createServer({configFile:false,root,logLevel:'error',optimizeDeps:{include:['react','react-dom/client','pepperscore'],force:true},server:{host:'0.0.0.0',port:0},plugins:[{name:'pitch-host',configureServer(server){
    server.middlewares.use(async(req,res,next)=>{
      if(req.url?.split('?')[0]!=='/pitch-host') return next();
      const html = await server.transformIndexHtml('/pitch-host', `<!doctype html><div id="root"></div><script type="module">
      import React from 'react';import {createRoot} from 'react-dom/client';import {PepperScore,CRF_PITCH_COLOURS} from 'pepperscore';import 'pepperscore/style.css';
      const root=createRoot(document.getElementById('root'));let palette=CRF_PITCH_COLOURS,settings={};window.pitchHandle=React.createRef();
      const abc='X:1\\nT:Pitch colours\\nM:4/4\\nL:1/4\\nK:C\\n[CE] ^C _D D ^D E F ^F G ^G A ^A B | '+Array(100).fill('[CE] D E F |').join(' ');
      window.pitchRender=(patch={})=>{if('palette' in patch)palette=patch.palette;if(patch.settings)settings=patch.settings;root.render(React.createElement(PepperScore,{ref:window.pitchHandle,abc,skin:{pitchColours:palette,bar:['pitchColours','options','transpose']},settings,persist:'pitch-acceptance',height:'650px'}));};window.pitchRender();
      </script>`);res.setHeader('Content-Type','text/html');res.end(html);
    });
  }}]});
  await host.listen();const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const url=`http://127.0.0.1:${host.httpServer.address().port}/pitch-host`;
    await page.goto(url);await page.locator('.notehead[data-pitch]').first().waitFor();
    const tile=page.locator('.skin-bar .ps-pitch-colour-tile');
    assert.equal(await tile.getAttribute('aria-pressed'),'false');
    await page.evaluate(()=>{window.pitchSvg=document.querySelector('.score-system svg');});
    await tile.click();assert.equal(await tile.getAttribute('aria-pressed'),'true');
    const colours=await page.evaluate(()=>Array.from(document.querySelector('.chord').querySelectorAll('.notehead')).map(e=>[e.dataset.pitch,getComputedStyle(e).fill,getComputedStyle(e).stroke]));
    assert.deepEqual(colours.map(c=>c.slice(0,2)),[['C','rgb(248, 110, 110)'],['E','rgb(255, 245, 109)']]);
    assert.ok(colours.every(c=>c[2]!=='none'),'pale heads outlined');
    const chromatic=await page.evaluate(()=>Object.fromEntries(Array.from(document.querySelectorAll('.notehead[data-pitch]'),h=>[h.dataset.pitch,getComputedStyle(h).fill])));
    for(const [pitch,hex] of Object.entries(CRF_PITCH_COLOURS)){
      const expected=await page.evaluate(hex=>{const el=document.createElement('span');el.style.color=hex;document.body.append(el);const c=getComputedStyle(el).color;el.remove();return c;},hex);
      assert.equal(chromatic[pitch],expected,`${pitch}: chromatic palette fill`);
    }

    assert.deepEqual(await page.locator('.notehead[data-pitch="C#"]').allTextContents().then(a=>a.length>1),true,'enharmonic heads share the same pitch tag');
    for(const mark of ['is-playing','ps-selection','ps-transposed','ps-out-of-range']) {
      assert.equal(await page.evaluate(mark=>{const head=document.querySelector('.notehead');const event=head.closest('.reader-note');event.classList.add(mark);const equal=getComputedStyle(head).fill===getComputedStyle(event).fill;event.classList.remove(mark);return equal;},mark),true,`${mark} overrides pitch fill`);
    }
    await page.evaluate(()=>window.pitchHandle.current.setPitchColours(false));await page.waitForFunction(()=>!document.querySelector('[data-ps-pitch-colours]'));
    await page.evaluate(()=>window.pitchRender({settings:{pitchColours:true}}));await page.waitForFunction(()=>document.querySelector('[data-ps-pitch-colours]'));
    assert.ok(await page.evaluate(()=>window.pitchSvg===document.querySelector('.score-system svg')),'toggle/settings keep engraving');
    await page.locator('.skin-options').click();assert.equal(await page.locator('.annotations-panel .ps-pitch-colour-tile').getAttribute('aria-pressed'),'true');
    await page.locator('.annotations-panel .ps-pitch-colour-tile').click();assert.equal(await tile.getAttribute('aria-pressed'),'false');
    await page.evaluate(()=>window.pitchHandle.current.setPitchColours(true));
    await page.reload();await page.locator('.notehead[data-pitch]').first().waitFor();assert.equal(await tile.getAttribute('aria-pressed'),'true','saved toggle reloads');
    await page.evaluate(()=>{window.pitchSvg=document.querySelector('.score-system svg');window.pitchRender({palette:undefined});});await page.waitForFunction(()=>!document.querySelector('.ps-pitch-colour-tile'));
    assert.equal(await page.locator('[data-ps-pitch-colours]').count(),0,'saved true without palette draws plain heads');
    await page.evaluate(()=>window.pitchRender({palette:{C:'#112233','C#':'#112233',D:'#112233','D#':'#112233',E:'#112233',F:'#112233','F#':'#112233',G:'#112233','G#':'#112233',A:'#112233','A#':'#112233',B:'#112233'}}));
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.notehead')).fill==='rgb(17, 34, 51)');
    assert.ok(await page.evaluate(()=>window.pitchSvg===document.querySelector('.score-system svg')),'palette changes preserve engraving');
    await page.evaluate(()=>window.pitchHandle.current.transpose(2));await page.waitForFunction(()=>document.querySelector('.chord .notehead')?.dataset.pitch==='D');
    await page.evaluate(()=>window.pitchHandle.current.scrollToMeasure(90));
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('.score-system')).some(s=>Number(s.dataset.firstMeasure)>60 && s.querySelector('.notehead[data-pitch]')));
    assert.deepEqual(errors,[]);console.log('Pitch colours: chord/enharmonics, outlines, mark precedence, no re-engrave, drawer/bar/settings/handle/reload, no palette, transposition and lazy paging passed');
  }finally{await browser.close();await host.close();}
}
