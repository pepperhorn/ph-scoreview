// npm pack the library, install the tarball into temporary Vite + React and Astro + React apps, build them, and check the output.
// Needs the network (the hosts install react, vite and astro from the npm registry). Nothing is published.
// Hosts: vite; astro (static, client:only); astro-ssr (output: 'server' with @astrojs/node, like becreative: a client:visible
// island rendered on the server; the built server is started on 127.0.0.1 and its page fetched).
// PACK_SMOKE_HOSTS=vite,astro-ssr (any subset) runs only those; the default runs all three.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args, cwd) => execFileSync(npm, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
const readJson = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const HOSTS = ['vite', 'astro', 'astro-ssr'];
const hosts = (process.env.PACK_SMOKE_HOSTS || HOSTS.join(',')).split(',').map(host => host.trim());
for (const host of hosts) assert.ok(HOSTS.includes(host), `PACK_SMOKE_HOSTS lists ${HOSTS.join(', ')}, not "${host}"`);
// No --prefer-offline: a stale cached packument can miss a just-published dependency (ETARGET); cached tarballs are reused anyway.
const install = (app, tarball, packages) => run(['install', '--no-audit', '--no-fund', tarball, ...packages], app);
const react = ['react@^19.2.0', 'react-dom@^19.2.0'];

/**
 * The host build copies both worker chunks and, byte for byte, the Verovio files the worker imports at runtime (LGPL:
 * they stay separate, replaceable files) and the third-party notices; it ships the package stylesheet and resolves
 * Poppins through @fontsource.
 */
function assertHostOutput(label, dir) {
  const files = readdirSync(dir);
  assert.ok(files.some(file => /verovio\.worker.*\.js$/.test(file)), `${label} build emits the Verovio worker: ${files}`);
  for (const file of ['verovio-module.mjs', 'verovio.mjs']) {
    const shipped = readFileSync(join(root, 'packages/pepperscore/dist/verovio', file));
    assert.ok(files.some(name => name.endsWith('.mjs') && readFileSync(join(dir, name)).equals(shipped)), `${label} build copies ${file} unchanged: ${files}`);
  }
  assert.ok(files.some(file => /^THIRD_PARTY_NOTICES.*\.txt$/.test(file)), `${label} build copies THIRD_PARTY_NOTICES.txt`);
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

/** A fresh Astro + React app with the score fixture and one page; `server` adds output: 'server' and the Node adapter. */
function astroApp(work, name, island, server = false) {
  const app = join(work, name);
  mkdirSync(join(app, 'src/pages'), { recursive: true });
  mkdirSync(join(app, 'src/scores'), { recursive: true });
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: `pepperscore-smoke-${name}`, private: true, type: 'module' }));
  writeFileSync(join(app, 'astro.config.mjs'), [
    "import { defineConfig } from 'astro/config';",
    "import react from '@astrojs/react';",
    ...(server ? ["import node from '@astrojs/node';", "export default defineConfig({ output: 'server', adapter: node({ mode: 'standalone' }), integrations: [react()] });"]
      : ['export default defineConfig({ integrations: [react()] });']),
  ].join('\n'));
  copyFileSync(join(root, 'validation/fixtures/idless-sibelius.musicxml'), join(app, 'src/scores/tune.musicxml'));
  writeFileSync(join(app, 'src/pages/index.astro'), [
    '---',
    "import { PepperScore } from 'pepperscore';",
    "import 'pepperscore/style.css';",
    "import tune from '../scores/tune.musicxml?raw';",
    '---',
    '<html lang="en"><body>',
    `<PepperScore ${island} chrome="minimal" musicXml={tune} assetBaseUrl="/pepperscore-sounds/" />`,
    '</body></html>',
  ].join('\n'));
  return app;
}
const astroPackages = () => {
  const reader = readJson('apps/reader/package.json').dependencies;
  return [...react, `astro@${reader.astro}`, `@astrojs/react@${reader['@astrojs/react']}`];
};

function astroHost(work, tarball) {
  const app = astroApp(work, 'astro-app', 'client:only="react"');
  install(app, tarball, astroPackages());
  run(['exec', '--', 'astro', 'build'], app);
  assertHostOutput('Astro', join(app, 'dist/_astro'));
  const page = readFileSync(join(app, 'dist/index.html'), 'utf8');
  assert.match(page, /<astro-island[^>]*client="only"/, 'Astro renders a client:only island');
  assert.ok(!page.includes('<svg'), 'nothing is engraved on the server');
  console.log('Pack smoke: a fresh Astro + React host build (client:only island) passed');
}

/**
 * Importing pepperscore in plain Node touches no browser global: window and document stay undefined (an unguarded read
 * throws a ReferenceError), and reads of storage or location are recorded, even ones a try/catch would swallow.
 */
