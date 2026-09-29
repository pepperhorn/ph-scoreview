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

function request<T>(operation: 'import' | 'render', data: string, options?: Record<string, unknown>): Promise<T> {
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, operation, data, options });
  });
}

export type VerovioTimemapEvent = { on?: string[]; off?: string[]; qstamp?: number; tstamp?: number; tempo?: number };
const importCache = new Map<string, Promise<{ mei: string; timemap: VerovioTimemapEvent[] }>>();
export function importVerovio(data: string): Promise<{ mei: string; timemap: VerovioTimemapEvent[] }> {
  let cached = importCache.get(data);
  if (!cached) {
    cached = request('import', data);
    importCache.set(data, cached);
    while (importCache.size > 2) importCache.delete(importCache.keys().next().value!);
    cached.catch(() => importCache.delete(data));
  }
  return cached;
}

export function renderVerovio(data: string, options: Record<string, unknown>): Promise<{ pages: string[] }> {
  return request('render', data, options);
}

export function disposeVerovio(): void {
  worker?.terminate();
  worker = undefined;
  importCache.clear();
  for (const item of pending.values()) item.reject(new Error('Verovio renderer disposed.'));
  pending.clear();
}
