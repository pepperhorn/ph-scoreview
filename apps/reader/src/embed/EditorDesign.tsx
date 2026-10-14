import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { PepperScore, type PepperScoreHighlight } from 'pepperscore';
import expressive from '../../../../validation/fixtures/expressive.musicxml?raw';

/**
 * /design: a static, high-fidelity mockup of the pepperscore editor ("the engraver's desk"). Nothing here is wired to the
 * command engine: the real viewer engraves the score, every other control is presentational. Review switches (top right)
 * frame the mock as a 390px phone and show the read-only (unlicensed) state.
 */

/** Bravura (SMuFL) code points; the viewer loads the font from the asset base. */
const SMUFL = {
  whole: '\uE1D2', half: '\uE1D3', quarter: '\uE1D5', eighth: '\uE1D7', sixteenth: '\uE1D9', thirtySecond: '\uE1DB',
  dot: '\uE1E7', restQuarter: '\uE4E5', sharp: '\uE262', flat: '\uE260', natural: '\uE261', tuplet3: '\uE883',
  gClef: '\uE050', fClef: '\uE062', cClef: '\uE05C',
  barSingle: '\uE030', barDouble: '\uE031', barFinal: '\uE032', repeatLeft: '\uE040', repeatRight: '\uE041',
  segno: '\uE047', coda: '\uE048', fermata: '\uE4C0',
  accent: '\uE4A0', staccato: '\uE4A2', tenuto: '\uE4A4', marcato: '\uE4AC',
  pp: '\uE52B', p: '\uE520', mp: '\uE52C', mf: '\uE52D', f: '\uE522', ff: '\uE52F', sfz: '\uE539',
  cresc: '\uE53E', dim: '\uE53F',
} as const;

const HIGHLIGHTS: PepperScoreHighlight[] = [
  { ids: ['accent'], className: 'ps-cursor' },
  { ids: ['sharp', 'natural'], className: 'ps-selection' },
  { measures: [1], className: 'ps-cursor-measure' },
];

/**
 * The viewer picks its default stave size from the viewport (a known v1 limitation), so inside the 390px review frame
 * on a desktop it would fit four bars at a tiny size; the frame asks for the size a phone gets instead.
 */
const PHONE_FRAME_SETTINGS = { zoom: .5 };

/** A SMuFL glyph with a text fallback (shown when Bravura fails to load). */
function Glyph({ c, alt, className = '' }: { c: string; alt: string; className?: string }) {
  return <span className={`ps-glyph ${className}`} data-fallback={alt} aria-hidden="true">{c}</span>;
}

