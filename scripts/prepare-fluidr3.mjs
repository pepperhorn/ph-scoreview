import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const manifest = JSON.parse(await readFile(resolve('packages/pepperscore/src/lib/gm-soundfont-manifest.json'), 'utf8'));
const names = manifest.programs.map(({ soundfont }) => soundfont);
const root = resolve('packages/pepperscore-sounds-complete/soundfonts/fluidr3');
const source = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM';
const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const keyToMidi = key => {
  const match = /^([A-G])([b#]?)(-?\d+)$/.exec(key);
  return match ? (Number(match[3]) + 1) * 12 + semitones[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0) : null;
};

await mkdir(root, { recursive: true });
for (const name of names) {
  const url = `${source}/${name}-mp3.js`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const script = await response.text();
  const match = script.match(/MIDI\.Soundfont\.[\w]+\s*=\s*(\{[\s\S]*?\})\s*;?\s*$/);
  if (!match) throw new Error(`${name}: unexpected MIDI.js source format`);
  const entries = Object.entries(JSON.parse(match[1].replace(/,\s*}/g, '}'))).map(([key, uri]) => [keyToMidi(key), uri]).filter(([midi, uri]) => midi !== null && typeof uri === 'string');
  if (!entries.length) throw new Error(`${name}: no samples`);
  const chosen = new Map();
  for (let target = 36; target <= 96; target += 5) {
    const [midi, uri] = entries.reduce((best, entry) => Math.abs(entry[0] - target) < Math.abs(best[0] - target) ? entry : best);
    chosen.set(midi, uri.replace(/^data:audio\/[^;]+;base64,/, ''));
  }
  const samples = Object.fromEntries([...chosen].sort((a, b) => a[0] - b[0]));
  await writeFile(resolve(root, `${name}.json`), JSON.stringify({ name, source: url, license: 'CC BY 3.0', samples }));
  console.log(`${name}: ${Object.keys(samples).length} samples`);
}
