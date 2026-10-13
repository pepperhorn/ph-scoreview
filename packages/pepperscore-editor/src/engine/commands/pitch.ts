import { effectiveKey } from '../../model/query';
import { newId } from '../../model/ids';
import type { Note, Pitch } from '../../model/schema';
import { pruneDanglingReferences } from '../prune';
import { findEvent, findNote } from '../sequence-edit';
import type { Command, Editable } from '../types';

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];

const samePitch = (a: Pitch, b: Pitch) => a.step === b.step && a.octave === b.octave && a.alter === b.alter;
const diatonic = (p: Pitch) => p.octave * 7 + STEPS.indexOf(p.step);

/** The alteration the key signature (`fifths`) gives `step`. */
export function keyAlter(step: Pitch['step'], fifths: number): number {
  if (fifths > 0) return SHARP_ORDER.indexOf(step) < fifths ? 1 : 0;
  if (fifths < 0) return SHARP_ORDER.length - 1 - SHARP_ORDER.indexOf(step) < -fifths ? -1 : 0;
  return 0;
}

/** Sets a note's pitch (no-op when unchanged or out of range) and drops ties that no longer hold. */
function repitch(draft: Editable, noteId: string, next: (note: Note, measureIndex: number) => Pitch | undefined): void {
  const at = findNote(draft.document, noteId);
  if (!at) return;
  const pitch = next(at.note, at.measureIndex);
  if (!pitch || pitch.octave < 0 || pitch.octave > 9 || pitch.alter < -2 || pitch.alter > 2 || samePitch(pitch, at.note.pitch)) return;
  at.note.pitch = pitch;
  pruneDanglingReferences(draft.document);
}

/** Adds a note to a (non-rest) event's chord, kept low to high; an existing pitch is a no-op. */
export const addChordNote: Command<{ eventId: string; pitch: Pitch }> = {
  label: 'Add chord note',
  run: (draft, { eventId, pitch }) => {
    const at = findEvent(draft.document, eventId);
    if (!at || at.event.rest || at.event.notes?.some((n) => samePitch(n.pitch, pitch))) return;
    const notes = [...(at.event.notes ?? []), { id: newId(), pitch: { ...pitch } }];
    at.event.notes = notes.sort((a, b) => diatonic(a.pitch) - diatonic(b.pitch) || a.pitch.alter - b.pitch.alter);
  },
};

export const setPitch: Command<{ noteId: string; pitch: Pitch }> = {
  label: 'Set pitch',
  coalesceKey: ({ noteId }) => `pitch:${noteId}`,
  run: (draft, { noteId, pitch }) => repitch(draft, noteId, () => ({ ...pitch })),
};

/** Moves a note `steps` scale steps, taking the key signature's alteration for the new step. */
export const stepPitch: Command<{ noteId: string; steps: number }> = {
  label: 'Step pitch',
  coalesceKey: ({ noteId }) => `pitch:${noteId}`,
  run: (draft, { noteId, steps }) =>
    repitch(draft, noteId, (note, index) => {
      if (steps === 0) return undefined;
      const target = diatonic(note.pitch) + steps;
      const step = STEPS[((target % 7) + 7) % 7];
      return { step, octave: Math.floor(target / 7), alter: keyAlter(step, effectiveKey(draft.document, index).fifths) };
    }),
};

export const shiftOctave: Command<{ noteId: string; octaves: number }> = {
  label: 'Shift octave',
  run: (draft, { noteId, octaves }) => repitch(draft, noteId, (note) => ({ ...note.pitch, octave: note.pitch.octave + octaves })),
};

export const setAccidental: Command<{ noteId: string; alter: number }> = {
  label: 'Set accidental',
  run: (draft, { noteId, alter }) => repitch(draft, noteId, (note) => ({ ...note.pitch, alter })),
};
