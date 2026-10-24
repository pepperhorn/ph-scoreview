import { describe, expect, it } from 'vitest';
import { applyInstrumentView, type PartSwitch } from '../instrument-view';
import { pitch, type Part, type Score } from '../score';
import { planTab, tabParts } from './tab-parts';

// A guitar part with an imported TAB staff doubling it (staves 1 and 2).
const notes = (partId: string) => [{ index: 0, beats: 4, notes: [{ id: `${partId}-a`, start: 0, duration: 4, pitches: [{ ...pitch('E', 3), sourceId: `m-${partId}-a` }], voice: '1' }] }];
const guitar: Part = { id: 'G', name: 'Guitar', clef: 'treble', instrument: 'guitar', gmProgram: 25, pitchBasis: 'written', transposition: { semitones: -12, diatonic: -7 }, measures: notes('G') };
const tab: Part = { id: 'T', name: 'Guitar', clef: 'tab', instrument: 'guitar', gmProgram: 25, pitchBasis: 'written', tab: true, tabOf: 'G', measures: notes('T') };
const source: Score = { title: '', source: '', tempo: 120, beats: 4, beatType: 4, key: 0, parts: [guitar, tab] };
const staffOf = new Map([['G', '1'], ['T', '2']]);
const options = { tuning: [40, 45, 50, 55, 59, 64], capo: 0, stale: false };
const sw = (instrument: PartSwitch['instrument'], octaves: PartSwitch['octaves'] = {}): PartSwitch => ({ instrument, level: 'intermediate', autoRange: true, octaves });

describe('TAB of an instrument view', () => {
  it('as written: the imported TAB shows', () => {
    const plan = planTab(source, staffOf, 'tab', options);
    expect(plan.importedFor.get('G')?.id).toBe('T');
    expect(plan.added).toEqual([]);
  });

  it('an octave-moved guitar regenerates its TAB (fingerings not fixed) and hides the imported one', () => {
    const view = applyInstrumentView(source, { G: sw(undefined, { 'G-a': 12 }) }, 'written').score;
    for (const tabView of ['tab', 'both'] as const) {
      const plan = planTab(view, staffOf, tabView, options);
      expect(plan.importedFor.size).toBe(0);
      expect(plan.added).toEqual(['101']);
      expect(plan.hidden).toContain('2');
      expect(plan.spec).toMatchObject({ generate: ['1'], fixed: true, unfixed: ['1'] });
    }
  });

  it('a guitar switched to violin is no TAB part: notation stays, the imported TAB is hidden', () => {
    const view = applyInstrumentView(source, { G: sw('violin') }, 'written').score;
    expect(tabParts(view)).toEqual([]);
    const plan = planTab(view, staffOf, 'tab', options);
    expect(plan.hidden).toEqual(['2']);
    expect(plan.added).toEqual([]);
    expect(plan.display.size).toBe(0);
    expect(plan.spec).toBeUndefined();
  });

  it('a part switched to guitar takes generated TAB', () => {
    const piano: Part = { ...guitar, id: 'P', name: 'Piano', instrument: 'piano', gmProgram: 1, transposition: undefined };
    const flute: Part = { ...guitar, id: 'F', name: 'Flute', instrument: 'flute', gmProgram: 74, transposition: undefined };
    const view = applyInstrumentView({ ...source, parts: [flute, piano] }, { P: sw('guitar') }, 'written').score;
    expect(tabParts(view).map(part => part.id)).toEqual(['P']);
    expect(planTab(view, new Map([['F', '1'], ['P', '2']]), 'both', options).added).toEqual(['102']);
  });
});
