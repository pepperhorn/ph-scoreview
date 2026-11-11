import { describe, expect, it } from 'vitest';
import { injectTab, type TabSpec } from '../../notation/mei-tab';
import { VIOLIN, CELLO } from './charts';
import { fingeringPitch } from './solver';
import { solveFingerPhrase } from './phrase';
import { substituteFingerLabels } from './svg';

const wrap = (notes: string, key = '0') => `<mei><music><body><mdiv><score><scoreDef keysig="${key}"><staffGrp><staffDef n="1" lines="5"/></staffGrp></scoreDef><section><measure><staff n="1"><layer n="1">${notes}</layer></staff></measure></section></score></mdiv></body></music></mei>`;
const spec: TabSpec = { generate: ['1'], retarget: {}, tuning: [55,62,69,76], fingers: { '1': 'violin' }, capo: 0, fixed: false };
describe('finger TAB integration', () => {
  it('passes key-signature spelling and measure accidentals to the chart', () => {
    const mei = injectTab(wrap('<note xml:id="a" pname="a" oct="3" dur="4"/><note xml:id="b" pname="b" oct="3" dur="4"/>', '2f'), spec);
    expect(mei).toContain('finger-tab-L2-p1'); // Bb3, not A#3
    expect(mei).toContain('I pos.');
    expect(mei).toContain('lines="4"');
  });
  it('numeric placeholders reserve two glyphs; metadata survives independently of ordering/font size', () => {
    const mei = injectTab(wrap('<note xml:id="a" pname="b" oct="3" accid="f" dur="4"/>'), spec);
    expect(mei).toContain('tab.fret="44"');
    const svg = '<svg><g id="other" class="note"><text><tspan>5</tspan></text></g><g id="a-tabn" class="note finger-tab-L2-p1"><text x="200" y="300" font-size="0px"><tspan font-size="280px">44</tspan></text></g></svg>';
    const out = substituteFingerLabels(svg);
    expect(out).toContain('font-size="280px"');
    expect(out).toContain('>L2</text>');
    expect(out).toContain('<tspan>5</tspan>');
    expect(substituteFingerLabels(out)).toBe(out);
  });
  it('centres position directions without changing other score directions', () => {
    const svg = '<svg><g class="dir finger-position"><text x="50">IV½ pos.</text></g><g class="dir"><text x="60">Allegro</text></g></svg>';
    const out = substituteFingerLabels(svg);
    expect(out).toContain('<text x="50" text-anchor="middle">');
    expect(out).toContain('<text x="60">Allegro</text>');
    expect(substituteFingerLabels(out)).toBe(out);
  });
  it.each([VIOLIN, CELLO])('%s double stops use distinct strings and one hand position with exact pitches', chart => {
    for (let low = chart.openMidi[3]; low < chart.openMidi[0] + 8; low++) {
      const notes = [low, low + 7].map((midi, i) => ({ id: String(i), midi, onset: 0, duration: 1 }));
      const solved = solveFingerPhrase(chart, notes);
      if (!solved.size) continue;
      const [a, b] = notes.map(n => solved.get(n.id)!);
      expect(a.string).not.toBe(b.string);
      if (a.position && b.position) expect(a.position).toBe(b.position);
      notes.forEach(n => expect(fingeringPitch(chart, solved.get(n.id)!)).toBe(n.midi));
    }
  });
  it('continues a tie on its string and keeps overlapping voices feasible', () => {
    const solved = solveFingerPhrase(VIOLIN, [
      { id:'a',midi:77,onset:0,duration:1 }, { id:'b',midi:77,onset:1,duration:1,tieStop:true },
      { id:'c',midi:70,onset:1,duration:1 },
    ]);
    expect(solved.get('b')).toEqual(solved.get('a'));
    expect(solved.get('c')?.position).toBe(solved.get('b')?.position);
    expect(solved.get('c')?.string).not.toBe(solved.get('b')?.string);
  });
  it('keeps double-stop labels on stable chord note ids and hides tie continuation fingers', () => {
    const mei = injectTab(wrap('<chord xml:id="ch" dur="4"><note xml:id="a" pname="f" oct="5" accid="s"/><note xml:id="b" pname="c" oct="5" accid="s"/></chord><note xml:id="c" pname="c" oct="5" accid="s" dur="4" tie="t"/>'), spec);
    expect(mei).toContain('xml:id="a-tab"');
    expect(mei).toContain('xml:id="b-tab"');
    expect(mei).toContain('finger-tab-1-p1');
    expect(mei).toContain('finger-tab-2-p1');
    expect(mei).toContain('visible="false"');
  });
  it('does not let capo or custom tuning change fretless chart pitches', () => {
    const mei = wrap('<note xml:id="a" pname="b" oct="3" accid="f" dur="4"/>');
    expect(injectTab(mei, { ...spec, capo: 7, tunings: { '1': [40,45,50,55,59,64] } })).toBe(injectTab(mei, spec));
  });
});
