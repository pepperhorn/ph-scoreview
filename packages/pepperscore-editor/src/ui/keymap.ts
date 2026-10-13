import {
  addSlur, breakBeam, deleteEvents, enterEvent, extendSelection, makeTuplet, moveCursor, setBeamGroup, setCursorDuration,
  setEntryMode, shiftOctave, stepPitch, toggleArticulation, toggleDot, toggleTie,
} from '../engine/commands/index';
import { findEvent } from '../engine/sequence-edit';
import type { EditorStore } from '../engine/store';
import type { Command, EditorState } from '../engine/types';
import type { DurationBase } from '../model/durations';
import { effectiveKey, measureIndex } from '../model/query';
import type { Articulation, Pitch } from '../model/schema';
import { autoBeamSequence, cycleBarline, slurPair, targetEvent, targetNote } from './key-actions';
import { pitchForLetter } from './pitch-entry';

export type PopoverName = 'key' | 'time' | 'clef' | 'dynamic' | 'jump' | 'ending' | 'text';
export type KeyContext = { store: EditorStore; openPopover(name: PopoverName): void; play(): void };
/**
 * `keys` are readable combos (`'Ctrl+Shift+Z'`, `'ArrowUp'`, `'Shift+S'`), modifiers in the order
 * Ctrl, Alt, Shift; Cmd counts as Ctrl. Digit and symbol keys (`'>'`, `'4'`) match the typed
 * character whatever Shift state produced it. `mode` limits a binding to entry or select mode.
 */
export type KeyBinding = {
  keys: string[];
  label: string;
  group: 'entry' | 'duration' | 'pitch' | 'edit' | 'navigate' | 'score';
  mode?: 'enter' | 'select';
  action: (ctx: KeyContext) => void;
};

const record = <A>(ctx: KeyContext, command: Command<A>, args: A) => ctx.store.dispatch(command, args);
const move = <A>(ctx: KeyContext, command: Command<A>, args: A) => ctx.store.dispatch(command, args, { record: false });
const state = (ctx: KeyContext): EditorState => ctx.store.getState();

function onEvent(ctx: KeyContext, run: (eventId: string) => void): void {
  const id = targetEvent(state(ctx));
  if (id) run(id);
}

function onNote(ctx: KeyContext, run: (noteId: string) => void): void {
  const id = targetNote(state(ctx));
  if (id) run(id);
}

function enterLetter(ctx: KeyContext, step: Pitch['step']): void {
  const { document, cursor } = state(ctx);
  const fifths = effectiveKey(document, Math.max(measureIndex(document, cursor.measureId), 0)).fifths;
  record(ctx, enterEvent, { pitch: pitchForLetter(step, cursor.lastPitch, fifths) });
}

const BEAM_CYCLE = [2, 3, 4, 0] as const; // 0 = automatic
const beamSteps = new WeakMap<EditorStore, { key: string; step: number }>();

/** `b`: regroups the target event's sequence (else the cursor's) in 2s, 3s, 4s, then automatic. */
function cycleBeams(ctx: KeyContext): void {
  const s = state(ctx);
  const id = targetEvent(s);
  const at = id ? findEvent(s.document, id) : undefined;
  const { partId, staff, voice } = at ? { partId: at.part.id, staff: at.seq.staff, voice: at.seq.voice } : s.cursor;
  const measureId = at ? s.document.global.measures[at.measureIndex].id : s.cursor.measureId;
  const key = [partId, measureId, staff, voice].join('/');
  const previous = beamSteps.get(ctx.store);
  const step = previous?.key === key ? (previous.step + 1) % BEAM_CYCLE.length : 0;
  beamSteps.set(ctx.store, { key, step });
  const group = BEAM_CYCLE[step];
  if (group) {
    const pm = s.document.parts.find((p) => p.id === partId)?.measures[measureIndex(s.document, measureId)];
    if (pm) record(ctx, setBeamGroup, { measureId: pm.id, staff, voice, group });
  } else record(ctx, autoBeamSequence, { partId, measureId, staff, voice });
}

