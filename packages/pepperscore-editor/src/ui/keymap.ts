import {
  addChordNote, addSlur, breakBeam, deleteEvents, enterEvent, entryDot, entryDotChangesScore, setAccidental, stepSemitone, extendSelection, makeTuplet, moveCursor, escapeToSelect, setBeamGroup, setCursorDuration,
  cursorReferencePitch, restPitch, setDuration, setEntryMode, setPitch, shiftOctave, stepPitch, toggleArticulation, toggleDot, toggleRest, toggleTie,
} from '../engine/commands/index';
import { findEvent, findNote } from '../engine/sequence-edit';
import type { EditorStore } from '../engine/store';
import type { Command, EditorState } from '../engine/types';
import type { DurationBase } from '../model/durations';
import { effectiveKey, measureIndex } from '../model/query';
import type { Articulation, Pitch } from '../model/schema';
import { autoBeamSequence, cycleBarline, slurPair, targetEvent, targetNote } from './key-actions';
import { pitchForLetter } from './pitch-entry';

export type PopoverName = 'key' | 'time' | 'clef' | 'dynamic' | 'jump' | 'ending' | 'tempo';
export type KeyContext = { store: EditorStore; openPopover(name: PopoverName): void; play(): void };
/**
 * `keys` are readable combos (`'Ctrl+Shift+Z'`, `'ArrowUp'`, `'Shift+S'`), modifiers in the order
 * Ctrl, Alt, Shift; Cmd counts as Ctrl. Digit and symbol keys (`'>'`, `'+'`, `'4'`) match the typed
 * character whatever Shift state produced it. `mode` limits a binding to entry or select mode.
 */
