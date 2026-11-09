import { describe, expect, it } from 'vitest';
import { parseAbc } from './import';
import { generatedPitchId, scoreToMei } from './notation/document';
import { scoreForView, soundingMidi, spellingSpecFor } from './transpose';
import { applyInstrumentView } from './instrument-view';
import { respellMei } from './notation/mei-spelling';
import type { InstrumentId, Part, Score } from './score';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

const fixtures = import.meta.glob('./__fixtures__/abc/*.abc', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const load = (name: string) => parseAbc(fixtures[`./__fixtures__/abc/${name}.abc`]);
const abc = (body: string, header = 'K:C') => parseAbc(`X:1\nM:4/4\nL:1/4\n${header}\n${body}`);

describe('ABC engraving fidelity', () => {
  it('preserves explicit signs, carried alterations and bar resets', async () => {
    const score = await load('g-accidentals');
    const [a, b] = score.parts[0].measures;
    expect(a.notes.map(n => n.pitches[0].alter)).toEqual([1, 0, 1, 1]);
    expect(a.notes.map(n => n.pitches[0].accidental)).toEqual(['sharp', undefined, 'sharp', undefined]);
    expect(b.notes.map(n => n.pitches[0].alter)).toEqual([-1, -1, 0, 0]);
    expect(b.notes.map(n => n.pitches[0].accidental)).toEqual(['flat', undefined, 'natural', undefined]);
    const mei = scoreToMei(score);
    expect(mei.match(/ accid="s"/g)).toHaveLength(2);
    expect(mei).toContain('accid="n"');
    const reset = await abc('^F F F F | F4 |]');
    expect(reset.parts[0].measures[1].notes[0].pitches[0].alter).toBe(0);
    const wrapped = await abc('^F F\nF F | F4 |]');
    expect(wrapped.parts[0].measures[0].notes.map(n => n.pitches[0].alter)).toEqual([1, 1, 1, 1]);
  });

  it('keeps cello and augmented-chord accidentals visible', async () => {
    const cello = await load('c-cello');
    expect(cello.keyMode).toBe('minor');
    expect(cello.parts[0].clef).toBe('bass');
    expect(cello.parts[0].measures[1].notes[1].pitches[0]).toMatchObject({ step: 'C', octave: 3, alter: 1, accidental: 'sharp' });
    expect(scoreToMei(cello)).toContain('accid="s"');
    const chords = await load('f-chords');
    expect(chords.parts[0].measures[2].notes[1].pitches[0]).toMatchObject({ step: 'G', alter: 1, accidental: 'sharp' });
    expect(scoreToMei(chords)).toContain('accid="s"');
  });

  it('follows mid-tune keys without counting cancellation naturals', async () => {
    const score = await load('b-spelling');
    const measures = score.parts[0].measures;
    expect(measures.map(m => m.key)).toEqual([6, 6, 6, -6, -6, -6]);
    expect(measures[1].notes[2].pitches[0]).toMatchObject({ step: 'E', alter: 1, midi: 77 });
    expect(measures[3].notes.map(n => n.pitches[0].midi)).toEqual([66, 68, 70, 71]);
    expect(measures[3].notes[3].pitches[0]).toMatchObject({ step: 'C', alter: -1, octave: 5 });
    expect(scoreToMei(score)).toMatch(/<scoreDef><staffGrp><staffDef n="1" key.sig="6f"/);
    const control = await load('b2-gb');
    expect(control.parts[0].measures[0].notes.map(n => n.pitches[0])).toEqual(measures[3].notes.map(n => n.pitches[0]));
    const inline = await abc('F4 | [K:G] F4 | [K:C] F4 |]');
    expect(inline.parts[0].measures.map(m => m.key)).toEqual([0, 1, 0]);
    expect(inline.parts[0].measures.map(m => m.notes[0].pitches[0].midi)).toEqual([65, 66, 65]);
    expect(scoreToMei(inline)).toContain('key.sig="0" key.mode="major"');
  });

  it.each(['a-piano-grand', 'a2-piano-fixed'])('keeps text separate from harmony in %s', async name => {
    const score = await load(name);
    expect(score.parts[0].measures[0].notes[0].chordSymbol).toBe('C7');
    expect(score.parts[0].measures[0].directions).toContainEqual({ start: 0, text: 'Swing', placement: 'above' });
    const mei = scoreToMei(score);
    expect(mei).toContain('<dir staff="1" tstamp="1" place="above">Swing</dir>');
    expect(mei).toContain('>C7</harm>');
    expect(mei).not.toContain('>Swing</harm>');
    expect(mei).toContain('right="end"');
  });

  it('escapes annotations, retains placement and lets repeats take precedence', async () => {
    const score = await abc('"_A&B""C7"C4 || "^up"D4 :|');
    expect(scoreToMei(score)).toContain('place="below">A&amp;B</dir>');
    expect(scoreToMei(score)).toContain('right="dbl"');
    expect(scoreToMei(score)).toContain('right="rptend"');
  });

  it('draws the guitar octave clef and written G4 while sounding G3', async () => {
    const score = await load('e-guitar');
    const part = score.parts[0], note = part.measures[0].notes[0];
    expect(part.clef).toBe('treble-8');
    expect(part.pitchBasis).toBe('written');
    expect(part.transposition).toEqual({ semitones: -12, diatonic: -7 });
    expect(note.pitches[0]).toMatchObject({ octave: 4, midi: 67 });
    expect(soundingMidi(part, part.measures[0], note.pitches[0], 0)).toBe(55);
    expect(scoreToMei(score)).toContain('clef.shape="G" clef.line="2" clef.dis="8" clef.dis.place="below"');
    expect(scoreToMei(score)).toContain(`xml:id="${generatedPitchId(note, 0)}" pname="g" oct="4"`);
  });

  it.each([
    ['treble+8', 'G', 2, 'above', 3], ['bass-8', 'F', 4, 'below', 5],
    ['alto', 'C', 3, undefined, 4], ['tenor', 'C', 4, undefined, 4],
  ])('retains %s', async (clef, shape, line, place, octave) => {
    const score = await abc('G4 |]', `K:C clef=${clef}`);
    expect(score.parts[0].clef).toBe(clef);
    expect(scoreToMei(score)).toContain(`clef.shape="${shape}" clef.line="${line}"`);
    if (place) expect(scoreToMei(score)).toContain(`clef.dis="8" clef.dis.place="${place}"`);
    expect(scoreToMei(score)).toContain(`pname="g" oct="${octave}"`);
    const part = score.parts[0];
    expect(soundingMidi(part, part.measures[0], part.measures[0].notes[0].pitches[0], 0)).toBe(67);
  });

  const switchedMei = (source: Score, switched: Score) => respellMei(scoreToMei(source), spellingSpecFor(switched, new Map(switched.parts.map((p, i) => [p.id, String(i + 1)]))));
  const assertWrittenPitches = (mei: string, part: Part) => {
    for (const measure of part.measures) for (const note of measure.notes) for (const [i, pitch] of note.pitches.entries()) {
      const tag = mei.match(new RegExp(`<note\\b[^>]*xml:id="${generatedPitchId(note, i)}"[^>]*>`))?.[0];
      expect(tag).toBeDefined();
      expect(tag).toContain(`pname="${pitch.step.toLowerCase()}"`);
      expect(tag).toContain(`oct="${pitch.octave}"`);
    }
  };

  it.each(['treble-8', 'treble+8', 'bass-8'])('keeps %s written octaves in switched and concert engraving', async clef => {
    const score = await abc('G, C D E |]', `K:C clef=${clef}`);
    const source = score.parts[0];
    for (const target of ['alto-saxophone', 'flute', 'guitar'] as InstrumentId[]) for (const view of ['written', 'concert'] as const) {
      const switched = applyInstrumentView(scoreForView(score, view, 0), { [source.id]: { instrument: target, level: 'advanced', autoRange: false, octaves: {} } }, view).score;
      const part = switched.parts[0];
      const mei = switchedMei(score, switched);
      assertWrittenPitches(mei, part);
      expect(part.measures[0].notes.map(n => soundingMidi(part, part.measures[0], n.pitches[0], 0))).toEqual([55, 60, 62, 64]);
      if (clef === 'treble-8' && view === 'written') {
        expect(part.measures[0].notes.map(n => n.pitches[0].midi)).toEqual(target === 'alto-saxophone' ? [64, 69, 71, 73] : target === 'guitar' ? [67, 72, 74, 76] : [55, 60, 62, 64]);
      }
    }
    const concert = scoreForView(score, 'concert', 0);
    assertWrittenPitches(switchedMei(score, concert), concert.parts[0]);
  });

  it('records octave-clef changes per measure without changing sounding pitches', async () => {
    const score = await abc('G,4 | [K:C clef=treble]G4 | [K:C clef=treble+8]G4 |]', 'K:C clef=treble-8');
    const part = score.parts[0];
    expect(part.measures.map(m => m.transposition)).toEqual([{ semitones: -12, diatonic: -7 }, { semitones: 0, diatonic: 0 }, { semitones: 12, diatonic: 7 }]);
    expect(part.measures.map(m => soundingMidi(part, m, m.notes[0].pitches[0], 0))).toEqual([55, 67, 67]);
    expect(part.measures.map(m => m.notes[0].pitches[0].octave)).toEqual([4, 4, 3]);
  });

  it('carries a tied alteration across a bar without changing later untied notes', async () => {
    for (const separator of [' ', '\n']) {
      const score = await abc(`C D E ^F- |${separator}F G A F |]`);
      const part = score.parts[0], continuation = part.measures[1].notes[0];
      expect(continuation.pitches[0]).toMatchObject({ midi: 66, alter: 1, tieStop: true });
      expect(continuation.pitches[0].accidental).toBeUndefined();
      expect(part.measures[1].notes[3].pitches[0]).toMatchObject({ midi: 65, alter: 0 });
      const mei = scoreToMei(score);
      const tag = mei.match(new RegExp(`<note[^>]*xml:id="${generatedPitchId(continuation, 0)}"[^>]*>`))?.[0];
      expect(tag).toContain('accid.ges="s"');
      expect(tag).not.toContain(' accid=');
      expect(tag).toContain('tie="t"');
    }
    const chain = await abc('^F4- | F4- | F F F F |]');
    expect(chain.parts[0].measures.map(m => m.notes[0].pitches[0].midi)).toEqual([66, 66, 66]);
    expect(chain.parts[0].measures[2].notes[1].pitches[0].midi).toBe(65);
  });

  it('keeps mid-bar key signatures at their onset through the reader spelling pass', async () => {
    const score = await abc('C D [K:G] F F | F4 |]');
    const part = score.parts[0];
    expect(part.measures[0].key).toBe(0);
    expect(part.measures[0].keyChanges).toEqual([{ start: 2, key: 1, keyMode: 'major' }]);
    expect(part.measures[0].notes.map(n => n.pitches[0].midi)).toEqual([60, 62, 66, 66]);
    const toolkit = new VerovioToolkit(await createVerovioModule());
    try {
      for (const target of [undefined, 'alto-saxophone'] as const) {
        const shown = target ? applyInstrumentView(score, { [part.id]: { instrument: target, level: 'advanced', autoRange: false, octaves: {} } }, 'written').score : score;
        expect(toolkit.loadData(scoreToMei(score))).toBeTruthy();
        const spec = spellingSpecFor(shown, new Map([[part.id, '1']]));
        // The reader spells Verovio's normalized baseline, not just our original MEI string.
        const mei = respellMei(toolkit.getMEI(), spec);
        const sig = target ? '<keySig sig="4s"' : '<keySig sig="1s"';
        const before = mei.indexOf(`xml:id="${generatedPitchId(part.measures[0].notes[1], 0)}"`);
        const after = mei.indexOf(`xml:id="${generatedPitchId(part.measures[0].notes[2], 0)}"`);
        expect(mei.indexOf(sig)).toBeGreaterThan(before);
        expect(mei.indexOf(sig)).toBeLessThan(after);
        expect(toolkit.loadData(mei)).toBeTruthy();
        expect(toolkit.renderToSVG(1).match(/class="keySig"/g)?.length).toBeGreaterThanOrEqual(2);
      }
    } finally { toolkit.destroy(); }
  });

  it('resets accidentals at each mid-bar signature and reads its implied pitches while respelling', async () => {
    const score = await abc('^F F [K:G] F =F [K:C] F F G A | C8 |]', 'L:1/8\nK:C');
    const part = score.parts[0];
    expect(part.measures[0].keyChanges?.map(k => [k.start, k.key])).toEqual([[1, 1], [2, 0]]);
    expect(part.measures[0].notes.map(n => n.pitches[0].midi)).toEqual([66, 66, 66, 65, 65, 65, 67, 69]);
    const baseline = scoreToMei(score).replaceAll(/ accid.ges="s"/g, '');
    const spec = spellingSpecFor(score, new Map([[part.id, '1']]));
    spec.staves['1'].shift = [7, 12];
    const mei = respellMei(baseline, spec);
    const notes = [...mei.matchAll(/<note\b[^>]*>/g)].map(m => m[0]);
    expect(notes[0]).toContain('oct="5"');
    expect(notes[2]).toContain('accid.ges="s"');
    expect(notes[2]).not.toContain(' accid="');
    expect(notes[4]).toContain('accid.ges="n"');
    expect(notes[4]).not.toContain(' accid="');
    expect(mei).toContain('<keySig sig="1s"');
    expect(mei).toMatch(/<keySig sig="0"\/>/);
  });

  it('keeps a key change after the final note at the following bar boundary', async () => {
    const score = await abc('C4 [K:G] | F4 |]');
    expect(score.parts[0].measures[0].keyChanges).toEqual([]);
    expect(score.parts[0].measures[1].key).toBe(1);
    const mei = scoreToMei(score);
    expect(mei).not.toContain('<keySig');
    expect(mei).toMatch(/<scoreDef><staffGrp><staffDef n="1" key.sig="1s"/);
    expect(mei.indexOf('key.sig="1s"')).toBeLessThan(mei.indexOf('<measure n="2"'));
  });

  it('keeps the instrument-switch workaround at the same sounding pitch', async () => {
    const score = await load('g-accidentals');
    const part = score.parts[0];
    const switched = applyInstrumentView(score, { [part.id]: { instrument: 'alto-saxophone', level: 'advanced', autoRange: false, octaves: {} } }, 'written').score.parts[0];
    expect(switched.instrument).toBe('alto-saxophone');
    for (const [i, measure] of switched.measures.entries()) for (const [j, note] of measure.notes.entries()) {
      expect(soundingMidi(switched, measure, note.pitches[0], 0)).toBe(part.measures[i].notes[j].pitches[0].midi);
    }
  });

  it('keeps percussion unpitched even when a later measure has a pitched clef', async () => {
    const score = await abc('F4 | F4 |]', 'K:D clef=perc');
    score.parts[0].measures[1].clef = 'treble';
    const mei = scoreToMei(score);
    expect(mei).not.toContain('pname=');
    expect(mei).not.toContain('clef.shape="G"');
    expect(mei.match(/loc="/g)).toHaveLength(2);
  });

  it('loads and engraves every T1 fixture in Verovio', async () => {
    const toolkit = new VerovioToolkit(await createVerovioModule());
    try {
      toolkit.setOptions({ breaks: 'none', pageWidth: 3000, pageHeight: 3000 });
      for (const source of Object.values(fixtures)) {
        const score = await parseAbc(source);
        expect(toolkit.loadData(scoreToMei(score))).toBeTruthy();
        const svg = toolkit.renderToSVG(1);
        expect(svg).toContain('<svg');
        expect(svg).toContain('class="note"');
        if (source.includes('Swing')) expect(svg).toContain('Swing');
        if (source.includes('Case G')) expect(svg.match(/class="accid"/g)?.length).toBeGreaterThanOrEqual(4);
      }
    } finally { toolkit.destroy(); }
  });

  it('retains chord kinds, dyads, ties, dots, rests, tempo, beams and ids', async () => {
    const chords = await load('f-chords');
    expect(chords.parts[0].measures.flatMap(m => m.notes.flatMap(n => n.chordSymbol || []))).toEqual(['Cmaj7', 'Dm7', 'Bm7♭5', 'Bdim7', 'Caug', 'Gsus4', 'C6', 'C/E']);
    const score = await load('a-piano-grand');
    expect(score.tempo).toBe(88);
    const notes = score.parts[0].measures.flatMap(m => m.notes);
    expect(notes.some(n => n.duration === .75)).toBe(true);
    expect(notes.some(n => n.rest)).toBe(true);
    expect(notes.some(n => n.tieStart)).toBe(true);
    expect(notes.some(n => n.tieStop)).toBe(true);
    expect(notes.some(n => n.beamStart)).toBe(true);
    expect(notes.some(n => n.beamEnd)).toBe(true);
    const mei = scoreToMei(score);
    expect(mei).toContain('<beam>');
    expect(mei).toContain('dots="1"');
    expect(mei).toContain('tie="i"');
    const dyad = score.parts[0].measures[0].notes[3];
    expect(dyad.pitches).toHaveLength(2);
    expect(generatedPitchId(dyad, 0)).toBe('n_abc-0-0-0-3_p1');
    expect(generatedPitchId(dyad, 1)).toBe('n_abc-0-0-0-3_p2');
    expect(mei).toContain('<chord xml:id="n_abc-0-0-0-3"');
    expect(mei).toContain('xml:id="n_abc-0-0-0-3_p2"');
  });
});
