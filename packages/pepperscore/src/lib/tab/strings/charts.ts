/** Fretless chart data; violin and cello are integrated in the reader.
 * Source: ~/violintab/src/lib/tab/instruments.ts (violin/cello).
 * Strings run high → low; MIDI values are SOUNDING pitches, including bass.
 */
export type StringInstrumentId = 'violin' | 'viola' | 'cello' | 'double-bass';
export type FingerRow = readonly [number, number, number, number];
export interface StringChart {
  readonly id: StringInstrumentId;
  readonly provenance: 'ported' | 'derived';
  readonly source: string;
  readonly strings: readonly string[];
  readonly openMidi: readonly number[];
  /** One position map per string, high → low. */
  readonly fingers: readonly Readonly<Record<number, FingerRow>>[];
}

export const VIOLIN: StringChart = {
  id: 'violin', provenance: 'ported', source: 'violintab instruments.ts: VIOLIN_FINGER_MIDI',
  strings: ['E', 'A', 'D', 'G'], openMidi: [76, 69, 62, 55],
  fingers: [
    { 1: [78, 80, 81, 83], 2: [79, 81, 83, 85], 3: [81, 83, 85, 86], 4: [83, 85, 86, 88] },
    { 1: [71, 73, 74, 76], 2: [72, 74, 76, 77], 3: [74, 76, 77, 79], 4: [76, 77, 79, 81] },
    { 1: [64, 66, 67, 69], 2: [65, 67, 69, 71], 3: [67, 69, 71, 72], 4: [69, 71, 72, 74] },
    { 1: [57, 59, 60, 62], 2: [58, 60, 62, 64], 3: [60, 62, 64, 65], 4: [62, 64, 66, 67] },
  ],
};

/** Davidoff positions: there is NO 2½. Correct source keys
 * 2.5/3/3.5/4 → 3/3.5/4/4.5, preserving every source pitch.
 */
export const CELLO_POSITIONS = [0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5] as const;
function neckRows(open: number): Record<number, FingerRow> {
  return Object.fromEntries(CELLO_POSITIONS.map((position, index) => {
    const first = open + index + 1;
    return [position, [first, first + 1, first + 2, first + 3] satisfies FingerRow];
  }));
}
export const CELLO: StringChart = {
  id: 'cello', provenance: 'ported', source: 'violintab CELLO_FINGER_MIDI; Davidoff key correction',
  strings: ['A', 'D', 'G', 'C'], openMidi: [57, 50, 43, 36],
  fingers: [57, 50, 43, 36].map(neckRows),
};

/** Provisional analogies, NOT independently verified pedagogical charts.
 * Viola: transpose violin down a fifth. Bass: reuse cello finger offsets on
 * fourths tuning (not a claim about Simandl/1-2-4 or thumb technique).
 * A teacher must approve/replace these before production integration.
 */
export const VIOLA: StringChart = {
  id: 'viola', provenance: 'derived', source: 'violin transposed -7 semitones',
  strings: ['A', 'D', 'G', 'C'], openMidi: [69, 62, 55, 48],
  fingers: VIOLIN.fingers.map(positions => Object.fromEntries(
    Object.entries(positions).map(([p, row]) => [p, [row[0] - 7, row[1] - 7, row[2] - 7, row[3] - 7] satisfies FingerRow]),
  )),
};
export const DOUBLE_BASS: StringChart = {
  id: 'double-bass', provenance: 'derived', source: 'cello offsets on bass tuning; provisional four-finger analogy',
  strings: ['G', 'D', 'A', 'E'], openMidi: [43, 38, 33, 28],
  fingers: [43, 38, 33, 28].map(neckRows),
};
export const STRING_CHARTS: Readonly<Record<StringInstrumentId, StringChart>> = {
  violin: VIOLIN, viola: VIOLA, cello: CELLO, 'double-bass': DOUBLE_BASS,
};
