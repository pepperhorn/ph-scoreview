import type { Patch } from 'immer';
import type { Duration } from '../model/durations';
import type { Document, Pitch } from '../model/schema';
import type { ViewResult } from './layout/apply-layout';

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

/**
 * The part of the editor state commands may change; history patches are relative to it. `activeLayoutId`
 * is the layout the editor shows (switching it is dispatched unrecorded; a layout command that creates and
 * activates one records the switch, so undo goes back).
 */
export type Editable = { document: Document; cursor: Cursor; selection: Selection; activeLayoutId: string };

export type HistoryEntry = { label: string; patches: Patch[]; inverse: Patch[]; coalesceKey?: string; at: number };

export type History = { past: HistoryEntry[]; future: HistoryEntry[] };

/**
 * `dirty`: the history is not at the last saved (or opened) position. `view`: the document as the active
 * layout shows it, derived after every change; the UI compiles `view.document`.
 */
export type EditorState = Editable & { history: History; dirty: boolean; invariantErrors: string[]; view: ViewResult };

/** `record: false` marks a view-only command (cursor, selection, active layout): never recorded, whatever the caller asks. */
export type Command<A> = { label: string; record?: false; coalesceKey?: (args: A) => string | undefined; run: (draft: Editable, args: A) => void };