const letter = (step: Pitch['step']): KeyBinding => ({ keys: [step], label: `Note ${step}`, group: 'pitch', mode: 'enter', action: (ctx) => enterLetter(ctx, step) });

const DURATION_KEYS: DurationBase[] = ['32nd', '16th', 'eighth', 'quarter', 'half', 'whole'];
const duration = (base: DurationBase, i: number): KeyBinding => ({
  keys: [String(i + 1)], label: `${base[0].toUpperCase()}${base.slice(1)} note`, group: 'duration', mode: 'enter',
  action: (ctx) => move(ctx, setCursorDuration, { duration: { base, dots: 0 } }),
});

const articulation = (keys: string[], label: string, value: Articulation): KeyBinding => ({
  keys, label, group: 'edit', action: (ctx) => onEvent(ctx, (eventId) => record(ctx, toggleArticulation, { eventId, articulation: value })),
});

const tuplet = (multiple: 3 | 5 | 6 | 7): KeyBinding => ({
  keys: [`Ctrl+${multiple}`], label: `Tuplet (${multiple})`, group: 'edit',
  action: (ctx) => onEvent(ctx, (eventId) => record(ctx, makeTuplet, { eventId, multiple })),
});

const popover = (key: string, label: string, name: PopoverName, mode?: 'select'): KeyBinding => ({
  keys: [key], label, group: 'score', mode, action: (ctx) => ctx.openPopover(name),
});

