import { localNameOf, scanXml, XmlElement, XmlTreeBuilder } from './xml-stream';

/** Normalize matching octave-clef / octave-transpose encodings to sounding octaves.
 * Only the import copy changes. Keep chromatic/diatonic transposition, IDs, and all other source markup.
 * Capture one attributes/note subtree at a time; workers need no DOM or whole-document tree.
 */
export function normalizeOctaveClefs(text: string): string {
  if (!/<(?:[\w.-]+:)?octave-change(?:\s|>)/.test(text)) return text;
  const builder = new XmlTreeBuilder();
  const spans = new WeakMap<XmlElement, { start: number; end: number }>();
  const stack: string[] = [];
  const elements: (XmlElement | null)[] = [];
  const edits: { start: number; end: number; text: string }[] = [];
  const clefs = new Map<number, number>();
  const shifts = new Map<number, number>();
  const child = (e: XmlElement, name: string) => e.children.find(c => c.localName === name);
  const value = (e: XmlElement, name: string) => Number(child(e, name)?.textContent.trim() || 0);
  const replace = (e: XmlElement, replacement: string) => edits.push({ ...spans.get(e)!, text: replacement });
  scanXml(text, {
    startElement(name, attributes, start, end) {
      const local = localNameOf(name);
      if (local === 'part' && stack.at(-1) === 'score-partwise') { clefs.clear(); shifts.clear(); }
      const capture = local === 'attributes' || local === 'note';
      const element = builder.open(name, attributes, capture);
      if (element) spans.set(element, { start, end });
      stack.push(local);
      elements.push(element);
    },
    endElement(_name, _start, end) {
      stack.pop();
      const closing = elements.pop();
      if (closing) spans.get(closing)!.end = end;
      const element = builder.close();
      if (!element) return;
      spans.get(element)!.end = end;
      // Child spans end when closed, even when the owning subtree is still open.
      if (element.localName === 'attributes') {
        for (const clef of element.children.filter(c => c.localName === 'clef')) {
          clefs.set(Number(clef.getAttribute('number') || 1), value(clef, 'clef-octave-change'));
        }
        for (const transpose of element.children.filter(c => c.localName === 'transpose')) {
          const staff = Number(transpose.getAttribute('number') || 0);
          const octave = child(transpose, 'octave-change');
          const change = value(transpose, 'octave-change');
          const applicable = staff ? [clefs.get(staff)] : [...clefs.values()];
          const matches = change !== 0 && applicable.length > 0 && applicable.every(c => c === change);
          shifts.set(staff, matches ? change : 0);
          if (!staff) for (const n of shifts.keys()) if (n) shifts.delete(n);
          if (matches && octave) replace(octave, '');
        }
      } else if (element.localName === 'note') {
        const staff = value(element, 'staff') || 1;
        const shift = shifts.get(staff) ?? shifts.get(0) ?? 0;
        const pitch = child(element, 'pitch');
        const octave = pitch && child(pitch, 'octave');
        if (shift && octave) {
          const span = spans.get(octave)!;
          const raw = text.slice(span.start, span.end);
          replace(octave, raw.replace(/(>)[\s\S]*(<\/)/, (_match, open, close) => `${open}${Number(octave.textContent.trim()) + shift}${close}`));
        }
      }
    },
    text: value => builder.text(value),
  });
  if (!edits.length) return text;
  edits.sort((a, b) => a.start - b.start);
  let from = 0;
  const pieces: string[] = [];
  for (const edit of edits) { pieces.push(text.slice(from, edit.start), edit.text); from = edit.end; }
  pieces.push(text.slice(from));
  return pieces.join('');
}
