/** Key tonics by fifths (-7 .. 7), spelled with the music glyphs (♭ ♯) the UI shows. */
const MAJOR = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
const MINOR = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];
export const FIFTHS = Array.from({ length: 15 }, (_, i) => i - 7);
/** The display name of a key (`E♭ major`, `F♯ minor`); select options keep the fifths number as their value. */
export const keyName = (fifths: number, mode: 'major' | 'minor' = 'major') =>
  `${(mode === 'minor' ? MINOR : MAJOR)[fifths + 7]} ${mode}`;
