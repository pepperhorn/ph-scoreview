/**
 * Header controls registry.
 *
 * Maintainers: edit this list to reorder header controls or move them between
 * tiers. Array order is render order. `primary` controls always sit inline in
 * the header; `secondary` controls sit inline above MOBILE_HEADER_BREAKPOINT
 * and move into the "More controls" dropdown at or below it. Reader.tsx maps
 * each id to its element; every control is always rendered (`bars` is disabled outside Vertical view, `keyFlip` when the key has no enharmonic) so the
 * header footprint never depends on client-only state.
 */
export type HeaderControlId = 'stop' | 'play' | 'openFile' | 'bpm' | 'transpose' | 'keyFlip' | 'mode' | 'bars' | 'staveScale' | 'mixer';
export type HeaderControlTier = 'primary' | 'secondary';
export type HeaderControlConfig = { id: HeaderControlId; tier: HeaderControlTier };

export const HEADER_CONTROLS = [
  { id: 'stop', tier: 'primary' },
  { id: 'play', tier: 'primary' },
  { id: 'openFile', tier: 'primary' },
  { id: 'mode', tier: 'primary' },
  { id: 'bpm', tier: 'secondary' },
  { id: 'transpose', tier: 'secondary' },
  { id: 'keyFlip', tier: 'secondary' },
  { id: 'bars', tier: 'secondary' },
  { id: 'staveScale', tier: 'secondary' },
  { id: 'mixer', tier: 'secondary' },
] as const satisfies readonly HeaderControlConfig[];

/** Viewport width (px) at or below which secondary controls collapse into the "More controls" dropdown. */
export const MOBILE_HEADER_BREAKPOINT = 760;
/** Media query matching the collapsed (mobile) header. */
export const MOBILE_HEADER_QUERY = `(max-width: ${MOBILE_HEADER_BREAKPOINT}px)`;

/** Stave scale (zoom) bounds shared by the header slider and pinch zoom live with the defaults in stave-scale.ts. */
export { clampStaveScale, STAVE_SCALE_MAX, STAVE_SCALE_MIN, STAVE_SCALE_STEP } from './stave-scale';
