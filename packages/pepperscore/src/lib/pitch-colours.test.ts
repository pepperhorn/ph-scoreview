import { describe, expect, it } from 'vitest';
import { pitchClassOf, pitchColourStyle } from './pitch-colours';
import { CRF_PITCH_COLOURS } from './skin';
import { buildFileState, parseFileState } from './file-state';
import { exampleScore } from './score';
import { defaults, sanitizeSavedPrefs, settingsToPrefs } from './prefs';
describe('pitch colours', () => {
  it('maps chromatic MIDI pitches and enharmonic/octave equivalents', () => {
    expect(Array.from({length:12},(_,i)=>pitchClassOf(60+i))).toEqual(['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']);
    expect(pitchClassOf(73)).toBe(pitchClassOf(61));
    expect(pitchClassOf(-1)).toBe('B');
  });
  it('emits a complete palette and leaves an absent palette alone', () => {
    expect(pitchColourStyle()).toEqual({});
    expect(pitchColourStyle(CRF_PITCH_COLOURS)['--ps-pitch-c-sharp']).toBe(CRF_PITCH_COLOURS['C#']);
    expect(Object.keys(pitchColourStyle(CRF_PITCH_COLOURS))).toHaveLength(12);
  });
  it('defaults off, repairs saved values and accepts host settings', () => {
    expect(defaults.pitchColours).toBe(false);
    expect(sanitizeSavedPrefs({pitchColours:'true'}).pitchColours).toBe(false);
    expect(settingsToPrefs({pitchColours:true})).toEqual({pitchColours:true});
  });
  it('keeps existing default-off file output unchanged and round-trips true', () => {
    const source = { name: 'pitch.abc', format: 'abc', size: 1, sha256: 'a'.repeat(64) };
    const score = exampleScore();
    const off = buildFileState(source, defaults, score, [], {}, undefined, 1);
    expect(off.settings).not.toHaveProperty('pitchColours');
    const on = buildFileState(source, { ...defaults, pitchColours: true }, score, [], {}, undefined, 1);
    expect(parseFileState(JSON.stringify(on), source.sha256)?.settings.pitchColours).toBe(true);
    expect(parseFileState(JSON.stringify(off), source.sha256)?.settings).not.toHaveProperty('pitchColours');
  });

});
