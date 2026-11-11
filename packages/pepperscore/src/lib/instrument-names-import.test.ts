import { describe, expect, it } from 'vitest';
import { parseAbc, parseMusicXml } from './import';
import { readMusicXml } from './notation/musicxml-source';
import { canShowTab } from './tab/tab-parts';
import { stringInstrument } from './tab/string-instruments';

const abc = (names: string[], program?: number) => parseAbc(`X:1\nM:4/4\nL:1/4\n${names.map((name, i) => `V:v${i} name="${name}"${i === names.length - 1 && program !== undefined ? `\n%%MIDI program ${program - 1}` : ''}`).join('\n')}\nK:C\n${names.map((_, i) => `[V:v${i}] CDEF |`).join('\n')}`);
const xml = (names: string[], program?: number) => `<score-partwise version="4.0"><part-list>${names.map((name, i) => `<score-part id="p${i}"><part-name>${name}</part-name>${i === names.length - 1 && program !== undefined ? `<midi-instrument id="i${i}"><midi-channel>1</midi-channel><midi-program>${program}</midi-program></midi-instrument>` : ''}</score-part>`).join('')}</part-list>${names.map((_, i) => `<part id="p${i}"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>`).join('')}</score-partwise>`;

for (const [format, load] of [
  ['ABC', abc], ['MusicXML', (names: string[], program?: number) => parseMusicXml(xml(names, program))],
  ['MusicXML worker reader', (names: string[], program?: number) => readMusicXml(xml(names, program)).score],
] as const) describe(`${format} contextual instrument names`, () => {
  it.each([
    ['Soprano', 'Alto', 'Tenor', 'Bass'], ['S', 'A', 'T', 'B'],
    ['Sop.', 'Alt.', 'Ten.', 'Bass'], ['Alto', 'Tenor', 'Bass'], ['A', 'T', 'B'],
    ['Soprano 1', 'Soprano 2', 'Alto I', 'Alto II', 'Tenor 1', 'Tenor 2', 'Bass I', 'Bass II'],
    ['Alto 1', 'Tenor 1'], ['Baritone', 'Bass'], ['Ten.', 'Bass'],
  ])('resolves named or letter choir (%j) to voice without TAB', async (...names) => {
    const score = await load(names);
    expect(score.parts.map(p => p.instrument)).toEqual(names.map(() => 'microphone'));
    expect(canShowTab(score)).toBe(false);
  });
  it.each([
    ['Soprano', 'Bass', 'Piano'], ['Soprano', 'Alto', 'Tenor', 'Bass', 'Piano'],
    ['Soprano 1', 'Alto II', 'Bass I', 'Organ'], ['S', 'A', 'T', 'B', 'Piano'],
  ])('keeps accompanied choir (%j) as voices and piano', async (...names) => {
    for (const program of [undefined, 1]) {
      const score = await load(names, program);
      expect(score.parts.map(p => p.instrument)).toEqual([...names.slice(0, -1).map(() => 'microphone'), 'piano']);
      expect(canShowTab(score)).toBe(false);
    }
  });
  it.each([['A'], ['A', 'B'], ['S', 'B'], ['A', 'A', 'B'], ['A', 'Bass']])('keeps incomplete letter labels (%j) at their defaults', async (...names) => {
    const score = await load(names);
    expect(score.parts.map(p => p.instrument)).toEqual(names.map(name => name === 'Bass' ? 'bassguitar' : 'piano'));
  });
  it('does not infer B from a word-only voice label', async () => {
    expect((await load(['Soprano', 'B'])).parts.map(p => p.instrument)).toEqual(['microphone', 'piano']);
  });
  it.each(['Soprano', 'Alto', 'Tenor', 'Baritone', 'Alto II', 'Voice', 'Vocal', 'Choir', 'Singer'])('uses a voice for %s even alone', async name => {
    expect((await load([name])).parts[0].instrument).toBe('microphone');
  });
  it.each(['Bass Voice', 'Choir Bass', 'Bass (Vocal)'])('keeps explicit vocal hint %s even in a band', async name => {
    expect((await load(['Guitar', 'Drums', name])).parts[2].instrument).toBe('microphone');
  });
  it('uses sax names explicitly for a big band', async () => {
    const score = await load(['Alto Sax 1', 'Tenor Sax 1', 'Trumpet', 'Bass', 'Drums']);
    expect(score.parts.map(p => p.instrument)).toEqual(['alto-saxophone', 'tenor-saxophone', 'trumpet', 'bassguitar', 'drum-kit']);
    expect(stringInstrument(score.parts[3])).toBe('bass4');
  });
  it.each([
    ['Vocals', 'Guitar', 'Bass', 'Drums'], ['Soprano', 'Bass', 'Guitar'], ['Soprano', 'Bass', 'Drums'],
  ])('keeps bass guitar in a guitar/drum band (%j)', async (...names) => {
    const score = await load(names);
    const bass = score.parts.find(p => p.name === 'Bass')!;
    expect(bass.instrument).toBe('bassguitar');
    expect(stringInstrument(bass)).toBe('bass4');
  });
  it.each([25, 34])('keeps bass guitar with explicit guitar GM %i', async program => {
    const score = await load(['Soprano', 'Bass', 'Other'], program);
    expect(score.parts[1].instrument).toBe('bassguitar');
  });
  it.each([1, 20, 57, 66, 113])('does not use GM %i as a band exclusion', async program => {
    const score = await load(['Soprano', 'Bass', 'Other'], program);
    expect(score.parts[1].instrument).toBe('microphone');
  });
  it('uses an explicit piano program over a misleading guitar name for context', async () => {
    const score = await load(['Soprano', 'Bass', 'Guitar'], 1);
    expect(score.parts.map(p => p.instrument)).toEqual(['microphone', 'microphone', 'piano']);
  });
  it('preserves explicit programs over vocal and sax names', async () => {
    for (const name of ['Bass', 'Soprano 1', 'Tenor Sax']) {
      const part = (await load(['Soprano', name], 34)).parts[1];
      expect(part.instrument).toBe('bassguitar');
      expect(part.gmProgram).toBe(34);
    }
  });
  it.each([
    ['Soprano Sax', 'alto-saxophone'], ['Alto Sax 1', 'alto-saxophone'],
    ['Tenor Saxophone II', 'tenor-saxophone'], ['Baritone Sax', 'bari-saxophone'],
    ['Sax Tenor 1', 'tenor-saxophone'], ['Choir Tenor Sax', 'tenor-saxophone'],
  ])('uses a saxophone for %s and gives Bass no choir context', async (name, instrument) => {
    const score = await load([name, 'Bass']);
    expect(score.parts[0].instrument).toBe(instrument);
    expect(score.parts[1].instrument).toBe('bassguitar');
    expect(stringInstrument(score.parts[0])).toBeUndefined();
    if (name === 'Soprano Sax') expect(score.parts[0]).toMatchObject({ gmProgram: 65, gmSoundfont: 'soprano_sax' });
  });
});
