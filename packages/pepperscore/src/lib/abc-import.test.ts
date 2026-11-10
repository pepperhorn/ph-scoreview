import { describe, expect, it } from 'vitest';
import { parseAbc, parseMusicXml } from './import';
import { generatedPitchId, scoreToMei, staffDefXmlId } from './notation/document';
import { scoreForView, soundingMidi, spellingSpecFor } from './transpose';
import { applyInstrumentView } from './instrument-view';
import { respellMei } from './notation/mei-spelling';
import type { InstrumentId, Part, Score } from './score';
import { buildPerformanceTimeline } from './playback/timeline';
import { scanBaseline, buildViewMei } from './notation/mei-view';
import { planStaves } from './render';
import { sourcePartOf } from './instrument-view';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

const fixtures = import.meta.glob('./__fixtures__/abc/*.abc', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const load = (name: string) => parseAbc(fixtures[`./__fixtures__/abc/${name}.abc`]);
const abc = (body: string, header = 'K:C') => parseAbc(`X:1\nM:4/4\nL:1/4\n${header}\n${body}`);

describe('ABC engraving fidelity', () => {
  it.each(['Bass', 'Acoustic Bass', 'Electric Bass', 'Bass Guitar', 'Ukulele', 'Tenor Ukulele'])('imports the named sound for %s without a MIDI program', async name => {
    const score = await abc('CDEF |', `V:1 name="${name}"\nK:C`);
    expect(score.parts[0].instrument).toBe(name.includes('Ukulele') ? 'guitar' : 'bassguitar');
    expect(score.parts[0].gmProgram).toBeUndefined();
  });

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

  it('draws the guitar octave clef with sounding G3 encoded under clef.dis', async () => {
    const score = await load('e-guitar');
    const part = score.parts[0], note = part.measures[0].notes[0];
    expect(part.clef).toBe('treble-8');
    expect(part.pitchBasis).toBe('written');
    expect(part.transposition).toEqual({ semitones: 0, diatonic: 0 });
    expect(note.pitches[0]).toMatchObject({ octave: 3, midi: 55 });
    expect(soundingMidi(part, part.measures[0], note.pitches[0], 0)).toBe(55);
    expect(scoreToMei(score)).toContain('clef.shape="G" clef.line="2" clef.dis="8" clef.dis.place="below"');
    expect(scoreToMei(score)).toContain(`xml:id="${generatedPitchId(note, 0)}" pname="g" oct="3"`);
  });

  it.each([
    ['treble+8', 'G', 2, 'above', 4], ['bass-8', 'F', 4, 'below', 4],
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
      expect(tag).toContain(`oct="${pitch.octave - (part.clef === 'treble8vb' ? 1 : 0)}"`);
    }
  };

  it.each(['treble-8', 'treble+8', 'bass-8'])('keeps %s sounding octaves in switched and concert engraving', async clef => {
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
    expect(part.measures.map(m => m.transposition)).toEqual([{ semitones: 0, diatonic: 0 }, { semitones: 0, diatonic: 0 }, { semitones: 0, diatonic: 0 }]);
    expect(part.measures.map(m => soundingMidi(part, m, m.notes[0].pitches[0], 0))).toEqual([55, 67, 67]);
    expect(part.measures.map(m => m.notes[0].pitches[0].octave)).toEqual([3, 4, 4]);
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

  it('loads and engraves every ABC fixture in Verovio', async () => {
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


describe('ABC parts and instruments', () => {
  it.each(['a-piano-grand', 'a2-piano-fixed'])('groups %s while preserving staff and playback identity', async name => {
    const score = await load(name);
    const [rh, lh] = score.parts;
    expect(score.parts).toHaveLength(2);
    expect(sourcePartOf(rh)).toBe(sourcePartOf(lh));
    expect(score.parts.map(p => p.id)).toEqual(['abc-0-0-1', 'abc-0-0-2']);
    expect(score.parts.map(p => p.name)).toEqual(['Piano', 'Piano']);
    const mei = scoreToMei(score);
    expect(mei).toContain('<staffGrp symbol="brace" label="Piano">');
    expect(mei.match(/label="Piano"/g)).toHaveLength(1);
    expect(mei).not.toContain('Melody');
    for (const part of score.parts) expect(mei).toContain(`xml:id="${staffDefXmlId(part.id)}"`);
    const timeline = buildPerformanceTimeline(score, { bpm: score.tempo });
    for (const part of score.parts) {
      const note = part.measures[0].notes[0];
      const event = timeline.events.find(e => e.noteId === note.id);
      expect(event?.partId).toBe(part.id);
      expect(mei).toContain(`xml:id="${generatedPitchId(note, 0)}"`);
      expect(event?.visualNoteIds).toContain(note.id);
    }
    const toolkit = new VerovioToolkit(await createVerovioModule());
    try {
      expect(toolkit.loadData(mei)).toBeTruthy();
      expect(toolkit.renderToSVG(1)).toContain('class="grpSym"');
      const baseline = toolkit.getMEI();
      const plan = planStaves(scanBaseline(baseline), score, new Set([lh.id]));
      expect(plan.staffOf.get(rh.id)).toBe('1');
      expect(plan.staffOf.get(lh.id)).toBe('2');
      expect(plan.hiddenStaves).toEqual(['2']);
      const hidden = buildViewMei(baseline, { breakEvery: 0, chordSymbols: true, hiddenStaves: plan.hiddenStaves, spelling: plan.spelling });
      expect(hidden).not.toMatch(/<staff n="2"/);
      expect(hidden).toContain(`xml:id="${generatedPitchId(rh.measures[0].notes[0], 0)}"`);
      const switches = Object.fromEntries(score.parts.map(p => [p.id, { instrument: 'flute' as const, level: 'advanced' as const, autoRange: false, octaves: {} }]));
      const switched = applyInstrumentView(score, switches, 'written').score;
      expect(switched.parts.every(p => p.instrument === 'flute')).toBe(true);
      for (const [i, part] of switched.parts.entries()) for (const [j, measure] of part.measures.entries()) {
        expect(measure.notes.map(n => n.pitches.map(p => soundingMidi(part, measure, p, 0)))).toEqual(score.parts[i].measures[j].notes.map(n => n.pitches.map(p => p.midi)));
      }
    } finally { toolkit.destroy(); }
  });

  it('leaves unbraced and implicit voices separate', async () => {
    for (const grouping of ['', '%%score A B\n']) {
      const score = await abc('[V:A] C4 |\n[V:B] E4 |', `${grouping}V:A name="Top"\nV:B name="Bottom"\nK:C`);
      expect(score.parts.map(p => p.sourcePartId)).toEqual([undefined, undefined]);
      expect(scoreToMei(score)).not.toContain('symbol="brace"');
    }
  });

  it('keeps compressed staves attached to their source voices', async () => {
    const score = await abc('[V:A] C4 |\n[V:B] E4 |\n[V:B] F4 |\n[V:A] D4 |', 'V:A name="Same"\nV:B name="Same"\nK:C');
    expect(score.parts.map(p => p.measures.filter(m => m.notes.length).map(m => m.notes[0].pitches[0].midi))).toEqual([[60, 62], [64, 65]]);
    expect(new Set(score.parts.flatMap(p => p.measures.flatMap(m => m.notes.map(n => n.id)))).size).toBe(4);
  });

  it('does not leak a shared staff transpose into a different voice', async () => {
    const score = await abc('[V:A] C4 |\n[V:B] E4 |', '%%score (A B)\nV:A transpose=-9\nV:B\n%%MIDI transpose -2\nK:C');
    expect(score.parts.map(p => p.transposition?.semitones)).toEqual([-9, -2]);
  });

  it('shares host mid-bar keys with overlays and carries them across lines', async () => {
    const score = await abc('C D [K:G] F F & F F F F |\nF4 & F4 |]');
    expect(score.parts).toHaveLength(2);
    expect(score.parts[1].measures[0].notes.map(n => n.pitches[0].midi)).toEqual([65, 65, 66, 66]);
    expect(score.parts[1].measures[0].keyChanges).toEqual([{ start: 2, key: 1, keyMode: 'major' }]);
    expect(score.parts[1].measures[1].notes[0].pitches[0].midi).toBe(66);
    expect(scoreToMei(score).match(/<keySig sig="1s"/g)).toHaveLength(2);
  });

  it('matches the sax MusicXML sounding pitch while keeping written A major', async () => {
    const source = await load('d2-sax-transpose'), part = source.parts[0];
    const xml = import.meta.glob('./__fixtures__/abc/*.musicxml', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
    const reference = parseMusicXml(xml['./__fixtures__/abc/d-alto-sax.musicxml']).parts[0];
    expect(part.transposition).toEqual({ semitones: -9, diatonic: -5 });
    expect(part.key).toBe(3);
    expect(part.measures[0].notes[0].pitches[0].midi).toBe(69);
    expect(soundingMidi(part, part.measures[0], part.measures[0].notes[0].pitches[0], 0)).toBe(60);
    expect(soundingMidi(reference, reference.measures[0], reference.measures[0].notes[0].pitches[0], 0)).toBe(60);
    expect(part).toMatchObject({ gmProgram: 66, gmSoundfont: 'alto_sax', instrument: 'alto-saxophone' });
    expect(scoreToMei(source)).toContain('key.sig="3s"');
    const nameOnly = await load('d1-sax-name');
    expect(nameOnly.parts[0].transposition?.semitones).toBe(0);
    const scoreAttribute = await load('d3-sax-score');
    expect(scoreAttribute.parts[0].measures[0].notes[0].pitches[0].midi).toBe(60);
    expect(scoreAttribute.parts[0].transposition?.semitones).toBe(0);
  });

  it('honours MIDI headers and V precedence, including explicit zero', async () => {
    const midi = await abc('A4 |]', '%%MIDI transpose -9\n%%MIDI program 0\nK:A');
    expect(midi.parts[0]).toMatchObject({ transposition: { semitones: -9, diatonic: -5 }, gmProgram: 1, gmSoundfont: 'acoustic_grand_piano' });
    for (const value of [0, -2]) {
      const score = await abc('A4 |]', `V:1 transpose=${value}\n%%MIDI transpose -9\nK:A`);
      expect(score.parts[0].transposition?.semitones).toBe(value);
    }
    const drums = await abc('C4 |]', '%%MIDI channel 10\n%%MIDI program 65\nK:C');
    expect(drums.parts[0]).toMatchObject({ instrument: 'drum-kit', clef: 'percussion' });
    expect(drums.parts[0].gmProgram).toBeUndefined();
    expect(scoreToMei(drums)).toContain('loc="');
    expect(scoreToMei(drums)).not.toContain('pname=');
  });

  it.each(['treble', 'treble-8', 'treble+8'])('composes %s with instrument intervals through switches and concert view', async clef => {
    const source = await abc('A4 |]', `V:1 clef=${clef} transpose=-9\nK:A`);
    const part = source.parts[0];
    expect(part.transposition?.semitones).toBe(-9);
    expect(part.measures[0].transposition).toEqual(part.transposition);
    for (const view of ['written', 'concert'] as const) for (const target of ['flute', 'guitar', 'alto-saxophone'] as const) {
      const switched = applyInstrumentView(scoreForView(source, view, 0), { [part.id]: { instrument: target, level: 'advanced', autoRange: false, octaves: {} } }, view).score;
      const shown = switched.parts[0], measure = shown.measures[0], note = measure.notes[0];
      expect(soundingMidi(shown, measure, note.pitches[0], 0)).toBe(60);
      const mei = respellMei(scoreToMei(source), spellingSpecFor(switched, new Map([[part.id, '1']])));
      const tag = mei.match(new RegExp(`<note[^>]*xml:id="${generatedPitchId(note, 0)}"[^>]*>`))?.[0];
      expect(tag).toContain(`oct="${note.pitches[0].octave - (shown.clef === 'treble8vb' ? 1 : 0)}"`);
      expect(tag).toContain(`pname="${note.pitches[0].step.toLowerCase()}"`);
    }
  });

  it('adds instrument transposition to every measure after a clef change', async () => {
    const score = await abc('A4 | [K:A clef=treble-8] A4 | [K:A clef=treble+8] A4 |]', 'V:1 transpose=-9\nK:A');
    const part = score.parts[0];
    expect(part.measures.map(m => m.transposition)).toEqual([
      { semitones: -9, diatonic: -5 }, { semitones: -9, diatonic: -5 }, { semitones: -9, diatonic: -5 },
    ]);
    expect(part.measures.map(m => soundingMidi(part, m, m.notes[0].pitches[0], 0))).toEqual([60, 60, 60]);
  });

  it('uses meter beats for both annotations and harmony in 6/8', async () => {
    const score = await abc('C "^text""G7"D E F G A |]', 'M:6/8\nL:1/8\nK:C');
    const mei = scoreToMei(score);
    expect(mei).toContain('<dir staff="1" tstamp="2"');
    expect(mei).toContain('<harm staff="1" tstamp="2"');
  });
});


describe('ABC review MIDI attribution and grouping', () => {
  it('keeps header and body MIDI scoped to a flute and drum voice', async () => {
    const score = await load('multivoice-midi');
    const [flute, drums] = score.parts;
    expect(flute).toMatchObject({ instrument: 'flute', gmProgram: 74, clef: 'treble', transposition: { semitones: -2, diatonic: -1 } });
    expect(flute.measures[0].notes[0].pitches[0].unpitched).toBeUndefined();
    expect(drums).toMatchObject({ instrument: 'drum-kit', clef: 'percussion', transposition: { semitones: 0 } });
    expect(drums.measures[0].notes.every(n => n.pitches.every(p => p.unpitched))).toBe(true);
    expect(scoreToMei(score)).toContain('clef.shape="perc"');
    expect(scoreToMei(score)).toContain('pname="c"');
  });

  it('inherits tune-wide defaults separately for each property and lets body directives override', async () => {
    const score = await abc('[V:A] C4 |\n[V:B] C4 |\n[V:A]\n%%MIDI transpose -5\nD4 |]', '%%MIDI program 73\n%%MIDI transpose -2\nV:A\n%%MIDI program 65\nV:B\nK:C');
    expect(score.parts.map(p => p.gmProgram)).toEqual([66, 74]);
    expect(score.parts[0].measures.map(m => m.transposition?.semitones)).toEqual([-2, -5]);
    expect(score.parts[1].measures[0].transposition?.semitones).toBe(-2);
    const local = await abc('[V:A] C4 |\n[V:B] C4 |]', 'V:A name="Flute"\n%%MIDI transpose -2\nV:B name="Cello" clef=bass\nK:C');
    expect(local.parts.map(p => p.transposition?.semitones)).toEqual([-2, 0]);
    expect(soundingMidi(local.parts[1], local.parts[1].measures[0], local.parts[1].measures[0].notes[0].pitches[0], 0)).toBe(60);
    const programs = await abc('[V:A] C4 |\n[V:B] C4 |]', 'V:A name="Alto Sax"\n%%MIDI program 65\nV:B name="Bass"\n%%MIDI program 32\nK:C');
    expect(programs.parts.map(p => p.gmProgram)).toEqual([66, 33]);
  });

  it('lets body program and channel override only the selected voice defaults', async () => {
    const score = await abc('[V:A]\n%%MIDI channel 1\n%%MIDI program 65\nC4 |\n[V:B] C4 |]', '%%MIDI channel 10\n%%MIDI program 73\nV:A name="Solo"\nV:B name="Beat"\nK:C');
    expect(score.parts[0]).toMatchObject({ instrument: 'alto-saxophone', gmProgram: 66, clef: 'treble' });
    expect(score.parts[0].measures[0].notes[0].pitches[0].unpitched).toBeUndefined();
    expect(score.parts[1]).toMatchObject({ instrument: 'drum-kit', clef: 'percussion' });
    expect(score.parts[1].gmProgram).toBeUndefined();
  });

  it('imports body channel 10 with percussion clefs and staff positions before parsing notes', async () => {
    const score = await abc('[V:F] C4 |\n[V:D]\n%%MIDI channel 10\nC D E F |]', 'V:F name="Flute"\nV:D name="Beat"\nK:C');
    const part = score.parts[1];
    expect(part).toMatchObject({ clef: 'percussion', instrument: 'drum-kit' });
    expect(part.measures[0].clef).toBe('percussion');
    expect(part.measures[0].notes[0].pitches[0]).toMatchObject({ unpitched: true, displayStep: 'C', displayOctave: 4 });
    const staff = scoreToMei(score).match(/<staff n="2">([\s\S]*?)<\/staff>/)?.[1];
    expect(staff).toContain('loc="');
    expect(staff).not.toContain('pname=');
    expect(score.parts[0].clef).toBe('treble');
  });

  it('preserves single-voice header-only MIDI imports', async () => {
    for (const voice of ['', 'V:solo name="Solo"\n']) {
      const score = await abc('A4 |]', `${voice}%%MIDI program 65\n%%MIDI transpose -9\nK:A`);
      const part = score.parts[0], m = part.measures[0];
      expect(part).toMatchObject({ gmProgram: 66, gmSoundfont: 'alto_sax', instrument: 'alto-saxophone' });
      expect(soundingMidi(part, m, m.notes[0].pitches[0], 0)).toBe(60);
    }
  });

  it('keeps late voice ids distinct from grand-staff ids', async () => {
    const score = await abc('[V:R] C4 |\n[V:L] C,4 |\n[V:Z] |\n[V:Z] G4 |]', '%%score {R | L} Z\nV:R name="Piano"\nV:L clef=bass\nV:Z name="Flute"\nK:C');
    expect(score.parts).toHaveLength(3);
    expect(new Set(score.parts.map(p => p.id)).size).toBe(3);
    expect(new Set(score.parts.flatMap(p => p.measures.flatMap(m => m.notes.map(n => n.id)))).size).toBe(3);
    const compressed = await abc('[V:R] C4 |\n[V:L] C,4 |\n[V:Z] |\n[V:Z] G4 |]', 'V:R name="Piano"\nV:L clef=bass\nV:Z name="Flute"\nK:C');
    expect(new Set(compressed.parts.map(p => p.id)).size).toBe(3);
    // Keeping its bar-only first line preserves this voice's original staff id.
    expect(compressed.parts[2].id).toBe('abc-2-0');
  });

  it('shares a named or explicitly programmed sound across braced staves', async () => {
    const organ = await abc('[V:R] C4 |\n[V:L] C,4 |]', '%%score {R | L}\nV:R name="Clarinet"\nV:L clef=bass\nK:C');
    expect(organ.parts.map(p => p.instrument)).toEqual(['clarinet', 'clarinet']);
    const programmed = await abc('[V:R] C4 |\n[V:L] C,4 |]', '%%score {R | L}\nV:R name="Piano"\n%%MIDI channel 1\nV:L clef=bass\n%%MIDI program 19\nK:C');
    expect(programmed.parts.map(p => p.gmProgram)).toEqual([20, 20]);
    expect(programmed.parts.map(p => p.gmSoundfont)).toEqual(['church_organ', 'church_organ']);
    expect(new Set(programmed.parts.map(p => p.instrument)).size).toBe(1);
  });

  it('ignores selectors in comments and lyric fields while retaining source offsets', async () => {
    const score = await abc('[V:A] C4 | % [V:B]\n% [V:B]\nw: [V:B]\nD4 |\n[V:B] E4 |]', 'V:A name="Flute"\nV:B name="Cello"\nK:C');
    expect(score.parts.map(p => p.measures.filter(m => m.notes.length).map(m => m.notes[0].pitches[0].midi))).toEqual([[60, 62], [64]]);
  });
});


describe('ABC r2 tune and default-voice boundaries', () => {
  it.each(['%%MIDI program 40', '%%MIDI channel 10', '%%MIDI program 40\n%%MIDI channel 10'])('ignores later-tune headers: %s', async directives => {
    for (const voice of ['', 'V:1 name="Flute"\n']) for (const laterVoice of ['', 'V:1 name="Drums" transpose=-9\n']) {
      const first = `X:1\nT:First\nM:4/4\nL:1/4\n${voice}K:C\nC D E F |]\n`;
      const later = `X:2\n${laterVoice}${directives}\nK:A\nA4 |]`;
      const alone = await parseAbc(first), book = await parseAbc(`${first}\n${later}`);
      expect(book.parts).toEqual(alone.parts);
      expect(scoreToMei(book)).toBe(scoreToMei(alone));
      expect(book.parts[0]).toMatchObject({ instrument: voice ? 'flute' : 'piano', clef: 'treble', transposition: { semitones: 0 } });
      expect(book.parts[0].gmProgram).toBeUndefined();
      expect(book.parts[0].measures[0].notes.map(n => n.pitches[0].midi)).toEqual([60, 62, 64, 65]);
      expect(book.parts[0].measures[0].notes.some(n => n.pitches.some(p => p.unpitched))).toBe(false);
    }
  });

  it('keeps file-header defaults and first-tune V declarations despite later tunes', async () => {
    const first = '%%MIDI program 73\n% preserve original offsets\nX:1\nM:4/4\nL:1/4\nV:A name="Flute"\nV:B name="Cello" clef=bass\nK:C\n%%MIDI transpose -2\nC4 |]\n[V:B] C,4 |]\n';
    const book = await parseAbc(first + '\nX:2\nV:A transpose=-9\n%%MIDI program 40\n%%MIDI channel 10\nK:A\nA4 |]');
    expect(book.parts).toEqual((await parseAbc(first)).parts);
    expect(book.parts.map(p => p.gmProgram)).toEqual([74, 74]);
    expect(book.parts.map(p => p.transposition?.semitones)).toEqual([-2, 0]);
    expect(book.parts.map(p => p.clef)).toEqual(['treble', 'bass']);
  });

  it('applies unselected body directives and music to the first declared voice', async () => {
    const score = await abc('%%MIDI program 40\n%%MIDI transpose -2\nC D E F |]\n[V:B] C,4 |]', 'V:A name="Flute"\nV:B name="Cello" clef=bass\nK:C');
    expect(score.parts.map(p => p.name)).toEqual(['Flute', 'Cello']);
    expect(score.parts[0]).toMatchObject({ gmProgram: 41, instrument: 'violin', clef: 'treble', transposition: { semitones: -2 } });
    expect(score.parts[1]).toMatchObject({ instrument: 'cello', clef: 'bass', transposition: { semitones: 0 } });
    expect(score.parts[1].gmProgram).toBeUndefined();
    expect(score.parts[0].measures[0].notes.map(n => n.pitches[0].midi)).toEqual([60, 62, 64, 65]);
    expect(score.parts[1].measures[0].notes[0].pitches[0].midi).toBe(48);
    const explicit = await abc('[V:A]\n%%MIDI program 40\n%%MIDI transpose -2\nC D E F |]\n[V:B] C,4 |]', 'V:A name="Flute"\nV:B name="Cello" clef=bass\nK:C');
    // Inserting a default selector internally must retain existing generated ids.
    expect(score.parts).toEqual(explicit.parts);
  });

  it('keeps an implicit default voice separate from later body voice declarations', async () => {
    const score = await abc('%%MIDI program 40\nC4 |]\n[V:B] E4 |]');
    expect(score.parts).toHaveLength(2);
    expect(score.parts[0]).toMatchObject({ instrument: 'violin', gmProgram: 41 });
    expect(score.parts[0].measures[0].notes[0].pitches[0].midi).toBe(60);
    expect(score.parts[1].instrument).toBe('piano');
    expect(score.parts[1].gmProgram).toBeUndefined();
    expect(score.parts[1].measures[0].notes[0].pitches[0].midi).toBe(64);
  });

  it('applies an unselected body channel to the first voice only', async () => {
    const score = await abc('%%MIDI channel 10\nC4 |]\nV:B\nC,4 |]', 'V:A name="Beat"\nV:B name="Cello" clef=bass\nK:C');
    expect(score.parts[0]).toMatchObject({ instrument: 'drum-kit', clef: 'percussion' });
    expect(score.parts[0].measures[0].notes[0].pitches[0].unpitched).toBe(true);
    expect(score.parts[1]).toMatchObject({ instrument: 'cello', clef: 'bass' });
    expect(score.parts[1].measures[0].notes[0].pitches[0].unpitched).toBeUndefined();
  });

  it('retains a bar-only voice as an empty part with the original id', async () => {
    const score = await abc('[V:A] C4 |]\n[V:B] |]', 'V:A name="Flute"\nV:B name="Cello" clef=bass\nK:C');
    expect(score.parts).toHaveLength(2);
    expect(score.parts[1]).toMatchObject({ id: 'abc-1-0', name: 'Cello', instrument: 'cello', clef: 'bass' });
    expect(score.parts[1].measures).toHaveLength(1);
    expect(score.parts[1].measures[0].notes).toEqual([]);
    const mei = scoreToMei(score);
    expect(mei).toContain(`xml:id="${staffDefXmlId('abc-1-0')}" n="2"`);
    expect(mei).toContain('<staff n="2"><layer n="1"><rest dur="1"/></layer></staff>');
  });

  it('documents and implements unpitched drum names without a MIDI program', async () => {
    const drums = await abc('C D E F |]', 'V:1 name="Drums"\nK:C');
    expect(drums.parts[0]).toMatchObject({ instrument: 'drum-kit', clef: 'percussion' });
    expect(drums.parts[0].measures[0].notes.every(n => n.pitches.every(p => p.unpitched))).toBe(true);
    expect(scoreToMei(drums)).not.toContain('pname=');
    const programmed = await abc('C4 |]', 'V:1 name="Drums"\n%%MIDI program 73\nK:C');
    expect(programmed.parts[0]).toMatchObject({ instrument: 'flute', clef: 'treble', gmProgram: 74 });
    expect(programmed.parts[0].measures[0].notes[0].pitches[0].unpitched).toBeUndefined();
  });

  it.each(['name', 'clef', 'header channel', 'body channel'])('never propagates percussion across a brace: %s', async route => {
    const lh = route === 'name' ? 'name="Drums"' : `name="Beat"${route === 'clef' ? ' clef=perc' : ''}`;
    const score = await abc(`[V:R] C4 |]\n[V:L]\n${route === 'body channel' ? '%%MIDI channel 10\n' : ''}C4 |]`, `%%score {R | L}\nV:R name="Clarinet"\n%%MIDI program 71\nV:L ${lh}\n${route === 'header channel' ? '%%MIDI channel 10\n' : ''}K:C`);
    const [pitched, drums] = score.parts;
    expect(pitched).toMatchObject({ clef: 'treble', instrument: 'clarinet', gmProgram: 72 });
    expect(pitched.measures[0].notes[0].pitches[0].unpitched).toBeUndefined();
    expect(drums).toMatchObject({ clef: 'percussion', instrument: 'drum-kit' });
    expect(drums.gmProgram).toBeUndefined();
    expect(drums.measures[0].notes[0].pitches[0].unpitched).toBe(true);
    expect(sourcePartOf(pitched)).toBe(sourcePartOf(drums));
    expect(scoreToMei(score)).toContain('pname="c"');
    expect(scoreToMei(score)).toContain('loc="');
  });

  it('still shares sound among pitched partners when percussion is first in a brace', async () => {
    const score = await abc('[V:R] C4 |]\n[V:M] C,4 |]\n[V:D] C4 |]', '%%score {D | R | M}\nV:R name="Clarinet"\n%%MIDI program 71\nV:M clef=bass\nV:D name="Drums"\nK:C');
    expect(score.parts[0]).toMatchObject({ instrument: 'drum-kit', clef: 'percussion' });
    const pitched = score.parts.filter(p => p.clef !== 'percussion');
    expect(pitched).toHaveLength(2);
    expect(pitched.map(p => p.gmProgram)).toEqual([72, 72]);
    expect(pitched.map(p => p.instrument)).toEqual(['clarinet', 'clarinet']);
    expect(pitched.every(p => p.measures[0].notes.every(n => n.pitches.every(pitch => !pitch.unpitched)))).toBe(true);
    expect(new Set(score.parts.map(sourcePartOf)).size).toBe(1);
  });

  it('chooses the named pitched voice when a mixed brace has no explicit program', async () => {
    const score = await abc('[V:R] C4 |]\n[V:M] C,4 |]\n[V:D] C4 |]', '%%score {D | R | M}\nV:R\nV:M name="Clarinet" clef=bass\nV:D name="Drums"\nK:C');
    expect(score.parts[0]).toMatchObject({ instrument: 'drum-kit', clef: 'percussion' });
    expect(score.parts.filter(p => p.clef !== 'percussion').map(p => p.instrument)).toEqual(['clarinet', 'clarinet']);
  });

  it('keeps indexed MIDI changes aligned with their measure onsets, including zero', async () => {
    const shifts = [0, -2, -5, 0, 2, 5, 0, -9, 0, 12, -12, 0];
    const score = await abc('[V:A]\n' + shifts.map(shift => `%%MIDI transpose ${shift}\nC4 |`).join('\n') + '\n[V:B] C4 |]', '%%MIDI program 73\nV:A\nV:B\nK:C');
    expect(score.parts[0].measures.map(m => m.transposition?.semitones)).toEqual(shifts);
    expect(score.parts[0].measures.map(m => soundingMidi(score.parts[0], m, m.notes[0].pitches[0], 0))).toEqual(shifts.map(shift => 60 + shift));
    expect(score.parts.map(p => p.gmProgram)).toEqual([74, 74]);
    expect(score.parts[1].measures[0].transposition?.semitones).toBe(0);
  });
});

describe('ABC body-only voice and file-header directive scoping', () => {
  it.each(['V:A', '[V:A]'])('attributes body-only voice MIDI after %s', async selector => {
    const score = await abc(`${selector}\n%%MIDI program 65\n%%MIDI transpose -9\nA4 |]\nV:B\n%%MIDI channel 10\nC4 |]\nV:C\n%%MIDI program 73\n%%MIDI transpose -2\nD4 |]`);
    expect(score.parts).toHaveLength(3);
    expect(score.parts[0]).toMatchObject({ gmProgram: 66, instrument: 'alto-saxophone', transposition: { semitones: -9 } });
    expect(score.parts[1]).toMatchObject({ instrument: 'drum-kit', clef: 'percussion' });
    expect(score.parts[1].measures[0].notes[0].pitches[0].unpitched).toBe(true);
    expect(score.parts[2]).toMatchObject({ gmProgram: 74, instrument: 'flute', transposition: { semitones: -2 } });
    expect(score.parts.map(p => soundingMidi(p, p.measures[0], p.measures[0].notes[0].pitches[0], 0))).toEqual([60, 60, 60]);
  });

  it('applies pre-selector body MIDI to the first body-only voice', async () => {
    const score = await abc('%%MIDI program 65\n%%MIDI transpose -9\nV:A\nA4 |]\nV:B\nC4 |]');
    expect(score.parts).toHaveLength(2);
    expect(score.parts[0]).toMatchObject({ gmProgram: 66, instrument: 'alto-saxophone', transposition: { semitones: -9 } });
    expect(score.parts[1]).toMatchObject({ instrument: 'piano', transposition: { semitones: 0 } });
    expect(score.parts[1].gmProgram).toBeUndefined();
  });

  it('applies a pre-selector body channel only to the first body-only voice', async () => {
    const score = await abc('%%MIDI channel 10\nV:A\nC4 |]\nV:B\nC4 |]');
    expect(score.parts[0]).toMatchObject({ instrument: 'drum-kit', clef: 'percussion' });
    expect(score.parts[0].measures[0].notes[0].pitches[0].unpitched).toBe(true);
    expect(score.parts[1]).toMatchObject({ instrument: 'piano', clef: 'treble' });
    expect(score.parts[1].measures[0].notes[0].pitches[0].unpitched).toBeUndefined();
  });

  it('keeps pre-selector MIDI on an implicit bar-only voice', async () => {
    const score = await abc('%%MIDI program 40\n|]\nV:B\nC4 |]');
    expect(score.parts).toHaveLength(2);
    expect(score.parts[0]).toMatchObject({ instrument: 'violin', gmProgram: 41 });
    expect(score.parts[0].measures[0].notes).toEqual([]);
    expect(score.parts[1].instrument).toBe('piano');
    expect(score.parts[1].gmProgram).toBeUndefined();
  });

  it('ends the tune header at its own K: despite a file-header K:', async () => {
    const first = 'K:G\n%%MIDI program 73\nX:1\nM:4/4\nL:1/4\nV:A name="Solo" clef=alto\n%%MIDI program 65\n%%MIDI transpose -9\nV:B name="Bass" clef=bass\n%%MIDI program 42\nK:C\nA4 |]\n[V:B] C,4 |]\n';
    const score = await parseAbc(first + '\nX:2\nV:A\n%%MIDI channel 10\nK:A\nA4 |]');
    expect(score.parts).toEqual((await parseAbc(first)).parts);
    expect(score.key).toBe(0);
    expect(score.parts.map(p => p.name)).toEqual(['Solo', 'Bass']);
    expect(score.parts.map(p => p.clef)).toEqual(['alto', 'bass']);
    expect(score.parts.map(p => p.gmProgram)).toEqual([66, 43]);
    expect(score.parts.map(p => p.transposition?.semitones)).toEqual([-9, 0]);
  });
});

describe('ABC file-header voice declarations', () => {
  it.each(['bass', 'treble-8'])('preserves a pre-X: %s clef and sounding octaves', async clef => {
    const header = `V:1 name="Solo" clef=${clef}\n`;
    const tune = 'X:1\nM:4/4\nL:1/4\nK:C\nC4 |]';
    const score = await parseAbc(header + tune);
    const control = await parseAbc(tune.replace('X:1\n', `X:1\n${header}`));
    expect(score.parts).toEqual(control.parts);
    expect(score.parts[0]).toMatchObject({ name: 'Solo', clef, transposition: { semitones: 0 } });
    expect(score.parts[0].measures[0].clef).toBe(clef);
    expect(scoreToMei(score)).toBe(scoreToMei(control));
    expect(soundingMidi(score.parts[0], score.parts[0].measures[0], score.parts[0].measures[0].notes[0].pitches[0], 0)).toBe(60);
  });

  it('lets tune-header properties override file-header properties for the same id', async () => {
    const score = await parseAbc('V:1 name="Old" clef=bass transpose=-9\n%%MIDI program 42\nX:1\nM:4/4\nL:1/4\nV:1 name="Solo" clef=treble-8 transpose=0\n%%MIDI program 73\nK:C\nC4 |]');
    expect(score.parts).toHaveLength(1);
    expect(score.parts[0]).toMatchObject({ name: 'Solo', clef: 'treble-8', gmProgram: 74, transposition: { semitones: 0 } });
  });

  it('inherits unspecified file-header properties while keeping V: transpose ahead of MIDI', async () => {
    const score = await parseAbc('V:1 name="Old" clef=bass transpose=-9\n%%MIDI program 65\n%%MIDI transpose -2\nX:1\nM:4/4\nL:1/4\nV:1 name="Solo"\nK:A\nA4 |]');
    const part = score.parts[0], measure = part.measures[0];
    expect(part).toMatchObject({ name: 'Solo', clef: 'bass', gmProgram: 66, transposition: { semitones: -9 } });
    expect(measure.transposition?.semitones).toBe(-9);
    expect(soundingMidi(part, measure, measure.notes[0].pitches[0], 0)).toBe(60);
  });

  it('retains voice identity and MIDI source attribution across first-tune boundaries', async () => {
    const file = '%%MIDI program 73\n% offsets must survive\nV:A name="Solo" clef=alto transpose=-9\n%%MIDI program 65\nV:B name="Bass" clef=bass\n%%MIDI program 42\n';
    const tune = 'X:1\nM:4/4\nL:1/4\nK:C\nA4 |]\n[V:B]\n%%MIDI transpose -2\nC,4 |]\n[V:A]\n%%MIDI channel 10\nD4 |]\n';
    const later = '\nX:2\nV:A name="Wrong" clef=treble+8 transpose=12\n%%MIDI program 40\nK:A\nA4 |]';
    const score = await parseAbc(file + tune);
    const book = await parseAbc(file + tune + later);
    expect(book.parts).toEqual(score.parts);
    expect(score.parts).toHaveLength(2);
    expect(score.parts[0]).toMatchObject({ name: 'Solo', clef: 'percussion', instrument: 'drum-kit' });
    expect(score.parts[1]).toMatchObject({ name: 'Bass', clef: 'bass', gmProgram: 43, transposition: { semitones: -2 } });
    expect(score.parts[1].measures[0].notes[0].pitches[0]).toMatchObject({ step: 'C', octave: 3 });
    expect(score.parts[1].measures[0].transposition?.semitones).toBe(-2);
  });
});

describe('ABC file-header voices respect tune-header layout', () => {
  it.each(['%%score {RH | LH}', '%%staves {RH LH}'])('preserves a braced Piano and stable ids with %s', async layout => {
    const file = 'V:RH clef=treble\nV:LH clef=bass\n';
    const header = `X:1\nM:4/4\nL:1/4\n${layout}\n%%staffwidth 600\n`;
    for (const override of ['', 'V:RH name="Piano"\n']) {
      const tune = `${header}${override}K:C\n[V:RH] c4 |]\n[V:LH] C,4 |]`;
      const score = await parseAbc(file + tune);
      const control = await parseAbc(header + file + tune.slice(header.length));
      const withoutFileVoices = await parseAbc(tune);
      expect(score.parts).toEqual(control.parts);
      expect(score.parts.map(part => ({ id: part.id, sourcePartId: part.sourcePartId, name: part.name, notes: part.measures.flatMap(m => m.notes.map(n => n.id)) }))).toEqual(
        withoutFileVoices.parts.map(part => ({ id: part.id, sourcePartId: part.sourcePartId, name: part.name, notes: part.measures.flatMap(m => m.notes.map(n => n.id)) })),
      );
      expect(score.parts.map(p => ({ id: p.id, sourcePartId: p.sourcePartId, name: p.name, clef: p.clef }))).toEqual([
        { id: 'abc-0-0-1', sourcePartId: 'abc-0-0', name: 'Piano', clef: 'treble' },
        { id: 'abc-0-0-2', sourcePartId: 'abc-0-0', name: 'Piano', clef: 'bass' },
      ]);
      expect(scoreToMei(score)).toContain('symbol="brace"');
      expect(scoreToMei(score)).toBe(scoreToMei(control));
    }
  });

  it('keeps %%score (S A) voices on one staff and restores MIDI source coordinates', async () => {
    const file = 'V:S clef=treble\n';
    const header = 'X:1\nM:4/4\nL:1/4\n%%score (S A)\n%%staffwidth 600\n';
    const body = 'V:S\nV:A\nK:C\n[V:S] C4 |]\n[V:A]\n%%MIDI transpose -2\nE4 |]';
    const score = await parseAbc(file + header + body);
    const control = await parseAbc(header + file + body);
    expect(score.parts).toEqual(control.parts);
    expect(score.parts.map(p => p.id)).toEqual(['abc-0-0', 'abc-0-1']);
    expect(score.parts.map(p => p.measures[0].transposition?.semitones)).toEqual([0, -2]);
    expect(scoreToMei(score)).toBe(scoreToMei(control));
  });
});
