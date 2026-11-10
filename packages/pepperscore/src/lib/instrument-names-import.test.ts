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
    ['Sop.', 'Alt.', 'Ten.', 'Bass'], ['Soprano', 'B'], ['A', 'Bass'], ['Ten.', 'Bass'],
  ])('resolves a choir (%j) without programs to voice and offers no TAB', async (...names) => {
    const score = await load(names);
    expect(score.parts).toHaveLength(names.length);
    expect(score.parts.map(p => p.instrument)).toEqual(names.map(() => 'microphone'));
    expect(score.parts.every(p => p.gmProgram === undefined)).toBe(true);
    expect(canShowTab(score)).toBe(false);
    expect(score.parts.map(p => stringInstrument(p))).toEqual(names.map(() => undefined));
  });
  it('keeps a band bass and guitar as fretted instruments', async () => {
    const score = await load(['Guitar', 'Bass']);
    expect(score.parts.map(p => p.instrument)).toEqual(['guitar', 'bassguitar']);
    expect(stringInstrument(score.parts[1])).toBe('bass4');
  });
  it('preserves an explicit bass program even beside a choir label', async () => {
    const score = await load(['Soprano', 'Bass'], 34);
    expect(score.parts[1].instrument).toBe('bassguitar');
    expect(score.parts[1].gmProgram).toBe(34);
    expect(stringInstrument(score.parts[1])).toBe('bass4');
  });
  it('does not treat a tenor saxophone as a choir label', async () => {
    const score = await load(['Tenor Saxophone', 'Bass']);
    expect(score.parts[1].instrument).toBe('bassguitar');
    expect(stringInstrument(score.parts[1])).toBe('bass4');
  });
});
