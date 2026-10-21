import { useState, type ReactNode } from 'react';
import { deleteMeasure, insertMeasure, setBarline, setChordMode, setClef, setEnding, setJump, setRepeatEnd, setTime, toggleMark, toggleRepeatStart } from '../../engine/commands/index';
import { findEvent } from '../../engine/sequence-edit';
import { effectiveClef, effectiveKey, effectiveTime } from '../../model/query';
import { binding, usePosition, useRun, useUi, useDispatch } from '../controls';
import { BeamGroup, ChordIcon, CurveSlur, CurveTie, Glyph, Icon, PianoIcon, SMUFL } from '../icons';
import { shownDuration, targetEvent } from '../key-actions';
import { enterPitch, type PopoverName } from '../keymap';
import { pianoSpelling } from '../pitch-entry';
import { ENDINGS, JUMPS, jumpValue, keyName } from '../Popover';
import { VALUES } from '../Rail';
import { BARLINES, CLEF_BUTTONS, MARKS, TIMES } from '../ScoreTab';
import { ARTICULATIONS } from '../StaveTab';
import { tempoAt } from '../TempoFields';
import { LayoutStrip } from './LayoutStrip';
import { useEditorStore } from '../useEditorStore';

export type PhoneTab = 'value' | 'marks' | 'bar' | 'score' | 'layout';

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

/** How the Notes tab's third row enters pitches: a one-octave piano or the letter buttons. */
export type EntryInput = 'piano' | 'letters';
const ENTRY_INPUT_KEY = 'pepperscore-editor:phone-entry-input';
function readEntryInput(): EntryInput {
  try {
    return globalThis.localStorage?.getItem(ENTRY_INPUT_KEY) === 'letters' ? 'letters' : 'piano';
  } catch {
    return 'piano';
  }
}
function saveEntryInput(input: EntryInput): void {
  try {
    globalThis.localStorage?.setItem(ENTRY_INPUT_KEY, input);
  } catch {
    // Storage blocked (private mode, a sandboxed frame): the choice lasts for this session only.
  }
}

/**
 * The twelve keys in pitch order, so focus and screen readers go C, C sharp, D...; a black key (absolutely placed,
 * outside the white keys' flex row) is centred on the line after white key `after`.
 */
const KEYS: { pc: number; after?: number }[] = [
  { pc: 0 }, { pc: 1, after: 0 }, { pc: 2 }, { pc: 3, after: 1 }, { pc: 4 }, { pc: 5 }, { pc: 6, after: 3 }, { pc: 7 }, { pc: 8, after: 4 }, { pc: 9 }, { pc: 10, after: 5 }, { pc: 11 },
];
const ACCIDENTAL_TEXT: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };
const ACCIDENTAL_WORD: Record<number, string> = { [-2]: ' double flat', [-1]: ' flat', 0: '', 1: ' sharp', 2: ' double sharp' };

/**
 * One octave of piano keys, C to B. A key enters its pitch class as the letter buttons do (nearest the last note,
 * or into the chord in chord mode), spelled for the cursor bar's key: the key signature's spelling, else the
 * natural, else a sharp in sharp keys (and C major) or a flat in flat keys.
 */
function PianoKeys() {
  const { ctx, editable, refocus } = useUi();
  const { document, index } = usePosition();
  const fifths = effectiveKey(document, index).fifths;
  const key = (pc: number, after?: number) => {
    const { step, alter } = pianoSpelling(pc, fifths);
    const black = after !== undefined;
    return (
      <button
        key={pc}
        type="button"
        className={`ps-piano-key ${black ? 'ps-piano-key-black' : 'ps-piano-key-white'}`}
        style={black ? { left: `calc(${((after + 1) * 100) / 7}% - var(--ps-piano-black-w) / 2)` } : undefined}
        aria-label={`Piano ${step}${ACCIDENTAL_WORD[alter]}`}
        title={`${step}${ACCIDENTAL_TEXT[alter]}`}
        data-pitch-class={pc}
        disabled={!editable}
        onClick={() => {
          enterPitch(ctx, step, alter);
          refocus();
        }}
      >
        <span className="ps-piano-key-name">{step}{ACCIDENTAL_TEXT[alter]}</span>
      </button>
    );
  };
  return (
    <div className="ps-piano" role="group" aria-label="Piano keyboard">
      {KEYS.map(({ pc, after }) => key(pc, after))}
    </div>
  );
}

