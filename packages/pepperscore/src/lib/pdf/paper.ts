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

/** The exact integer geometry sent to Verovio, including the tall-system fallback. */
export function pageGeometry(paper: PaperId, naturalHeight: number, overhead = 0) {
  const size = PAPER_SIZES[paper];
  const scale = Math.min(1, (size.height - 2 * MARGIN_MM) / (Math.max(1, naturalHeight) * MM_PER_UNIT));
  const mm = MM_PER_UNIT * scale;
  const pageWidth = Math.round(size.width / mm), pageHeight = Math.round(size.height / mm);
  const margin = Math.round(MARGIN_MM / mm);
  return { pageWidth, pageHeight, margin, scale, capacity: pageWidth - 2 * margin - overhead };
}
