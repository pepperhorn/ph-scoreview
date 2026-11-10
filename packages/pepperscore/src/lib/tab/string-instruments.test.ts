import { applyInstrumentView } from '../instrument-view';
import { parseAbc } from '../import';
import { describe, expect, it } from 'vitest';
import { STRING_INSTRUMENTS, stringInstrument, withTabSettings } from './string-instruments';
import { canShowTab, planTab } from './tab-parts';
import { assignFrets } from './fret-assign';
import { injectTab } from '../notation/mei-tab';
import type { Part, Score } from '../score';

const part = (name: string, gmProgram?: number): Part => ({ id: name, name, gmProgram, instrument: 'piano', clef: 'treble', measures: [] });
const score = (parts: Part[]): Score => ({ title: '', source: '', tempo: 96, beats: 4, beatType: 4, key: 0, parts });
const options = { tuning: [40, 45, 50, 55, 59, 64], capo: 0, stale: false };
describe('string instrument TAB', () => {
  it('recognizes every GM guitar/bass program and rejects non-strings', () => {
    for (let gm = 25; gm <= 40; gm++) expect(stringInstrument(part('Part', gm))).toBe(gm < 33 ? 'guitar' : 'bass4');
    for (const name of ['Piano', 'Flute', 'Clarinet']) expect(canShowTab(score([part(name)]))).toBe(false);
    for (const name of ['Violin', 'Cello', 'Viola', 'Double Bass']) expect(canShowTab(score([part(name)]))).toBe(false);
    expect(stringInstrument(part('Double Bass', 33))).toBe('double-bass');
    expect(stringInstrument({ ...part('Acoustic Bass', 33), instrument: 'double-bass' })).toBe('bass4');
    expect(stringInstrument(part('Cello', 25))).toBe('guitar');
  });
  it('classifies finger TAB candidates without generating their staves', () => {
    for (const name of ['Violin', 'Cello']) {
      const id = stringInstrument(part(name))!;
      expect(STRING_INSTRUMENTS[id].kind).toBe('finger');
      expect(planTab(score([part(name)]), new Map([[name, '1']]), 'both', options).added).toEqual([]);
    }
  });
  it('uses independent defaults for mixed instruments and exact-id host overrides', () => {
    const parts = ['Guitar', 'Bass Guitar', 'Ukulele', 'Tenor Ukulele', 'Baritone Ukulele', 'Bass Ukulele'].map(name => part(name));
    const source = score(parts), staff = new Map(parts.map((p, i) => [p.id, String(i + 1)]));
    const spec = planTab(source, staff, 'both', options).spec!;
    expect(spec.tunings).toEqual({
      1: [40,45,50,55,59,64], 2: [28,33,38,43], 3: [67,60,64,69],
      4: [67,60,64,69], 5: [50,55,59,64], 6: [28,33,38,43],
    });
    const configured = withTabSettings(source, { 'Bass Guitar': 'bass5', Guitar: 'none' });
    const plan = planTab(configured, staff, 'both', options);
    expect(plan.spec!.generate).not.toContain('1');
    expect(plan.spec!.tunings!['2']).toEqual([23,28,33,38,43]);
    const explicit = planTab(withTabSettings(source, undefined, options.tuning), staff, 'both', options);
    expect(explicit.spec!.tunings).toEqual(spec.tunings);
  });
  it('rejects bass winds and choir voices with their real programs, and ambiguous names without programs', async () => {
    for (const [name, gm] of [['Bassoon',71], ['Bass Clarinet',72], ['Bass Trombone',58], ['Bass Flute',74], ['Bass',53], ['Bass (choir)',53], ['Basso',53]] as const) {
      const p = { ...part(name, gm), instrument: 'double-bass' as const };
      expect(stringInstrument(p), name).toBeUndefined();
      expect(canShowTab(score([p])), name).toBe(false);
    }
    for (const name of ['Bass', 'Bass (choir)', 'Basso', 'Bassoon', 'Bass Clarinet', 'Bass Trombone', 'Bass Flute', 'Guitarfish']) {
      expect(stringInstrument(part(name)), name).toBeUndefined();
    }
    for (const name of ['Bass Guitar', 'Electric Bass', 'Acoustic Bass', 'E-Bass']) expect(stringInstrument(part(name))).toBe('bass4');
    const choir = await parseAbc('X:1\nT:Choir\nM:4/4\nL:1/4\nV:B nm="Bass"\n%%MIDI program 52\nK:C\nCDEF |');
    expect(choir.parts[0].gmProgram).toBe(53);
    expect(canShowTab(choir)).toBe(false);
  });
  it('uses exact fretless programs, never the approximate sound icon', () => {
    for (let gm = 45; gm <= 52; gm++) {
      expect(stringInstrument({ ...part(gm === 47 ? 'Harp' : 'Strings', gm), instrument: 'violin' })).toBeUndefined();
    }
    for (const gm of [106,107,108]) expect(stringInstrument({ ...part('Plucked', gm), instrument: 'guitar' })).toBeUndefined();
    for (const [gm, id] of [[41,'violin'],[42,'viola'],[43,'cello'],[44,'double-bass']] as const) expect(stringInstrument(part('Part', gm))).toBe(id);
    expect(stringInstrument(part('Violin', 47))).toBeUndefined();
  });
  it('limits explicit and saved tuning overrides to matching string counts', () => {
    const parts = [part('Guitar'), part('Electric Bass'), part('Ukulele')];
    const source = score(parts), staff = new Map(parts.map((p,i) => [p.id, String(i+1)]));
    const dropD = [38,45,50,55,59,64];
    for (const plan of [
      planTab(withTabSettings(source, undefined, dropD), staff, 'both', options),
      planTab(source, staff, 'both', { ...options, tuning: dropD }),
    ]) expect(plan.spec!.tunings).toEqual({ 1: dropD, 2: [28,33,38,43], 3: [67,60,64,69] });
    const four = [50,55,59,64];
    expect(planTab(withTabSettings(source, undefined, four), staff, 'both', options).spec!.tunings).toEqual({ 1: options.tuning, 2: four, 3: four });
    const five = withTabSettings(source, { 'Electric Bass': 'bass5' }, dropD);
    expect(planTab(five, staff, 'both', options).spec!.tunings!['2']).toEqual([23,28,33,38,43]);
  });
  it('drops host overrides on instrument switches but preserves them for octave moves', () => {
    const source = withTabSettings(score([part('Guitar',25)]), { Guitar: 'bass5' });
    const state = { level: 'intermediate' as const, autoRange: true, octaves: {} };
    const trumpet = applyInstrumentView(source, { Guitar: { ...state, instrument: 'trumpet' } }, 'written').score;
    expect(canShowTab(trumpet)).toBe(false);
    const guitar = applyInstrumentView(source, { Guitar: { ...state, instrument: 'guitar' } }, 'written').score;
    expect(planTab(guitar, new Map([['Guitar','1']]), 'both', options).spec!.tunings!['1']).toHaveLength(6);
    expect(stringInstrument(source.parts[0], 'bass5', false)).toBe('bass5');
    expect(stringInstrument(source.parts[0], 'none', true)).toBe('guitar');
  });
  it('draws per-staff course counts and tuning without adding TAB inside a piano brace', () => {
    const source = score([part('Piano'), part('Guitar'), part('Bass Guitar')]);
    const plan = planTab(source, new Map([['Piano','1'],['Guitar','3'],['Bass Guitar','4']]), 'both', options);
    const mei = '<mei><music><body><mdiv><score><scoreDef><staffGrp><staffGrp symbol="brace"><staffDef n="1"/><staffDef n="2"/></staffGrp><staffDef n="3"/><staffDef n="4"/></staffGrp></scoreDef><section/></score></mdiv></body></music></mei>';
    const result = injectTab(mei, plan.spec!);
    expect(result).toMatch(/n="103" lines="6"/);
    expect(result).toMatch(/n="104" lines="4"/);
    expect(result.match(/<staffGrp symbol="brace">.*?<\/staffGrp>/)?.[0]).not.toContain('tab.guitar');
  });
  it('plays all four open re-entrant strings without dropping or crossing physical strings', () => {
    const tuning = [67,60,64,69];
    const pitches = [60,64,67,69];
    const result = assignFrets([{ onset: 0, pitches, durations: [1,1,1,1] }], { tuning, octaveFold: false })[0];
    expect(result).toEqual([{ string: 3, fret: 0 }, { string: 2, fret: 0 }, { string: 4, fret: 0 }, { string: 1, fret: 0 }]);
    const fixed = assignFrets([{ onset: 0, pitches, durations: [1,1,1,1], fixed: result.map(note => 'unplayable' in note ? undefined : note) }], { tuning })[0];
    expect(fixed).toEqual(result);
  });
});
