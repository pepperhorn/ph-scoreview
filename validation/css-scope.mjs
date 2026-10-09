// Static checks on the library stylesheets: everything is scoped under .pepperscore, nothing targets the page,
// sizes come from the root (container queries / data-ps-* attributes), and generic class names are prefixed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const files = ['packages/pepperscore/src/styles.css', 'packages/pepperscore/src/components/open-score-dialog.css'];
const GENERIC = ['toast', 'toast-text', 'toast-dismiss', 'error', 'error-text', 'range', 'switch', 'switch-row', 'selected', 'open', 'on', 'portrait', 'landscape', 'eyebrow'];
const problems = [];
for (const file of files) {
  const root = postcss.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { from: file });
  root.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
    for (const selector of rule.selectors) {
      if (!/^\.pepperscore(?![\w-])/.test(selector)) problems.push(`${file}: unscoped selector "${selector}"`);
      if (/(^|[\s,>+~(])(html|body)(?![\w-])|:root/.test(selector)) problems.push(`${file}: page-level selector "${selector}"`);
      for (const name of GENERIC) if (new RegExp(`\\.${name}(?![\\w-])`).test(selector)) problems.push(`${file}: generic class .${name} in "${selector}"`);
    }
  });
  root.walkAtRules(rule => {
    if (rule.name === 'media' && /width|height|orientation|aspect/.test(rule.params)) problems.push(`${file}: viewport query @media ${rule.params}`);
    if (/keyframes$/.test(rule.name) && !rule.params.startsWith('ps-')) problems.push(`${file}: @keyframes ${rule.params} must start with ps-`);
    if (rule.name === 'font-face') problems.push(`${file}: @font-face belongs in asset-fonts.ts`);
  });
  root.walkDecls(decl => {
    if (decl.prop === 'position' && decl.value === 'fixed') problems.push(`${file}: position:fixed in ${decl.parent.selector}`);
    if (/\d(d|s|l)?v(h|w|min|max)\b/.test(decl.value)) problems.push(`${file}: viewport unit in ${decl.parent.selector} { ${decl.prop}: ${decl.value} }`);
  });
}
assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
console.log('CSS scope: every rule under .pepperscore, no page selectors, viewport units, fixed positions or generic names');
