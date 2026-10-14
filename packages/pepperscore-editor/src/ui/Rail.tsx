import { memo, type ReactNode } from 'react';
import { setChordMode } from '../engine/commands/index';
import { binding, useDispatch, useRun, useUi } from './controls';
import { BeamGroup, ChordIcon, CurveSlur, CurveTie, Glyph, SMUFL } from './icons';
import { countRender } from './render-counts';
import { useEditorStore } from './useEditorStore';

/** The keycap legend: the binding's first key, with Ctrl and Shift as ^ and ⇧. */
export function legend(label: string): string | undefined {
  const key = binding(label)?.keys[0];
  return key?.replace(/^Ctrl\+/, '^').replace(/^Shift\+/, '⇧');
}

type KeycapProps = { label: string; keys?: string; active?: boolean; className?: string; title?: string; onClick?(): void; children: ReactNode };

/** A 56×52 keycap; without `onClick` it runs the keymap binding labelled `label`. */
function Keycap({ label, keys = legend(label), active, className = '', title, onClick, children }: KeycapProps) {
  const { editable } = useUi();
  const run = useRun();
  return (
    <button
      type="button"
      className={`ps-btn ps-tool ps-keycap ${active ? 'is-active' : ''} ${className}`.replace(/\s+/g, ' ').trim()}
      aria-label={label}
      aria-pressed={active ?? false}
      title={title ?? (keys ? `${label} (${binding(label)?.keys.join(' / ') ?? keys})` : label)}
      disabled={!editable}
      onClick={onClick ?? (() => run(label))}
    >
      <span className="ps-tool-face">{children}</span>
      {keys && <span className="ps-tool-key">{keys}</span>}
    </button>
  );
}

export const VALUES = [
  { label: 'Whole note', base: 'whole', c: SMUFL.whole, alt: '𝅝' },
  { label: 'Half note', base: 'half', c: SMUFL.half, alt: '𝅗𝅥' },
  { label: 'Quarter note', base: 'quarter', c: SMUFL.quarter, alt: '♩' },
  { label: 'Eighth note', base: 'eighth', c: SMUFL.eighth, alt: '♪' },
  { label: '16th note', base: '16th', c: SMUFL.sixteenth, alt: '16th' },
  { label: '32nd note', base: '32nd', c: SMUFL.thirtySecond, alt: '32nd' },
] as const;

/** The left rail: a recessed tray of note values, then modifiers, pitch and grouping keycaps. */
export const Rail = memo(function Rail() {
  countRender('Rail');
  const { store } = useUi();
  const dispatch = useDispatch();
  // Memoised, with no props, and subscribed only to what the keycaps light up (the value, dot and chord state), so
  // cursor moves do not re-render the rail (validation/editor.mjs counts its renders across arrow-key moves).
  const base = useEditorStore(store, (s) => s.cursor.duration.base);
  const dotted = useEditorStore(store, (s) => s.cursor.duration.dots > 0);
  const chord = useEditorStore(store, (s) => !!s.cursor.chord);
  return (
    <aside className="ps-rail" aria-label="Note entry tools">
      <div className="ps-rail-label">Value</div>
      <div className="ps-tray" role="group" aria-label="Duration">
        {VALUES.map((v) => (
          <Keycap key={v.base} label={v.label} active={base === v.base} className="ps-pencil"><Glyph c={v.c} alt={v.alt} className="ps-glyph-note" /></Keycap>
        ))}
        <Keycap label="Toggle dot" active={dotted}><Glyph c={SMUFL.dot} alt="dot" className="ps-glyph-dot" /></Keycap>
      </div>
      <div className="ps-rail-label">Modify</div>
      <div className="ps-rail-grid" role="group" aria-label="Modifiers">
        <Keycap label="Rest"><Glyph c={SMUFL.restQuarter} alt="rest" className="ps-glyph-rest" /></Keycap>
        <Keycap label="Tie"><CurveTie /></Keycap>
        <Keycap label="Slur"><CurveSlur /></Keycap>
      </div>
      <div className="ps-rail-label">Pitch</div>
      <div className="ps-rail-grid" role="group" aria-label="Accidentals and chords">
        <Keycap label="Sharp"><Glyph c={SMUFL.sharp} alt="♯" className="ps-glyph-acc" /></Keycap>
        <Keycap label="Flat"><Glyph c={SMUFL.flat} alt="♭" className="ps-glyph-acc" /></Keycap>
        <Keycap label="Natural"><Glyph c={SMUFL.natural} alt="♮" className="ps-glyph-acc" /></Keycap>
        <Keycap
          label="Add to chord"
          keys="⇧"
          title="Add to chord: note letters add to the chord (Shift+letter adds one note)"
          active={chord}
          onClick={() => dispatch(setChordMode, { on: !chord }, { record: false })}
        >
          <ChordIcon />
        </Keycap>
      </div>
      <div className="ps-rail-label">Group</div>
      <div className="ps-rail-grid" role="group" aria-label="Grouping">
        <Keycap label="Tuplet (3)"><Glyph c={SMUFL.tuplet3} alt="3" className="ps-glyph-tuplet" /></Keycap>
        <Keycap label="Beam grouping 2/3/4/auto"><BeamGroup /></Keycap>
      </div>
    </aside>
  );
});
