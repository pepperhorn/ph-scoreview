// pepperscore/audio, the shared audio engine's public subpath (packages/pepperscore/src/audio.ts).
// 1. Node: metronome voice planning per beat (src/lib/metronome.ts).
// 2. The packed tarball: `pepperscore/audio` resolves through package.json exports, ships dist/audio.js + audio.d.ts,
//    type-checks in a strict consumer, imports in Node without touching browser globals, and shares one copy of the
//    AudioContext/playback-owner state with the main entry.
// 3. Browser (built from the tarball with Vite, no network): a non-pack instrument (TimGM6mb fallback) and the metronome
//    voices play; stop() cancels notes already scheduled ahead (smplr's own stop() leaves queued notes); a note's stop
//    handle cancels it; and every request goes to the page's own origin (the asset base), never another host.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { metronomeHits, metronomeNotes, METRONOME_VOICES } from '../packages/pepperscore/src/lib/metronome.ts';

const root = resolve(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// 1. Metronome voices, beat by beat (4/4: beat 0 is beat 1, accented).
{
  const kit = () => true, none = () => false;
  const bar = (voice, covers) => [0, 1, 2, 3].map(beat => metronomeHits(voice, beat, { covers }));
  assert.deepEqual(METRONOME_VOICES, ['woodblock', 'drum-machine', 'click']);
  assert.deepEqual(bar('woodblock', kit).map(hits => hits.map(hit => hit.note)), [[76], [77], [77], [77]], 'woodblock: hi wood block on beat 1, low on the others');
  assert.deepEqual(bar('drum-machine', kit).map(hits => hits.map(hit => hit.note)), [[36], [42], [42], [42]], 'drum-machine: kick on beat 1, closed hat on the others');
  for (const voice of ['woodblock', 'drum-machine']) {
    const velocities = bar(voice, kit).map(([hit]) => hit.velocity);
    assert.ok(velocities[0] > velocities[1] && velocities[1] === velocities[2] && velocities[2] === velocities[3], `${voice}: beat 1 is accented`);
  }
  assert.deepEqual(bar('woodblock', none), [[{ kind: 'knock', accent: true }], [{ kind: 'knock', accent: false }], [{ kind: 'knock', accent: false }], [{ kind: 'knock', accent: false }]], 'woodblock without a kit wood block: a synthesized knock');
  assert.deepEqual(bar('drum-machine', undefined).map(([hit]) => hit.kind), ['tick', 'tick', 'tick', 'tick'], 'drum-machine without a kit: synthesized ticks');
  assert.deepEqual(bar('click', kit), [[{ kind: 'tick', accent: true }], [{ kind: 'tick', accent: false }], [{ kind: 'tick', accent: false }], [{ kind: 'tick', accent: false }]], 'click: always a synthesized tick, accented on beat 1');
  assert.deepEqual(metronomeHits('click', 2, { accent: true }), [{ kind: 'tick', accent: true }], 'accent can be set per beat');
  assert.deepEqual(metronomeNotes('woodblock'), [76, 77]); assert.deepEqual(metronomeNotes('drum-machine'), [36, 42]); assert.deepEqual(metronomeNotes('click'), []);
  console.log('Audio API: metronome voices per beat (woodblock, drum-machine, click; accent on beat 1) passed');
}

const work = mkdtempSync(join(tmpdir(), 'pepperscore-audio-'));
let server, browser;
let failedOnce = false;
try {
  // 2. Pack (build first; --ignore-scripts keeps prepack's build out of --json) and unpack into a consumer's node_modules.
  execFileSync(npm, ['run', 'build', '-w', 'pepperscore'], { cwd: root, stdio: ['ignore', 2, 'inherit'] });
  const [packed] = JSON.parse(execFileSync(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', work, '-w', 'pepperscore'], { cwd: root, encoding: 'utf8' }));
  const files = packed.files.map(file => file.path);
  for (const file of ['dist/audio.js', 'dist/audio.d.ts', 'dist/lib/instruments.d.ts', 'dist/lib/metronome.d.ts']) assert.ok(files.includes(file), `tarball has ${file}`);
  const app = join(work, 'app');
  const pkgDir = join(app, 'node_modules/pepperscore');
  mkdirSync(pkgDir, { recursive: true });
  execFileSync('tar', ['-xzf', join(work, packed.filename), '-C', pkgDir, '--strip-components=1']);
  // The audio entry's runtime dependencies, linked from this repository (no network).
  for (const dep of ['smplr', 'soundfont2']) symlinkSync(join(root, 'node_modules', dep), join(app, 'node_modules', dep), 'dir');
  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.exports['./audio'], { types: './dist/audio.d.ts', import: './dist/audio.js', default: './dist/audio.js' }, 'package.json exports ./audio');
  assert.ok(manifest.exports['.'] && manifest.exports['./style.css'], 'the main entry and stylesheet exports are unchanged');
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'pepperscore-audio-consumer', private: true, type: 'module' }));

  // One copy of the shared state: only one dist chunk creates the AudioContext, and both entries import it.
  const distFiles = readdirSync(join(pkgDir, 'dist')).filter(file => file.endsWith('.js'));
  const owners = distFiles.filter(file => readFileSync(join(pkgDir, 'dist', file), 'utf8').includes('new AudioContext'));
  assert.equal(owners.length, 1, `exactly one dist chunk creates the AudioContext (${owners})`);
  for (const entry of ['index.js', 'audio.js']) assert.ok(readFileSync(join(pkgDir, 'dist', entry), 'utf8').includes(`./${owners[0]}`), `dist/${entry} imports the shared ${owners[0]}`);
  // The main entry's exports are unchanged (pepperscore's own index.ts re-exports no audio API).
  assert.doesNotMatch(readFileSync(join(pkgDir, 'dist/index.d.ts'), 'utf8'), /loadInstrument|createMetronome|getSharedAudio/, 'the main entry does not export the audio API');

  // The public declarations carry no internal fields: AudioPlayer.fallback is stripped and Instrument.plan is the narrow { kind, sourceId }.
  assert.doesNotMatch(readFileSync(join(pkgDir, 'dist/lib/sound-players.d.ts'), 'utf8'), /fallback\?:/, 'AudioPlayer.fallback (@internal) is not in the shipped declarations');
  assert.match(readFileSync(join(pkgDir, 'dist/lib/instruments.d.ts'), 'utf8'), /readonly plan: InstrumentPlan/, 'Instrument.plan is the narrow public InstrumentPlan');

  // Types: a strict consumer type-checks against dist/audio.d.ts through the exports map.
  writeFileSync(join(app, 'check.ts'), [
    "import { claimPlayback, createMetronome, getSharedAudio, loadDrumKit, loadInstrument, releasePlayback, resumeAudio, METRONOME_VOICES, SOUNDS_VERSION, type AudioPlayer, type Instrument, type Metronome, type MetronomeVoice, type PlaybackOwner, type SharedAudio, type SoundSource } from 'pepperscore/audio';",
    'const shared: SharedAudio | null = getSharedAudio();',
    'if (shared) { const ok: Promise<boolean> = resumeAudio(shared.context); void ok; }',
    'const owner: PlaybackOwner = { stop() {} }; claimPlayback(owner); releasePlayback(owner);',
    "const sources: SoundSource[] = [{ id: 'kit', kind: 'note-files', manifest: '/kit/manifest.json', drums: true }];",
    "async function demo(): Promise<void> {",
    "  const piano: Instrument = await loadInstrument(1, { assetBaseUrl: '/sounds/', soundPack: 'complete', sources, notes: [60] });",
    "  const harp: AudioPlayer = await loadInstrument('orchestral_harp');",
    "  const drums = await loadDrumKit({ notes: [36] });",
    '  const stop: () => void = piano.start({ note: 60, time: piano.context.currentTime, duration: 1, velocity: 90, destination: piano.output });',
    '  stop(); harp.stop(); drums.dispose(); piano.covers(60); await piano.loadNotes([61]);',
    "  const voice: MetronomeVoice = METRONOME_VOICES[0];",
    "  const metronome: Metronome = await createMetronome({ voice, gain: .4, assetBaseUrl: '/sounds/' });",
    "  await metronome.ready; const planKind: 'sf2' | 'sample-pack' | 'note-files' = piano.plan.kind; const planId: string = piano.plan.sourceId; void planKind; void planId;",
    "  // @ts-expect-error the plan's URLs are internal",
    "  void piano.plan.url;",
    "  const tickStop: () => void = metronome.tick({ time: 0, beat: 0 }); tickStop();",
    "  await metronome.setVoice('click'); metronome.stop(); metronome.dispose();",
    "  // @ts-expect-error not a metronome voice",
    "  await metronome.setVoice('cowbell');",
    "  const version: string = SOUNDS_VERSION; void version;",
    '}',
    'void demo;',
  ].join('\n'));
  writeFileSync(join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, skipLibCheck: false, lib: ['ES2022', 'DOM'], types: [] }, files: ['check.ts'] }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', app], { cwd: app, stdio: ['ignore', 'inherit', 'inherit'] });
  console.log('Audio API: the tarball exports pepperscore/audio, dist/audio.d.ts type-checks in a strict consumer, one shared AudioContext chunk');

  // Node import: resolves through exports and touches no browser global.
  execFileSync(process.execPath, ['--input-type=module', '-e', [
    'const touched = [];',
    "for (const name of ['window', 'document', 'localStorage', 'location', 'AudioContext']) Object.defineProperty(globalThis, name, { configurable: true, get() { touched.push(name); return undefined; } });",
    "const audio = await import('pepperscore/audio');",
    "for (const name of ['getSharedAudio', 'resumeAudio', 'claimPlayback', 'releasePlayback', 'loadInstrument', 'loadDrumKit', 'createMetronome']) if (typeof audio[name] !== 'function') throw new Error(`no ${name} export`);",
    "if (touched.length) throw new Error(`importing pepperscore/audio read ${touched.join(', ')}`);",
  ].join('\n')], { cwd: app, stdio: ['ignore', 'inherit', 'inherit'] });
  console.log('Audio API: importing pepperscore/audio in Node touches no browser global');

  // 3. A browser page built from the tarball. /sounds/ serves the complete pack with only the piano listed as a FluidR3
  // sound, so the harp (GM 47) falls back to TimGM6mb.sf2 and the drum kit to Perfect Drums + TimGM6mb's kit.
  writeFileSync(join(app, 'index.html'), '<!doctype html><title>audio</title><script type="module" src="/main.js"></script>');
  writeFileSync(join(app, 'main.js'), "import * as audio from 'pepperscore/audio';\nwindow.__audio = audio;\n");
  execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'warn'], { cwd: app, stdio: ['ignore', 'inherit', 'inherit'] });
  const sounds = join(root, 'packages/pepperscore-sounds-complete');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg' };
  const served = [];
  server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    served.push(pathname);
    // /sounds2/ (slow SF2), /sounds3/ (counts kit loads) and /sounds4/ (the first drum manifest request fails) alias /sounds/.
    const alias = /^\/sounds([234])\//.exec(pathname);
    if (alias) {
      if (alias[1] === '2' && pathname.endsWith('.sf2')) await new Promise(done => setTimeout(done, 1500));
      if (alias[1] === '4' && pathname.endsWith('perfect-drums/manifest.json') && !failedOnce) { failedOnce = true; return response.writeHead(500).end(); }
      request.url = request.url.replace(alias[0], '/sounds/');
      return handle(request, response);
    }
    return handle(request, response);
  });
  async function handle(request, response) {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/sounds/pack.json') return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ pack: 'core', fluidr3: ['acoustic_grand_piano'] }));
    const [base, rel] = pathname.startsWith('/sounds/') ? [sounds, pathname.slice('/sounds/'.length)] : [join(app, 'dist'), pathname === '/' ? 'index.html' : pathname.slice(1)];
    const path = resolve(base, rel);
    if (!path.startsWith(`${base}${sep}`)) return response.writeHead(403).end();
    try { response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' }).end(await readFile(path)); } catch { response.writeHead(404).end(); }
  }
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext();
  const requests = [];
  context.on('request', request => requests.push(request.url()));
  // Record every sound node started: buffer sources (samples, smplr's voices included) and oscillators (synth sounds),
  // with their start time and the earliest stop. A node stopped at or before its start time never sounds (cancelled).
  await context.addInitScript(() => {
    window.__nodes = [];
    for (const [Node, kind] of [[AudioBufferSourceNode, 'buffer'], [OscillatorNode, 'osc']]) {
      const start = Node.prototype.start, stop = Node.prototype.stop;
      Node.prototype.start = function (when, ...rest) { this.__entry = { kind, startAt: Math.max(when || 0, this.context.currentTime), stopAt: Infinity }; window.__nodes.push(this.__entry); return start.call(this, when, ...rest); };
      Node.prototype.stop = function (when, ...rest) { if (this.__entry) this.__entry.stopAt = Math.min(this.__entry.stopAt, Math.max(when || 0, this.context.currentTime)); return stop.call(this, when, ...rest); };
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.__audio);
  const result = await page.evaluate(async () => {
    const { getSharedAudio, resumeAudio, claimPlayback, releasePlayback, loadInstrument, loadDrumKit, createMetronome } = window.__audio;
    const wait = ms => new Promise(done => setTimeout(done, ms));
    // Sounds since a mark that were not cancelled before they began, per kind.
    const starts = () => window.__nodes.length;
    const delta = before => {
      const heard = window.__nodes.slice(before).filter(node => node.stopAt > node.startAt);
      return { buffer: heard.filter(node => node.kind === 'buffer').length, osc: heard.filter(node => node.kind === 'osc').length };
    };
    const out = {};
    const shared = getSharedAudio();
    out.sameShared = shared === getSharedAudio();
    out.running = await resumeAudio(shared.context);
    let stopped = 0;
    const first = { stop: () => stopped++ }, second = { stop() {} };
    claimPlayback(first); claimPlayback(second); releasePlayback(second);
    out.claimStopsPrevious = stopped === 1;
    const ctx = shared.context;

    // A non-pack instrument: GM 47 (orchestral harp) is not in pack.json, so it plays from TimGM6mb.sf2.
    const harp = await loadInstrument(47, { assetBaseUrl: '/sounds/', notes: [60, 64, 67] });
    out.harpPlan = { kind: harp.plan.kind, sourceId: harp.plan.sourceId };
    // Positive control: a note scheduled beyond smplr's 200 ms lookahead does start when left alone.
    let before = starts();
    harp.start({ note: 60, time: ctx.currentTime + .6, duration: .3, velocity: 90 });
    await wait(1100);
    out.harpControl = delta(before);
    // stop() cancels notes scheduled ahead (queued in smplr's scheduler, not yet voices).
    before = starts();
    for (const [i, note] of [60, 64, 67].entries()) harp.start({ note, time: ctx.currentTime + 1 + i * .4, duration: .3, velocity: 90 });
    harp.stop();
    await wait(2300);
    out.harpAfterStop = delta(before);
    // A note's own stop handle cancels just that note.
    before = starts();
    const cancel = harp.start({ note: 64, time: ctx.currentTime + .8, duration: .3, velocity: 90 });
    cancel();
    await wait(1300);
    out.harpAfterHandle = delta(before);

    // A pack instrument (FluidR3 piano) and the drum kit come from the same asset base.
    const piano = await loadInstrument(1, { assetBaseUrl: '/sounds/', notes: [60] });
    out.pianoPlan = { kind: piano.plan.kind, sourceId: piano.plan.sourceId };
    before = starts();
    piano.start({ note: 60, time: ctx.currentTime + 1, duration: .3, velocity: 90 });
    piano.stop();
    await wait(1300);
    out.pianoAfterStop = delta(before);
    const kit = await loadDrumKit({ assetBaseUrl: '/sounds/', notes: [36, 42] });
    out.kitPlan = { kind: kit.plan.kind, sourceId: kit.plan.sourceId, covers76: kit.covers(76) };

    // Metronome voices: one bar of four beats each, scheduled close together.
    const metronome = await createMetronome({ assetBaseUrl: '/sounds/' });
    out.defaultVoice = metronome.voice;
    out.defaultGain = metronome.output.gain.value;
    await metronome.ready;
    const bar = async () => {
      const b = starts(), t = ctx.currentTime + .05;
      for (let beat = 0; beat < 4; beat++) metronome.tick({ time: t + beat * .1, beat });
      await wait(700);
      return delta(b);
    };
    out.woodblock = await bar();
    await metronome.setVoice('drum-machine');
    out.drumMachine = await bar();
    await metronome.setVoice('click');
    out.click = await bar();
    // Metronome stop() cancels beats scheduled ahead, for every voice.
    out.metronomeAfterStop = {};
    for (const voice of ['woodblock', 'drum-machine', 'click']) {
      await metronome.setVoice(voice);
      const b = starts();
      for (let beat = 0; beat < 4; beat++) metronome.tick({ time: ctx.currentTime + .8 + beat * .3, beat });
      metronome.stop();
      await wait(2000);
      out.metronomeAfterStop[voice] = delta(b);
    }
    metronome.dispose(); harp.dispose(); piano.dispose(); kit.dispose();
    return out;
  });
  const lifecycle = await page.evaluate(async () => {
    const { createMetronome } = window.__audio;
    const ctx = window.__audio.getSharedAudio().context;
    const wait = ms => new Promise(done => setTimeout(done, ms));
    const starts = () => window.__nodes.length;
    const delta = before => { const heard = window.__nodes.slice(before).filter(node => node.stopAt > node.startAt); return { buffer: heard.filter(node => node.kind === 'buffer').length, osc: heard.filter(node => node.kind === 'osc').length }; };
    const bar = async metronome => { const b = starts(), t = ctx.currentTime + .05; for (let beat = 0; beat < 4; beat++) metronome.tick({ time: t + beat * .1, beat }); await wait(600); return delta(b); };
    const out = {};
    // createMetronome does not wait for the kit: the SF2 here takes 1.5 s. Until it arrives the woodblock plays the synthesized knock.
    let t0 = performance.now();
    const slow = await createMetronome({ assetBaseUrl: '/sounds2/' });
    out.resolveMs = performance.now() - t0;
    out.beforeKit = await bar(slow);
    await slow.ready;
    out.afterKit = await bar(slow);
    slow.dispose();
    // Two quick setVoice calls from 'click' load one kit.
    const quick = await createMetronome({ voice: 'click', assetBaseUrl: '/sounds3/' });
    await Promise.all([quick.setVoice('drum-machine'), quick.setVoice('woodblock'), quick.setVoice('drum-machine')]);
    out.quick = await bar(quick);
    quick.dispose();
    // dispose() while the kit is loading releases it when it arrives, and nothing throws or plays.
    const early = await createMetronome({ assetBaseUrl: '/sounds2/' });
    early.dispose();
    await wait(2500);
    // A failed kit load is retried by the next setVoice.
    const flaky = await createMetronome({ voice: 'click', assetBaseUrl: '/sounds4/' });
    await flaky.setVoice('drum-machine');
    out.flakyFirst = await bar(flaky);
    await flaky.setVoice('drum-machine');
    out.flakyRetry = await bar(flaky);
    flaky.dispose();
    return out;
  });
  assert.ok(lifecycle.resolveMs < 1000, `createMetronome resolves before the kit arrives (${Math.round(lifecycle.resolveMs)} ms)`);
  assert.ok(lifecycle.beforeKit.osc >= 4 && lifecycle.beforeKit.buffer === 0, `until the kit arrives the woodblock plays the synthesized knock: ${JSON.stringify(lifecycle.beforeKit)}`);
  assert.ok(lifecycle.afterKit.buffer >= 4 && lifecycle.afterKit.osc === 0, `after ready it plays the kit samples: ${JSON.stringify(lifecycle.afterKit)}`);
  assert.equal(served.filter(path => path === '/sounds3/soundfonts/perfect-drums/manifest.json').length, 1, 'overlapping setVoice calls share one drum kit load');
  assert.ok(lifecycle.quick.buffer >= 4, 'the shared kit plays');
  assert.deepEqual(lifecycle.flakyFirst, { buffer: 0, osc: 4 }, 'after a failed drum load the metronome plays synthesized sounds');
  assert.deepEqual(lifecycle.flakyRetry, { buffer: 4, osc: 0 }, 'the next setVoice retries the drum load and succeeds');
  assert.deepEqual(errors, [], 'no page errors');
  assert.ok(result.sameShared, 'getSharedAudio() returns one shared graph');
  assert.ok(result.running, 'the shared AudioContext runs');
  assert.ok(result.claimStopsPrevious, 'claimPlayback stops the previous owner');
  assert.deepEqual(result.harpPlan, { kind: 'sf2', sourceId: 'builtin:timgm6mb' }, 'a program missing from the pack plays from TimGM6mb.sf2');
  assert.ok(result.harpControl.buffer > 0, `a queued SF2 note plays when not stopped (control): ${JSON.stringify(result.harpControl)}`);
  assert.equal(result.harpAfterStop.buffer, 0, `stop() cancels SF2 notes scheduled ahead: ${JSON.stringify(result.harpAfterStop)}`);
  assert.equal(result.harpAfterHandle.buffer, 0, `a note's stop handle cancels it: ${JSON.stringify(result.harpAfterHandle)}`);
  assert.deepEqual(result.pianoPlan, { kind: 'sample-pack', sourceId: 'builtin:fluidr3' });
  assert.deepEqual(result.pianoAfterStop, { buffer: 0, osc: 0 }, 'stop() cancels a scheduled sample-pack note (stopped before its start time)');
  assert.deepEqual(result.kitPlan, { kind: 'note-files', sourceId: 'builtin:perfect-drums', covers76: false }, 'the kit: Perfect Drums, which has no wood block');
  assert.equal(result.defaultVoice, 'woodblock'); assert.ok(Math.abs(result.defaultGain - .5) < 1e-6, 'default metronome gain is gentle (0.5)');
  assert.ok(result.woodblock.buffer >= 4 && result.woodblock.osc === 0, `woodblock plays the GM wood block samples (TimGM6mb's kit), one or more voices per beat: ${JSON.stringify(result.woodblock)}`);
  assert.deepEqual(result.drumMachine, { buffer: 4, osc: 0 }, 'drum-machine plays one kit sample per beat (kick, hat, hat, hat)');
  assert.deepEqual(result.click, { buffer: 0, osc: 4 }, 'click synthesizes one tick per beat');
  assert.deepEqual(result.metronomeAfterStop, { woodblock: { buffer: 0, osc: 0 }, 'drum-machine': { buffer: 0, osc: 0 }, click: { buffer: 0, osc: 0 } }, 'metronome stop() cancels scheduled beats of every voice');
  const foreign = requests.filter(url => !url.startsWith(`${origin}/`));
  assert.deepEqual(foreign, [], 'every request goes to the page origin (asset base), none to another host');
  assert.ok(served.includes('/sounds/soundfonts/TimGM6mb.sf2'), 'TimGM6mb.sf2 comes from the asset base');
  assert.ok(served.includes('/sounds/soundfonts/fluidr3/acoustic_grand_piano.json') && served.includes('/sounds/soundfonts/perfect-drums/manifest.json'));
  console.log(`Audio API: browser playback from the tarball (TimGM6mb fallback, FluidR3 piano, drum kit, metronome voices), stop() cancels scheduled notes, no foreign hosts (${requests.length} requests) passed`);
} finally {
  await browser?.close();
  await new Promise(done => server ? server.close(done) : done());
  if (existsSync(work)) rmSync(work, { recursive: true, force: true });
}
