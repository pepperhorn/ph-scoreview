import type { BaselineInfo, ViewSpec } from './notation/mei-view';

/** Messages between verovio-runtime.ts (main thread) and verovio.worker.ts. */
export type VerovioRequest = { id: number } & (
  /** Convert a source (MusicXML or MEI) once; the worker keeps the MEI baseline for `revision`. */
  | { kind: 'import'; revision: number; text: string }
  /** Forget a revision's baseline. */
  | { kind: 'release'; revision: number }
  /** Lay out the first `measures` measures (plus spans that end soon after) as their own small document and serialize page 1. */
  | { kind: 'probe'; ticket: number; revision: number; view: ViewSpec; options: Record<string, unknown>; measures: number }
  /** Lay out the whole view (loading or re-laying out only as needed) and serialize the requested one-based pages. */
  | { kind: 'render'; ticket: number; revision: number; view: ViewSpec; options: Record<string, unknown>; pages: number[] }
);

export type VerovioReply = {
  id: number;
  value?: unknown;
  error?: string;
  /** `superseded`: a newer render ticket arrived first; `missing`: the worker no longer holds the revision; `oom`: WASM ran out of memory. */
  code?: 'superseded' | 'missing' | 'oom';
};

export type ProbeResult = { svg: string; pageCount: number; measures: number };
export type PagesResult = { pageCount: number; pages: { page: number; svg: string }[] };
export type { BaselineInfo, ViewSpec };