export type KeyBinding = {
  keys: string[];
  label: string;
  group: 'entry' | 'duration' | 'pitch' | 'chord' | 'edit' | 'navigate' | 'score';
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

/**
 * `step` (with alteration `alter`, else the key signature's) as the letter keys and buttons enter it: in chord mode a
 * note added to the target event's chord; in select (Edit) mode the target note repitched, in the octave nearest its
 * old pitch (a target rest pitched in place, nearest the last pitch entered on its staff or the middle line); else a new note nearest the
 * last pitch entered on the cursor's staff, or its clef's middle line. The phone's piano keys use it too. (Typed letters reach
 * it in entry mode only; the toolbar buttons in either mode.)
 */
export function enterPitch(ctx: KeyContext, step: Pitch['step'], alter?: number): void {
  if (state(ctx).cursor.chord) return chordLetter(ctx, step, alter);
  const { document, cursor } = state(ctx);
  if (cursor.mode === 'select') {
    const noteId = targetNote(state(ctx));
    const at = noteId ? findNote(document, noteId) : undefined;
    if (noteId && at) {
      const pitch = pitchForLetter(step, at.note.pitch, effectiveKey(document, at.measureIndex).fifths, alter);
      return record(ctx, setPitch, { noteId, pitch });
    }
    // A target rest takes the pitch in place (its duration kept, the cursor still), not a new note entered at the cursor.
    const eventId = targetEvent(state(ctx));
    const rest = eventId ? findEvent(document, eventId) : undefined;
    if (eventId && rest?.event.rest && !rest.event.grace) {
      const pitch = pitchForLetter(step, restPitch(state(ctx), rest), effectiveKey(document, rest.measureIndex).fifths, alter);
      return record(ctx, toggleRest, { eventId, pitch });
    }
  }
  const fifths = effectiveKey(document, Math.max(measureIndex(document, cursor.measureId), 0)).fifths;
  record(ctx, enterEvent, { pitch: pitchForLetter(step, cursorReferencePitch(state(ctx)), fifths, alter) });
}

/**
 * Adds `step` to the target event's chord, in the octave nearest its top note (an octave higher when
 * that pitch is already there) with the key signature's alteration (or `alter`); the cursor stays.
 */
function chordLetter(ctx: KeyContext, step: Pitch['step'], alter?: number): void {
  onEvent(ctx, (eventId) => {
    const at = findEvent(state(ctx).document, eventId);
    const top = at?.event.notes?.at(-1)?.pitch;
    if (!at || !top) return;
    const pitch = pitchForLetter(step, top, effectiveKey(state(ctx).document, at.measureIndex).fifths, alter);
    const taken = at.event.notes!.some((n) => n.pitch.step === pitch.step && n.pitch.octave === pitch.octave && n.pitch.alter === pitch.alter);
    record(ctx, addChordNote, { eventId, pitch: taken ? { ...pitch, octave: pitch.octave + 1 } : pitch });
  });
}

/** Sets the target note's alteration from its current one (clamped to double sharp/flat). */
function accidental(ctx: KeyContext, alter: (current: number) => number): void {
  onNote(ctx, (noteId) => {
    const note = findNote(state(ctx).document, noteId)?.note;
    if (note) record(ctx, setAccidental, { noteId, alter: Math.max(-2, Math.min(2, alter(note.pitch.alter))) });
  });
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

const letter = (step: Pitch['step']): KeyBinding => ({ keys: [step], label: `Note ${step}`, group: 'pitch', mode: 'enter', action: (ctx) => enterPitch(ctx, step) });
const chordKey = (step: Pitch['step']): KeyBinding => ({ keys: [`Shift+${step}`], label: `Add ${step} to chord`, group: 'chord', action: (ctx) => chordLetter(ctx, step) });

const DURATION_KEYS: DurationBase[] = ['32nd', '16th', 'eighth', 'quarter', 'half', 'whole'];
const duration = (base: DurationBase, i: number): KeyBinding => ({
  keys: [String(i + 1)], label: `${base[0].toUpperCase()}${base.slice(1)} note`, group: 'duration', mode: 'enter',
  // In select (Edit) mode it resizes the target event (the toolbar buttons; typed digits reach it in entry mode only).
  action: (ctx) => {
    if (state(ctx).cursor.mode === 'select') onEvent(ctx, (eventId) => record(ctx, setDuration, { eventId, duration: { base, dots: 0 } }));
    else move(ctx, setCursorDuration, { duration: { base, dots: 0 } });
  },
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
  {
    keys: ['Escape'], label: 'Edit mode', group: 'entry',
    action: (ctx) => move(ctx, escapeToSelect, {}),
  },
  ...DURATION_KEYS.map(duration),
  ...(['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const).map(letter),
  {
    keys: ['0'], label: 'Rest', group: 'entry', mode: 'enter',
    // The toolbar button in select (Edit) mode turns the target event into a rest, or a rest back into a note.
    action: (ctx) => (state(ctx).cursor.mode === 'select' ? onEvent(ctx, (eventId) => record(ctx, toggleRest, { eventId })) : record(ctx, enterEvent, { rest: true })),
  },
  {
    keys: ['.'], label: 'Toggle dot', group: 'duration',
    action: (ctx) => {
      if (state(ctx).cursor.mode !== 'enter') onEvent(ctx, (eventId) => record(ctx, toggleDot, { eventId }));
      else if (entryDotChangesScore(state(ctx))) record(ctx, entryDot, {});
      else move(ctx, entryDot, {});
    },
  },
  { keys: ['ArrowUp'], label: 'Pitch up', group: 'pitch', action: (ctx) => onNote(ctx, (noteId) => record(ctx, stepPitch, { noteId, steps: 1 })) },
  { keys: ['ArrowDown'], label: 'Pitch down', group: 'pitch', action: (ctx) => onNote(ctx, (noteId) => record(ctx, stepPitch, { noteId, steps: -1 })) },
  { keys: ['Ctrl+ArrowUp'], label: 'Octave up', group: 'pitch', action: (ctx) => onNote(ctx, (noteId) => record(ctx, shiftOctave, { noteId, octaves: 1 })) },
  { keys: ['Ctrl+ArrowDown'], label: 'Octave down', group: 'pitch', action: (ctx) => onNote(ctx, (noteId) => record(ctx, shiftOctave, { noteId, octaves: -1 })) },
  { keys: ['Alt+ArrowUp'], label: 'Semitone up', group: 'pitch', action: (ctx) => onNote(ctx, (noteId) => record(ctx, stepSemitone, { noteId, delta: 1 })) },
  { keys: ['Alt+ArrowDown'], label: 'Semitone down', group: 'pitch', action: (ctx) => onNote(ctx, (noteId) => record(ctx, stepSemitone, { noteId, delta: -1 })) },
  { keys: ['+'], label: 'Sharp', group: 'pitch', action: (ctx) => accidental(ctx, (a) => a + 1) },
  { keys: ['_'], label: 'Flat', group: 'pitch', action: (ctx) => accidental(ctx, (a) => a - 1) },
  { keys: ['='], label: 'Natural', group: 'pitch', action: (ctx) => accidental(ctx, () => 0) },
  ...(['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const).map(chordKey),
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
