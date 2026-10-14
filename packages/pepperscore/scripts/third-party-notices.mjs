// THIRD_PARTY_NOTICES.txt for what pepperscore puts in front of users: its runtime npm dependencies (walked from the
// installed node_modules, with each package's own licence file), Verovio (LGPL-3.0-or-later, loaded at runtime from
// dist/verovio/) with the music fonts it embeds, and Poppins. No dependencies: vite.config.ts writes it into dist/, and
// apps/reader/astro.config.mjs writes the demo's own copy (adding the editor's dependencies and React).
//
// CLI: node scripts/third-party-notices.mjs [out-file]   (default: stdout)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([.-].*)?$/i;
const RULE = '='.repeat(100);

/** The installed directory of `name` as seen from `from` (Node's node_modules lookup, without exports maps). */
function findPackage(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * Every installed package reachable from `names` through `dependencies` (and installed optional ones), sorted by name.
 * Each top-level name is looked up from the first directory of `from` (one or a list) that has it.
 */
export function runtimePackages(names, from = packageDir) {
  const seen = new Map();
  const visit = (name, base) => {
    const dir = findPackage(name, base);
    if (!dir) return;
    const manifest = readJson(join(dir, 'package.json'));
    const key = `${manifest.name}@${manifest.version}`;
    if (seen.has(key)) return;
    seen.set(key, { dir, manifest });
    for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) visit(dep, dir);
  };
  const bases = [from].flat();
  for (const name of names) visit(name, bases.find(base => findPackage(name, base)) ?? bases[0]);
  return [...seen.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name) || a.manifest.version.localeCompare(b.manifest.version));
}

/** The installed verovio package (a devDependency: the build copies its files into dist/verovio/). */
let verovioFound;
function verovioPackage() {
  if (verovioFound) return verovioFound;
  const dir = findPackage('verovio', packageDir);
  if (!dir) throw new Error('The verovio package is not installed (run npm install).');
  return verovioFound = { dir, manifest: readJson(join(dir, 'package.json')) };
}

const licenseOf = manifest => typeof manifest.license === 'string' ? manifest.license
  : manifest.license?.type ?? (Array.isArray(manifest.licenses) ? manifest.licenses.map(entry => entry.type ?? entry).join(' OR ') : 'UNKNOWN');
const repositoryOf = manifest => {
  const repo = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  return (repo || manifest.homepage || `https://www.npmjs.com/package/${manifest.name}`).replace(/^git\+/, '').replace(/\.git$/, '');
};
const licenseTexts = dir => readdirSync(dir).filter(file => LICENSE_FILE.test(file)).sort()
  .map(file => readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim());

const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

/** A package that ships no licence file: the MIT text with its author (as its README states), else a pointer. */
function fallbackLicense(manifest) {
  const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name;
  if (licenseOf(manifest) === 'MIT' && author) return `MIT License\n\nCopyright (c) ${author}\n\n${MIT_TEXT}\n\n(The package ships no licence file; text reproduced from its declared MIT licence.)`;
  return `(No licence file in the package; licensed ${licenseOf(manifest)}, see ${repositoryOf(manifest)}.)`;
}

/** The OFL fonts Verovio embeds (upstream fonts/README.md and each font's own metadata, Verovio 6.3.0). */
const VEROVIO_FONTS = [
  ['Leipzig', 'Verovio\'s own font, created by Etienne Darbellay, Jean-François Marti, Laurent Pugin and Klaus Rettinghaus (https://github.com/rism-digital/leipzig)'],
  ['Bravura', 'Copyright (c) 2021, Steinberg Media Technologies GmbH (http://www.steinberg.net/), with Reserved Font Name "Bravura"; designed by Daniel Spreadbury'],
  ['Gootville', 'Designed by Grzegorz Pruchniakowski for MuseScore; glyph templates based on SMuFL and Bravura (https://github.com/musescore/MuseScore/tree/master/fonts/gootville)'],
  ['Leland', 'Copyright (c) 2025, MuseScore BVBA (http://www.musescore.org/) (https://github.com/MuseScoreFonts/Leland)'],
  ['Petaluma', 'Copyright (c) 2021, Steinberg Media Technologies GmbH (http://www.steinberg.net/), with Reserved Font Name "Petaluma"'],
  ['Liberation (text glyphs)', 'Originally designed by Steve Matteson; Copyright (c) 2012 Red Hat, Inc. (https://github.com/liberationfonts/liberation-fonts)'],
];

