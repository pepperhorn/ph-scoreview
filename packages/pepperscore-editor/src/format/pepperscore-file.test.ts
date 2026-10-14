import type { Cursor } from '../engine/types';
import { helloDoc } from '../test-helpers';
import phase1 from './__fixtures__/phase1.pepperscore.json?raw';
import { PEPPERSCORE_EXTENSION, PEPPERSCORE_MIME, readPepperScoreFile, writePepperScoreFile } from './pepperscore-file';

const cursor = (doc: ReturnType<typeof helloDoc>): Cursor => ({
  partId: doc.parts[0].id, staff: 1, voice: 1, measureId: doc.global.measures[0].id, tick: 960, duration: { base: 'eighth', dots: 1 }, mode: 'enter',
  lastPitch: { step: 'E', octave: 4, alter: 0 },
});

describe('.pepperscore files', () => {
  it('round-trips the document, source and editor state as 2-space JSON', () => {
    const doc = { ...helloDoc(), meta: { title: 'Hello', composer: 'Me' } };
    const source = { format: 'musicxml' as const, sha256: 'ab'.repeat(32), filename: 'hello.musicxml', dropped: [{ feature: 'lyric', count: 2, location: 'P1/m1' }] };
    const editor = { cursor: cursor(doc), activeLayoutId: doc.layouts[0].id };
    const text = writePepperScoreFile({ document: doc, source, editor, created: '2026-01-02T03:04:05.000Z' });
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
    const file = readPepperScoreFile(text);
    expect(file.pepperscore).toEqual({ version: 1 });
    expect(file.document).toEqual(doc);
    expect(file.source).toEqual(source);
    expect(file.editor).toEqual(editor);
    expect(file.meta).toMatchObject({ title: 'Hello', composer: 'Me', created: '2026-01-02T03:04:05.000Z' });
    expect(Date.parse(file.meta.modified)).toBeGreaterThanOrEqual(Date.parse(file.meta.created));
  });

  it('stamps created and modified when created is not given, and omits absent sections', () => {
    const file = readPepperScoreFile(writePepperScoreFile({ document: { ...helloDoc(), meta: {} } }));
    expect(file.meta.created).toBe(file.meta.modified);
    expect(Number.isNaN(Date.parse(file.meta.created))).toBe(false);
    expect(file).not.toHaveProperty('source');
    expect(file).not.toHaveProperty('editor');
    expect(file.meta).not.toHaveProperty('title');
  });

  it('rejects non-JSON and JSON without a pepperscore header', () => {
    expect(() => readPepperScoreFile('<score-partwise/>')).toThrow('Not a .pepperscore file');
    expect(() => readPepperScoreFile('{"document":{}}')).toThrow('Not a .pepperscore file');
    expect(() => readPepperScoreFile('null')).toThrow('Not a .pepperscore file');
  });

  it('rejects other versions', () => {
    const file = JSON.parse(writePepperScoreFile({ document: helloDoc() }));
    file.pepperscore.version = 2;
    expect(() => readPepperScoreFile(JSON.stringify(file))).toThrow('Unsupported .pepperscore version 2');
  });

  it('a header without a numeric version is not a .pepperscore file', () => {
    for (const version of [undefined, '1', null, {}]) {
      const file = JSON.parse(writePepperScoreFile({ document: helloDoc() }));
      file.pepperscore = version === undefined ? {} : { version };
      expect(() => readPepperScoreFile(JSON.stringify(file))).toThrow('Not a .pepperscore file');
    }
  });

  it('validates the document and the wrapper', () => {
    const file = JSON.parse(writePepperScoreFile({ document: helloDoc() }));
    expect(() => readPepperScoreFile(JSON.stringify({ ...file, document: { ...file.document, layouts: [] } }))).toThrow();
    expect(() => readPepperScoreFile(JSON.stringify({ ...file, meta: {} }))).toThrow();
    expect(() => readPepperScoreFile(JSON.stringify({ ...file, source: { format: 'pdf', sha256: 'x', dropped: [] } }))).toThrow();
  });

  it('names its MIME type and extension', () => {
    expect(PEPPERSCORE_MIME).toBe('application/vnd.pepperscore+json');
    expect(PEPPERSCORE_EXTENSION).toBe('.pepperscore');
  });

  it('opens a phase 1 file, whose layouts have no kind or transposing flag', () => {
    const text = phase1;
    expect(JSON.parse(text).document.layouts[0]).not.toHaveProperty('transposing');
    const file = readPepperScoreFile(text);
    expect(file.pepperscore).toEqual({ version: 1 });
    expect(file.document.layouts).toEqual([{ id: 'layout1', name: 'Score', kind: 'score', transposing: true, parts: [{ partId: 'p1' }], overrides: {} }]);
    expect(file.document.parts[0].measures[0].sequences[0].content.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });
});
