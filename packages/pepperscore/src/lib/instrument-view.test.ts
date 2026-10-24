import { describe, expect, it } from 'vitest';
import { applyInstrumentView, phrasesOf, sourcePartOf, switchablePart, type PartSwitch } from './instrument-view';
import { pitch, type Measure, type Part, type Pitch, type Score, type ScoreNote } from './score';
import { scoreForView, soundingMidi } from './transpose';

// Small Score fixtures: a note is `id:STEP[#b]OCT[~]` ('~' = tie start; a tie stop is inferred from the previous
// note's '~' in the same voice and pitch), `r` is a rest, `|` breaks the measure.
type NoteSpec = string | { id: string; p: string[]; slurStop?: string[]; tieStart?: boolean; tieStop?: boolean };
function measures(partId: string, spec: string): Measure[] {
  const open = new Set<number>();
  return spec.split('|').map((bar, index) => {
    const notes: ScoreNote[] = [];
    let start = 0;
    for (const token of bar.trim().split(/\s+/).filter(Boolean)) {
      if (token === 'r') { notes.push({ id: `${partId}-r${index}-${start}`, start, duration: 1, pitches: [], rest: true, voice: '1' }); start++; continue; }
      const [, id, step, accidental, octave, tie, slur] = /^(\w+):([A-G])([#b]?)(-?\d)(~?)(\)?)$/.exec(token)!;
      const p: Pitch = { ...pitch(step, Number(octave), accidental === '#' ? 1 : accidental === 'b' ? -1 : 0), sourceId: `m-${id}` };
      const tieStop = open.has(p.midi);
      if (tieStop) { p.tieStop = true; open.delete(p.midi); }
      if (tie) { p.tieStart = true; open.add(p.midi); }
      notes.push({ id, start, duration: 1, pitches: [p], voice: '1', ...(p.tieStart ? { tieStart: true } : {}), ...(tieStop ? { tieStop: true } : {}), ...(slur ? { slurStop: ['1'] } : {}) });
      start++;
    }
    return { index, beats: 4, notes };
  });
}
const part = (id: string, spec: string, extra: Partial<Part> = {}): Part => ({ id, name: id, clef: 'treble', instrument: 'piano', gmProgram: 1, pitchBasis: 'written', measures: measures(id, spec), ...extra });
const score = (...parts: Part[]): Score => ({ title: '', source: '', tempo: 120, beats: 4, beatType: 4, key: 0, parts });
const sw = (instrument: PartSwitch['instrument'], level: PartSwitch['level'] = 'intermediate', octaves: PartSwitch['octaves'] = {}, autoRange = true): PartSwitch => ({ instrument, level, autoRange, octaves });
const notesOf = (p: Part) => p.measures.flatMap(m => m.notes.filter(n => !n.rest));
const names = (p: Part) => notesOf(p).map(n => n.pitches.map(x => `${x.step}${x.alter === 1 ? '#' : x.alter === -1 ? 'b' : ''}${x.octave}`).join('+'));
const sounding = (p: Part) => p.measures.flatMap(m => m.notes.filter(n => !n.rest).map(n => soundingMidi(p, m, n.pitches[0], 0)));
const CLARINET = { instrument: 'clarinet' as const, gmProgram: 72, transposition: { semitones: -2, diatonic: -1 } };

describe('instrument view', () => {
  it('carries the switched staves (with source keys) on the Score, and a later view drops them', () => {
    const input = score(part('P1', 'a:C5 b:E5', { key: -1, measures: measures('P1', 'a:C5 b:E5').map(m => ({ ...m, key: -1 })) }));
    const result = applyInstrumentView(input, { P1: sw('alto-saxophone') }, 'written');
    // F major moved by the alto's written interval (a major sixth up) = D major.
    expect(result.score.instrumentView?.staves.P1).toMatchObject({ shift: [5, 9], clef: 'treble', keys: [[0, 2, 'major']] });
    expect(scoreForView(result.score, 'written', 2).instrumentView).toBeUndefined();
    expect(applyInstrumentView(input, {}, 'written').score.instrumentView).toBeUndefined();
  });
  it('sourcePartOf falls back to part.id when sourcePartId is undefined', () => {
    expect(sourcePartOf(part('P1', 'a:C4'))).toBe('P1');
    expect(sourcePartOf(part('P1-2', 'a:C4', { sourcePartId: 'P1' }))).toBe('P1');
  });

  it('phrasesOf breaks at rests and after slur ends, and joins ties across bars', () => {
    const p = part('P', 'a:C4 b:D4) c:E4 r | d:F4~ | e:F4 f:G4 r g:A4');
    expect(phrasesOf(p)).toEqual([['a', 'b'], ['c'], ['d', 'e', 'f'], ['g']]);
  });

  it('piano melody to trumpet written is a major second up, treble clef, trumpet sound', () => {
    const source = score(part('P', 'a:C4 b:D4 c:E4 d:F4', { clef: 'bass', measures: measures('P', 'a:C4 b:D4 c:E4 d:F4').map(m => ({ ...m, clef: 'bass' })) }));
    source.parts[0].measures[0].notes[0].chordSymbol = 'C7';
    const result = applyInstrumentView(source, { P: sw('trumpet') }, 'written');
    const out = result.score.parts[0];
    expect(names(out)).toEqual(['D4', 'E4', 'F#4', 'G4']);
    expect(out.measures[0].notes[0].chordSymbol).toBe('D7');
    expect(out).toMatchObject({ instrument: 'trumpet', gmProgram: 57, clef: 'treble', transposition: { semitones: -2, diatonic: -1 } });
    expect(out.measures.every(m => m.clef === undefined)).toBe(true);
    expect(out.measures[0].key).toBe(2);
    expect(result.moved).toEqual([]);
    expect(result.staves.P).toEqual({ shift: [1, 2], clef: 'treble', octaves: {} });
  });

  it('concert view keeps sounding pitch', () => {
    const source = score(part('P', 'a:C4 b:D4 c:E4 d:F4'));
    const out = applyInstrumentView(scoreForView(source, 'concert', 0), { P: sw('trumpet') }, 'concert').score.parts[0];
    expect(names(out)).toEqual(['C4', 'D4', 'E4', 'F4']);
    expect(sounding(out)).toEqual([60, 62, 64, 65]);
    expect(out.instrument).toBe('trumpet');
    // A transposing source in the concert view: clarinet written D4 E4 sounds C4 D4, shown so on trumpet.
    const clarinet = score(part('K', 'a:D4 b:E4', CLARINET));
    const concert = applyInstrumentView(scoreForView(clarinet, 'concert', 0), { K: sw('trumpet') }, 'concert');
    const outK = concert.score.parts[0];
    expect(names(outK)).toEqual(['C4', 'D4']);
    expect(sounding(outK)).toEqual([60, 62]);
    expect(outK.transposition).toBeUndefined();
    expect(concert.staves.K.shift).toEqual([-1, -2]);
  });

  it('switch keeps the source spelling', () => {
    const source = score(part('P', 'a:Bb4 b:Eb5 c:C#5'));
    expect(names(applyInstrumentView(source, { P: sw('flute') }, 'written').score.parts[0])).toEqual(['Bb4', 'Eb5', 'C#5']);
    expect(names(applyInstrumentView(source, { P: sw('violin') }, 'written').score.parts[0])).toEqual(['Bb4', 'Eb5', 'C#5']);
    expect(names(applyInstrumentView(source, { P: sw('trumpet') }, 'written').score.parts[0])).toEqual(['C5', 'F5', 'D#5']);
  });

  it('phrase below alto beginner range moves up and is listed in moved', () => {
    // Alto beginner: sounding 49..69. C3 D3 (48, 50) is below; C4 (60) fits.
    const result = applyInstrumentView(score(part('P', 'a:C3 b:D3 r c:C4')), { P: sw('alto-saxophone', 'beginner') }, 'written');
    const out = result.score.parts[0];
    expect(result.moved).toEqual(['a', 'b']);
    expect(sounding(out)).toEqual([60, 62, 60]);
    expect(names(out)).toEqual(['A4', 'B4', 'A4']);
    expect(result.outOfRange).toEqual([]);
    expect(result.staves.P.octaves).toEqual({ 'm-a': 12, 'm-b': 12 });
  });

  it('ties across bars move together', () => {
    // Bar 1's D4 is in range on its own but is tied into bar 2's run, which reaches C3 (below alto's 49).
    const result = applyInstrumentView(score(part('P', 'a:A3 r b:D4~ | c:D4 d:C3')), { P: sw('alto-saxophone', 'beginner') }, 'written');
    expect(result.moved).toEqual(['b', 'c', 'd']);
    expect(sounding(result.score.parts[0])).toEqual([57, 74, 74, 60]);
    // The tied D4 moved up to D5 (74) is above alto beginner's top (69): still out, and flagged.
    expect(result.outOfRange).toEqual(['b', 'c']);
  });

  it('transposing source part: B-flat clarinet to alto sax uses the clarinet sounding pitch', () => {
    // Written D4 on clarinet sounds C4 (60); alto writes it a major sixth up: A4. From the written D4 it would be B4.
    const source = score(part('P', 'a:D4 b:E4', CLARINET));
    const out = applyInstrumentView(source, { P: sw('alto-saxophone') }, 'written');
    expect(names(out.score.parts[0])).toEqual(['A4', 'B4']);
    expect(sounding(out.score.parts[0])).toEqual([60, 62]);
    expect(out.score.parts[0].transposition).toEqual({ semitones: -9, diatonic: -5 });
    // Baseline MEI is clarinet written pitch: up a perfect fifth to alto written.
    expect(out.staves.P.shift).toEqual([4, 7]);
    // In the concert view the clarinet part is already at sounding pitch: same result, shown at concert pitch.
    const concert = applyInstrumentView(scoreForView(source, 'concert', 0), { P: sw('alto-saxophone') }, 'concert');
    expect(names(concert.score.parts[0])).toEqual(['C4', 'D4']);
    expect(sounding(concert.score.parts[0])).toEqual([60, 62]);
    expect(concert.staves.P.shift).toEqual([-1, -2]);
  });

  it('refits after semitones', () => {
    // Alto beginner 49..69: untransposed the low phrase (C3 = 48) moves; at +7 the high one (G4 -> D5 = 74) does.
    const source = score(part('P', 'a:G4 r b:C3'));
    expect(applyInstrumentView(scoreForView(source, 'written', 0), { P: sw('alto-saxophone', 'beginner') }, 'written').moved).toEqual(['b']);
    const up = applyInstrumentView(scoreForView(source, 'written', 7), { P: sw('alto-saxophone', 'beginner') }, 'written');
    expect(up.moved).toEqual(['a']);
    expect(sounding(up.score.parts[0])).toEqual([62, 55]);
  });

  it('manual octave on an unswitched part moves its tie chain and flags out of range', () => {
    // Flute intermediate 60..91: C4 tied into bar 2, moved down by the reader, is out of range.
    const result = applyInstrumentView(score(part('P', 'a:C4~ | b:C4 c:E4', { instrument: 'flute', gmProgram: 74 })), { P: sw(undefined, 'intermediate', { b: -12 }) }, 'written');
    const out = result.score.parts[0];
    expect(result.moved).toEqual(['a', 'b']);
    expect(result.outOfRange).toEqual(['a', 'b']);
    expect(names(out)).toEqual(['C3', 'C3', 'E4']);
    expect(out.instrument).toBe('flute');
    expect(result.staves.P).toEqual({ shift: [0, 0], octaves: { 'm-a': -12, 'm-b': -12 } });
  });

  it('drum kit and tab parts are not switchable', () => {
    const drums = part('D', 'a:C4', { clef: 'percussion', instrument: 'drum-kit' });
    const tab = part('T', 'a:C4', { clef: 'tab', instrument: 'guitar', tab: true });
    expect(switchablePart(drums)).toBe(false);
    expect(switchablePart(tab)).toBe(false);
    expect(switchablePart(part('P', 'a:C4'))).toBe(true);
    const source = score(drums, tab);
    const result = applyInstrumentView(source, { D: sw('trumpet'), T: sw('trumpet') }, 'written');
    expect(result.score.parts).toEqual(source.parts);
    expect(result.staves).toEqual({});
  });

  it('tab doubling of a switched part is hidden', () => {
    const guitar = part('G', 'a:E3', { instrument: 'guitar', gmProgram: 25, transposition: { semitones: -12, diatonic: -7 } });
    const tab = part('T', 'a:E3', { clef: 'tab', instrument: 'guitar', tab: true, tabOf: 'G' });
    expect(applyInstrumentView(score(guitar, tab), { G: sw('cello') }, 'written').hiddenTab).toEqual(['T']);
    expect(applyInstrumentView(score(guitar, tab), { G: sw(undefined) }, 'written').hiddenTab).toEqual([]);
    // An unswitched guitar with a reader's octave move: the TAB frets no longer match, so it is hidden too.
    expect(applyInstrumentView(score(guitar, tab), { G: sw(undefined, 'intermediate', { a: 12 }) }, 'written').hiddenTab).toEqual(['T']);
  });

  it('octave moves of a Score engraved from itself (ABC, MIDI) key on the generated MEI ids', () => {
    const abc = (p: Part): Part => ({ ...p, measures: p.measures.map(m => ({ ...m, notes: m.notes.map(n => ({ ...n, pitches: n.pitches.map(({ sourceId: _, ...x }) => x) })) })) });
    const flute = abc(part('abc-1', 'a:C5 b:E5', { instrument: 'flute', gmProgram: 74 }));
    flute.measures[0].notes[1].pitches.push(pitch('G', 5));
    const doc = { format: 'abc', engravingFormat: 'mei' } as Score['document'];
    const result = applyInstrumentView({ ...score(flute), document: doc }, { 'abc-1': sw(undefined, 'intermediate', { a: 12, b: -12 }) }, 'written');
    expect(result.staves['abc-1'].octaves).toEqual({ n_a: 12, n_b_p1: -12, n_b_p2: -12 });
    expect(result.score.instrumentView?.staves['abc-1'].octaves).toEqual({ n_a: 12, n_b_p1: -12, n_b_p2: -12 });
    // A switched part too; and the generated ids win over source ids of a generated engraving.
    const withIds = { ...score(part('abc-1', 'a:C3')), document: doc };
    expect(applyInstrumentView(withIds, { 'abc-1': sw('alto-saxophone', 'beginner') }, 'written').staves['abc-1'].octaves).toEqual({ n_a: 12 });
  });

  it('a percussion (or rangeless) target is treated as written', () => {
    const source = score(part('P', 'a:C4 b:E4'));
    const result = applyInstrumentView(source, { P: sw('drum-kit') }, 'written');
    expect(result.score.parts[0]).toBe(source.parts[0]);
    expect(result.staves).toEqual({});
    expect(result.score.instrumentView).toBeUndefined();
  });

  it('refuses a Score that already carries an instrument view', () => {
    const once = applyInstrumentView(score(part('P', 'a:C4')), { P: sw('trumpet') }, 'written').score;
    expect(() => applyInstrumentView(once, { P: sw('trumpet') }, 'written')).toThrow(/already has an instrument view/);
  });

  it('takes the view from the Score, the scorePitch argument only without one', () => {
    const clarinet = score(part('K', 'a:D4 b:E4', CLARINET));
    const concert = scoreForView(clarinet, 'concert', 0);
    const out = applyInstrumentView(concert, { K: sw('trumpet') }, 'written').score.parts[0];
    expect(names(out)).toEqual(['C4', 'D4']);
    expect(out.transposition).toBeUndefined();
    expect(names(applyInstrumentView(score(part('P', 'a:C4')), { P: sw('trumpet') }, 'concert').score.parts[0])).toEqual(['C4']);
  });

  it('playback invariant: soundingMidi of every output note is the judged pitch plus its shift', () => {
    const source = score(
      part('C', 'a:D4 b:E4) c:C6 | d:G3~ | e:G3 r f:B5', CLARINET),
      part('F', 'g:C4 h:D4 r i:C7', { instrument: 'flute', gmProgram: 74 }),
      part('K', 'j:D4 k:F4', CLARINET),
      // Untouched transposing part: no switch, no move.
      part('U', 'l:D4 m:A4', CLARINET),
    );
    for (const view of ['written', 'concert'] as const) for (const semitones of [0, 3, -5]) {
      const viewed = scoreForView(source, view, semitones);
      const result = applyInstrumentView(viewed, { C: sw('tenor-saxophone', 'beginner', { d: -12 }), F: sw(undefined, 'beginner', { h: 12 }), K: sw(undefined, 'beginner', { k: 12 }) }, view);
      expect(result.moved).toEqual(expect.arrayContaining(['c', 'd', 'e', 'h', 'k']));
      result.score.parts.forEach((out, partIndex) => {
        const original = source.parts[partIndex];
        out.measures.forEach((measure, m) => measure.notes.forEach((note, n) => note.pitches.forEach((p, k) => {
          const judged = soundingMidi(original, original.measures[m], original.measures[m].notes[n].pitches[k], semitones);
          const shift = result.moved.includes(note.id) ? soundingMidi(out, measure, p, 0) - judged : 0;
          expect(Math.abs(shift) === 12 || shift === 0).toBe(true);
          expect(soundingMidi(out, measure, p, 0)).toBe(judged + shift);
        })));
      });
    }
  });
});