/**
 * The notices text. `packages`: npm package names whose installed dependency trees are listed (pepperscore's runtime
 * `dependencies` by default), looked up from `from` (a directory or a list); `title`: what the notices are for.
 */
export function thirdPartyNotices({ title = 'pepperscore', packages, from = packageDir } = {}) {
  const own = readJson(join(packageDir, 'package.json'));
  const names = packages ?? Object.keys(own.dependencies ?? {});
  const verovio = verovioPackage().manifest;
  const listed = runtimePackages(names, from).filter(({ manifest }) => manifest.name !== 'verovio' && !manifest.name.startsWith('pepperscore'));
  const poppins = listed.find(({ manifest }) => manifest.name === '@fontsource/poppins');
  const lgpl = readFileSync(join(packageDir, 'LICENSES/LGPL-3.0.txt'), 'utf8').trim();
  const gpl = readFileSync(join(packageDir, 'LICENSES/GPL-3.0.txt'), 'utf8').trim();
  const ofl = poppins ? licenseTexts(poppins.dir).join('\n\n') : '';

  const out = [];
  out.push(`THIRD-PARTY SOFTWARE NOTICES: ${title}`, RULE, '');
  out.push(`${title} includes or loads the third-party software listed below. pepperscore's own code is MIT licensed`,
    '(Copyright (c) 2026 PepperHorn); that licence does not cover the components below, which keep their own licences.', '');
  out.push('SUMMARY', '-------', '');
  out.push(`  verovio ${verovio.version}  LGPL-3.0-or-later  ${repositoryOf(verovio)}`);
  out.push(`    music fonts embedded in Verovio: ${VEROVIO_FONTS.map(([name]) => name).join(', ')}  OFL-1.1`);
  for (const { manifest } of listed) out.push(`  ${manifest.name} ${manifest.version}  ${licenseOf(manifest)}  ${repositoryOf(manifest)}`);
  out.push('', '');

  out.push(RULE, `Verovio ${verovio.version} (LGPL-3.0-or-later)`, RULE, '');
  out.push(
    'Music engraving library, https://www.verovio.org/ . Copyright (c) Laurent Pugin and the Verovio contributors',
    '(RISM Digital Center). Licensed under the GNU Lesser General Public License, version 3 or (at your option) any later',
    'version; the LGPL-3.0 and GPL-3.0 texts are at the end of this file.',
    '',
    'pepperscore does not bundle Verovio into its own code. Its worker loads two unmodified upstream files at runtime,',
    `from npm verovio@${verovio.version} dist/: verovio-module.mjs (the WebAssembly module and its Emscripten glue) and`,
    'verovio.mjs (the JavaScript toolkit). They ship in pepperscore as dist/verovio/, with only a licence comment',
    'added at the top, next to a LICENSE file.',
    '',
    'Replacing Verovio: pass the URL of a directory holding an interface-compatible build of those two files as the',
    `PepperScore \`verovioBaseUrl\` prop (for example https://cdn.jsdelivr.net/npm/verovio@${verovio.version}/dist/ , or your own`,
    'modified build), or replace the files in a deployed site.',
    '',
    `Corresponding source: https://github.com/rism-digital/verovio/tree/version-${verovio.version}`,
    `(tag version-${verovio.version}; also published on npm as verovio@${verovio.version}). Verovio's source also`,
    'includes third-party components under their own permissive licences (see its include/ directory).',
    '',
    'Music fonts embedded in Verovio (SIL Open Font License 1.1; text below):',
    ...VEROVIO_FONTS.map(([name, credit]) => `  - ${name}: ${credit}`),
    '', '');

  if (poppins) {
    out.push(RULE, `Poppins font (via ${poppins.manifest.name} ${poppins.manifest.version}, SIL Open Font License 1.1)`, RULE, '',
      'Used for the reader interface. The licence below (with the Poppins copyright notice) also serves as the SIL Open',
      'Font License 1.1 text for the Verovio music fonts listed above.', '', ofl, '', '');
  }

  out.push(RULE, 'npm packages', RULE, '');
  for (const { dir, manifest } of listed) {
    if (manifest === poppins?.manifest) continue;
    const texts = licenseTexts(dir);
    out.push(`--- ${manifest.name} ${manifest.version} (${licenseOf(manifest)}) ${repositoryOf(manifest)}`, '');
    out.push(texts.length ? texts.join('\n\n') : fallbackLicense(manifest), '', '');
  }

  out.push(RULE, 'GNU LESSER GENERAL PUBLIC LICENSE, version 3 (applies to Verovio)', RULE, '', lgpl, '', '');
  out.push(RULE, 'GNU GENERAL PUBLIC LICENSE, version 3 (incorporated by the LGPL-3.0)', RULE, '', gpl, '');
  return out.join('\n');
}

