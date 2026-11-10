import { beforeAll, describe, expect, it } from 'vitest';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { parseAbc, parseMusicXml } from './import';
import { readMusicXml } from './notation/musicxml-source';
import { normalizeOctaveClefs } from './notation/musicxml-octave-clef';
import { scoreToMei } from './notation/document';
import { respellMei } from './notation/mei-spelling';
import { injectTab } from './notation/mei-tab';
import { buildPerformanceTimeline } from './playback/timeline';
import { planTab } from './tab/tab-parts';
import { applyInstrumentView } from './instrument-view';
import { scoreForView, soundingMidi, spellingSpecFor } from './transpose';

const fixtures = import.meta.glob('./__fixtures__/octave-clef/*', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const file = (name: string) => fixtures[`./__fixtures__/octave-clef/${name}`];
let toolkit: VerovioToolkit;
beforeAll(async () => { toolkit = new VerovioToolkit(await createVerovioModule()); });
const baseline = (text: string) => {
  toolkit.setOptions({ breaks: 'none', pageWidth: 10000 });
  expect(toolkit.loadData(text)).toBeTruthy();
  return toolkit.getMEI();
};
const ys = (mei: string) => {
  expect(toolkit.loadData(mei)).toBeTruthy();
  const svg = toolkit.renderToSVG(1);

  const staffY = Number(svg.match(/class="staff">[\s\S]*?<path d="M[\d.-]+ ([\d.-]+)/)?.[1]);
  expect(Number.isFinite(staffY)).toBe(true);
  return [...svg.matchAll(/class="notehead">\s*<use[^>]*?transform="translate\([\d.-]+, ([\d.-]+)\)/g)].map(m => Number(m[1]) - staffY);
};
const expectedFrets = [0, 2, 0, 5, 3, 0, 2, 3, 5, 4, 3, 4, 2, 3];

describe('0012 octave clefs', () => {
  it('draws ABC and written MusicXML at the sounding-reference staff positions and generates identical TAB', async () => {
    const reference = baseline(readMusicXml(file('e2-guitar-sounding.musicxml')).engravingText);
    const positions = ys(reference);
    expect(positions).toHaveLength(14);
    for (const name of ['e-guitar.abc', 'e-guitar.musicxml', 'e2-guitar-sounding.musicxml']) {
      const abc = name.endsWith('.abc');
      const imported = abc ? undefined : readMusicXml(file(name));
      const score = abc ? await parseAbc(file(name)) : imported!.score;
      const mei = baseline(abc ? scoreToMei(score) : imported!.engravingText);
      expect(ys(mei)).toEqual(positions);
      expect(mei).toMatch(/(?:clef\.)?dis="8"/);
      const part = score.parts[0];
      expect(buildPerformanceTimeline(score, { bpm: score.tempo }).events.slice(0, 8).map(e => e.midi)).toEqual([55,57,59,60,62,64,66,67]);
      expect(part.measures[0].notes.map(n => soundingMidi(part, part.measures[0], n.pitches[0], 0))).toEqual([55, 57, 59, 60, 62, 64, 66, 67]);
      const tab = injectTab(mei, planTab(score, new Map([[part.id, '1']]), 'both', { tuning: [40,45,50,55,59,64], capo: 0, stale: false }).spec!);
      expect([...tab.matchAll(/tab.fret="(\d+)"/g)].map(m => Number(m[1]))).toEqual(expectedFrets);
    }
  });

  it('keeps the guitar 8 through guitar / sax / flute / guitar switches and concert view without changing playback', async () => {
    const score = await parseAbc(file('e-guitar.abc'));
    const source = baseline(scoreToMei(score));
    const positions = ys(source);
    for (const instrument of ['guitar', 'alto-saxophone', 'flute', 'guitar'] as const) for (const view of ['written', 'concert'] as const) {
      const switched = applyInstrumentView(scoreForView(score, view, 0), { [score.parts[0].id]: { instrument, level: 'advanced', autoRange: false, octaves: {} } }, view).score;
      const part = switched.parts[0], staffs = new Map([[part.id, '1']]);
      const mei = respellMei(source, spellingSpecFor(switched, staffs));
      expect(part.measures[0].notes.map(n => soundingMidi(part, part.measures[0], n.pitches[0], 0))).toEqual([55,57,59,60,62,64,66,67]);
      if (instrument === 'guitar' && view === 'written') {
        expect(mei).toMatch(/(?:clef\.)?dis="8"/);
        expect(ys(mei)).toEqual(positions);
        expect(ys(scoreToMei(switched))).toEqual(positions);
        const tab = injectTab(mei, planTab(switched, staffs, 'both', { tuning: [40,45,50,55,59,64], capo: 0, stale: false }).spec!);
        expect([...tab.matchAll(/tab.fret="(\d+)"/g)].map(m => Number(m[1]))).toEqual(expectedFrets);
      }
    }
  });

  it('leaves sounding bass unchanged, and normalizes a written bass export to the same positions and playback', () => {
    const sounding = file('h-bass-sounding.musicxml');
    expect(normalizeOctaveClefs(sounding)).toBe(sounding);
    const written = sounding.replace(/<octave>(\d+)<\/octave>/g, (_, n) => `<octave>${Number(n) + 1}</octave>`).replace('</attributes>', '<transpose><diatonic>0</diatonic><chromatic>0</chromatic><octave-change>-1</octave-change></transpose></attributes>');
    const reference = readMusicXml(sounding), converted = readMusicXml(written);
    const pitches = (score: typeof reference.score) => score.parts.flatMap(p => p.measures.flatMap(m => m.notes.flatMap(n => n.pitches.map(pitch => soundingMidi(p, m, pitch, 0)))));
    expect(pitches(converted.score)).toEqual(pitches(reference.score));
    const positions = ys(baseline(reference.engravingText));
    expect(ys(baseline(converted.engravingText))).toEqual(positions);
    expect(converted.engravingText).toContain('<clef-octave-change>-1</clef-octave-change>');
    expect(normalizeOctaveClefs(converted.engravingText)).toBe(converted.engravingText);
  });

  it('preserves the original source and IDs, handles timewise input, namespaces and octave-up clefs', () => {
    const original = file('e-guitar.musicxml');
    const score = parseMusicXml(original);
    expect(score.document?.originalText).toBe(original);
    expect(score.document?.engravingText).toContain('id="n38"');
    expect(score.document?.engravingText).toContain('<octave>3</octave>');
    const up = original.replace(/<-1>/g, '<1>').replace(/>-1</g, '>1<');
    const normalized = normalizeOctaveClefs(up);
    expect(normalized).toContain('<octave>5</octave>');
    expect(normalizeOctaveClefs(normalized)).toBe(normalized);
    const prefixed = original.replace(/<(\/?)([a-zA-Z][\w-]*)/g, '<$1mx:$2').replace('<mx:score-partwise ', '<mx:score-partwise xmlns:mx="http://www.musicxml.org/ns/musicxml" ');
    expect(normalizeOctaveClefs(prefixed)).toContain('<mx:octave>3</mx:octave>');
    const timewise = original.replace('score-partwise', 'score-timewise').replace('</score-partwise>', '</score-timewise>').replace('<part id="P1"><measure number="1">', '<measure number="1"><part id="P1">').replace('</measure><measure number="2">', '</part></measure><measure number="2"><part id="P1">').replace('</measure></part>', '</part></measure>');
    expect(readMusicXml(timewise).score.parts[0].measures[0].notes[0].pitches[0].midi).toBe(55);
  });

  it('leaves nonmatching transposition and sibling staves untouched; keeps residual instrument transposition', () => {
    const score = (body: string) => `<score-partwise><part-list/><part id="P1"><measure number="1">${body}</measure></part></score-partwise>`;
    const note = (staff: number) => `<note id="n${staff}"><pitch><step>C</step><octave>4</octave></pitch><staff>${staff}</staff></note>`;
    const attributes = '<attributes><clef number="1"><sign>G</sign><clef-octave-change>-1</clef-octave-change></clef><clef number="2"><sign>F</sign></clef><transpose number="1"><diatonic>-1</diatonic><chromatic>-2</chromatic><octave-change>-1</octave-change></transpose></attributes>';
    const normalized = normalizeOctaveClefs(score(attributes + note(1) + note(2)));
    expect(normalized).toContain('<diatonic>-1</diatonic><chromatic>-2</chromatic>');
    expect(normalized).toContain('<octave>3</octave>');
    expect(normalized).toContain(note(2));
    const mismatch = score(attributes.replace('<octave-change>-1', '<octave-change>1') + note(1));
    expect(normalizeOctaveClefs(mismatch)).toBe(mismatch);
  });
});
