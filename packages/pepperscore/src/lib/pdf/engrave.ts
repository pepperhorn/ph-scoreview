import type { ViewSpec } from '../notation/mei-view';
import type { VerovioFiles } from '../verovio-protocol';
import { bundledVerovioFiles } from '../../runtime-files';
import type { PaperId } from './paper';

/** A snapshot of source notation and the same view plan used by the reader. */
export type PageInput = { data: string; view?: ViewSpec };
export type PageOptions = { paper: PaperId; maxBars: number; font?: string; files?: VerovioFiles; spacingStaff?: number; annotationRoom?: number; headingMm?: number };
export type LineInfo = { start: number; count: number; width: number };
export type PagesResult = { pages: string[]; lines: LineInfo[]; shrunk: boolean };

/** Dynamically import this module on first PDF use. Each call owns and releases its own WASM worker. */
export function engravePages(input: PageInput, opts: PageOptions, signal: AbortSignal): Promise<PagesResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('PDF export cancelled.', 'AbortError')); return; }
    let worker: Worker;
    const finish = (error?: Error, value?: PagesResult) => {
      signal.removeEventListener('abort', abort);
      worker?.terminate();
      if (error) reject(error); else resolve(value!);
    };
    const abort = () => finish(new DOMException('PDF export cancelled.', 'AbortError'));
    try {
      worker = new Worker(new URL('./engrave.worker.ts', import.meta.url), { type: 'module' });
      signal.addEventListener('abort', abort, { once: true });
      worker.onmessage = ({ data }: MessageEvent<{ value?: PagesResult; error?: string }>) => finish(data.error ? new Error(data.error) : undefined, data.value);
      worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || 'PDF engraving worker failed.')); };
      worker.postMessage({ input, opts, files: opts.files ?? bundledVerovioFiles() });
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
