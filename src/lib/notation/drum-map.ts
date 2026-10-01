/**
 * Drum-set notation for General MIDI percussion (channel 10) on a five-line percussion staff, following the common
 * drum-set convention (PAS / MuseScore default kit): kick in the bottom space, snare in the third space, toms around
 * them, cymbals above the staff with x noteheads. Positions are written as treble-clef pitches; `loc` is the MEI staff
 * position (0 = bottom line, 1 = bottom space, ... 8 = top line).
 */
export type DrumHead = 'x' | 'diamond';
export type DrumNotation = { name: string; step: string; octave: number; head?: DrumHead };

const drum = (name: string, position: string, head?: DrumHead): DrumNotation => ({ name, step: position[0], octave: Number(position.slice(1)), ...(head ? { head } : {}) });

export const GM_DRUM_NOTATION: Readonly<Record<number, DrumNotation>> = {
  35: drum('Acoustic Bass Drum', 'E4'),
  36: drum('Bass Drum 1', 'F4'),
  37: drum('Side Stick', 'C5', 'x'),
  38: drum('Acoustic Snare', 'C5'),
  39: drum('Hand Clap', 'B4', 'x'),
  40: drum('Electric Snare', 'C5'),
  41: drum('Low Floor Tom', 'G4'),
  42: drum('Closed Hi-Hat', 'G5', 'x'),
  43: drum('High Floor Tom', 'A4'),
  44: drum('Pedal Hi-Hat', 'D4', 'x'),
  45: drum('Low Tom', 'B4'),
  46: drum('Open Hi-Hat', 'G5', 'x'),
  47: drum('Low-Mid Tom', 'D5'),
  48: drum('Hi-Mid Tom', 'E5'),
  49: drum('Crash Cymbal 1', 'A5', 'x'),
  50: drum('High Tom', 'E5'),
  51: drum('Ride Cymbal 1', 'F5', 'x'),
  52: drum('Chinese Cymbal', 'B5', 'x'),
  53: drum('Ride Bell', 'F5', 'diamond'),
  54: drum('Tambourine', 'E5', 'x'),
  55: drum('Splash Cymbal', 'B5', 'x'),
  56: drum('Cowbell', 'D5', 'diamond'),
  57: drum('Crash Cymbal 2', 'A5', 'x'),
  59: drum('Ride Cymbal 2', 'F5', 'x'),
};
/** Any other GM percussion sound: a diamond in the top space, apart from the kit. */
export const DRUM_FALLBACK: DrumNotation = drum('Percussion', 'E5', 'diamond');

export const drumNotation = (midi: number): DrumNotation => GM_DRUM_NOTATION[midi] ?? DRUM_FALLBACK;

/** MEI @loc of a written treble-clef position on a five-line staff (E4 = 0, the bottom line). */
export function staffLoc(step: string, octave: number): number {
  return octave * 7 + 'CDEFGAB'.indexOf(step.toUpperCase()) - (4 * 7 + 2);
}
