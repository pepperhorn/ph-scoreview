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

/** Save-time drawing snapshot, resolved in the same root as the screen's noteheads. */
export type PitchColourPaint = { palette: PitchPalette; outline: string; strokeWidth: string };
/** Requires the active player root (palette supplied and pitch-colour pref on). */
export function resolvePitchColours(root: HTMLElement): PitchColourPaint {
  if (!root.matches('.pepperscore[data-ps-pitch-colours]')) {
    throw new Error('Pitch colours must be active on the player root before creating a PDF paint snapshot.');
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none';
  for (const pitch of PITCH_CLASSES) {
    const head = document.createElementNS(svg.namespaceURI, 'g');
    head.setAttribute('class', 'notehead'); head.setAttribute('data-pitch', pitch); svg.append(head);
  }
  root.append(svg);
  try {
    const heads = Array.from(svg.children);
    const palette = Object.fromEntries(heads.map(head => [head.getAttribute('data-pitch'), getComputedStyle(head).fill])) as PitchPalette;
    const style = getComputedStyle(heads[0]);
    return { palette, outline: style.stroke, strokeWidth: style.strokeWidth };
  } finally { svg.remove(); }
}
