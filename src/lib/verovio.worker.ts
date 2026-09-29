import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

type WorkerRequest = {
  id: number;
  operation: 'import' | 'render';
  data: string;
  options?: Record<string, unknown>;
  /** One-based page numbers to serialize; all pages when omitted. */
  pages?: number[];
};

let modulePromise: Promise<unknown> | undefined;
const moduleReady = () => modulePromise ??= createVerovioModule();
let toolkit: VerovioToolkit | undefined;

// One toolkit is reused across requests. Requests are serialized, and every
// request resets options before applying its own, so transposition, fonts and
// layout settings cannot leak between loads. A failed request discards the
// instance so a poisoned WASM state is never reused.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      toolkit ??= new VerovioToolkit(await moduleReady());
      toolkit.resetOptions();
      // Stable generated IDs come from xmlIdChecksum; resetXmlIdSeed(0) would mean a random seed.
      toolkit.setOptions(request.operation === 'import'
        ? { breaks: 'none', inputFrom: 'auto', xmlIdChecksum: true }
        : request.options || {});
      if (!toolkit.loadData(request.data)) throw new Error('Verovio could not import this score.');
      let value: unknown;
      if (request.operation === 'import') value = { mei: toolkit.getMEI() };
      else {
        const count = toolkit.getPageCount();
        const wanted = request.pages?.filter(page => page >= 1 && page <= count) ?? Array.from({ length: count }, (_, index) => index + 1);
        value = { pageCount: count, pages: wanted.map(page => ({ page, svg: toolkit!.renderToSVG(page) })) };
      }
      self.postMessage({ id: request.id, value });
    } catch (error) {
      try { toolkit?.destroy(); } catch { /* already unusable */ }
      toolkit = undefined;
      self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
};
