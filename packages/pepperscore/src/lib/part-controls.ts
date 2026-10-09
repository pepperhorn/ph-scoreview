/**
 * Staff-control sizing. Every dimension of a `.part-control` (instrument icon,
 * name font, focus and hide buttons) and the first-system control gutter is derived from
 * the rendered five-line staff height in CSS px, so controls keep a constant
 * ratio to the stave across zoom, width fit, many-staff height fit and
 * Vertical/Endless. Clamps keep them legible and inside their staff's band.
 */
export type PartControlMetrics = { stavePx: number; icon: number; font: number; eye: number; height: number; gutter: number };
export type PartControlLimits = {
  /** Smallest distance between adjacent staff centres (px); controls never grow past it. */
  staffPitchPx?: number;
  /** Largest gutter the viewport can spare (px). */
  maxGutter?: number;
  /** How many small buttons (focus, hide) each control carries. */
  buttons?: number;
};

/** Icon and name font as a fraction of the five-line staff height (double the original 28px icon / 11px name on a 72px staff). */
export const ICON_RATIO = 56 / 72;
export const FONT_RATIO = 22 / 72;
const ICON_MIN = 22, ICON_MAX = 104;
const FONT_MIN = 11, FONT_MAX = 30;
const EYE_MIN = 24, EYE_MAX = 40;
const PAD = 8, GAP = 4;
/** Room for roughly nine characters of part name before it ellipsizes. */
const NAME_EMS = 5;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function partControlMetrics(stavePx: number, { staffPitchPx = Infinity, maxGutter = Infinity, buttons = 0 }: PartControlLimits = {}): PartControlMetrics {
  const s = Number.isFinite(stavePx) && stavePx > 0 ? stavePx : 72;
  // Adjacent controls must not overlap: cap the control height a little under the staff pitch.
  const room = Number.isFinite(staffPitchPx) && staffPitchPx > 0 ? Math.max(18, staffPitchPx - 4) : Infinity;
  const icon = Math.round(Math.min(room, clamp(s * ICON_RATIO, ICON_MIN, ICON_MAX)));
  const font = Math.round(Math.min(room * .6, clamp(s * FONT_RATIO, FONT_MIN, FONT_MAX)) * 10) / 10;
  const eyeSize = buttons > 0 ? Math.round(Math.min(room, clamp(icon * .7, EYE_MIN, EYE_MAX))) : 0;
  const fixed = PAD + icon + GAP + buttons * (GAP + eyeSize);
  const gutter = Math.round(Math.max(fixed + font * 2, Math.min(maxGutter, fixed + font * NAME_EMS)));
  return { stavePx: s, icon, font, eye: eyeSize, height: Math.max(icon, eyeSize, Math.ceil(font * 1.3)), gutter };
}
