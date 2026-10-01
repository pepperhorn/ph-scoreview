/**
 * Large-score guardrail: a non-blocking "this will take a while" notice with an expected wait (see
 * docs/specs/large-score-performance.md, Phase 3 "Guardrails"). The estimate is a deliberately simple linear model;
 * its constants are named so they can be recalibrated against the e2e perf probe.
 */
import { formatMb } from './mxl';

const MB = 1024 * 1024;
/** Files at or above this many bytes get the large-score notice as soon as they are chosen. */
export const LARGE_FILE_BYTES = 8 * MB;
/** Scores at or above this many staff-measures (parts × measures) get the notice once the score is known. */
export const LARGE_SCORE_STAFF_MEASURES = 2400;
/**
 * Test / tuning override: `localStorage['scoreflow-large-file-bytes']` (a positive number of bytes) replaces
 * LARGE_FILE_BYTES, so validation can trigger the notice with a small fixture.
 */
export const LARGE_FILE_BYTES_OVERRIDE_KEY = 'scoreflow-large-file-bytes';
/**
 * Desktop open time per MB of score file, in seconds: [optimistic, pessimistic]. Calibrated on the Phase 3 e2e probe
 * (12-core desktop): 12.5 MB orchestral 3.3 s, 31.6 MB orchestral 4.1 s, 31.9 MB ensemble 3.6 s to first paint.
 */
export const DESKTOP_SECONDS_PER_MB: readonly [number, number] = [0.08, 0.2];
/** Fixed desktop overhead (worker start, WASM load, first layout), in seconds. */
export const OPEN_BASE_SECONDS = 1.5;
/** Phones and tablets take this many times as long as a desktop. */
export const PHONE_SLOWDOWN = 2.5;
/** File bytes a staff-measure is treated as (orchestral MusicXML runs about 1.6 KB), when the score is what makes it large (a compressed .mxl). */
export const BYTES_PER_STAFF_MEASURE = 1.5 * 1024;

/** The byte threshold in effect (LARGE_FILE_BYTES unless overridden in localStorage). */
export function largeFileBytes(): number {
  try {
    const override = Number(globalThis.localStorage?.getItem(LARGE_FILE_BYTES_OVERRIDE_KEY));
    if (Number.isFinite(override) && override > 0) return override;
  } catch { /* storage blocked: use the default */ }
  return LARGE_FILE_BYTES;
}
export const isLargeFile = (bytes: number) => bytes >= largeFileBytes();
/** Staves × measures: what engraving cost scales with. */
export const staffMeasures = (score: { parts: ReadonlyArray<{ measures: ArrayLike<unknown> }> }) =>
  score.parts.length * Math.max(0, ...score.parts.map(part => part.measures.length));
export const isLargeScore = (score: { parts: ReadonlyArray<{ measures: ArrayLike<unknown> }> }) => staffMeasures(score) >= LARGE_SCORE_STAFF_MEASURES;

/** Expected seconds to open a score file of `bytes`: a [low, high] range, whole seconds, low ≥ 1. */
export function estimateOpenSeconds(bytes: number, { phone = false }: { phone?: boolean } = {}): [number, number] {
  const mb = Math.max(0, bytes) / MB;
  const factor = phone ? PHONE_SLOWDOWN : 1;
  const low = (OPEN_BASE_SECONDS + mb * DESKTOP_SECONDS_PER_MB[0]) * factor;
  const high = (OPEN_BASE_SECONDS + mb * DESKTOP_SECONDS_PER_MB[1]) * factor;
  const roundedLow = Math.max(1, Math.round(low));
  return [roundedLow, Math.max(roundedLow, Math.ceil(high))];
}

/**
 * The notice text, e.g. "Large score (31.6 MB). Opening may take about 10–20 seconds on this device." When the score's
 * staff-measures are known and imply a longer wait than its bytes, the estimate follows them.
 */
export function largeScoreMessage(bytes: number, { phone = false, staffMeasures: cells }: { phone?: boolean; staffMeasures?: number } = {}): string {
  const equivalent = Math.max(bytes, (cells ?? 0) * BYTES_PER_STAFF_MEASURE);
  const [low, high] = estimateOpenSeconds(equivalent, { phone });
  const size = cells && cells * BYTES_PER_STAFF_MEASURE > bytes ? `${cells.toLocaleString('en')} staff-bars` : formatMb(bytes);
  const wait = low === high ? `about ${low} second${low === 1 ? '' : 's'}` : `about ${low}–${high} seconds`;
  return `Large score (${size}). Opening may take ${wait} on this device.`;
}
