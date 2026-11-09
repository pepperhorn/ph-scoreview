import { describe, expect, it } from 'vitest';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { parseAbc } from '../import';
import { generatedPitchId, scoreToMei } from './document';
import { respellMei } from './mei-spelling';
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
