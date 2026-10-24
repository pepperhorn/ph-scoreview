import { describe, expect, it } from 'vitest';
import { applyHostSwitchChange, readerPartsInfo, readerPitch, restoredScorePitch, selectOctaveNote, selectOctavePhrase, sourcePartsOf, steppedOctaves, switchedSoundParts, switchedTimeline, switchedView, switchesFromSaved, switchesFromSettings, switchHighlights, withOctaves, withoutStalePins, withSound, withSourceSwitch, partLabel } from './instrument-switch-state';
import { buildBaseTimeline, playbackEventsFrom } from './playback/timeline';
import { gmProgramForSoundfont, pitch, type Part, type Score } from './score';
import { scoreForView } from './transpose';
import { switchablePart, withPickedSound } from './instrument-view';

const note = (id: string, step: string, octave: number, start = 0) => ({ id, start, duration: 1, voice: '1', pitches: [{ ...pitch(step, octave), sourceId: `m-${id}` }] });
const part = (id: string, notes: ReturnType<typeof note>[], extra: Partial<Part> = {}): Part => ({ id, name: id, clef: 'treble', instrument: 'piano', gmProgram: 1, pitchBasis: 'written', measures: [{ index: 0, beats: 4, notes }], ...extra });
const score = (...parts: Part[]): Score => ({ title: '', source: '', tempo: 120, beats: 4, beatType: 4, key: 0, parts });
// A piano grand staff (C5 E5 / C3), a B-flat clarinet (written D5 = sounding C5) and a drum kit.
const piano = () => [
  part('P1-1', [note('rh1', 'C', 5), note('rh2', 'E', 5, 1)], { sourcePartId: 'P1' }),
  part('P1-2', [note('lh1', 'C', 3)], { sourcePartId: 'P1', clef: 'bass' }),
];
const clarinet = () => part('P2', [note('cl1', 'D', 5)], { instrument: 'clarinet', gmProgram: 72, transposition: { semitones: -2, diatonic: -1 } });
const drums = () => part('P0', [note('dr1', 'C', 4)], { instrument: 'drum-kit', clef: 'percussion' });
const alto = { instrument: 'alto-saxophone' as const, level: 'intermediate' as const, autoRange: true, octaves: {} };
const midis = (events: { partId: string; midi: number }[], partId: string) => events.filter(event => event.partId === partId).map(event => event.midi);

