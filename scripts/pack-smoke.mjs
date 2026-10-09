// npm pack the library, install the tarball into temporary Vite + React and Astro + React apps, build them, and check the output.
// Needs the network (the hosts install react, vite and astro from the npm registry). Nothing is published.
// PACK_SMOKE_HOSTS=vite (or astro) runs one host only; the default runs both.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args, cwd) => execFileSync(npm, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
const readJson = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const hosts = (process.env.PACK_SMOKE_HOSTS || 'vite,astro').split(',').map(host => host.trim());
// No --prefer-offline: a stale cached packument can miss a just-published dependency (ETARGET); cached tarballs are reused anyway.
const install = (app, tarball, packages) => run(['install', '--no-audit', '--no-fund', tarball, ...packages], app);
const react = ['react@^19.2.0', 'react-dom@^19.2.0'];

/** The host build copies both worker chunks, ships the package stylesheet and resolves Poppins through @fontsource. */
function assertHostOutput(label, dir) {
  const files = readdirSync(dir);
  assert.ok(files.some(file => /verovio\.worker.*\.js$/.test(file)), `${label} build emits the Verovio worker: ${files}`);
  assert.ok(files.some(file => /import\.worker.*\.js$/.test(file)), `${label} build emits the import worker`);
  assert.ok(files.some(file => file.endsWith('.css') && readFileSync(join(dir, file), 'utf8').includes('.pepperscore')), `${label} build emits the package stylesheet`);
  assert.ok(files.some(file => /poppins.*\.woff2$/i.test(file)), `${label}: Poppins arrives through @fontsource`);
}

function viteHost(work, tarball) {
  const app = join(work, 'vite-app');
  mkdirSync(join(app, 'src'), { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'pepperscore-smoke-vite', private: true, type: 'module' }));
  writeFileSync(join(app, 'index.html'), '<!doctype html><div id="app"></div><script type="module" src="/src/main.js"></script>');
  writeFileSync(join(app, 'src/main.js'), [
    "import { createElement } from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import { PepperScore } from 'pepperscore';",
    "import 'pepperscore/style.css';",
    "createRoot(document.getElementById('app')).render(createElement(PepperScore, { chrome: 'minimal', abc: 'X:1\\nK:C\\nCDEF|' }));",
  ].join('\n'));
  install(app, tarball, [...react, `vite@${readJson('package.json').devDependencies.vite}`]);
  run(['exec', '--', 'vite', 'build'], app);
  assertHostOutput('Vite', join(app, 'dist/assets'));
  console.log('Pack smoke: a fresh Vite + React host build passed');
}

function astroHost(work, tarball) {
  const app = join(work, 'astro-app');
  mkdirSync(join(app, 'src/pages'), { recursive: true });
  mkdirSync(join(app, 'src/scores'), { recursive: true });
  const reader = readJson('apps/reader/package.json').dependencies;
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'pepperscore-smoke-astro', private: true, type: 'module' }));
  writeFileSync(join(app, 'astro.config.mjs'), [
    "import { defineConfig } from 'astro/config';",
    "import react from '@astrojs/react';",
    'export default defineConfig({ integrations: [react()] });',
  ].join('\n'));
  copyFileSync(join(root, 'validation/fixtures/idless-sibelius.musicxml'), join(app, 'src/scores/tune.musicxml'));
  writeFileSync(join(app, 'src/pages/index.astro'), [
    '---',
    "import { PepperScore } from 'pepperscore';",
    "import 'pepperscore/style.css';",
    "import tune from '../scores/tune.musicxml?raw';",
    '---',
    '<html lang="en"><body>',
    '<PepperScore client:only="react" chrome="minimal" musicXml={tune} assetBaseUrl="/pepperscore-sounds/" />',
    '</body></html>',
  ].join('\n'));
  install(app, tarball, [...react, `astro@${reader.astro}`, `@astrojs/react@${reader['@astrojs/react']}`]);
  run(['exec', '--', 'astro', 'build'], app);
  assertHostOutput('Astro', join(app, 'dist/_astro'));
  const page = readFileSync(join(app, 'dist/index.html'), 'utf8');
  assert.match(page, /<astro-island[^>]*client="only"/, 'Astro renders a client:only island');
  assert.ok(!page.includes('<svg'), 'nothing is engraved on the server');
  console.log('Pack smoke: a fresh Astro + React host build (client:only island) passed');
}

const work = mkdtempSync(join(tmpdir(), 'pepperscore-smoke-'));
try {
  // Build first and pack with --ignore-scripts: prepack's build output would otherwise land in the --json output.
  execFileSync(npm, ['run', 'build', '-w', 'pepperscore'], { cwd: root, stdio: ['ignore', 2, 'inherit'] });
  const [packed] = JSON.parse(run(['pack', '--json', '--ignore-scripts', '--pack-destination', work, '-w', 'pepperscore'], root));
  const files = packed.files.map(file => file.path);
  for (const expected of ['dist/index.js', 'dist/index.d.ts', 'dist/style.css', 'package.json', 'README.md', 'LICENSE']) assert.ok(files.includes(expected), `tarball has ${expected}`);
  assert.ok(files.some(file => /^dist\/assets\/verovio\.worker-[\w-]+\.js$/.test(file)), 'tarball has the Verovio worker chunk');
  assert.ok(files.some(file => /^dist\/assets\/import\.worker-[\w-]+\.js$/.test(file)), 'tarball has the import worker chunk');
  assert.ok(!files.some(file => file.startsWith('src/')), 'tarball ships no sources');
  const manifest = readJson('packages/pepperscore/package.json');
  assert.deepEqual(manifest.peerDependencies, { react: '>=19', 'react-dom': '>=19' });
  assert.equal(manifest.license, 'MIT');
  console.log(`Pack smoke: ${packed.filename} (${files.length} files) has the build output and no sources`);

  const tarball = join(work, packed.filename);
  if (hosts.includes('vite')) viteHost(work, tarball);
  if (hosts.includes('astro')) astroHost(work, tarball);
} finally { rmSync(work, { recursive: true, force: true }); }
