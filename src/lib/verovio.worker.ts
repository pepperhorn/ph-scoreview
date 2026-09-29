import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

type WorkerRequest = {
  id: number;
  operation: 'import' | 'render';
  data: string;
  options?: Record<string, unknown>;
};

let modulePromise: Promise<unknown> | undefined;
const moduleReady = () => modulePromise ??= createVerovioModule();

// The WASM toolkit has mutable global state. Each request owns an instance and
// requests are serialized so a rejected or superseded render cannot poison it.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    const toolkit = new VerovioToolkit(await moduleReady());
    try {
      toolkit.setOptions(request.operation === 'import'
        ? { breaks: 'none', inputFrom: 'auto', xmlIdChecksum: true }
        : request.options || {});
      if (!toolkit.loadData(request.data)) throw new Error('Verovio could not import this score.');
      const value = request.operation === 'import'
        ? { mei: toolkit.getMEI(), timemap: toolkit.renderToTimemap() }
        : { pages: Array.from({ length: toolkit.getPageCount() }, (_, index) => toolkit.renderToSVG(index + 1)) };
      self.postMessage({ id: request.id, value });
    } catch (error) {
      self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
    } finally {
      toolkit.destroy();
    }
  });
};