describe('instrument switch state', () => {
  it('numbers source parts from 1 (grand staff once, TAB doublings skipped) and offers the switch only for pitched parts', () => {
    const tab = part('P3', [note('t1', 'E', 4)], { instrument: 'guitar', tabOf: 'P2' });
    const sources = sourcePartsOf(score(drums(), ...piano(), clarinet(), tab));
    expect(sources.map(source => [source.id, source.parts.map(p => p.id), source.switchable])).toEqual([
      ['P0', ['P0'], false], ['P1', ['P1-1', 'P1-2'], true], ['P2', ['P2'], true],
    ]);
  });

  it('settings: `instrument` switches the first switchable source part (every staff), `instruments` wins and keys by number', () => {
    const input = score(drums(), ...piano(), clarinet());
    expect(switchesFromSettings(input, { instrument: 'alto-saxophone' })).toEqual({ 'P1-1': alto, 'P1-2': alto });
    expect(switchesFromSettings(input, { instrument: 'alto-saxophone', rangeLevel: 'beginner', autoRange: false })['P1-2']).toEqual({ ...alto, level: 'beginner', autoRange: false });
    expect(switchesFromSettings(input, { instrument: 'alto-saxophone', instruments: { 2: 'trumpet' } })).toEqual({ 'P1-1': { ...alto, instrument: 'trumpet' }, 'P1-2': { ...alto, instrument: 'trumpet' } });
    expect(switchesFromSettings(input, { instruments: { 3: 'flute' } })).toEqual({ P2: { ...alto, instrument: 'flute' } });
    // Unknown ids, the drum kit, part 1 (the drum kit here), part numbers out of range and bad levels are ignored.
    expect(switchesFromSettings(input, { instruments: { 1: 'flute', 9: 'flute', x: 'flute', 2: 'kazoo' as never, 3: 'drum-kit' as never } })).toEqual({});
    expect(switchesFromSettings(input, { instrument: 'flute', rangeLevel: 'expert' as never })['P1-1'].level).toBe('intermediate');
    expect(switchesFromSettings(input, {})).toEqual({});
  });

  it('`instruments` also keys by onReady part id (a staff switches its whole source part); onReady lists source numbers and switchability', () => {
    const input = score(drums(), ...piano(), clarinet());
    expect(switchesFromSettings(input, { instruments: { 'P1-2': 'trumpet' } })).toEqual({ 'P1-1': { ...alto, instrument: 'trumpet' }, 'P1-2': { ...alto, instrument: 'trumpet' } });
    expect(switchesFromSettings(input, { instruments: { P1: 'flute', P2: 'trumpet' } })).toEqual({ 'P1-1': { ...alto, instrument: 'flute' }, 'P1-2': { ...alto, instrument: 'flute' }, P2: { ...alto, instrument: 'trumpet' } });
    // The number and the id name the same part: both forms give the same switch; the drum kit and unknown ids are ignored.
    expect(switchesFromSettings(input, { instruments: { 3: 'flute' } })).toEqual(switchesFromSettings(input, { instruments: { P2: 'flute' } }));
    expect(switchesFromSettings(input, { instruments: { P0: 'flute', nope: 'flute' } })).toEqual({});
    expect(readerPartsInfo(input)).toEqual([
      { id: 'P0', name: 'P0', sourcePart: 1, switchable: false },
      { id: 'P1-1', name: 'P1-1', sourcePart: 2, switchable: true }, { id: 'P1-2', name: 'P1-2', sourcePart: 2, switchable: true },
      { id: 'P2', name: 'P2', sourcePart: 3, switchable: true },
    ]);
    // Every listed part's `String(sourcePart)` and `id` keys switch the same staves.
    for (const info of readerPartsInfo(input).filter(item => item.switchable)) {
      expect(switchesFromSettings(input, { instruments: { [info.id]: 'cello' } })).toEqual(switchesFromSettings(input, { instruments: { [String(info.sourcePart)]: 'cello' } }));
    }
  });

  it('a Sound pick never changes what can be switched (pitched GM sounds with the drum kit icon, e.g. Timpani)', () => {
    const [rh, lh] = piano();
    // The mixer writes the sound's icon id: Timpani (GM 48) uses the drum kit icon.
    const timpani = withPickedSound(rh, { instrument: 'drum-kit', gmProgram: 48, gmSoundfont: 'timpani' });
    expect([timpani.instrument, timpani.importedInstrument, switchablePart(timpani)]).toEqual(['drum-kit', 'piano', true]);
    // A second pick keeps the instrument it was imported as.
    expect(withPickedSound(timpani, { instrument: 'violin', gmProgram: 47, gmSoundfont: 'orchestral_harp' }).importedInstrument).toBe('piano');
    const picked = score(timpani, lh, clarinet());
    expect(sourcePartsOf(picked).map(source => source.switchable)).toEqual([true, true]);
    expect(switchesFromSettings(picked, { instrument: 'flute' })).toEqual({ 'P1-1': { ...alto, instrument: 'flute' }, 'P1-2': { ...alto, instrument: 'flute' } });
    expect(switchesFromSettings(picked, { instruments: { 2: 'trumpet' } })).toEqual({ P2: { ...alto, instrument: 'trumpet' } });
    // A real drum kit stays unswitchable, whatever sound it is given.
    const kit = drums();
    expect(switchablePart(kit)).toBe(false);
    expect(switchablePart(withPickedSound(kit, { instrument: 'piano', gmProgram: 1, gmSoundfont: 'acoustic_grand_piano' }))).toBe(false);
    expect(switchablePart({ ...kit, clef: 'treble' })).toBe(false);
  });

  it('a host change re-applies only the changed keys', () => {
    const input = score(...piano(), clarinet());
    const reader = { 'P1-1': { ...alto, octaves: { rh1: -12 as const } }, 'P1-2': alto, P2: { ...alto, instrument: 'flute' as const } };
    const changed = applyHostSwitchChange(input, reader, { instrument: 'alto-saxophone' }, { instrument: 'trumpet' });
    expect(changed['P1-1']).toEqual({ ...alto, instrument: 'trumpet', octaves: { rh1: -12 } });
    expect(changed.P2.instrument).toBe('flute');
    expect(applyHostSwitchChange(input, reader, {}, { rangeLevel: 'advanced' }).P2.level).toBe('advanced');
    expect(applyHostSwitchChange(input, reader, { instrument: 'alto-saxophone' }, { instrument: 'alto-saxophone' })).toBe(reader);
  });

  it('withSourceSwitch sets every staff of a grand staff; as written with nothing else drops the entries', () => {
    const input = score(...piano(), clarinet());
    const defaults = { level: 'intermediate' as const, autoRange: true };
    const on = withSourceSwitch(input, {}, 'P1', { instrument: 'alto-saxophone' }, defaults);
    expect(on).toEqual({ 'P1-1': alto, 'P1-2': alto });
    const level = withSourceSwitch(input, on, 'P1', { level: 'beginner' }, defaults);
    expect([level['P1-1'].level, level['P1-2'].level]).toEqual(['beginner', 'beginner']);
    expect(withSourceSwitch(input, on, 'P1', { instrument: undefined }, defaults)).toEqual({});
    const moved = withOctaves(on, 'P1-1', { rh1: 12 }, defaults);
    expect(withSourceSwitch(input, moved, 'P1', { instrument: undefined }, defaults)).toEqual({ 'P1-1': { ...alto, instrument: undefined, octaves: { rh1: 12 } } });
    expect(withOctaves({}, 'P2', {}, defaults)).toEqual({});
  });

  it('saved switches restore per staff part, only for switchable parts; a grand staff is normalised to its first switch', () => {
    const input = score(drums(), ...piano());
    const restored = switchesFromSaved(input, { 'P1-1': { visible: true, instrument: 'piano', switch: { instrument: 'alto-saxophone', level: 'advanced', autoRange: false, octaves: { rh1: 12 } } }, P0: { visible: true, instrument: 'drum-kit', switch: { instrument: 'flute', level: 'beginner', autoRange: true } } });
    // The left hand's switch was missing (dropped as malformed): it takes the right hand's, without its octave moves.
    const saxRestored = { instrument: 'alto-saxophone', level: 'advanced', autoRange: false };
    expect(restored).toEqual({ 'P1-1': { ...saxRestored, octaves: { rh1: 12 } }, 'P1-2': { ...saxRestored, octaves: {} } });
    // Differing staves: the first staff's instrument, level and fit for both, each keeping its own octave moves and
    // its sound only where the instrument matches.
    const differing = switchesFromSaved(input, {
      'P1-1': { visible: true, instrument: 'piano', switch: { instrument: 'trumpet', level: 'beginner', autoRange: true, sound: { instrument: 'violin', gmSoundfont: 'orchestral_harp' } } },
      'P1-2': { visible: true, instrument: 'piano', switch: { instrument: 'flute', level: 'advanced', autoRange: false, octaves: { lh1: 12 }, sound: { instrument: 'flute', gmSoundfont: 'piccolo' } } },
    });
    expect(differing).toEqual({
      'P1-1': { instrument: 'trumpet', level: 'beginner', autoRange: true, octaves: {}, sound: { instrument: 'violin', gmSoundfont: 'orchestral_harp' } },
      'P1-2': { instrument: 'trumpet', level: 'beginner', autoRange: true, octaves: { lh1: 12 } },
    });
    // A plain lead (as written, defaults, only its own octave moves): the other staff gets no no-op entry, the shape
    // withSourceSwitch / withOctaves leave.
    const defaults = { level: 'intermediate' as const, autoRange: true };
    const plainLead = { 'P1-1': { visible: true, instrument: 'piano' as const, switch: { level: 'intermediate' as const, autoRange: true, octaves: { rh1: 12 as const } } }, 'P1-2': { visible: true, instrument: 'piano' as const } };
    expect(switchesFromSaved(input, plainLead, defaults)).toEqual(withOctaves({}, 'P1-1', { rh1: 12 }, defaults));
    expect(switchesFromSaved(input, plainLead, defaults)).toEqual({ 'P1-1': { level: 'intermediate', autoRange: true, octaves: { rh1: 12 } } });
    // A saved level differing from the host's default is kept on every staff, as withSourceSwitch sets it.
    const levelOnly = { 'P1-1': { visible: true, instrument: 'piano' as const, switch: { level: 'beginner' as const, autoRange: true } } };
    expect(switchesFromSaved(input, levelOnly, defaults)).toEqual(withSourceSwitch(input, {}, 'P1', { level: 'beginner' }, defaults));
  });

  it('a saved concert pitch view of a concert-basis score (forced, never chosen) restores as written', () => {
    const concert = score(...piano().map(p => ({ ...p, pitchBasis: 'concert' as const })));
    expect(restoredScorePitch(concert, {}, 'concert')).toBe('written');
    expect(restoredScorePitch(concert, { 'P1-1': { ...alto, instrument: 'flute' } }, 'concert')).toBe('written');
    // A part switched to a transposing instrument offered the choice: a saved concert view was the reader's.
    expect(restoredScorePitch(concert, { 'P1-1': alto, 'P1-2': alto }, 'concert')).toBe('concert');
    expect(restoredScorePitch(score(clarinet()), {}, 'concert')).toBe('concert');
    expect(restoredScorePitch(concert, {}, 'written')).toBe('written');
    // Restored as written, a later switch to alto sax shows its written pitch.
    const switched = { 'P1-1': alto, 'P1-2': alto };
    expect(readerPitch(concert, switched, restoredScorePitch(concert, {}, 'concert')).scorePitch).toBe('written');
  });

  it('a sound picked while switched overrides only the sound; choosing an instrument again drops it', () => {
    const input = score(...piano());
    const defaults = { level: 'intermediate' as const, autoRange: true };
    const trumpet = withSourceSwitch(input, {}, 'P1', { instrument: 'trumpet' }, defaults);
    expect(withSound({}, 'P1-1', { instrument: 'violin', gmSoundfont: 'orchestral_harp' })).toBeUndefined();
    const harp = withSound(trumpet, 'P1-1', { instrument: 'violin', gmSoundfont: 'orchestral_harp' })!;
    expect(harp['P1-1']).toEqual({ ...trumpet['P1-1'], sound: { instrument: 'violin', gmSoundfont: 'orchestral_harp' } });
    const view = switchedView(input, harp, 'written');
    // The engraving is the trumpet's either way; only the sound differs.
    expect(view.score.parts.map(p => [p.instrument, p.clef])).toEqual(switchedView(input, trumpet, 'written').score.parts.map(p => [p.instrument, p.clef]));
    const sounds = switchedSoundParts(input.parts, view, harp);
    expect(sounds.map(p => [p.instrument, p.gmSoundfont, p.gmProgram])).toEqual([['violin', 'orchestral_harp', 47], ['trumpet', 'trumpet', 57]]);
    // The drum kit sound (no soundfont) is the kit.
    const kit = switchedSoundParts(input.parts, view, withSound(trumpet, 'P1-1', { instrument: 'drum-kit' })!);
    expect([kit[0].instrument, kit[0].gmSoundfont]).toEqual(['drum-kit', undefined]);
    // Choosing the current instrument again keeps the picked sound.
    expect(withSourceSwitch(input, harp, 'P1', { instrument: 'trumpet' }, defaults)).toEqual(harp);
    // A new instrument (or As written) plays its main sound again.
    expect(withSourceSwitch(input, harp, 'P1', { instrument: 'flute' }, defaults)['P1-1'].sound).toBeUndefined();
    expect(withSourceSwitch(input, harp, 'P1', { instrument: undefined }, defaults)).toEqual({});
    // Level, fit and octave moves keep the picked sound.
    expect(withSourceSwitch(input, harp, 'P1', { level: 'beginner' }, defaults)['P1-1'].sound).toEqual({ instrument: 'violin', gmSoundfont: 'orchestral_harp' });
    expect(withOctaves(harp, 'P1-1', { rh1: 12 }, defaults)['P1-1'].sound).toEqual({ instrument: 'violin', gmSoundfont: 'orchestral_harp' });
  });

  it('concert-basis scores show concert pitch unless a part is switched to a transposing instrument', () => {
    const concert = score(...piano().map(p => ({ ...p, pitchBasis: 'concert' as const })));
    expect(readerPitch(concert, {}, 'written')).toMatchObject({ scorePitch: 'concert', forcedConcert: true, hasTransposingParts: false });
    expect(readerPitch(concert, { 'P1-1': { ...alto, instrument: 'flute' } }, 'written')).toMatchObject({ scorePitch: 'concert', forcedConcert: true });
    expect(readerPitch(concert, { 'P1-1': alto }, 'written')).toMatchObject({ scorePitch: 'written', forcedConcert: false, hasTransposingParts: true, switchedTransposing: true });
    expect(readerPitch(concert, { 'P1-1': alto }, 'concert').scorePitch).toBe('concert');
    expect(readerPitch(score(clarinet()), {}, 'concert')).toMatchObject({ scorePitch: 'concert', forcedConcert: false, hasTransposingParts: true });
    expect(readerPitch(score(...piano()), {}, 'written')).toMatchObject({ scorePitch: 'written', hasTransposingParts: false });
  });

  it('no switches: the view is scoreForView\'s result itself, nothing highlighted, the timeline untouched', () => {
    const input = score(...piano(), clarinet());
    const viewed = scoreForView(input, 'concert', 2);
    const view = switchedView(viewed, {}, 'concert');
    expect(view.score).toBe(viewed);
    expect(switchHighlights(view)).toEqual([]);
    const base = buildBaseTimeline(input);
    expect(switchedTimeline(base, view, 2)).toBe(base);
  });

  it('playback: switched parts sound at their fitted pitch, unswitched (transposing) parts as before, in both views and transposed', () => {
    const input = score(...piano(), clarinet());
    const switches = { 'P1-1': alto, 'P1-2': alto };
    const base = buildBaseTimeline(input);
    const before = playbackEventsFrom(base, 0, 120, 0);
    for (const view of ['written', 'concert'] as const) for (const semitones of [0, 2]) {
      const result = switchedView(scoreForView(input, view, semitones), switches, view);
      const events = playbackEventsFrom(switchedTimeline(base, result, semitones), 0, 120, semitones);
      // The clarinet's written D5 sounds C5 (+ the transposition), never counted twice in the concert view.
      expect(midis(events, 'P2'), `${view} +${semitones}`).toEqual(midis(before, 'P2').map(midi => midi + semitones));
      expect(midis(events, 'P2')).toEqual([72 + semitones]);
      // Piano as alto sax (intermediate 49-77): C3 is below the range and moves up an octave; at +2 the right hand's
      // F#5 is above it, so the phrase moves down.
      expect(midis(events, 'P1-1'), `${view} +${semitones}`).toEqual(semitones ? [62, 66] : [72, 76]);
      expect(midis(events, 'P1-2'), `${view} +${semitones}`).toEqual(semitones ? [50] : [60]);
    }
  });

  it('highlights: moved notes ps-transposed, out-of-range ps-out-of-range; switched parts play the target sound', () => {
    const input = score(...piano());
    const result = switchedView(input, { 'P1-1': alto, 'P1-2': { ...alto, autoRange: false } }, 'written');
    expect(switchHighlights(result)).toEqual([{ ids: [], className: 'ps-transposed' }, { ids: ['lh1'], className: 'ps-out-of-range' }].filter(item => item.ids.length));
    const fitted = switchedView(input, { 'P1-1': alto, 'P1-2': alto }, 'written');
    expect(switchHighlights(fitted)).toEqual([{ ids: ['lh1'], className: 'ps-transposed' }]);
    const sound = switchedSoundParts(input.parts, fitted, { 'P1-1': alto, 'P1-2': alto });
    expect(sound.map(p => [p.instrument, gmProgramForSoundfont(p.gmSoundfont!)])).toEqual([['alto-saxophone', 66], ['alto-saxophone', 66]]);
    expect(switchedSoundParts(input.parts, fitted, {})).toBe(input.parts);
  });

  it('octave tool selection: a tie chain, a passage across voices (Shift or a second click), the phrase; 8va / 8vb steps', () => {
    // Bar 1: a C5, b D5 tied into bar 2's c, voice 2 v E4; bar 2: c, a rest, d F5.
    const tied = (id: string, step: string, octave: number, start: number, tie: { tieStart?: boolean; tieStop?: boolean }) => { const n = note(id, step, octave, start); n.pitches[0] = { ...n.pitches[0], ...tie }; return n; };
    const line = part('P', [], { measures: [
      { index: 0, beats: 4, notes: [note('a', 'C', 5, 0), { ...note('v', 'E', 4, 0), voice: '2' }, tied('b', 'D', 5, 1, { tieStart: true })] },
      { index: 1, beats: 4, notes: [tied('c', 'D', 5, 0, { tieStop: true }), { id: 'r', start: 1, duration: 1, voice: '1', rest: true, pitches: [] }, note('d', 'F', 5, 2)] },
    ] });
    const input = score(line, drums());
    const a = selectOctaveNote(input, null, 'a', false)!;
    expect(a).toEqual({ partId: 'P', anchor: 'a', ids: ['a'], extendable: true });
    expect(selectOctaveNote(input, null, 'c', false)!.ids).toEqual(['b', 'c']);
    // A second click (or Shift-click) selects the passage between, every voice, tie chains whole.
    const passage = selectOctaveNote(input, a, 'b', false)!;
    expect(passage).toEqual({ partId: 'P', anchor: 'a', ids: ['a', 'v', 'b', 'c'], extendable: false });
    expect(selectOctaveNote(input, selectOctaveNote(input, null, 'd', false), 'b', true)!.ids).toEqual(['b', 'c', 'd']);
    // After a passage a plain click starts again; Shift-click extends from the anchor.
    expect(selectOctaveNote(input, passage, 'd', false)!.ids).toEqual(['d']);
    expect(selectOctaveNote(input, passage, 'd', true)!.ids).toEqual(['a', 'v', 'b', 'c', 'd']);
    // Rests and drum notes keep the selection.
    expect(selectOctaveNote(input, a, 'r', false)).toBe(a);
    expect(selectOctaveNote(input, a, 'dr1', false)).toBe(a);
    // The phrase: broken at the rest, joined across the tie.
    expect(selectOctavePhrase(input, a).ids).toEqual(['a', 'b', 'c']);
    expect(selectOctavePhrase(input, selectOctaveNote(input, null, 'd', false)!).ids).toEqual(['d']);
    // 8va / 8vb on an unswitched staff: up an octave, then back as written (no override left); values stay within ±12.
    const up = steppedOctaves({}, ['a', 'b'], 12);
    expect(up).toEqual({ a: 12, b: 12 });
    const upView = switchedView(input, { P: { level: 'intermediate', autoRange: true, octaves: up } }, 'written');
    // The override on b extends along its tie to c.
    expect([upView.shifts, upView.planned]).toEqual([{ a: 12, b: 12, c: 12 }, {}]);
    expect(steppedOctaves(up, ['a', 'b'], 12, upView.shifts, upView.planned)).toEqual({ a: 12, b: 12 });
    expect(steppedOctaves(up, ['a'], -12, upView.shifts, upView.planned)).toEqual({ b: 12 });
    expect(steppedOctaves({}, ['a'], -12)).toEqual({ a: -12 });
  });

  it('octave tool steps from the shown shift: 8vb on an auto-raised phrase keeps it as written (an explicit 0), 8va on an auto-lowered one too', () => {
    // Piano as alto sax: the left hand's C3 is below the alto, auto-fit raises it.
    const input = score(...piano());
    const fitted = switchedView(input, { 'P1-1': alto, 'P1-2': alto }, 'written');
    expect([fitted.shifts, fitted.planned]).toEqual([{ lh1: 12 }, { lh1: 12 }]);
    const kept = steppedOctaves({}, ['lh1'], -12, fitted.shifts, fitted.planned);
    expect(kept).toEqual({ lh1: 0 });
    const asWritten = switchedView(input, { 'P1-1': alto, 'P1-2': { ...alto, octaves: kept } }, 'written');
    expect([asWritten.moved, asWritten.shifts, asWritten.outOfRange]).toEqual([[], {}, ['lh1']]);
    expect(asWritten.score.parts[1].measures[0].notes[0].pitches[0].midi).toBe(fitted.score.parts[1].measures[0].notes[0].pitches[0].midi - 12);
    // 8va from there is what auto-fit gives: no override.
    expect(steppedOctaves(kept, ['lh1'], 12, asWritten.shifts, asWritten.planned)).toEqual({});
    // A C7 is above the alto, auto-fit lowers it; 8va keeps it as written.
    const high = score(part('H', [note('h1', 'C', 7)]));
    const lowered = switchedView(high, { H: alto }, 'written');
    expect([lowered.shifts, lowered.planned]).toEqual([{ h1: -12 }, { h1: -12 }]);
    expect(steppedOctaves({}, ['h1'], 12, lowered.shifts, lowered.planned)).toEqual({ h1: 0 });
    expect(switchedView(high, { H: { ...alto, octaves: { h1: 0 } } }, 'written').moved).toEqual([]);
  });
  it('stale "as written" pins: a 0 override the new auto-fit plan no longer overrides is dropped; one it still overrides stays', () => {
    const input = score(...piano());
    const defaults = { level: 'intermediate' as const, autoRange: true };
    const view = { scorePitch: 'written' as const, semitones: 0 };
    // Piano as alto sax, the reader's 8vb on the auto-raised C3: an explicit 0 (as written), and an 8va on rh1.
    const pinned = { 'P1-1': { ...alto, octaves: { rh1: 12 as const } }, 'P1-2': { ...alto, octaves: { lh1: 0 as const } } };
    expect(withoutStalePins(input, pinned, view, defaults)).toBe(pinned);
    // Cello: C3 is in range, auto-fit no longer moves it, so its pin goes; the 8va stays.
    const cello = withoutStalePins(input, withSourceSwitch(input, pinned, 'P1', { instrument: 'cello' }, defaults), view, defaults);
    expect(cello).toEqual({ 'P1-1': { ...alto, instrument: 'cello', octaves: { rh1: 12 } }, 'P1-2': { ...alto, instrument: 'cello', octaves: {} } });
    // Fit to range off: no plan, the pin goes. Beginner alto: C3 is still raised, the pin stays.
    expect(withoutStalePins(input, withSourceSwitch(input, pinned, 'P1', { autoRange: false }, defaults), view, defaults)['P1-2'].octaves).toEqual({});
    expect(withoutStalePins(input, withSourceSwitch(input, pinned, 'P1', { level: 'beginner' }, defaults), view, defaults)['P1-2'].octaves).toEqual({ lh1: 0 });
    // As written: nothing is planned, so a staff with only a pin left is plain again (no entry).
    const asWritten = withoutStalePins(input, withSourceSwitch(input, pinned, 'P1', { instrument: undefined }, defaults), view, defaults);
    expect(asWritten).toEqual({ 'P1-1': { ...alto, instrument: undefined, octaves: { rh1: 12 } } });
    // Transposed down a fifth (F2, still below the alto): the plan is the transposed view's, so the pin stays.
    expect(withoutStalePins(input, pinned, { ...view, semitones: -7 }, defaults)).toBe(pinned);
  });

  it('part labels: the source name, and the instrument a switched staff is shown as', () => {
    const [rh, lh] = piano();
    const guitar = { ...alto, instrument: 'guitar' as const };
    expect(partLabel(rh, {})).toEqual({ name: 'P1-1' });
    expect([partLabel(rh, { 'P1-1': guitar, 'P1-2': guitar }), partLabel(lh, { 'P1-1': guitar, 'P1-2': guitar })]).toEqual([{ name: 'P1-1', switched: 'Guitar' }, { name: 'P1-2', switched: 'Guitar' }]);
    expect(partLabel(rh, { 'P1-1': alto })).toEqual({ name: 'P1-1', switched: 'Alto Sax' });
    // Octave moves only, or switched to the instrument it already is: no switch shown.
    expect(partLabel(rh, { 'P1-1': { ...alto, instrument: undefined, octaves: { rh1: 12 } } })).toEqual({ name: 'P1-1' });
    expect(partLabel(rh, { 'P1-1': { ...alto, instrument: 'piano' } })).toEqual({ name: 'P1-1' });
    expect(partLabel(drums(), { P0: alto })).toEqual({ name: 'P0' });
  });
});
