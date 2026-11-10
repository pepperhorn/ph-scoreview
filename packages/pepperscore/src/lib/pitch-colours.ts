import type { ScoreNote, Part } from './score';
import type { PitchClass, PitchPalette } from './skin';

export const PITCH_CLASSES: readonly PitchClass[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const pitchClassOf = (midi: number): PitchClass => PITCH_CLASSES[((midi % 12) + 12) % 12];
export const pitchVariable = (pitch: PitchClass): string => `--ps-pitch-${pitch.toLowerCase().replace('#', '-sharp')}`;
export function pitchColourStyle(palette?: PitchPalette): Record<string, string> {
  return palette ? Object.fromEntries(PITCH_CLASSES.map(pitch => [pitchVariable(pitch), palette[pitch]])) : {};
}
/** Verovio preserves source note order inside chords; prefer exact identity where present. */
export function tagPitchColours(element: Element, event: ScoreNote, part: Pick<Part, 'clef'>, tabStaves: ReadonlySet<string> = new Set()): void {
  if (part.clef === 'percussion' || part.clef === 'tab' || element.closest('.tabGrp') || tabStaves.has(element.closest('.staff')?.getAttribute('data-n') || '')) return;
  Array.from(element.querySelectorAll('.notehead')).forEach((head, index) => {
    const id = head.closest('.note')?.id;
    const pitch = event.pitches.find(pitch => pitch.sourceId && pitch.sourceId === id) ?? event.pitches[index];
    if (pitch && !pitch.unpitched) head.setAttribute('data-pitch', pitchClassOf(pitch.midi));
  });
}
