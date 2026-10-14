import type { BaselineInfo, ViewSpec } from './notation/mei-view';

/**
 * Messages between verovio-runtime.ts (main thread) and verovio.worker.ts. `channel` is a reader instance: render
 * tickets only supersede older requests on their own channel.
 */
export type VerovioRequest = { id: number } & (
  /**
   * Convert a source (MusicXML or MEI, as UTF-8 bytes, transferred) once; the worker keeps the MEI baseline for
   * `revision`, or, for a long MusicXML score (or any MusicXML with `chunking.force`), an index to engrave it in chunks.
   */
  | { kind: 'import'; revision: number; bytes: ArrayBuffer; chunking?: { force: boolean } }
  /** Forget a revision's baseline. */
  | { kind: 'release'; revision: number }
  /** Lay out the first `measures` measures (plus spans that end soon after) as their own small document and serialize page 1. */
  | { kind: 'probe'; channel: number; ticket: number; revision: number; view: ViewSpec; options: Record<string, unknown>; measures: number; chunkBudget: number; simulateOom?: boolean }
  /**
   * Lay out the whole view, or for a chunked score the chunks holding the requested pages (about `chunkBudget`
   * staff-measures each), loading or re-laying out only as needed, and serialize the requested one-based pages.
   */
  | { kind: 'render'; channel: number; ticket: number; revision: number; view: ViewSpec; options: Record<string, unknown>; pages: number[]; chunkBudget: number; simulateOom?: boolean }
);

/**
 * Where the worker imports Verovio from: upstream's own, unmodified ES modules, loaded at runtime so they stay a
 * separately replaceable library (LGPL-3.0-or-later). `module` is the Emscripten module (npm verovio's
 * dist/verovio-module.mjs, default export: an async factory of the WASM module); `toolkit` is the JavaScript toolkit
 * (dist/verovio.mjs, exports `VerovioToolkit` and `enableLogToBuffer`). Absolute URLs.
 */
export type VerovioFiles = { module: string; toolkit: string };

/** Sent once by the runtime right after it starts a worker, before any request. */
export type VerovioConfigure = { kind: 'configure'; files: VerovioFiles };

export type VerovioReply = {
  id: number;
  value?: unknown;
  error?: string;
  /**
   * `superseded`: a newer render ticket arrived first on the same channel; `missing`: the worker no longer holds the
   * revision; `oom`: WASM ran out of memory; `restarted`: the worker was recycled under this request; the runtime
   * retries it once.
   */
  code?: 'superseded' | 'missing' | 'oom' | 'restarted';
  /** The worker's WASM heap size after the request, in bytes (the runtime recycles a worker whose heap grew large). */
  heap?: number;
};

export type ProbeResult = { svg: string; pageCount: number; measures: number };
export type PagesResult = { pageCount: number; pages: { page: number; svg: string }[] };
export type { BaselineInfo, ViewSpec };
