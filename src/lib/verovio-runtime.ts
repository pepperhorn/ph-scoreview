type Reply = { id: number; value?: unknown; error?: string };
type Pending = { resolve: (value: any) => void; reject: (reason: Error) => void };
let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./verovio.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<Reply>) => {
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id);
    if (data.error) item.reject(new Error(data.error));
    else item.resolve(data.value);
  };
  worker.onerror = (event) => {
    for (const item of pending.values()) item.reject(new Error(event.message || 'Verovio worker failed.'));
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}

function request<T>(operation: 'import' | 'render', data: string, options?: Record<string, unknown>, pages?: number[]): Promise<T> {
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, operation, data, options, pages });
  });
}

function remember<T>(cache: Map<string, Promise<T>>, key: string, limit: number, make: () => Promise<T>): Promise<T> {
  let cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return cached; }
  cached = make();
  cache.set(key, cached);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
  cached.catch(() => { if (cache.get(key) === cached) cache.delete(key); });
  return cached;
}

const importCache = new Map<string, Promise<{ mei: string }>>();
/** Import a source document once and return Verovio's untouched MEI baseline. */
export function importVerovio(data: string): Promise<{ mei: string }> {
  return remember(importCache, data, 2, () => request('import', data));
}

export type VerovioPages = { pageCount: number; pages: { page: number; svg: string }[] };
const renderCache = new Map<string, Promise<VerovioPages>>();
/**
 * Lay out and serialize pages. Results are cached by (MEI, options, pages), so
 * view changes that do not alter the engraving (zoom, text font, count style)
 * reuse the previous layout instead of running Verovio again.
 */
export function renderVerovio(data: string, options: Record<string, unknown>, pages?: number[]): Promise<VerovioPages> {
  const key = `${JSON.stringify(options)}\u0000${pages?.join(',') ?? '*'}\u0000${data}`;
  return remember(renderCache, key, 8, () => request('render', data, options, pages));
}

export function disposeVerovio(): void {
  worker?.terminate();
  worker = undefined;
  importCache.clear();
  renderCache.clear();
  for (const item of pending.values()) item.reject(new Error('Verovio renderer disposed.'));
  pending.clear();
}
