import type { Pitch } from './score';

const qualities: [number[], string][] = [
  [[0, 4, 7, 11], 'maj7'],
  [[0, 4, 7, 10], '7'],
  [[0, 3, 7, 10], 'm7'],
  [[0, 3, 6, 10], 'm7♭5'],
  [[0, 3, 6, 9], 'dim7'],
  [[0, 4, 7, 9], '6'],
  [[0, 3, 7, 9], 'm6'],
  [[0, 4, 7], ''],
  [[0, 3, 7], 'm'],
  [[0, 3, 6], 'dim'],
  [[0, 4, 8], 'aug'],
  [[0, 5, 7], 'sus4'],
  [[0, 2, 7], 'sus2'],
];

export function pitchName(pitch: Pitch): string {
  return pitch.step + (pitch.alter > 0 ? '♯'.repeat(pitch.alter) : '♭'.repeat(-pitch.alter));
}

export function inferChordSymbol(pitches: Pitch[]): string | undefined {
  const classes = [...new Set(pitches.map(pitch => pitch.midi % 12))];
  if (classes.length < 3 || classes.length > 4) return;
  const bass = pitches.reduce((lowest, pitch) => pitch.midi < lowest.midi ? pitch : lowest);
  for (const root of [bass.midi % 12, ...classes.filter(pc => pc !== bass.midi % 12)]) {
    const intervals = classes.map(pc => (pc - root + 12) % 12).sort((a, b) => a - b);
    const quality = qualities.find(([pattern]) => pattern.length === intervals.length && pattern.every((interval, index) => interval === intervals[index]));
    if (!quality) continue;
    const rootPitch = pitches.find(pitch => pitch.midi % 12 === root);
    if (!rootPitch) continue;
    return `${pitchName(rootPitch)}${quality[1]}${root === bass.midi % 12 ? '' : `/${pitchName(bass)}`}`;
  }
}
