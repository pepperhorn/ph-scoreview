import { describe, expect, it, vi, afterEach } from 'vitest';
import { applyInstrumentView, type PartSwitch } from '../instrument-view';
import { pitch, type Part, type Score } from '../score';
import { withTabSettings } from './string-instruments';
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


describe('custom tuning diagnostics', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const bass = { ...guitar, id: 'b1', name: 'Bass', instrument: 'bassguitar' as const, gmProgram: undefined };
  const tuning = [23, 28, 33, 38, 43];
  const configured = { ...source, parts: [bass], tabSettings: { tuning } };
  const staves = new Map([['b1', '1']]);
  it('warns in development, names the part and suggests the bass5 override, keeping default tuning', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(planTab(configured, staves, 'both', options).spec!.tunings!['1']).toEqual([28,33,38,43]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('part "Bass" (b1)'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("settings.tabInstruments: { 'b1': 'bass5' }"));
    planTab(configured, staves, 'tab', options);
    planTab({ ...configured, parts: [{ ...bass }] }, staves, 'both', options);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockClear();
    expect(planTab(withTabSettings(configured, { b1: 'bass5' }, tuning), staves, 'both', options).spec!.tunings!['1']).toEqual(tuning);
    expect(warn).not.toHaveBeenCalled();
  });
  it('directs saved reader tunings to the reader and warns only once for that part', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const saved = { ...source, parts: [{ ...bass, id: 'saved-bass' }] };
    const staff = new Map([['saved-bass', '1']]);
    planTab(saved, staff, 'both', { ...options, tuning });
    planTab(saved, staff, 'tab', { ...options, tuning: [30,35,40,45,50,55] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Reader saved tuning'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('in the reader'));
    expect(warn.mock.calls[0][0]).not.toContain('settings.tabInstruments');
  });
  it.each(['production', 'no-process'])('skips diagnostics safely in %s hosts', environment => {
    if (environment === 'production') vi.stubEnv('NODE_ENV', 'production');
    else vi.stubGlobal('process', undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const id = environment;
    expect(planTab({ ...configured, parts: [{ ...bass, id }] }, new Map([[id, '1']]), 'both', options).spec!.tunings!['1']).toEqual([28,33,38,43]);
    expect(warn).not.toHaveBeenCalled();
  });
});
