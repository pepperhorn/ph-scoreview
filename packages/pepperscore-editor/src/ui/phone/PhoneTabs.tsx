import type { ReactNode } from 'react';
import { deleteMeasure, insertMeasure, setBarline, setChordMode, setClef, setEnding, setJump, setRepeatEnd, setTime, toggleMark, toggleRepeatStart } from '../../engine/commands/index';
import { findEvent } from '../../engine/sequence-edit';
import { effectiveClef, effectiveKey, effectiveTime } from '../../model/query';
import { binding, usePosition, useRun, useUi, useDispatch } from '../controls';
import { BeamGroup, ChordIcon, CurveSlur, CurveTie, Glyph, Icon, SMUFL } from '../icons';
import { targetEvent } from '../key-actions';
import type { PopoverName } from '../keymap';
import { ENDINGS, JUMPS, jumpValue, keyName } from '../Popover';
import { VALUES } from '../Rail';
import { BARLINES, CLEF_BUTTONS, MARKS, TIMES } from '../ScoreTab';
import { ARTICULATIONS } from '../StaveTab';
import { tempoAt } from '../TempoFields';
import { LayoutStrip } from './LayoutStrip';
import { useEditorStore } from '../useEditorStore';

export type PhoneTab = 'value' | 'pitch' | 'bar' | 'score' | 'layout';

type PBtnProps = { label: string; on?: boolean; text?: boolean; disabled?: boolean; className?: string; onClick?(): void; children: ReactNode };

/** A 44px toolbar target (a text button grows wider); without `onClick` it runs the keymap binding labelled `label`. */
export function PBtn({ label, on, text, disabled, className = '', onClick, children }: PBtnProps) {
  const { editable } = useUi();
  const run = useRun();
  const keys = binding(label)?.keys.join(' / ');
  return (
    <button
      type="button"
      className={`ps-btn ps-pbtn ${text ? 'ps-pbtn-text' : ''} ${on ? 'is-active' : ''} ${className}`.replace(/\s+/g, ' ').trim()}
      aria-label={label}
      aria-pressed={on ?? false}
      title={keys ? `${label} (${keys})` : label}
      disabled={!editable || disabled}
      onClick={onClick ?? (() => run(label))}
    >
      {children}
    </button>
  );
}
const PRow = ({ label, children }: { label: string; children: ReactNode }) => <div className="ps-prow" role="group" aria-label={label}>{children}</div>;
const Spacer = () => <span className="ps-prow-spacer" />;

