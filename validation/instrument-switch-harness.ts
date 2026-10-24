// In-page harness for validation/instrument-switch.mjs: imports a MusicXML file the way the reader does and reports the
// import facts the instrument switch keys on (source part ids, slur ends, note ids) plus the MEI xml:ids Verovio assigns.
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { parseMusicXml } from '../packages/pepperscore/src/lib/import';
import { sourcePartOf } from '../packages/pepperscore/src/lib/instrument-view';

let toolkit: Promise<InstanceType<typeof VerovioToolkit>> | undefined;
const verovio = () => toolkit ??= createVerovioModule().then(module => new VerovioToolkit(module));

/** The xml:ids of an MEI document, in order. */
async function meiIds(xml: string): Promise<string[]> {
  const target = await verovio();
  target.resetOptions(); target.setOptions({ breaks: 'none', inputFrom: 'auto', xmlIdChecksum: true });
  if (!target.loadData(xml)) throw new Error('Verovio could not load the document');
  return [...target.getMEI().matchAll(/xml:id="([^"]+)"/g)].map(match => match[1]);
}

export async function importFacts(xml: string) {
  const score = parseMusicXml(xml);
  return {
    parts: score.parts.map(part => ({ id: part.id, sourcePartId: part.sourcePartId, sourcePart: sourcePartOf(part) })),
    noteIds: score.parts.flatMap(part => part.measures.flatMap(measure => measure.notes.map(note => note.id))),
    slurStops: score.parts.flatMap(part => part.measures.flatMap(measure => measure.notes.map(note => (note.slurStop?.length ?? 0) > 0))),
    meiIds: await meiIds(xml),
  };
}
