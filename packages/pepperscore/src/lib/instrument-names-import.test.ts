import { describe, expect, it } from 'vitest';
import { parseAbc, parseMusicXml } from './import';
import { readMusicXml } from './notation/musicxml-source';
import { canShowTab } from './tab/tab-parts';
import { stringInstrument } from './tab/string-instruments';

const abc = (names: string[], program?: number) => parseAbc(`X:1\nM:4/4\nL:1/4\n${names.map((name, i) => `V:v${i} name="${name}"${i === names.length - 1 && program !== undefined ? `\n%%MIDI program ${program - 1}` : ''}`).join('\n')}\nK:C\n${names.map((_, i) => `[V:v${i}] CDEF |`).join('\n')}`);
const xml = (names: string[], program?: number) => `<score-partwise version="4.0"><part-list>${names.map((name, i) => `<score-part id="p${i}"><part-name>${name.replace(/&/g, '&amp;')}</part-name>${i === names.length - 1 && program !== undefined ? `<midi-instrument id="i${i}"><midi-channel>1</midi-channel><midi-program>${program}</midi-program></midi-instrument>` : ''}</score-part>`).join('')}</part-list>${names.map((_, i) => `<part id="p${i}"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>`).join('')}</score-partwise>`;

for (const [format, load] of [
  ['ABC', abc], ['MusicXML', (names: string[], program?: number) => parseMusicXml(xml(names, program))],
  ['MusicXML worker reader', (names: string[], program?: number) => readMusicXml(xml(names, program)).score],
] as const) describe(`${format} contextual instrument names`, () => {
  it.each([
    ['Soprano', 'Alto', 'Tenor', 'Bass'], ['S', 'A', 'T', 'B'],
    ['Soprano/Alto', 'Tenor/Bass'], ['Soprano & Alto', 'Tenor & Bass'], ['Sopranos', 'Altos', 'Tenors', 'Basses'], ['Sopranos/Altos', 'Tenors/Basses'], ['Sopranos & Altos', 'Tenors & Basses'], ['Treble', 'Alto', 'Tenor', 'Bass'], ['Mezzo-Soprano', 'Bass'],
    ['Sop.', 'Alt.', 'Ten.', 'Bass'], ['Alto', 'Tenor', 'Bass'], ['A', 'T', 'B'],
    ['Soprano 1', 'Soprano 2', 'Alto I', 'Alto II', 'Tenor 1', 'Tenor 2', 'Bass I', 'Bass II'],
    ['Alto 1', 'Tenor 1'], ['Baritone', 'Bass'], ['Ten.', 'Bass'],
  ])('resolves named or letter choir (%j) to voice without TAB', async (...names) => {
    const score = await load(names);
    expect(score.parts.map(p => p.instrument)).toEqual(names.map(() => 'microphone'));
    expect(canShowTab(score)).toBe(false);
  });
  it.each([
    ['Soprano Solo', 'Alto Solo', 'Tenor Solo', 'Bass Solo', 'Piano'],
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
  it.each(['Treble line', 'Mezzo melody', 'Bass Solo Guitar', 'Tenor/Bass Guitar'])('does not treat arbitrary or instrumental labels as voices: %s', async name => {
    const score = await load([name, 'Bass']);
    expect(score.parts[0].instrument).not.toBe('microphone');
    expect(score.parts[1].instrument).toBe('bassguitar');
  });
  it.each(['Treble', 'Treble II', 'Treble 1'])('keeps piano-staff label %s from creating choir context', async name => {
    const score = await load([name, 'Bass']);
    expect(score.parts.map(p => p.instrument)).toEqual(['piano', 'bassguitar']);
    expect(stringInstrument(score.parts[1])).toBe('bass4');
    expect(canShowTab(score)).toBe(true);
  });
  it.each(['Soprano', 'Alto', 'Tenor', 'Baritone', 'Mezzo', 'Contralto', 'Countertenor'])('recognizes Treble with another choir word %s', async name => {
    const score = await load(['Treble II', name, 'Bass']);
    expect(score.parts.map(p => p.instrument)).toEqual(['microphone', 'microphone', 'microphone']);
    expect(canShowTab(score)).toBe(false);
  });
  it('does not take misleading programmed choir names as Treble context', async () => {
    const score = await load(['Treble', 'Alto'], 1);
    expect(score.parts.map(p => p.instrument)).toEqual(['piano', 'piano']);
  });
  it('keeps Bass Solo a voice in a band', async () => {
    const score = await load(['Guitar', 'Drums', 'Bass Solo']);
    expect(score.parts[2].instrument).toBe('microphone');
    expect(stringInstrument(score.parts[2])).toBeUndefined();
  });
  it('does not infer B from a word-only voice label', async () => {
    expect((await load(['Soprano', 'B'])).parts.map(p => p.instrument)).toEqual(['microphone', 'piano']);
  });
  it.each(['Soprano', 'Alto', 'Tenor', 'Baritone', 'Alto II', 'Soprano Solo', 'Alto Solo', 'Tenor Solo', 'Bass Solo', 'Soprano/Alto', 'Tenor/Bass', 'Mezzo-Soprano', 'Mezzo', 'Contralto', 'Countertenor', 'Sopranos', 'Altos', 'Tenors', 'Basses', 'Treble Voice', 'Voice', 'Vocal', 'Choir', 'Singer'])('uses a voice for %s even alone', async name => {
    expect((await load([name])).parts[0].instrument).toBe('microphone');
  });
  it.each(['Bass Voice', 'Choir Bass', 'Bass (Vocal)'])('keeps explicit vocal hint %s even in a band', async name => {
    expect((await load(['Guitar', 'Drums', name])).parts[2].instrument).toBe('microphone');
  });
  it.each([
    ['English Horn', 'clarinet', 70, undefined], ['Cor Anglais', 'clarinet', 70, undefined],
    ['Flügelhorn', 'trumpet', undefined, undefined], ['Flu\u0308gelhorn', 'trumpet', undefined, undefined], ['Basset Horn', 'clarinet', undefined, undefined], ['Flugelhorn', 'trumpet', undefined, undefined],
    ['French Horn', 'trombone', 61, undefined], ['Horn in F', 'trombone', 61, undefined], ['Horn', 'trombone', 61, undefined],
    ['Treble Recorder', 'flute', 75, undefined], ['Mezzo-Soprano Sax', 'alto-saxophone', 65, undefined],
    ['Alto Flute', 'flute', undefined, undefined], ['Tenor Trombone', 'trombone', undefined, undefined],
    ['Baritone Horn', 'trombone', 61, undefined], ['Tenor Horn', 'trombone', 61, undefined],
    ['Soprano Recorder', 'flute', 75, undefined], ['Tenor Banjo', 'guitar', 106, undefined],
    ['Baritone Guitar', 'guitar', undefined, 'guitar'], ['Tenor Guitar', 'guitar', undefined, 'guitar'],
  ] as const)('keeps instrument noun %s and gives Bass no voice context', async (name, instrument, program, tab) => {
    const score = await load([name, 'Bass']);
    expect(score.parts[0].instrument).toBe(instrument);
    expect(score.parts[0].gmProgram).toBe(program);
    if (program === 70) expect(score.parts[0].gmSoundfont).toBe('english_horn');
    if (program === 61) expect(score.parts[0].gmSoundfont).toBe('french_horn');
    expect(stringInstrument(score.parts[0])).toBe(tab);
    expect(score.parts[1].instrument).toBe('bassguitar');
    expect(stringInstrument(score.parts[1])).toBe('bass4');
  });
  it.each(['Electric Bass', 'Acoustic Bass', 'Fretless Bass', 'E-Bass', 'Bass Guitar'])('keeps explicit %s and protects ambiguous Bass beside voices', async name => {
    const score = await load([name, 'Soprano', 'Bass']);
    expect(score.parts.map(p => p.instrument)).toEqual(['bassguitar', 'microphone', 'bassguitar']);
    expect(stringInstrument(score.parts[0])).toBe('bass4');
    expect(stringInstrument(score.parts[2])).toBe('bass4');
  });
  it.each(['Alto 2', 'Tenor II', 'Soprano (Choir)', 'Alto divisi', 'Soprano I div.', 'Mezzo', 'Contralto', 'Countertenor', 'Treble Voice', 'Treble (Choir)'])('retains voice label %s and choir context', async name => {
    const score = await load([name, 'Bass']);
    expect(score.parts.map(p => p.instrument)).toEqual(['microphone', 'microphone']);
  });
  it('uses sax names explicitly for a big band' , async () => {
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
    for (const name of ['Bass', 'Soprano 1', 'Tenor Sax', 'Treble', 'Bass Solo', 'Tenor/Bass', 'Mezzo-Soprano', 'English Horn', 'Cor Anglais', 'Basset Horn', 'Flugelhorn', 'Flügelhorn', 'French Horn', 'Horn in F', 'Horn']) {
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