/** Durations, dot and rest; the note letters; undo and redo. */
function ValueRows() {
  const { store } = useUi();
  const cursor = useEditorStore(store, (s) => s.cursor);
  const canUndo = useEditorStore(store, (s) => s.history.past.length > 0);
  const canRedo = useEditorStore(store, (s) => s.history.future.length > 0);
  return (
    <>
      <PRow label="Duration">
        {VALUES.map((v) => <PBtn key={v.base} label={v.label} on={cursor.duration.base === v.base} className="ps-pencil"><Glyph c={v.c} alt={v.alt} className="ps-glyph-note" /></PBtn>)}
        <PBtn label="Toggle dot" on={cursor.duration.dots > 0}><Glyph c={SMUFL.dot} alt="dot" className="ps-glyph-dot" /></PBtn>
        <PBtn label="Rest"><Glyph c={SMUFL.restQuarter} alt="rest" className="ps-glyph-rest" /></PBtn>
      </PRow>
      <PRow label="Pitch letters">
        {(['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const).map((step) => <PBtn key={step} label={`Note ${step}`} className="ps-pbtn-letter">{step}</PBtn>)}
        <Spacer />
        <PBtn label="Undo" disabled={!canUndo}><Icon name="undo" size={19} /></PBtn>
        <PBtn label="Redo" disabled={!canRedo}><Icon name="redo" size={19} /></PBtn>
      </PRow>
    </>
  );
}

/** Accidentals, chord entry and octave shifts; tie, slur, articulations, tuplet, beams and a dynamic at the target note (selected, just entered, else the cursor note). */
function PitchRows() {
  const { store, togglePopover } = useUi();
  const dispatch = useDispatch();
  const chord = useEditorStore(store, (s) => !!s.cursor.chord);
  const target = useEditorStore(store, (s) => {
    const id = targetEvent(s);
    return id ? findEvent(s.document, id)?.event : undefined;
  });
  return (
    <>
      <PRow label="Accidentals and octave">
        <PBtn label="Sharp"><Glyph c={SMUFL.sharp} alt="♯" className="ps-glyph-acc" /></PBtn>
        <PBtn label="Flat"><Glyph c={SMUFL.flat} alt="♭" className="ps-glyph-acc" /></PBtn>
        <PBtn label="Natural"><Glyph c={SMUFL.natural} alt="♮" className="ps-glyph-acc" /></PBtn>
        <PBtn label="Add to chord" on={chord} onClick={() => dispatch(setChordMode, { on: !chord }, { record: false })}><ChordIcon /></PBtn>
        <PBtn label="Octave up" text><Icon name="up" size={15} />8va</PBtn>
        <PBtn label="Octave down" text><Icon name="down" size={15} />8vb</PBtn>
      </PRow>
      <PRow label="Ties, slurs, articulations, tuplets, beams and dynamics">
        <PBtn label="Tie"><CurveTie /></PBtn>
        <PBtn label="Slur"><CurveSlur /></PBtn>
        {ARTICULATIONS.map((a) => <PBtn key={a.value} label={a.label} on={!!target?.articulations?.includes(a.value)}><Glyph c={a.c} alt={a.alt} className="ps-glyph-artic" /></PBtn>)}
        <PBtn label="Tuplet (3)"><Glyph c={SMUFL.tuplet3} alt="3" className="ps-glyph-tuplet" /></PBtn>
        <PBtn label="Beam grouping 2/3/4/auto"><BeamGroup /></PBtn>
        <PBtn label="Dynamic" text className="ps-pbtn-field ps-pchip-dynamic" onClick={() => togglePopover('dynamic')}><span className="ps-chip-k">Dyn</span><Glyph c={SMUFL.mf} alt="mf" className="ps-glyph-dyn" /></PBtn>
      </PRow>
    </>
  );
}

/** The cursor bar's barline and repeats; endings, jump, marks, and inserting or deleting the bar. */
function BarRows() {
  const { editable } = useUi();
  const dispatch = useDispatch();
  const { document, cursor, g } = usePosition();
  const measureId = cursor.measureId;
  const ending = g?.ending?.numbers.join(',') ?? '';
  return (
    <>
      <PRow label="Barline and repeats">
        {BARLINES.map((b) => (
          <PBtn key={b.value} label={b.label} text={!b.c} on={(g?.barline ?? 'regular') === b.value} onClick={() => dispatch(setBarline, { measureId, barline: b.value })}>
            {b.c ? <Glyph c={b.c} alt={b.alt} className="ps-glyph-pbar" /> : b.alt}
          </PBtn>
        ))}
        <PBtn label="Repeat start" on={!!g?.repeatStart} onClick={() => dispatch(toggleRepeatStart, { measureId })}><Glyph c={SMUFL.repeatLeft} alt="|:" className="ps-glyph-pbar" /></PBtn>
        <PBtn label="Repeat end" on={!!g?.repeatEnd} onClick={() => dispatch(setRepeatEnd, { measureId, times: g?.repeatEnd ? null : undefined })}><Glyph c={SMUFL.repeatRight} alt=":|" className="ps-glyph-pbar" /></PBtn>
      </PRow>
      <PRow label="Endings, jumps and marks">
        {ENDINGS.slice(0, 3).map((e) => (
          <PBtn key={e.value} label={e.label} text on={ending === e.value} onClick={() => dispatch(setEnding, { measureId, numbers: e.numbers })}>{e.value ? `${e.value}.` : 'None'}</PBtn>
        ))}
        <select className="ps-select ps-pselect ps-select-jump" aria-label="Jump" value={jumpValue(g?.jump)} disabled={!editable} onChange={(e) => dispatch(setJump, { measureId, jump: JUMPS.find((j) => j.value === e.target.value)?.jump ?? null })}>
          {JUMPS.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
        </select>
        {MARKS.map((m) => (
          <PBtn key={m.mark} label={m.label} text={!('c' in m)} on={!!g?.[m.mark]} onClick={() => dispatch(toggleMark, { measureId, mark: m.mark })}>
            {'c' in m ? <Glyph c={m.c} alt={m.alt} className="ps-glyph-mark" /> : m.alt}
          </PBtn>
        ))}
        <PBtn label="Insert measure" text onClick={() => dispatch(insertMeasure, { afterMeasureId: measureId })}><Icon name="plus" size={14} />Bar</PBtn>
        <PBtn label="Delete measure" text disabled={document.global.measures.length <= 1} onClick={() => dispatch(deleteMeasure, { measureId })}><Icon name="minus" size={14} />Bar</PBtn>
      </PRow>
    </>
  );
}

/** Key, time, clef and tempo chips (each opens its inline strip), then quick clef and time choices. */
function ScoreRows() {
  const { togglePopover } = useUi();
  const dispatch = useDispatch();
  const { document, cursor, index } = usePosition();
  const key = effectiveKey(document, index);
  const time = effectiveTime(document, index);
  const timeValue = `${time.count}/${time.unit}`;
  const tempo = tempoAt(document, index);
  const part = document.parts.find((p) => p.id === cursor.partId);
  const clef = part ? effectiveClef(part, index, cursor.staff) : undefined;
  const chip = (name: PopoverName, label: string, k: string, value: ReactNode) => (
    <PBtn label={label} text className={`ps-pbtn-field ps-pchip-${name}`} onClick={() => togglePopover(name)}><span className="ps-chip-k">{k}</span>{value}</PBtn>
  );
  return (
    <>
      <PRow label="Score settings">
        {chip('key', 'Key signature', 'Key', keyName(key.fifths, key.mode ?? 'major'))}
        {chip('time', 'Time signature', 'Time', timeValue)}
        {chip('clef', 'Clef', 'Clef', CLEF_BUTTONS.find((c) => c.value === clef)?.label.replace(' clef', '') ?? 'Other')}
        {chip('tempo', 'Tempo', 'Tempo', tempo ? <><Glyph c={SMUFL.quarter} alt="♩" className="ps-glyph-mm" />={tempo.bpm}</> : 'None')}
      </PRow>
      <PRow label="Quick clef and time">
        {CLEF_BUTTONS.map((c) => (
          <PBtn key={c.value} label={c.label} on={clef === c.value} onClick={() => part && dispatch(setClef, { partId: part.id, measureId: cursor.measureId, staff: cursor.staff, clef: c.value })}>
            <Glyph c={c.c} alt={c.alt} className="ps-glyph-clef" />
          </PBtn>
        ))}
        <Spacer />
        {TIMES.map((t) => {
          const [count, unit] = t.split('/').map(Number);
          return <PBtn key={t} label={`${t} time`} text on={timeValue === t} onClick={() => dispatch(setTime, { measureId: cursor.measureId, time: { count, unit: unit as 4 | 8 } })}>{t}</PBtn>;
        })}
      </PRow>
    </>
  );
}

/** The button rows (at most two) of toolbar tab `tab`. */
export function PhoneTabRows({ tab }: { tab: PhoneTab }) {
  switch (tab) {
    case 'value': return <ValueRows />;
    case 'pitch': return <PitchRows />;
    case 'bar': return <BarRows />;
    case 'score': return <ScoreRows />;
    case 'layout': return <LayoutStrip />;
  }
}