/** Durations, dot and rest; accidentals, octave shifts and chord entry; then a piano octave or the letter buttons. */
function ValueRows() {
  const { store } = useUi();
  const dispatch = useDispatch();
  // Entry lights the entry duration; Edit the target event's, which the duration buttons change there.
  const duration = useEditorStore(store, shownDuration);
  const chord = useEditorStore(store, (s) => !!s.cursor.chord);
  const [input, setInput] = useState<EntryInput>(readEntryInput);
  const next: EntryInput = input === 'piano' ? 'letters' : 'piano';
  const switchLabel = next === 'piano' ? 'Use piano keys' : 'Use letter buttons';
  return (
    <>
      <PRow label="Duration">
        {VALUES.map((v) => <PBtn key={v.base} label={v.label} on={duration.base === v.base} className="ps-pencil"><Glyph c={v.c} alt={v.alt} className="ps-glyph-note" /></PBtn>)}
        <PBtn label="Toggle dot" on={duration.dots > 0}><Glyph c={SMUFL.dot} alt="dot" className="ps-glyph-dot" /></PBtn>
        <PBtn label="Rest"><Glyph c={SMUFL.restQuarter} alt="rest" className="ps-glyph-rest" /></PBtn>
      </PRow>
      <PRow label="Accidentals, octave and chord">
        <PBtn label="Sharp"><Glyph c={SMUFL.sharp} alt="♯" className="ps-glyph-acc" /></PBtn>
        <PBtn label="Natural"><Glyph c={SMUFL.natural} alt="♮" className="ps-glyph-acc" /></PBtn>
        <PBtn label="Flat"><Glyph c={SMUFL.flat} alt="♭" className="ps-glyph-acc" /></PBtn>
        <PBtn label="Octave down" text className="ps-pbtn-octave"><Icon name="down" size={15} />8vb</PBtn>
        <PBtn label="Octave up" text className="ps-pbtn-octave"><Icon name="up" size={15} />8va</PBtn>
        <PBtn label="Add to chord" on={chord} className="ps-pbtn-chord" onClick={() => dispatch(setChordMode, { on: !chord }, { record: false })}><ChordIcon /></PBtn>
      </PRow>
      <div className={`ps-prow ps-prow-entry ps-prow-entry-${input}`} role="group" aria-label={input === 'piano' ? 'Piano entry' : 'Pitch letters'}>
        {input === 'piano'
          ? <PianoKeys />
          : (['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const).map((step) => <PBtn key={step} label={`Note ${step}`} className="ps-pbtn-letter">{step}</PBtn>)}
        <button
          type="button"
          className="ps-btn ps-pbtn ps-pbtn-entry-switch"
          aria-label={switchLabel}
          title={switchLabel}
          onClick={() => {
            setInput(next);
            saveEntryInput(next);
          }}
        >
          {next === 'piano' ? <PianoIcon /> : <span className="ps-entry-switch-abc">ABC</span>}
        </button>
      </div>
    </>
  );
}

/** Tie, slur, tuplet, beams and a dynamic; the articulations, lit when the last entered (or selected) note has them. */
function MarksRows() {
  const { store, togglePopover } = useUi();
  const target = useEditorStore(store, (s) => {
    const id = targetEvent(s);
    return id ? findEvent(s.document, id)?.event : undefined;
  });
  return (
    <>
      <PRow label="Ties, slurs, tuplets, beams and dynamics">
        <PBtn label="Tie"><CurveTie /></PBtn>
        <PBtn label="Slur"><CurveSlur /></PBtn>
        <PBtn label="Tuplet (3)"><Glyph c={SMUFL.tuplet3} alt="3" className="ps-glyph-tuplet" /></PBtn>
        <PBtn label="Beam grouping 2/3/4/auto"><BeamGroup /></PBtn>
        <PBtn label="Dynamic" text className="ps-pbtn-field ps-pchip-dynamic" onClick={() => togglePopover('dynamic')}><span className="ps-chip-k">Dyn</span><Glyph c={SMUFL.mf} alt="mf" className="ps-glyph-dyn" /></PBtn>
      </PRow>
      <PRow label="Articulations">
        {ARTICULATIONS.map((a) => <PBtn key={a.value} label={a.label} on={!!target?.articulations?.includes(a.value)}><Glyph c={a.c} alt={a.alt} className="ps-glyph-artic" /></PBtn>)}
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

/** The button rows of toolbar tab `tab`: three on Notes (the last a piano or letters), at most two elsewhere. */
export function PhoneTabRows({ tab }: { tab: PhoneTab }) {
  switch (tab) {
    case 'value': return <ValueRows />;
    case 'marks': return <MarksRows />;
    case 'bar': return <BarRows />;
    case 'score': return <ScoreRows />;
    case 'layout': return <LayoutStrip />;
  }
}