export const KEYMAP: KeyBinding[] = [
  { keys: ['N'], label: 'Toggle note entry', group: 'entry', action: (ctx) => move(ctx, setEntryMode, { mode: state(ctx).cursor.mode === 'enter' ? 'select' : 'enter' }) },
  { keys: ['Escape'], label: 'Select mode', group: 'entry', action: (ctx) => move(ctx, setEntryMode, { mode: 'select' }) },
  ...DURATION_KEYS.map(duration),
  ...(['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const).map(letter),
  { keys: ['0'], label: 'Rest', group: 'entry', mode: 'enter', action: (ctx) => record(ctx, enterEvent, { rest: true }) },
  { keys: ['.'], label: 'Toggle dot', group: 'duration', action: (ctx) => onEvent(ctx, (eventId) => record(ctx, toggleDot, { eventId })) },
  { keys: ['ArrowUp'], label: 'Pitch up', group: 'pitch', action: (ctx) => onNote(ctx, (noteId) => record(ctx, stepPitch, { noteId, steps: 1 })) },
  { keys: ['ArrowDown'], label: 'Pitch down', group: 'pitch', action: (ctx) => onNote(ctx, (noteId) => record(ctx, stepPitch, { noteId, steps: -1 })) },
  { keys: ['Ctrl+ArrowUp'], label: 'Octave up', group: 'pitch', action: (ctx) => onNote(ctx, (noteId) => record(ctx, shiftOctave, { noteId, octaves: 1 })) },
  { keys: ['Ctrl+ArrowDown'], label: 'Octave down', group: 'pitch', action: (ctx) => onNote(ctx, (noteId) => record(ctx, shiftOctave, { noteId, octaves: -1 })) },
  { keys: ['ArrowLeft'], label: 'Previous event', group: 'navigate', action: (ctx) => move(ctx, moveCursor, { by: 'event', delta: -1 }) },
  { keys: ['ArrowRight'], label: 'Next event', group: 'navigate', action: (ctx) => move(ctx, moveCursor, { by: 'event', delta: 1 }) },
  { keys: ['Ctrl+ArrowLeft'], label: 'Previous bar', group: 'navigate', action: (ctx) => move(ctx, moveCursor, { by: 'measure', delta: -1 }) },
  { keys: ['Ctrl+ArrowRight'], label: 'Next bar', group: 'navigate', action: (ctx) => move(ctx, moveCursor, { by: 'measure', delta: 1 }) },
  { keys: ['Shift+ArrowLeft'], label: 'Extend selection left', group: 'navigate', action: (ctx) => move(ctx, extendSelection, { delta: -1 }) },
  { keys: ['Shift+ArrowRight'], label: 'Extend selection right', group: 'navigate', action: (ctx) => move(ctx, extendSelection, { delta: 1 }) },
  { keys: ['T'], label: 'Tie', group: 'edit', action: (ctx) => onNote(ctx, (noteId) => record(ctx, toggleTie, { noteId })) },
  {
    keys: ['S'], label: 'Slur', group: 'edit',
    action: (ctx) => {
      const pair = slurPair(state(ctx));
      if (pair) record(ctx, addSlur, { fromEventId: pair[0], toEventId: pair[1] });
    },
  },
  articulation(['Shift+S'], 'Staccato', 'staccato'),
  articulation(['-'], 'Tenuto', 'tenuto'),
  articulation(['>'], 'Accent', 'accent'),
  articulation(['^'], 'Marcato', 'marcato'),
  ...([3, 5, 6, 7] as const).map(tuplet),
  { keys: ['B'], label: 'Beam grouping 2/3/4/auto', group: 'edit', mode: 'select', action: cycleBeams },
  { keys: ['/'], label: 'Break beam', group: 'edit', action: (ctx) => onEvent(ctx, (eventId) => record(ctx, breakBeam, { eventId })) },
  popover('D', 'Dynamic', 'dynamic', 'select'),
  popover('K', 'Key signature', 'key'),
  popover('Q', 'Time signature', 'time'),
  popover('C', 'Clef', 'clef', 'select'),
  popover('V', 'Ending', 'ending'),
  popover('J', 'Jump', 'jump'),
  { keys: ['R'], label: 'Cycle barline', group: 'score', action: (ctx) => record(ctx, cycleBarline, { measureId: state(ctx).cursor.measureId }) },
  {
    keys: ['Delete', 'Backspace'], label: 'Delete', group: 'edit',
    action: (ctx) => {
      const ids = state(ctx).selection.ids;
      if (ids.length) record(ctx, deleteEvents, { ids });
      else onEvent(ctx, (eventId) => record(ctx, deleteEvents, { ids: [eventId] }));
    },
  },
  { keys: ['Ctrl+Z'], label: 'Undo', group: 'edit', action: (ctx) => ctx.store.undo() },
  { keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], label: 'Redo', group: 'edit', action: (ctx) => ctx.store.redo() },
  { keys: ['Space'], label: 'Play', group: 'navigate', action: (ctx) => ctx.play() },
];

/**
 * The normalized combo of a key event, e.g. `ctrl+shift+z`, `shift+s`, `space`. Digits and symbols
 * match as typed, ignoring Shift (`>` is the accent whatever produces it; AZERTY digits need Shift).
 */
function comboOf(event: KeyboardEvent): string {
  const key = event.key === ' ' ? 'Space' : event.key;
  const typed = key.length === 1 && !/[a-z]/i.test(key);
  const parts = [event.ctrlKey || event.metaKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey && !typed ? 'Shift' : '', key];
  return parts.filter(Boolean).join('+').toLowerCase();
}

const tagOf = (target: EventTarget | null): string => ((target as { tagName?: string } | null)?.tagName ?? '').toUpperCase();

function isTextTarget(target: EventTarget | null): boolean {
  return (target as { isContentEditable?: boolean } | null)?.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagOf(target));
}

/** Runs the binding for `event`; true (and default prevented) when one consumed it. */
export function handleKey(event: KeyboardEvent, ctx: KeyContext): boolean {
  if (event.isComposing || isTextTarget(event.target)) return false;
  if (event.key === ' ' && tagOf(event.target) === 'BUTTON') return false; // let Space press the button
  const combo = comboOf(event);
  const mode = ctx.store.getState().cursor.mode;
  const binding = KEYMAP.find((b) => (!b.mode || b.mode === mode) && b.keys.some((k) => k.toLowerCase() === combo));
  if (!binding) return false;
  event.preventDefault();
  binding.action(ctx);
  return true;
}

/** The binding's keys for a tooltip, e.g. `Ctrl+Shift+Z / Ctrl+Y`. */
export function describeKey(binding: KeyBinding): string {
  return binding.keys.join(' / ');
}
