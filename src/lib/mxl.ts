import { strFromU8, unzipSync } from 'fflate';
import { parseXmlTree } from './notation/xml-stream';

const MB = 1024 * 1024;
/** Largest score file accepted (MusicXML, MXL, MEI, ABC or MIDI). Orchestral MusicXML routinely runs to tens of MB. */
export const MAX_SCORE_FILE_BYTES = 64 * MB;
/** Uncompressed size limit for an MXL score member; bounds decompression so a small archive cannot inflate without limit. */
export const MXL_MAX_SCORE_BYTES = 128 * MB;
export const formatMb = (bytes: number) => `${Math.round(bytes / MB * 10) / 10} MB`;

/**
 * Reads the MusicXML member of an MXL archive without inflating anything else:
 * only META-INF/container.xml and the chosen score are decompressed, each with a
 * declared-size bound (fflate never writes past the declared size). DOM-free, so it runs in the import worker.
 */
export function extractMxlScore(bytes: Uint8Array): string {
  const entries: { name: string; originalSize: number }[] = [];
  let listing: Record<string, Uint8Array>;
  try {
    listing = unzipSync(bytes, { filter: file => { entries.push({ name: file.name, originalSize: file.originalSize }); return file.name === 'META-INF/container.xml' && file.originalSize <= 1_000_000; } });
  } catch { throw new Error('This MXL archive could not be opened.'); }
  const container = listing['META-INF/container.xml'];
  let path: string | undefined;
  if (container) {
    let declared: string | null | undefined;
    try {
      const root = parseXmlTree(strFromU8(container));
      declared = (root.localName === 'rootfile' ? root : root.descendants().find(el => el.localName === 'rootfile'))?.getAttribute('full-path');
    }
    catch { throw new Error('This MXL archive has an unreadable META-INF/container.xml.'); }
    if (declared) {
      try { path = decodeURIComponent(declared.trim()); } catch { path = declared.trim(); }
      path = path.replace(/^\.\//, '');
      if (path.startsWith('/') || path.split(/[\\/]/).includes('..')) throw new Error('This MXL archive declares an unsafe score path.');
      // Some writers percent-encode the path, others store it raw; accept either spelling.
      if (!entries.some(entry => entry.name === path) && entries.some(entry => entry.name === declared!.trim())) path = declared.trim();
    }
  }
  const target = path ? entries.find(entry => entry.name === path) : entries.find(entry => /\.(xml|musicxml)$/i.test(entry.name) && !entry.name.startsWith('META-INF/'));
  if (!target) throw new Error(path ? `This MXL archive does not contain its declared score "${path}".` : 'This MXL archive has no MusicXML score.');
  if (!(target.originalSize <= MXL_MAX_SCORE_BYTES)) throw new Error(`The score inside this MXL archive is ${formatMb(target.originalSize)} uncompressed; the limit is ${formatMb(MXL_MAX_SCORE_BYTES)}.`);
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes, { filter: file => file.name === target.name && file.originalSize <= MXL_MAX_SCORE_BYTES }); }
  catch { throw new Error('The score inside this MXL archive could not be decompressed.'); }
  const entry = files[target.name];
  if (!entry || !entry.length) throw new Error('The score inside this MXL archive is empty.');
  return strFromU8(entry);
}
