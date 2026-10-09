import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import soundfont2 from 'soundfont2';

const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/prepare-perfect-drums.mjs /path/to/perfect-drums-v2.sf2');
const { SoundFont2 } = soundfont2;
const sf = new SoundFont2(new Uint8Array(readFileSync(input)));
const preset = sf.presets.find(item => item.header.bank === 128 && item.header.preset === 0);
if (!preset) throw new Error('Expected drum bank 128, preset 0.');
const output = resolve('packages/pepperscore-sounds-complete/soundfonts/perfect-drums');
mkdirSync(output, { recursive: true });
const notes = {};
for (let note = 35; note <= 70; note++) {
  const key = sf.getKeyData(note, 128, 0);
  if (!key) continue;
  const left = key.sample.data;
  const linked = sf.samples[key.sample.header.link];
  const right = key.sample.header.type === 4 && linked?.header.type === 2 ? linked.data : left;
  const frames = Math.max(left.length, right.length);
  const pcm = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) {
    pcm.writeInt16LE(left[i] || 0, i * 4);
    pcm.writeInt16LE(right[i] || 0, i * 4 + 2);
  }
  const file = `${note}.mp3`;
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(key.sample.header.sampleRate), '-ac', '2', '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '128k', '-y', resolve(output, file)], { input: pcm });
  if (result.status !== 0) throw new Error(`Could not encode drum ${note}: ${result.stderr}`);
  notes[note] = file;
}
writeFileSync(resolve(output, 'manifest.json'), `${JSON.stringify({ name: 'Perfect Drums 1', bank: 128, preset: 0, source: 'https://musical-artifacts.com/artifacts/8466', notes }, null, 2)}\n`);
console.log(`Prepared ${Object.keys(notes).length} drum samples from ${preset.header.name}.`);
