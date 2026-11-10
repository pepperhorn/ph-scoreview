import { describe, expect, it } from 'vitest';
import { STRING_INSTRUMENTS, stringInstrument, withTabSettings } from './string-instruments';
import { canShowTab, planTab } from './tab-parts';
import { assignFrets } from './fret-assign';
import { injectTab } from '../notation/mei-tab';
import type { Part, Score } from '../score';

const part = (name: string, gmProgram = 1): Part => ({ id: name, name, gmProgram, instrument: 'piano', clef: 'treble', measures: [] });
const score = (parts: Part[]): Score => ({ title: '', source: '', tempo: 96, beats: 4, beatType: 4, key: 0, parts });
const options = { tuning: [40, 45, 50, 55, 59, 64], capo: 0, stale: false };
describe('string instrument TAB', () => {
  it('recognizes every GM guitar/bass program and rejects non-strings', () => {
    for (let gm = 25; gm <= 40; gm++) expect(stringInstrument(part('Part', gm))).toBe(gm < 33 ? 'guitar' : 'bass4');
    for (const name of ['Piano', 'Flute', 'Clarinet']) expect(canShowTab(score([part(name)]))).toBe(false);
    for (const name of ['Violin', 'Cello', 'Viola', 'Double Bass']) expect(canShowTab(score([part(name)]))).toBe(false);
    expect(stringInstrument(part('Double Bass', 33))).toBe('double-bass');
    expect(stringInstrument({ ...part('Acoustic Bass', 33), instrument: 'double-bass' })).toBe('bass4');
    expect(stringInstrument(part('Cello', 25))).toBe('cello');
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
    expect(Object.values(explicit.spec!.tunings!)).toEqual(parts.map(() => options.tuning));
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
