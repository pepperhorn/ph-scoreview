import { describe, expect, it } from 'vitest';
import { applyHostSwitchChange, readerPitch, restoredScorePitch, sourcePartsOf, switchedSoundParts, switchedTimeline, switchedView, switchesFromSaved, switchesFromSettings, switchHighlights, withOctaves, withSound, withSourceSwitch } from './instrument-switch-state';
import { buildBaseTimeline, playbackEventsFrom } from './playback/timeline';
import { gmProgramForSoundfont, pitch, type Part, type Score } from './score';
import { scoreForView } from './transpose';

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
    expect(switchesFromSettings(input, { instruments: { 1: 'flute', 9: 'flute', x: 'flute', 2: 'kazoo' as never, 3: 'drum-kit' } })).toEqual({});
    expect(switchesFromSettings(input, { instrument: 'flute', rangeLevel: 'expert' as never })['P1-1'].level).toBe('intermediate');
    expect(switchesFromSettings(input, {})).toEqual({});
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
});
