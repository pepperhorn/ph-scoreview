import { useEffect, useState, type ReactNode } from 'react';

/** Bravura (SMuFL) code points; the viewer loads the font from its asset base. */
export const SMUFL = {
  whole: '', half: '', quarter: '', eighth: '', sixteenth: '', thirtySecond: '',
  dot: '', restQuarter: '', sharp: '', flat: '', natural: '', tuplet3: '',
  gClef: '', fClef: '', cClef: '',
  barSingle: '', barDouble: '', barFinal: '', barDashed: '', repeatLeft: '', repeatRight: '',
  segno: '', coda: '',
  accent: '', staccato: '', tenuto: '', marcato: '',
  ppp: '', pp: '', p: '', mp: '', mf: '', f: '', ff: '', fff: '', sfz: '', fp: '',
} as const;

/** A SMuFL glyph with a text fallback, shown when Bravura is missing (`data-ps-glyphs="fallback"` on the editor). */
export function Glyph({ c, alt, className = '' }: { c: string; alt: string; className?: string }) {
  return <span className={`ps-glyph ${className}`.trim()} data-fallback={alt} aria-hidden="true">{c}</span>;
}

/** `'bravura'` until a check a moment after mount finds the font missing. */
export function useGlyphFont(): 'bravura' | 'fallback' {
  const [font, setFont] = useState<'bravura' | 'fallback'>('bravura');
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    let live = true;
    const timer = window.setTimeout(() => {
      document.fonts.load('24px Bravura', SMUFL.quarter).then(
        (faces) => live && setFont(faces.length ? 'bravura' : 'fallback'),
        () => live && setFont('fallback'),
      );
    }, 2500);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, []);
  return font;
}

const ICON_PATHS = {
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>,
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />,
  save: <><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4" /><path d="M8 20v-6h8v6" /></>,
  export: <><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>,
  open: <><path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
} satisfies Record<string, ReactNode>;
export type IconName = keyof typeof ICON_PATHS;

/** A line icon (stroke = currentColor). */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className={`ps-icon ps-icon-${name}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  );
}

/** Curves the music font has no stand-alone glyph for: tie, slur, beam group, chord. */
export const CurveTie = () => <svg className="ps-curve ps-curve-tie" width="30" height="16" viewBox="0 0 30 16" aria-hidden="true"><path d="M3 5c6 8 18 8 24 0c-6 5.5-18 5.5-24 0z" fill="currentColor" /></svg>;
export const CurveSlur = () => <svg className="ps-curve ps-curve-slur" width="30" height="20" viewBox="0 0 30 20" aria-hidden="true"><path d="M3 15C8 3 22 3 27 15C21 6.5 9 6.5 3 15z" fill="currentColor" /></svg>;
export const BeamGroup = () => (
  <svg className="ps-curve ps-curve-beam" width="30" height="24" viewBox="0 0 30 24" aria-hidden="true">
    <g fill="currentColor">
      <ellipse cx="5.5" cy="19" rx="3.6" ry="2.6" transform="rotate(-20 5.5 19)" /><ellipse cx="15" cy="17" rx="3.6" ry="2.6" transform="rotate(-20 15 17)" /><ellipse cx="24.5" cy="15" rx="3.6" ry="2.6" transform="rotate(-20 24.5 15)" />
      <rect x="8.2" y="3" width="1.3" height="16" /><rect x="17.7" y="2" width="1.3" height="15" /><rect x="27.2" y="1" width="1.3" height="14" /><path d="M8.2 3 28.5 1v3.4L8.2 6.4z" />
    </g>
  </svg>
);
export const ChordIcon = () => (
  <svg className="ps-curve ps-curve-chord" width="24" height="28" viewBox="0 0 24 28" aria-hidden="true">
    <g fill="currentColor"><ellipse cx="8" cy="23" rx="4.4" ry="3.1" transform="rotate(-20 8 23)" /><ellipse cx="8" cy="16.5" rx="4.4" ry="3.1" transform="rotate(-20 8 16.5)" /><ellipse cx="8" cy="10" rx="4.4" ry="3.1" transform="rotate(-20 8 10)" /><rect x="11.4" y="1" width="1.4" height="22" /></g>
  </svg>
);

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ps-kbd">{children}</kbd>;
}