const IMPORT_GUARD = [
  'const touched = [];',
  "for (const name of ['localStorage', 'sessionStorage', 'location']) Object.defineProperty(globalThis, name, { configurable: true, get() { touched.push(name); return undefined; } });",
  "const { PepperScore } = await import(process.argv[1]);",
  "if (typeof PepperScore !== 'function') throw new Error('no PepperScore export');",
  "if (touched.length) throw new Error(`importing pepperscore read ${touched.join(', ')}`);",
].join('\n');

const freePort = () => new Promise((done, fail) => {
  const probe = createServer().once('error', fail).listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => done(port)); });
});

/** becreative's setup: output: 'server' with @astrojs/node and a client:visible island, built, started and fetched. */
async function astroSsrHost(work, tarball) {
  const app = astroApp(work, 'astro-ssr-app', 'client:visible', true);
  install(app, tarball, [...astroPackages(), '@astrojs/node@^11.0.1']);
  execFileSync(process.execPath, ['--input-type=module', '-e', IMPORT_GUARD, 'pepperscore'], { cwd: app, stdio: ['ignore', 'inherit', 'inherit'] });
  console.log('Pack smoke: importing pepperscore in Node touches no window, document, storage or location');
  run(['exec', '--', 'astro', 'build'], app);
  assertHostOutput('Astro SSR', join(app, 'dist/client/_astro'));
  const port = await freePort();
  const server = spawn(process.execPath, [join(app, 'dist/server/entry.mjs')], { cwd: app, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', chunk => { log += chunk; });
  server.stderr.on('data', chunk => { log += chunk; });
  try {
    let response;
    for (const deadline = Date.now() + 30000; !response; await new Promise(done => setTimeout(done, 250))) {
      assert.equal(server.exitCode, null, `the Astro server exited early:\n${log}`);
      assert.ok(Date.now() < deadline, `the Astro server did not answer within 30s:\n${log}`);
      response = await fetch(`http://127.0.0.1:${port}/`).catch(() => undefined);
    }
    const page = await response.text();
    assert.equal(response.status, 200, `the server page answers 200:\n${page.slice(0, 500)}\n${log}`);
    assert.match(page, /<astro-island[^>]*client="visible"/, 'Astro renders a client:visible island');
    assert.match(page, /<astro-island[^>]*>\s*<div[^>]*class="pepperscore[ "]/, 'the island holds the server-rendered .pepperscore frame');
    assert.ok(!page.includes('<svg'), 'nothing is engraved on the server');
    assert.doesNotMatch(log, /localstorage|window is not defined|document is not defined|\berror\b/i, `the server log is clean:\n${log}`);
  } finally { server.kill(); }
  console.log('Pack smoke: a fresh Astro SSR host (output: server, @astrojs/node, client:visible island) built, served and answered 200');
}

const work = mkdtempSync(join(tmpdir(), 'pepperscore-smoke-'));
try {
  // Build first and pack with --ignore-scripts: prepack's build output would otherwise land in the --json output.
  execFileSync(npm, ['run', 'build', '-w', 'pepperscore'], { cwd: root, stdio: ['ignore', 2, 'inherit'] });
  const [packed] = JSON.parse(run(['pack', '--json', '--ignore-scripts', '--pack-destination', work, '-w', 'pepperscore'], root));
  const files = packed.files.map(file => file.path);
  for (const expected of ['dist/index.js', 'dist/index.d.ts', 'dist/style.css', 'dist/verovio/verovio-module.mjs', 'dist/verovio/verovio.mjs', 'dist/verovio/LICENSE', 'dist/THIRD_PARTY_NOTICES.txt', 'package.json', 'README.md', 'LICENSE', 'LICENSES/LGPL-3.0.txt', 'LICENSES/GPL-3.0.txt']) assert.ok(files.includes(expected), `tarball has ${expected}`);
  assert.ok(files.some(file => /^dist\/assets\/verovio\.worker-[\w-]+\.js$/.test(file)), 'tarball has the Verovio worker chunk');
  assert.ok(files.some(file => /^dist\/assets\/import\.worker-[\w-]+\.js$/.test(file)), 'tarball has the import worker chunk');
  assert.ok(!files.some(file => file.startsWith('src/')), 'tarball ships no sources');
  const manifest = readJson('packages/pepperscore/package.json');
  assert.deepEqual(manifest.peerDependencies, { react: '>=19', 'react-dom': '>=19' });
  assert.equal(manifest.license, 'MIT AND LGPL-3.0-or-later', 'MIT component code, LGPL-3.0-or-later Verovio shipped in dist/verovio/');
  console.log(`Pack smoke: ${packed.filename} (${files.length} files) has the build output and no sources`);

  const tarball = join(work, packed.filename);
  if (hosts.includes('vite')) viteHost(work, tarball);
  if (hosts.includes('astro')) astroHost(work, tarball);
  if (hosts.includes('astro-ssr')) await astroSsrHost(work, tarball);
} finally { rmSync(work, { recursive: true, force: true }); }