/** The licence comment put at the top of each shipped Verovio file. */
export function verovioBanner(file) {
  const { version } = verovioPackage().manifest;
  return [
    '/*!',
    ` * Verovio ${version} - https://www.verovio.org/ - Copyright (c) Laurent Pugin and the Verovio contributors.`,
    ' * Licensed under the GNU Lesser General Public License v3.0 or later (LGPL-3.0-or-later); see LICENSE in this directory.',
    ` * Unmodified upstream file dist/${file} from the npm package verovio@${version}; only this comment was added.`,
    ` * Source: https://github.com/rism-digital/verovio/tree/version-${version}`,
    ' * This file can be replaced by an interface-compatible build: see the `verovioBaseUrl` prop of pepperscore.',
    ' */',
    '',
  ].join('\n');
}

/** The LICENSE placed next to the shipped Verovio files. */
export function verovioLicense() {
  const { version } = verovioPackage().manifest;
  return [
    `verovio-module.mjs and verovio.mjs in this directory are Verovio ${version} (https://www.verovio.org/),`,
    'Copyright (c) Laurent Pugin and the Verovio contributors (RISM Digital Center), copied unmodified from the npm',
    `package verovio@${version} (dist/) except for a licence comment added at the top of each file.`,
    '',
    'Verovio is licensed under the GNU Lesser General Public License, version 3 or (at your option) any later version.',
    'The LGPL-3.0 and the GPL-3.0 it incorporates follow. Verovio embeds the Leipzig, Bravura, Gootville, Leland and',
    'Petaluma music fonts and Liberation-derived text glyphs, under the SIL Open Font License 1.1 (see',
    'THIRD_PARTY_NOTICES.txt next to this directory).',
    '',
    `Corresponding source: https://github.com/rism-digital/verovio/tree/version-${version}`,
    '',
    'You may replace these files with a modified, interface-compatible build: pepperscore loads them at runtime, from',
    'this directory by default or from the directory given in its `verovioBaseUrl` prop.',
    '',
    '='.repeat(80), '',
    readFileSync(join(packageDir, 'LICENSES/LGPL-3.0.txt'), 'utf8').trim(), '',
    '='.repeat(80), '',
    readFileSync(join(packageDir, 'LICENSES/GPL-3.0.txt'), 'utf8').trim(), '',
  ].join('\n');
}

/** Directory of the installed verovio package's dist/ (the files the build copies). */
export const verovioDist = () => join(verovioPackage().dir, 'dist');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = thirdPartyNotices();
  if (process.argv[2]) writeFileSync(process.argv[2], text); else process.stdout.write(text);
}
