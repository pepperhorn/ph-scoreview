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
 * Endless default stave scale (unchanged from the fixed device defaults): desktop is 75% of the sample's former
 * rendered scale of 1 (a 72px staff at 1280x800); phones and tablets keep 1. Vertical does not use it.
 */
export const ENDLESS_STAVE_SCALE: Record<DeviceClass, number> = { desktop: .75, compact: 1 };
/**
 * Vertical default: the largest stave scale at which this many bars (or every bar of a shorter score) fit the first
 * system beside the staff controls at their minimum width, so Auto shows that many per line (`barFitZoom` in render.ts).
 */
export const DEFAULT_VERTICAL_BARS = 4;
/**
 * Readable floor for the Vertical default on compact devices (phones, tablets): the rendered five-line staff is at least
 * this many px, so a phone shows fewer bars per line (2-3) rather than an unreadably small four-bar fit.
 * Only the default is floored; a user can still zoom below it.
 */
export const COMPACT_MIN_DEFAULT_STAVE_PX = 40;
/** Smallest Vertical default stave scale for a device class (the staff is 72px at stave scale 1, render.ts STAFF_UNITS). */
export const minimumDefaultStaveScale = (device: DeviceClass) => device === 'compact' ? Math.ceil(COMPACT_MIN_DEFAULT_STAVE_PX / 72 * 1000) / 1000 : 0;
/** Scores with more than this many staves default to the full-stack height fit, capped at the default above. */
export const HEIGHT_FIT_STAVES = 4;
/*
 * Without a user-chosen zoom the reader requests 'fit', which render.ts resolves per layout: Vertical fits
 * DEFAULT_VERTICAL_BARS bars, Endless uses ENDLESS_STAVE_SCALE, and many staves take min(that, height fit); on compact
 * devices the Vertical result is then raised to minimumDefaultStaveScale (readability wins over fit). The default
 * is re-resolved on every layout (resize, rotation, mode), while a user-chosen zoom stays fixed and is the only one saved.
 */
