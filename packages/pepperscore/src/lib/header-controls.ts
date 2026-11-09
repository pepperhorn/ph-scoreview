/**
 * Header controls registry.
 *
 * Maintainers: edit this list to reorder header controls or move them between
 * tiers. Array order is render order. `primary` controls always sit inline in
 * the header; `secondary` controls sit inline above MOBILE_HEADER_BREAKPOINT
 * and move into the "More controls" dropdown at or below it. PepperScore.tsx maps
 * each id to its element; every control is always rendered (`bars` is disabled outside Vertical view, `keyFlip` when the key has no enharmonic) so the
 * header footprint never depends on client-only state. `tab` (the Notation / TAB / Both switch) is the exception: it shows only for a score with a
 * stave that can take TAB (any pitched part).
 */
export type HeaderControlId = 'stop' | 'play' | 'openFile' | 'bpm' | 'transpose' | 'keyFlip' | 'mode' | 'tab' | 'bars' | 'staveScale' | 'mixer' | 'noteNames' | 'counts' | 'chordSymbols' | 'options' | 'instrumentSwitch' | 'octaveTool' | 'pitchColours' | 'pdf';
export type HeaderControlTier = 'primary' | 'secondary';
export type HeaderControlConfig = { id: HeaderControlId; tier: HeaderControlTier };

export const HEADER_CONTROLS = [
  { id: 'stop', tier: 'primary' },
  { id: 'play', tier: 'primary' },
  { id: 'openFile', tier: 'primary' },
  { id: 'mode', tier: 'primary' },
  { id: 'tab', tier: 'secondary' },
  { id: 'bpm', tier: 'secondary' },
  { id: 'transpose', tier: 'secondary' },
  { id: 'keyFlip', tier: 'secondary' },
  { id: 'bars', tier: 'secondary' },
  { id: 'staveScale', tier: 'secondary' },
  { id: 'mixer', tier: 'secondary' },
] as const satisfies readonly HeaderControlConfig[];

/** Reader root width (px) at or below which secondary controls collapse into the "More controls" dropdown (`@container pepperscore (max-width:760px)` in styles.css). */
export const MOBILE_HEADER_BREAKPOINT = 760;

/** Stave scale (zoom) bounds shared by the header slider and pinch zoom live with the defaults in stave-scale.ts. */
export { clampStaveScale, STAVE_SCALE_MAX, STAVE_SCALE_MIN, STAVE_SCALE_STEP } from './stave-scale';

/** Which `controls` key shows each header control (see chrome.ts). */
export const HEADER_CONTROL_GROUP: Partial<Record<HeaderControlId, 'transport' | 'viewToggle' | 'openFile' | 'zoom' | 'mixer' | 'tabToggle'>> = {
  stop: 'transport', play: 'transport', bpm: 'transport', transpose: 'transport', keyFlip: 'transport', bars: 'transport',
  mode: 'viewToggle', tab: 'tabToggle', openFile: 'openFile', staveScale: 'zoom', mixer: 'mixer',
};