/** Line icons for the chrome (stroke = currentColor). */
const ICON_PATHS: Record<string, ReactNode> = {
  undo: <><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></>,
  redo: <><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></>,
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>,
  save: <><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/></>,
  export: <><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></>,
  up: <path d="m6 15 6-6 6 6"/>,
  down: <path d="m6 9 6 6 6-6"/>,
  chevron: <path d="m6 9 6 6 6-6"/>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  minus: <path d="M5 12h14"/>,
  more: <><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/></>,
  close: <path d="M6 6l12 12M18 6 6 18"/>,
  desktop: <><rect x="3" y="4.5" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16.5V20"/></>,
  phone: <><rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M11 18h2"/></>,
};
function Icon({ name, size = 16 }: { name: keyof typeof ICON_PATHS; size?: number }) {
  return <svg className={`ps-icon ps-icon-${String(name)}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON_PATHS[name]}</svg>;
}

/** Curves the font has no stand-alone glyph for: tie, slur, beam group, chord. */
const CurveTie = () => <svg className="ps-curve ps-curve-tie" width="30" height="16" viewBox="0 0 30 16" aria-hidden="true"><path d="M3 5c6 8 18 8 24 0c-6 5.5-18 5.5-24 0z" fill="currentColor"/></svg>;
const CurveSlur = () => <svg className="ps-curve ps-curve-slur" width="30" height="20" viewBox="0 0 30 20" aria-hidden="true"><path d="M3 15C8 3 22 3 27 15C21 6.5 9 6.5 3 15z" fill="currentColor"/></svg>;
const BeamGroup = () => <svg className="ps-curve ps-curve-beam" width="30" height="24" viewBox="0 0 30 24" aria-hidden="true">
  <g fill="currentColor"><ellipse cx="5.5" cy="19" rx="3.6" ry="2.6" transform="rotate(-20 5.5 19)"/><ellipse cx="15" cy="17" rx="3.6" ry="2.6" transform="rotate(-20 15 17)"/><ellipse cx="24.5" cy="15" rx="3.6" ry="2.6" transform="rotate(-20 24.5 15)"/>
  <rect x="8.2" y="3" width="1.3" height="16"/><rect x="17.7" y="2" width="1.3" height="15"/><rect x="27.2" y="1" width="1.3" height="14"/><path d="M8.2 3 28.5 1v3.4L8.2 6.4z"/></g></svg>;
const Chord = () => <svg className="ps-curve ps-curve-chord" width="24" height="28" viewBox="0 0 24 28" aria-hidden="true">
  <g fill="currentColor"><ellipse cx="8" cy="23" rx="4.4" ry="3.1" transform="rotate(-20 8 23)"/><ellipse cx="8" cy="16.5" rx="4.4" ry="3.1" transform="rotate(-20 8 16.5)"/><ellipse cx="8" cy="10" rx="4.4" ry="3.1" transform="rotate(-20 8 10)"/><rect x="11.4" y="1" width="1.4" height="22"/></g></svg>;

function Kbd({ children }: { children: ReactNode }) { return <kbd className="ps-kbd">{children}</kbd>; }

type ToolProps = { label: string; keys?: string; active?: boolean; className?: string; children: ReactNode };
function Tool({ label, keys, active, className = '', children }: ToolProps) {
  return <button type="button" className={`ps-btn ps-tool ${active ? 'is-active' : ''} ${className}`} aria-pressed={active ?? false} title={keys ? `${label} (${keys})` : label} aria-label={label}>
    <span className="ps-tool-face">{children}</span>
    {keys && <span className="ps-tool-key">{keys}</span>}
  </button>;
}

const DURATIONS = [
  { label: 'Whole', key: '6', c: SMUFL.whole, alt: '𝅝' },
  { label: 'Half', key: '5', c: SMUFL.half, alt: '𝅗𝅥' },
  { label: 'Quarter', key: '4', c: SMUFL.quarter, alt: '♩' },
  { label: 'Eighth', key: '3', c: SMUFL.eighth, alt: '♪' },
  { label: 'Sixteenth', key: '2', c: SMUFL.sixteenth, alt: '16th' },
  { label: '32nd', key: '1', c: SMUFL.thirtySecond, alt: '32nd' },
];

/** The left rail: a recessed "pencil tray" of note values, then the entry modifiers. */
function ToolRail() {
  return <aside className="ps-rail ps-reveal" aria-label="Note entry tools">
    <div className="ps-rail-label">Value</div>
    <div className="ps-tray" role="group" aria-label="Duration">
      {DURATIONS.map(d => <Tool key={d.key} label={d.label} keys={d.key} active={d.key === '4'} className="ps-pencil"><Glyph c={d.c} alt={d.alt} className="ps-glyph-note"/></Tool>)}
    </div>
    <div className="ps-rail-label">Modify</div>
    <div className="ps-rail-grid" role="group" aria-label="Modifiers">
      <Tool label="Dot" keys="."><Glyph c={SMUFL.dot} alt="dot" className="ps-glyph-dot"/></Tool>
      <Tool label="Rest" keys="0"><Glyph c={SMUFL.restQuarter} alt="rest" className="ps-glyph-rest"/></Tool>
      <Tool label="Tie" keys="T"><CurveTie/></Tool>
      <Tool label="Slur" keys="S"><CurveSlur/></Tool>
    </div>
    <div className="ps-rail-label">Pitch</div>
    <div className="ps-rail-grid" role="group" aria-label="Accidentals and chords">
      <Tool label="Sharp" keys="+"><Glyph c={SMUFL.sharp} alt="♯" className="ps-glyph-acc"/></Tool>
      <Tool label="Flat" keys="−"><Glyph c={SMUFL.flat} alt="♭" className="ps-glyph-acc"/></Tool>
      <Tool label="Natural" keys="="><Glyph c={SMUFL.natural} alt="♮" className="ps-glyph-acc"/></Tool>
      <Tool label="Chord entry" keys="⇧" active><Chord/></Tool>
    </div>
    <div className="ps-rail-label">Group</div>
    <div className="ps-rail-grid" role="group" aria-label="Grouping">
      <Tool label="Triplet" keys="^3"><Glyph c={SMUFL.tuplet3} alt="3" className="ps-glyph-tuplet"/></Tool>
      <Tool label="Beam group" keys="B"><BeamGroup/></Tool>
    </div>
  </aside>;
}

const KEYS_MAJOR = ['C', 'G', 'D', 'A', 'E', 'F', 'B♭', 'E♭', 'A♭', 'D♭', 'B', 'F♯'];

/** The example popover: key signature, opened from bar 1. */
function KeyPopover({ at }: { at: { left: number; top: number } }) {
  return <div className="ps-popover ps-popover-key" role="dialog" aria-label="Key signature" style={{ left: at.left, top: at.top }}>
    <span className="ps-popover-arrow" aria-hidden="true"/>
    <header className="ps-popover-head">
      <div className="ps-popover-titles"><span className="ps-eyebrow">From bar 1</span><h3 className="ps-popover-title">Key signature</h3></div>
      <button type="button" className="ps-btn ps-icon-btn ps-popover-close" aria-label="Close"><Icon name="close" size={14}/></button>
    </header>
    <div className="ps-seg ps-popover-mode" role="tablist"><button type="button" className="ps-seg-item is-on">Major</button><button type="button" className="ps-seg-item">Minor</button></div>
    <div className="ps-key-grid">
      {KEYS_MAJOR.map(k => <button key={k} type="button" className={`ps-btn ps-key-chip ${k === 'C' ? 'is-on' : ''}`}>{k}</button>)}
    </div>
    <label className="ps-check-row"><span className="ps-check is-on"><Icon name="check" size={11}/></span>Transpose notes with the key</label>
    <footer className="ps-popover-foot"><span className="ps-popover-hint"><Kbd>K</Kbd> opens · <Kbd>Esc</Kbd> closes</span><button type="button" className="ps-btn ps-btn-primary ps-btn-sm">Apply</button></footer>
  </div>;
}

const HINTS: Array<[string, string]> = [['N', 'Entry'], ['A–G', 'Pitch'], ['1–6', 'Duration'], ['>', 'Accent'], ['Ctrl+Z', 'Undo'], ['Space', 'Play']];

type Field = { label: string; children: ReactNode };
const Section = ({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) =>
  <section className={`ps-insp-section ${className}`}><h4 className="ps-insp-title">{title}</h4>{children}</section>;
const Row = ({ label, children }: Field) => <div className="ps-insp-row"><span className="ps-insp-label">{label}</span><div className="ps-insp-control">{children}</div></div>;
const Select = ({ value, glyph }: { value: string; glyph?: ReactNode }) => <button type="button" className="ps-btn ps-select">{glyph}<span className="ps-select-value">{value}</span><Icon name="chevron" size={14}/></button>;
const Seg = ({ items, on }: { items: ReactNode[]; on: number }) => <div className="ps-seg">{items.map((item, i) => <button key={i} type="button" className={`ps-seg-item ${i === on ? 'is-on' : ''}`}>{item}</button>)}</div>;
const GlyphBtn = ({ c, alt, label, on, bar }: { c: string; alt: string; label: string; on?: boolean; bar?: boolean }) =>
  <button type="button" className={`ps-btn ps-glyph-btn ${on ? 'is-on' : ''}`} title={label} aria-label={label}><Glyph c={c} alt={alt} className={bar ? 'ps-glyph-bar' : ''}/></button>;
const Stepper = ({ value }: { value: string }) => <div className="ps-stepper"><button type="button" className="ps-btn ps-stepper-btn" aria-label="Decrease"><Icon name="minus" size={13}/></button><span className="ps-stepper-value">{value}</span><button type="button" className="ps-btn ps-stepper-btn" aria-label="Increase"><Icon name="plus" size={13}/></button></div>;

function ScoreTab() {
  return <>
    <Section title="Key & time">
      <Row label="Key"><Select value="C major"/></Row>
      <Row label="Time"><Seg items={['4/4', '3/4', '6/8', '…']} on={0}/></Row>
      <Row label="Clef"><div className="ps-glyph-row"><GlyphBtn c={SMUFL.gClef} alt="G" label="Treble" on/><GlyphBtn c={SMUFL.fClef} alt="F" label="Bass"/><GlyphBtn c={SMUFL.cClef} alt="C" label="Alto"/></div></Row>
    </Section>
    <Section title="Barlines & form">
      <Row label="Barline"><div className="ps-glyph-row"><GlyphBtn c={SMUFL.barSingle} alt="|" label="Regular" bar on/><GlyphBtn c={SMUFL.barDouble} alt="||" label="Double" bar/><GlyphBtn c={SMUFL.barFinal} alt="|‖" label="Final" bar/></div></Row>
      <Row label="Repeat"><div className="ps-glyph-row"><GlyphBtn c={SMUFL.repeatLeft} alt="|:" label="Repeat start" bar on/><GlyphBtn c={SMUFL.repeatRight} alt=":|" label="Repeat end" bar/></div></Row>
      <Row label="Ending"><Seg items={['None', '1.', '2.', '1.–2.']} on={0}/></Row>
      <Row label="Jump"><Select value="D.S. al Coda"/></Row>
      <Row label="Marks"><div className="ps-glyph-row"><button type="button" className="ps-btn ps-rehearsal is-on" title="Rehearsal mark">A</button><GlyphBtn c={SMUFL.segno} alt="𝄋" label="Segno"/><GlyphBtn c={SMUFL.coda} alt="𝄌" label="Coda"/><GlyphBtn c={SMUFL.fermata} alt="𝄐" label="Fermata"/></div></Row>
    </Section>
    <Section title="Tempo">
      <div className="ps-tempo"><input className="ps-input ps-tempo-text" defaultValue="Allegretto" aria-label="Tempo text"/><span className="ps-tempo-mm"><Glyph c={SMUFL.quarter} alt="♩" className="ps-glyph-mm"/> = <input className="ps-input ps-tempo-bpm" defaultValue="120" aria-label="Beats per minute"/></span></div>
    </Section>
    <Section title="Bars" className="ps-insp-bars">
      <div className="ps-bar-actions"><button type="button" className="ps-btn ps-btn-ghost"><Icon name="plus" size={14}/>Insert bar</button><button type="button" className="ps-btn ps-btn-ghost ps-btn-danger"><Icon name="minus" size={14}/>Delete bar</button></div>
    </Section>
  </>;
}

function StaveTab() {
  return <>
    <Section title="Articulations">
      <div className="ps-glyph-row ps-glyph-row-wrap"><GlyphBtn c={SMUFL.accent} alt=">" label="Accent" on/><GlyphBtn c={SMUFL.staccato} alt="·" label="Staccato"/><GlyphBtn c={SMUFL.tenuto} alt="–" label="Tenuto"/><GlyphBtn c={SMUFL.marcato} alt="^" label="Marcato"/><GlyphBtn c={SMUFL.fermata} alt="𝄐" label="Fermata"/></div>
    </Section>
    <Section title="Dynamics">
      <div className="ps-glyph-row ps-glyph-row-wrap ps-dynamics">{(['pp', 'p', 'mp', 'mf', 'f', 'ff', 'sfz'] as const).map(d => <GlyphBtn key={d} c={SMUFL[d]} alt={d} label={d} on={d === 'f'}/>)}</div>
      <Row label="Hairpin"><div className="ps-glyph-row"><GlyphBtn c={SMUFL.cresc} alt="<" label="Crescendo" on/><GlyphBtn c={SMUFL.dim} alt=">" label="Diminuendo"/></div></Row>
    </Section>
    <Section title="Text">
      <Row label="Style"><Seg items={['Expr.', 'Tech.', 'Lyric']} on={0}/></Row>
      <input className="ps-input ps-text-input" defaultValue="dolce" aria-label="Stave text"/>
    </Section>
    <Section title="Beam group">
      <Seg items={['2', '3', '4', 'Auto']} on={3}/>
    </Section>
    <Section title="Nudge" className="ps-insp-nudge">
      <Row label="x"><Stepper value="+0.50 sp"/></Row>
      <Row label="y"><Stepper value="−1.00 sp"/></Row>
      <p className="ps-insp-note">Offsets are in staff spaces and stay anchored to the note.</p>
    </Section>
  </>;
}

function Inspector({ tab, setTab, sheetOpen, toggleSheet }: { tab: 'score' | 'stave'; setTab(t: 'score' | 'stave'): void; sheetOpen: boolean; toggleSheet(): void }) {
  return <aside className={`ps-inspector ps-reveal ${sheetOpen ? 'is-open' : ''}`} aria-label="Inspector">
    <button type="button" className="ps-sheet-grip" aria-label={sheetOpen ? 'Close inspector' : 'Open inspector'} onClick={toggleSheet}><span className="ps-sheet-grip-bar"/></button>
    <div className="ps-tabs" role="tablist">
      {(['score', 'stave'] as const).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} className={`ps-tab ${tab === t ? 'is-on' : ''}`} onClick={() => { setTab(t); if (!sheetOpen) toggleSheet(); }}>{t === 'score' ? 'Score' : 'Stave'}</button>)}
    </div>
    <div className="ps-insp-context"><span className="ps-eyebrow">{tab === 'score' ? 'Bar 2 · whole score' : 'Piano RH · bar 2, beat 3'}</span></div>
    <div className="ps-insp-body">{tab === 'score' ? <ScoreTab/> : <StaveTab/>}</div>
  </aside>;
}

const PALETTE: Array<{ label: string; face: ReactNode; on?: boolean }> = [
  ...DURATIONS.slice().reverse().map(d => ({ label: d.label, face: <Glyph c={d.c} alt={d.alt} className="ps-glyph-note"/>, on: d.key === '4' })),
  { label: 'Pitch up', face: <Icon name="up" size={20}/> },
  { label: 'Pitch down', face: <Icon name="down" size={20}/> },
  { label: 'Sharp', face: <Glyph c={SMUFL.sharp} alt="♯" className="ps-glyph-acc"/> },
  { label: 'Flat', face: <Glyph c={SMUFL.flat} alt="♭" className="ps-glyph-acc"/> },
  { label: 'Natural', face: <Glyph c={SMUFL.natural} alt="♮" className="ps-glyph-acc"/> },
  { label: 'Rest', face: <Glyph c={SMUFL.restQuarter} alt="rest" className="ps-glyph-rest"/> },
  { label: 'Dot', face: <Glyph c={SMUFL.dot} alt="dot" className="ps-glyph-dot"/> },
  { label: 'Tie', face: <CurveTie/> },
  { label: 'Slur', face: <CurveSlur/> },
  { label: 'Accent', face: <Glyph c={SMUFL.accent} alt=">" className="ps-glyph-art"/> },
  { label: 'Staccato', face: <Glyph c={SMUFL.staccato} alt="·" className="ps-glyph-art"/> },
  { label: 'Undo', face: <Icon name="undo" size={19}/> },
  { label: 'Redo', face: <Icon name="redo" size={19}/> },
];

/** Bar 1's position on the paper, for the example popover (measured once the engraving is drawn). */
function useBarOneAnchor(paper: React.RefObject<HTMLDivElement | null>, tick: number) {
  const [at, setAt] = useState({ left: 96, top: 150 });
  useEffect(() => {
    const host = paper.current;
    if (!host) return;
    const measure = () => {
      const bar = host.querySelector<SVGGraphicsElement>('.score-system svg .measure');
      if (!bar) return;
      // Engraving units per CSS pixel, so the dashed bar outline keeps a 2px stroke at any zoom.
      const scale = bar.getScreenCTM()?.a;
      if (scale) host.style.setProperty('--ps-svg-px', `${1 / scale}px`);
      const a = bar.getBoundingClientRect(), b = host.getBoundingClientRect();
      if (!a.width) return;
      setAt({ left: Math.max(12, a.left - b.left + Math.min(a.width * .3, 90) - 32), top: a.top - b.top + a.height * .5 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    const timer = window.setInterval(measure, 600);
    const stop = window.setTimeout(() => window.clearInterval(timer), 6000);
    return () => { observer.disconnect(); window.clearInterval(timer); window.clearTimeout(stop); };
  }, [paper, tick]);
  return at;
}

export default function EditorDesign() {
  const [view, setView] = useState<'desktop' | 'phone'>('desktop');
  const [readOnly, setReadOnly] = useState(false);
  const [tab, setTab] = useState<'score' | 'stave'>('score');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [glyphs, setGlyphs] = useState<'bravura' | 'fallback'>('bravura');
  const [drawn, setDrawn] = useState(0);
  const paper = useRef<HTMLDivElement>(null);
  const popoverAt = useBarOneAnchor(paper, drawn + (view === 'phone' ? 1000 : 0));
  const onReady = useCallback(() => setDrawn(n => n + 1), []);

  // Text fallbacks if Bravura never loads (the viewer injects its @font-face on mount).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      document.fonts.load('24px Bravura', SMUFL.quarter).then(faces => setGlyphs(faces.length ? 'bravura' : 'fallback'), () => setGlyphs('fallback'));
    }, 2500);
    return () => window.clearTimeout(timer);
  }, []);

  return <div className="ps-design" data-view={view} data-glyphs={glyphs}>
    <div className="ps-review" role="toolbar" aria-label="Review switches">
      <span className="ps-review-title">Editor design mock</span>
      <div className="ps-review-seg" role="group" aria-label="View">
        <span className="ps-review-label">View</span>
        <button type="button" className={`ps-review-btn ${view === 'desktop' ? 'is-on' : ''}`} aria-pressed={view === 'desktop'} onClick={() => setView('desktop')}><Icon name="desktop" size={14}/>Desktop</button>
        <button type="button" className={`ps-review-btn ${view === 'phone' ? 'is-on' : ''}`} aria-pressed={view === 'phone'} onClick={() => setView('phone')}><Icon name="phone" size={14}/>Phone</button>
      </div>
      <button type="button" className={`ps-review-btn ps-review-readonly ${readOnly ? 'is-on' : ''}`} aria-pressed={readOnly} onClick={() => setReadOnly(v => !v)}><Icon name="lock" size={13}/>Read-only</button>
    </div>

    <div className="ps-stage">
      <div className="ps-device">
        <div className={`ps-app ${readOnly ? 'is-readonly' : ''}`} data-sheet={sheetOpen ? 'open' : 'closed'}>
          <div className="ps-shell">
            <header className="ps-topbar ps-reveal">
              <div className="ps-brand"><span className="ps-brand-mark"><Glyph c={SMUFL.gClef} alt="𝄞"/></span><span className="ps-brand-name">pepperscore</span></div>
              <div className="ps-title-block">
                <h1 className="ps-score-title">Expression and Rhythm</h1>
                <p className="ps-score-composer">Clara Weston · Study for piano, Op. 4</p>
              </div>
              <div className="ps-chips" aria-label="Score settings">
                <button type="button" className="ps-btn ps-chip"><span className="ps-chip-k">Key</span>C major</button>
                <button type="button" className="ps-btn ps-chip"><span className="ps-chip-k">Time</span>4/4</button>
                <button type="button" className="ps-btn ps-chip"><span className="ps-chip-k">Tempo</span><Glyph c={SMUFL.quarter} alt="♩" className="ps-glyph-mm"/>= 120</button>
              </div>
              <div className="ps-actions">
                <div className="ps-history">
                  <button type="button" className="ps-btn ps-icon-btn ps-undo" aria-label="Undo" title="Undo (Ctrl+Z)"><Icon name="undo" size={17}/></button>
                  <button type="button" className="ps-btn ps-icon-btn ps-redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled><Icon name="redo" size={17}/></button>
                </div>
                <button type="button" className="ps-btn ps-btn-play"><Icon name="play" size={14}/><span className="ps-btn-text">Play</span></button>
                <div className="ps-file">
                  <button type="button" className="ps-btn ps-btn-ghost ps-save"><Icon name="save" size={15}/><span className="ps-btn-text">Save</span></button>
                  <button type="button" className="ps-btn ps-btn-ghost ps-export"><Icon name="export" size={15}/><span className="ps-btn-text">Export</span></button>
                </div>
                <span className={`ps-licence ${readOnly ? 'is-viewer' : ''}`}><span className="ps-licence-dot"/>{readOnly ? 'Viewer · read-only' : 'Editor · 4 staves'}</span>
                <button type="button" className="ps-btn ps-icon-btn ps-more" aria-label="More"><Icon name="more" size={18}/></button>
              </div>
            </header>

            {readOnly && <div className="ps-banner-readonly" role="status">
              <span className="ps-banner-icon"><Icon name="lock" size={15}/></span>
              <span className="ps-banner-text"><strong>Editing requires a licence.</strong> You can read, play and export this score; tools are disabled.</span>
              <button type="button" className="ps-btn ps-btn-primary ps-btn-sm ps-banner-cta">Enter licence key</button>
            </div>}

            <div className="ps-workspace">
              <ToolRail/>
              <main className="ps-canvas ps-reveal" aria-label="Score">
                <div className="ps-canvas-head">
                  <div className="ps-canvas-crumbs"><span className="ps-mode-pill"><span className="ps-mode-dot"/>Entry</span><span className="ps-crumb">Piano · bar 2 of 4</span></div>
                  <div className="ps-canvas-view"><Seg items={['Page', 'Endless']} on={0}/><span className="ps-zoom">100%</span></div>
                </div>
                <div className="ps-desk">
                  <div className="ps-paper" ref={paper}>
                    <PepperScore key={view} className="ps-design-score" settings={view === 'phone' ? PHONE_FRAME_SETTINGS : undefined} chrome="none" musicXml={expressive} highlights={HIGHLIGHTS} assetBaseUrl="/" ariaLabel="Expression and Rhythm" onReady={onReady}/>
                    {!readOnly && <KeyPopover at={popoverAt}/>}
                  </div>
                </div>
                <div className="ps-hints" aria-label="Keyboard hints">
                  {HINTS.map(([k, v]) => <span key={k} className="ps-hint"><Kbd>{k}</Kbd><span className="ps-hint-text">{v}</span></span>)}
                </div>
              </main>
              <Inspector tab={tab} setTab={setTab} sheetOpen={sheetOpen} toggleSheet={() => setSheetOpen(v => !v)}/>
            </div>

            <nav className="ps-palette" aria-label="Touch palette">
              {PALETTE.map(item => <button key={item.label} type="button" className={`ps-btn ps-palette-btn ${item.on ? 'is-active' : ''}`} aria-label={item.label} title={item.label}>{item.face}</button>)}
            </nav>

            <footer className="ps-status">
              <span className="ps-status-check"><span className="ps-status-dot"/>Score check: no problems</span>
              <span className="ps-status-pos">Quarter · bar 2, beat 3 · Piano RH</span>
              <span className="ps-status-saved">Saved locally · 14:32</span>
            </footer>
          </div>
        </div>
      </div>
    </div>
  </div>;
}
