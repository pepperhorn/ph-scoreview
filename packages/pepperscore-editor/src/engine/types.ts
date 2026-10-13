import type { Patch } from 'immer';
import type { Duration } from '../model/durations';
import type { Document, Pitch } from '../model/schema';

export type Cursor = {
  partId: string;
  staff: number;
  voice: 1 | 2 | 3 | 4;
  measureId: string;
  tick: number;
  duration: Duration;
  mode: 'select' | 'enter';
  lastPitch?: Pitch;
  /** The event entry mode just entered; cleared when the cursor moves. Entry-mode `.` dots it while the cursor sits right after it. */
  entered?: string;
  /** "Add to chord": entry-mode letters add to the target event's chord instead of entering. */
  chord?: boolean;
};

/** Event, note, direction or measure ids. */
export type Selection = { ids: string[] };

/** The part of the editor state commands may change; history patches are relative to it. */
export type Editable = { document: Document; cursor: Cursor; selection: Selection };

export type HistoryEntry = { label: string; patches: Patch[]; inverse: Patch[]; coalesceKey?: string; at: number };

export type History = { past: HistoryEntry[]; future: HistoryEntry[] };

export type EditorState = Editable & { history: History; dirty: boolean; activeLayoutId: string; invariantErrors: string[] };

export type Command<A> = { label: string; coalesceKey?: (args: A) => string | undefined; run: (draft: Editable, args: A) => void };
