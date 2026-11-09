import { describe, expect, it } from 'vitest';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { parseAbc } from '../import';
import { generatedPitchId, scoreToMei } from './document';
import { respellMei, spellBaseline } from './mei-spelling';
import { spellingSpecFor } from '../transpose';
import { buildPerformanceTimeline } from '../playback/timeline';

// The local Verovio declaration omits these native toolkit methods.
const createToolkit = async () => new VerovioToolkit(await createVerovioModule()) as VerovioToolkit & {
  renderToMIDI(): string;
  getMIDIValuesForElement(id: string): { pitch: number };
};

async function fixture(layers: number, shortFirst = false) {
  const score = await parseAbc('X:1\nM:4/4\nL:1/4\nK:C\nC D [K:G] F =F | F4 |]');
  const measure = score.parts[0].measures[0];
  const notes = measure.notes;
  measure.notes = Array.from({ length: layers }, (_, layer) => notes
    .filter(n => !shortFirst || layer > 0 || n.start < 2)
    .map(n => ({ ...n, id: `${n.id}-v${layer + 1}`, voice: String(layer + 1), pitches: n.pitches.map(p => ({ ...p })) }))).flat();
  return score;
}

describe('staff-wide mid-bar key signatures', () => {
  it.each([1, 2])('draws one mid-bar signature with %i layers and retains spelling/playback', async layers => {
    const score = await fixture(layers);
    const part = score.parts[0];
    const mei = scoreToMei(score);
    // Pin main's single-layer spelling: implied F sharp then explicit F natural.
    for (const note of part.measures[0].notes.filter(n => n.start >= 2)) {
      const tag = mei.match(new RegExp(`<note\\b[^>]*xml:id="${generatedPitchId(note, 0)}"[^>]*>`))![0];
      expect(tag).toContain('pname="f" oct="4"');
      if (note.start === 2) { expect(tag).toContain('accid.ges="s"'); expect(tag).not.toContain(' accid="'); }
      else expect(tag).toContain('accid="n"');
    }
    const expected = [...Array.from({ length: layers }, () => [60, 62, 66, 65]).flat(), 66].sort((a, b) => a - b);
    expect(buildPerformanceTimeline(score, { bpm: 120 }).events.map(e => e.midi).sort((a, b) => a - b)).toEqual(expected);
    const toolkit = await createToolkit();
    try {
      expect(toolkit.loadData(mei)).toBeTruthy();
      // One initial C signature group plus exactly one mid-bar G signature group.
      expect(toolkit.renderToSVG(1).match(/class="keySig"/g)).toHaveLength(2);
      const normalized = toolkit.getMEI();
      expect(normalized.match(/<keySig\b[^>]*sig="1s"/g)).toHaveLength(1);
      const spelled = respellMei(normalized, spellingSpecFor(score, new Map([[part.id, '1']])));
      expect(toolkit.loadData(spelled)).toBeTruthy();
      expect(toolkit.renderToSVG(1).match(/class="keySig"/g)).toHaveLength(2);
      toolkit.renderToMIDI();
      for (const measure of part.measures) for (const note of measure.notes) {
        expect(toolkit.getMIDIValuesForElement(generatedPitchId(note, 0)).pitch).toBe(note.pitches[0].midi);
      }
    } finally { toolkit.destroy(); }
  });

  it.each([
    { interval: 'M2', semitones: 2, sig: '3s', pname: 'g', oct: '4' },
    { interval: '-m3', semitones: -3, sig: '4s', pname: 'd', oct: '4' },
  ])('retains one signature and every layer’s pitches transposed by $interval', async ({ interval, semitones, sig, pname, oct }) => {
    const score = await fixture(2);
    const part = score.parts[0];
    const toolkit = await createToolkit();
    try {
      expect(toolkit.loadData(scoreToMei(score))).toBeTruthy();
      const spelled = await spellBaseline(toolkit.getMEI(), {
        ...spellingSpecFor(score, new Map([[part.id, '1']])), interval, semitones,
      }, (mei, options) => {
        toolkit.setOptions(options);
        expect(toolkit.loadData(mei)).toBeTruthy();
        return toolkit.getMEI();
      });
      toolkit.setOptions({ transpose: '', transposeToSoundingPitch: false });
      expect(toolkit.loadData(spelled)).toBeTruthy();
      expect(toolkit.renderToSVG(1).match(/class="keySig"/g)).toHaveLength(2);
      const normalized = toolkit.getMEI();
      expect(normalized.match(new RegExp(`<keySig\\b[^>]*sig="${sig}"`, 'g'))).toHaveLength(1);
      // Both the owning layer and the other layer keep implied sharp / explicit natural spelling.
      for (const note of part.measures[0].notes.filter(n => n.start >= 2)) {
        const element = normalized.match(new RegExp(`<note\\b[^>]*xml:id="${generatedPitchId(note, 0)}"[^>]*>[\\s\\S]*?</note>`))![0];
        expect(element).toContain(`pname="${pname}"`);
        expect(element).toContain(`oct="${oct}"`);
        expect(element).toContain(note.start === 2 ? 'accid.ges="s"' : 'accid="n"');
      }
      toolkit.renderToMIDI();
      for (const measure of part.measures) for (const note of measure.notes) {
        expect(toolkit.getMIDIValuesForElement(generatedPitchId(note, 0)).pitch).toBe(note.pitches[0].midi + semitones);
      }
    } finally { toolkit.destroy(); }
  });

  it('falls back to layer 1 when every layer sustains across the key change', async () => {
    const score = await fixture(2);
    const part = score.parts[0];
    const measure = part.measures[0];
    measure.notes = measure.notes.filter(n => n.start === 0 || n.start === 3);
    for (const note of measure.notes.filter(n => n.start === 0)) note.duration = 3;
    const mei = scoreToMei(score);
    const layers = [...mei.matchAll(/<layer n="(\d+)">([\s\S]*?)<\/layer>/g)];
    expect(mei.match(/<keySig\b/g)).toHaveLength(1);
    expect(layers[0][2]).toContain('<keySig sig="1s"');
    expect(layers[1][2]).not.toContain('<keySig');
    // Intentional main behaviour: with no free layer at beat 2, layer 1 owns the
    // signature and draws it late, after its dotted-half note ends at beat 3.
    const held = measure.notes.find(n => n.voice === '1' && n.start === 0)!;
    const after = measure.notes.find(n => n.voice === '1' && n.start === 3)!;
    expect(layers[0][2]).toContain('dur="2" dots="1"');
    expect(layers[0][2].indexOf(generatedPitchId(held, 0))).toBeLessThan(layers[0][2].indexOf('<keySig'));
    expect(layers[0][2].indexOf('<keySig')).toBeLessThan(layers[0][2].indexOf(generatedPitchId(after, 0)));
    const toolkit = await createToolkit();
    try {
      expect(toolkit.loadData(mei)).toBeTruthy();
      expect(toolkit.renderToSVG(1).match(/class="keySig"/g)).toHaveLength(2);
      const spelled = respellMei(toolkit.getMEI(), spellingSpecFor(score, new Map([[part.id, '1']])));
      expect(toolkit.loadData(spelled)).toBeTruthy();
      expect(toolkit.renderToSVG(1).match(/class="keySig"/g)).toHaveLength(2);
      toolkit.renderToMIDI();
      for (const measure of part.measures) for (const note of measure.notes) {
        expect(toolkit.getMIDIValuesForElement(generatedPitchId(note, 0)).pitch).toBe(note.pitches[0].midi);
      }
    } finally { toolkit.destroy(); }
  });

  it.each(['trailing rest', 'held note'])('retains the onset when layer 1 has a %s', async kind => {
    const score = await fixture(2, kind === 'trailing rest');
    if (kind === 'held note') {
      const measure = score.parts[0].measures[0];
      measure.notes = measure.notes.filter(n => n.voice !== '1' || n.start === 0 || n.start === 3);
      measure.notes[0].duration = 3;
    }
    const mei = scoreToMei(score);
    expect(mei.match(/<keySig\b/g)).toHaveLength(1);
    const toolkit = await createToolkit();
    try {
      expect(toolkit.loadData(mei)).toBeTruthy();
      expect(toolkit.renderToSVG(1).match(/class="keySig"/g)).toHaveLength(2);
      const normalized = toolkit.getMEI();
      const spelled = respellMei(normalized, spellingSpecFor(score, new Map([[score.parts[0].id, '1']])));
      expect(toolkit.loadData(spelled)).toBeTruthy();
      toolkit.renderToMIDI();
      expect(toolkit.renderToSVG(1).match(/class="keySig"/g)).toHaveLength(2);
      const after = score.parts[0].measures[0].notes.find(n => n.start === 2)!;
      expect(toolkit.getMIDIValuesForElement(generatedPitchId(after, 0)).pitch).toBe(66);
    } finally { toolkit.destroy(); }
  });
});
