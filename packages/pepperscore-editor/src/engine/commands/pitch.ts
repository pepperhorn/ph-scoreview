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

const SEMITONES: Record<Pitch['step'], number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midi = (p: Pitch) => (p.octave + 1) * 12 + SEMITONES[p.step] + p.alter;

/**
 * The spelling of MIDI note `target`: the key signature's (`fifths`) spelling if it has one, else the
 * natural, else a sharp going up (`direction` > 0) or a flat going down, else the other single
 * accidental, else a double.
 */
export function spellMidi(target: number, fifths: number, direction: number): Pitch | undefined {
  const candidates: Pitch[] = [];
  for (const step of STEPS) {
    for (let octave = Math.floor(target / 12) - 2; octave <= Math.floor(target / 12); octave++) {
      const alter = target - midi({ step, octave, alter: 0 });
      if (alter >= -2 && alter <= 2) candidates.push({ step, octave, alter });
    }
  }
  const single = direction >= 0 ? 1 : -1;
  const rank = (p: Pitch) => (p.alter === keyAlter(p.step, fifths) ? 0 : p.alter === 0 ? 1 : p.alter === single ? 2 : p.alter === -single ? 3 : 4);
  return candidates.sort((a, b) => rank(a) - rank(b))[0];
}

/** Moves a note `delta` semitones, respelled by `spellMidi` in the bar's key (sharps up, flats down). */
export const stepSemitone: Command<{ noteId: string; delta: number }> = {
  label: 'Step semitone',
  coalesceKey: ({ noteId }) => `pitch:${noteId}`,
  run: (draft, { noteId, delta }) =>
    repitch(draft, noteId, (note, index) => (delta ? spellMidi(midi(note.pitch) + delta, effectiveKey(draft.document, index).fifths, delta) : undefined)),
};
