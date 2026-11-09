/** Portrait dimensions in millimetres; shared by engraving and PDF composition. */
export const PAPER_SIZES = {
  a4: { width: 210, height: 297 },
  a3: { width: 297, height: 420 },
  letter: { width: 215.9, height: 279.4 },
  legal: { width: 215.9, height: 355.6 },
} as const;
export type PaperId = keyof typeof PAPER_SIZES;
/** Five-line stave height, independent of screen zoom and paper size. */
export const STAVE_MM = 6.5;
export const MM_PER_UNIT = STAVE_MM / 72;
export const MARGIN_MM = 12;
