/**
 * Stave scale (zoom): rendered px per Verovio layout unit at Verovio `scale: 100`,
 * i.e. an absolute stave size. `1` is Verovio's natural size (a 72px five-line staff).
 * The layout width is `(viewport width - first-system gutter) / zoom`, so Verovio
 * reflows the score to fill the viewport at the chosen stave size.
 */
export type DeviceClass = 'desktop' | 'compact';

/** Slider and pinch range; matches the score-state schema. The floor is low enough for many-staff height fits (Cielito, 12 staves, fits at about 0.22 on desktop). */
export const STAVE_SCALE_MIN = .2;
export const STAVE_SCALE_MAX = 4;
export const STAVE_SCALE_STEP = .05;
/**
 * Round to the slider step within the range. `min` is the effective minimum: a many-staff height fit can sit below
 * STAVE_SCALE_MIN, and the slider then reaches down to it (the fit is never clamped up).
 */
export const clampStaveScale = (value: number, min = STAVE_SCALE_MIN) => Math.max(min, Math.min(STAVE_SCALE_MAX, Math.round(value / STAVE_SCALE_STEP) / Math.round(1 / STAVE_SCALE_STEP)));
/** Smallest stave scale a saved record may hold (a user can keep a very small height fit). */
export const STAVE_SCALE_FLOOR = .02;

/** Desktop: a fine pointer and a viewport wider than 850px. Everything else (phones, tablets) is compact. */
export const DESKTOP_QUERY = '(pointer: fine) and (min-width: 851px)';
export const deviceClass = (): DeviceClass => typeof window !== 'undefined' && window.matchMedia?.(DESKTOP_QUERY).matches ? 'desktop' : 'compact';

/**
 * Rendered stave scale of the single-stave sample before zoom became absolute
 * (measured on main, 2026-09-30): 1280x800 desktop rendered every system at 1.0;
 * 390x844 rendered the later systems at 1.0 (the first, beside the staff controls,
 * width-fitted to 0.78, which the reflow still does when a bar cannot fit).
 */
export const BASELINE_STAVE_SCALE: Record<DeviceClass, number> = { desktop: 1, compact: 1 };
/** Desktop is 75% of the baseline; phones and tablets keep the baseline so they look unchanged. */
export const DEFAULT_STAVE_SCALE: Record<DeviceClass, number> = { desktop: BASELINE_STAVE_SCALE.desktop * .75, compact: BASELINE_STAVE_SCALE.compact };
/** Scores with more than this many staves default to the full-stack height fit. */
export const HEIGHT_FIT_STAVES = 4;

/**
 * Default zoom for a score without a user-chosen one: a device scale, or 'fit' for many staves. The default is
 * re-resolved on every layout (resize, rotation, mode), while a user-chosen zoom stays fixed and is the only one saved.
 */
export const defaultStaveScale = (device: DeviceClass, staves: number): number | 'fit' => staves > HEIGHT_FIT_STAVES ? 'fit' : DEFAULT_STAVE_SCALE[device];
