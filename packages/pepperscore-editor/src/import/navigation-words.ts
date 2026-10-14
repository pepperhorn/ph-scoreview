// Copied from pepperscore/src/lib/notation/navigation.ts (MIT): `endingNumbers` and
// `navigationWord`, so the editor reads endings and navigation words exactly as the viewer does; keep in sync.

export type NavigationWord = 'daCapo' | 'dalSegno' | 'toCoda' | 'fine' | 'coda' | 'segno';

/** Volta numbers: "1", "1, 2", "1,3", "1-2", "1." */
export function endingNumbers(value: string | null | undefined): number[] {
  const result = (value || '').replace(/[^\d,\-\s]/g, ' ').split(/[\s,]+/).flatMap(token => {
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (range) return Array.from({ length: Math.max(0, Math.min(16, Number(range[2]) - Number(range[1]) + 1)) }, (_, i) => Number(range[1]) + i);
    const number = Number(token); return Number.isInteger(number) && number > 0 ? [number] : [];
  });
  return [...new Set(result)];
}

/**
 * Navigation meaning of a text direction. Anchored at the start so "both hands"
 * or "Winds" never trigger D.S. and "Coda" inside other words is ignored.
 * ABC decoration names ("D.C.alfine", "D.S.alcoda") use the same spelling.
 */
export function navigationWord(text: string): NavigationWord | undefined {
  const words = text.trim();
  if (/^(?:D\.\s*C\.?|Da\s+Capo)(?![a-z])/i.test(words)) return 'daCapo';
  if (/^(?:D\.\s*S\.?|Dal\s+Segno)(?![a-z])/i.test(words)) return 'dalSegno';
  if (/^to\s*(?:the\s+)?(?:coda|\u{1D10C})/iu.test(words)) return 'toCoda';
  if (/^fine\.?$/i.test(words)) return 'fine';
  if (/^(?:\u{1D10C}\s*)?coda\.?$/iu.test(words) || words === '\u{1D10C}') return 'coda';
  if (/^(?:\u{1D10B}\s*)?segno$/iu.test(words) || words === '\u{1D10B}') return 'segno';
  return undefined;
}
