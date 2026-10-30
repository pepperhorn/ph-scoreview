import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A stand-in Worker that records what the runtime sends it. */
class FakeWorker {
  static started: FakeWorker[] = [];
  messages: any[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  constructor(readonly url: URL | string) { FakeWorker.started.push(this); }
  postMessage(message: unknown) { this.messages.push(message); }
  terminate() { this.terminated = true; }
}

const runtime = () => import('./verovio-runtime');
const doc = (text = '<score-partwise/>') => ({ engravingBytes: () => new TextEncoder().encode(text) }) as never;

describe('Verovio warm-up (main thread)', () => {
  beforeEach(() => {
    vi.resetModules();
    FakeWorker.started = [];
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('window', {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts the worker and configures it before any import request', async () => {
    const { openVerovioChannel, warmVerovio, prepareVerovio } = await runtime();
    const channel = openVerovioChannel();
    warmVerovio();
    expect(FakeWorker.started).toHaveLength(1);
    expect(FakeWorker.started[0].messages).toEqual([{ kind: 'configure', files: expect.objectContaining({ module: expect.stringMatching(/verovio-module\.mjs$/) }) }]);
    void prepareVerovio(doc(), channel).catch(() => {});
    // The import reuses the warmed worker rather than starting another.
    expect(FakeWorker.started).toHaveLength(1);
    expect(FakeWorker.started[0].messages.map(message => message.kind)).toEqual(['configure', 'import']);
  });

  it('applies verovioBaseUrl set before warming', async () => {
    const { setVerovioBaseUrl, warmVerovio } = await runtime();
    setVerovioBaseUrl('https://cdn.example/verovio/');
    warmVerovio();
    expect(FakeWorker.started[0].messages[0].files).toEqual({ module: 'https://cdn.example/verovio/verovio-module.mjs', toolkit: 'https://cdn.example/verovio/verovio.mjs' });
  });

  it('replaces a warm-only worker when the base URL changes, but never one already serving requests', async () => {
    const { openVerovioChannel, setVerovioBaseUrl, warmVerovio, prepareVerovio } = await runtime();
    const channel = openVerovioChannel();
    warmVerovio();
    setVerovioBaseUrl('https://cdn.example/a/');
    expect(FakeWorker.started[0].terminated).toBe(true);
    warmVerovio();
    expect(FakeWorker.started).toHaveLength(2);
    expect(FakeWorker.started[1].messages[0].files.module).toBe('https://cdn.example/a/verovio-module.mjs');
    void prepareVerovio(doc(), channel).catch(() => {});
    setVerovioBaseUrl('https://cdn.example/b/');
    expect(FakeWorker.started[1].terminated).toBe(false);
  });

  it('still stops a warmed worker when the last reader channel closes', async () => {
    const { openVerovioChannel, closeVerovioChannel, warmVerovio } = await runtime();
    const first = openVerovioChannel(), second = openVerovioChannel();
    warmVerovio();
    closeVerovioChannel(first);
    expect(FakeWorker.started[0].terminated).toBe(false);
    closeVerovioChannel(second);
    expect(FakeWorker.started[0].terminated).toBe(true);
  });

  it('preloadVerovio(base) warms with the host files and does nothing on a server', async () => {
    const { preloadVerovio } = await runtime();
    preloadVerovio('https://cdn.example/v/');
    expect(FakeWorker.started[0].messages[0].files.toolkit).toBe('https://cdn.example/v/verovio.mjs');
    vi.resetModules();
    vi.stubGlobal('window', undefined);
    (await runtime()).preloadVerovio();
    expect(FakeWorker.started).toHaveLength(1);
  });
});

describe('Verovio warm-up (worker)', () => {
  const flag = '__pepperscoreTestModuleCreated';
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('self', { postMessage: () => {} });
    delete (globalThis as Record<string, unknown>)[flag];
  });
  afterEach(() => vi.unstubAllGlobals());

  it('imports and instantiates Verovio on configure, before any request', async () => {
    await import('./verovio.worker');
    const module = `data:text/javascript,${encodeURIComponent(`export default async () => { globalThis.${flag} = true; return {}; };`)}`;
    const toolkit = `data:text/javascript,${encodeURIComponent('export class VerovioToolkit {} export function enableLogToBuffer() {}')}`;
    const self = (globalThis as unknown as { self: { onmessage: (event: { data: unknown }) => void } }).self;
    self.onmessage({ data: { kind: 'configure', files: { module, toolkit } } });
    await vi.waitFor(() => expect((globalThis as Record<string, unknown>)[flag]).toBe(true));
  });
});
