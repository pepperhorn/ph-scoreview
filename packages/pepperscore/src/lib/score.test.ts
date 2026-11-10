import { describe, expect, it } from 'vitest';
import { INSTRUMENTS } from './instrument-model';
import { instrumentDetails, instrumentForName, type Part } from './score';
import { canShowTab } from './tab/tab-parts';
import { stringInstrument } from './tab/string-instruments';

const cases = [
  ...['Bass', 'Acoustic Bass', 'Electric Bass', 'Bass Guitar', 'Bass 1', 'Bass I', 'Synth Bass', 'Bass line', 'Jazz Bass', 'Bass (8vb)'].map(name => [name, 'bassguitar', 'bass4'] as const),
  ...['Double Bass', 'Contrabass', 'Upright Bass', 'String Bass'].map(name => [name, 'double-bass', 'double-bass'] as const),
  ...['Choir Bass', 'Bass voice', 'Vocal Bass', 'SATB Bass'].map(name => [name, 'microphone', undefined] as const),
  ['Bassoon', 'piano', undefined], ['Bass Clarinet', 'clarinet', undefined],
  ['Bass Trombone', 'trombone', undefined], ['Bass Saxophone', 'alto-saxophone', undefined], ['Bass Flute', 'flute', undefined],
  ...['Ukulele', 'Tenor Ukulele', 'Baritone Ukulele', 'Bass Ukulele'].map((name, i) =>
    [name, 'guitar', ['ukulele-soprano', 'ukulele-tenor', 'ukulele-baritone', 'ukulele-bass'][i]] as const),
] as const;

describe('instrument names without MIDI programs', () => {
  it.each(cases)('%s uses %s and the matching TAB identity', (name, sound, tab) => {
    expect(instrumentForName(name)).toBe(sound);
    const part: Part = { id: 'p', name, instrument: instrumentForName(name), clef: 'bass', measures: [] };
    expect(stringInstrument(part)).toBe(tab);
    expect(canShowTab({ title: '', source: '', tempo: 120, beats: 4, beatType: 4, key: 0, parts: [part] })).toBe(tab === 'bass4' || tab?.startsWith('ukulele-') === true);
  });
  it('uses existing nylon guitar GM 25 and bass guitar GM 34', () => {
    expect(instrumentDetails('guitar').soundfont).toBe('acoustic_guitar_nylon');
    expect(INSTRUMENTS.guitar.gmProgram).toBe(25);
    expect(INSTRUMENTS.bassguitar.gmProgram).toBe(34);
  });
});
