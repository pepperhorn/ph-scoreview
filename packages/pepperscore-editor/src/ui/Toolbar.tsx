import { createContext, useContext, type ReactNode } from 'react';
import {
  addDynamic, deleteMeasure, insertMeasure, setBarline, setBeamGroup, setCursorDuration, setEnding, setJump, setRepeatEnd, toggleMark, toggleRepeatStart,
  type Mark,
} from '../engine/commands/index';
import type { EditorStore } from '../engine/store';
import type { DurationBase } from '../model/durations';
import { measureIndex } from '../model/query';
import type { Dynamic, GlobalMeasure } from '../model/schema';
import { autoBeamSequence } from './key-actions';
import { describeKey, KEYMAP, type KeyContext, type PopoverName } from './keymap';
import { OPEN_ACCEPT } from './files';
import { DYNAMICS, ENDINGS, JUMPS, jumpValue } from './Popover';
import { useEditorStore } from './useEditorStore';

const DURATIONS: { base: DurationBase; label: string; glyph: string }[] = [
  { base: 'whole', label: 'Whole note', glyph: '𝅝' }, { base: 'half', label: 'Half note', glyph: '𝅗𝅥' }, { base: 'quarter', label: 'Quarter note', glyph: '♩' },
  { base: 'eighth', label: 'Eighth note', glyph: '♪' }, { base: '16th', label: '16th note', glyph: '𝅘𝅥𝅯' }, { base: '32nd', label: '32nd note', glyph: '𝅘𝅥𝅰' },
];
const MARKS: { mark: Mark; label: string }[] = [{ mark: 'segno', label: 'Segno' }, { mark: 'coda', label: 'Coda' }, { mark: 'toCoda', label: 'To Coda' }, { mark: 'fine', label: 'Fine' }];
const BARLINES = ['regular', 'double', 'final', 'dashed', 'invisible'] as const;

export type ToolbarProps = {
  store: EditorStore;
  ctx: KeyContext;
  editable: boolean;
  playing: boolean;
  onPopover(name: PopoverName): void;
  onPlay(): void;
  onExport(): void;
  onSave(): void;
  onOpen(file: File): void;
  /** Returns keyboard focus to the editor after a control is used. */
  refocus(): void;
};

const binding = (label: string) => KEYMAP.find((b) => b.label === label);
const tip = (title: string, label?: string) => {
  const b = label ? binding(label) : undefined;
  return b ? `${title} (${describeKey(b)})` : title;
};

function Group({ name, children }: { name: string; children: ReactNode }) {
  return <div className={`ps-toolbar-group ps-toolbar-${name}`} role="group" aria-label={name}>{children}</div>;
}

type ButtonContext = { editable: boolean; run(label: string): void };
const ButtonCtx = createContext<ButtonContext>({ editable: false, run: () => {} });

/** A toolbar button; without `onClick` it runs the keymap binding labelled `label`. */
function Btn({ label, title, active, disabled, popoverFor, children, onClick }: { label: string; title?: string; active?: boolean; disabled?: boolean; popoverFor?: PopoverName; children: ReactNode; onClick?(): void }) {
  const { editable, run } = useContext(ButtonCtx);
  return (
    <button
      type="button"
      className={`ps-btn ${active ? 'ps-btn-active' : ''}`.trim()}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      data-ps-popover-for={popoverFor}
      title={title ?? tip(label, label)}
      disabled={!editable || disabled}
      onClick={onClick ?? (() => run(label))}
    >
      {children}
    </button>
  );
}

export function Toolbar(props: ToolbarProps) {
  const { store, ctx, editable, refocus } = props;
  const cursor = useEditorStore(store, (s) => s.cursor);
  const document = useEditorStore(store, (s) => s.document);
  const canUndo = useEditorStore(store, (s) => s.history.past.length > 0);
  const canRedo = useEditorStore(store, (s) => s.history.future.length > 0);
  const index = measureIndex(document, cursor.measureId);
  const g: GlobalMeasure | undefined = document.global.measures[index];
  const measureId = cursor.measureId;

  const run = (label: string) => {
    binding(label)?.action(ctx);
    refocus();
  };
  const select = (name: string, label: string, value: string, options: { value: string; label: string }[], onChange: (value: string) => void) => (
    <select className={`ps-select ps-select-${name}`} aria-label={label} title={label} value={value} disabled={!editable} onChange={(e) => { onChange(e.target.value); refocus(); }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  const popover = (name: PopoverName, label: string, text: string) => (
    <Btn label={label} title={tip(label, label)} popoverFor={name} onClick={() => props.onPopover(name)}>{text}</Btn>
  );

  return (
    <ButtonCtx.Provider value={{ editable, run }}>
    <div className="ps-toolbar" role="toolbar" aria-label="Score editing">
      <Group name="history">
        <Btn label="Undo" disabled={!canUndo}>↶</Btn>
        <Btn label="Redo" disabled={!canRedo}>↷</Btn>
      </Group>
      <Group name="entry">
        <Btn label="Toggle note entry" active={cursor.mode === 'enter'}>{cursor.mode === 'enter' ? 'Entry' : 'Select'}</Btn>
      </Group>
      <Group name="duration">
        {DURATIONS.map((d) => (
          <Btn key={d.base} label={d.label} active={cursor.duration.base === d.base} onClick={() => { store.dispatch(setCursorDuration, { duration: { base: d.base, dots: 0 } }, { record: false }); refocus(); }}>
            <span className="ps-glyph">{d.glyph}</span>
          </Btn>
        ))}
        <Btn label="Toggle dot">.</Btn>
        <Btn label="Rest">Rest</Btn>
      </Group>
      <Group name="edit">
        <Btn label="Tie">Tie</Btn>
        <Btn label="Slur">Slur</Btn>
        <Btn label="Staccato">Stacc.</Btn>
        <Btn label="Tenuto">Ten.</Btn>
        <Btn label="Accent">&gt;</Btn>
        <Btn label="Marcato">^</Btn>
        <Btn label="Tuplet (3)">3</Btn>
        {select('beams', 'Beam grouping', '', [{ value: '', label: 'Beams…' }, { value: '0', label: 'Automatic' }, { value: '2', label: 'In 2s' }, { value: '3', label: 'In 3s' }, { value: '4', label: 'In 4s' }], (v) => {
          const group = Number(v);
          if (!v) return;
          if (group) store.dispatch(setBeamGroup, { measureId, staff: cursor.staff, voice: cursor.voice, group });
          else store.dispatch(autoBeamSequence, { partId: cursor.partId, measureId, staff: cursor.staff, voice: cursor.voice });
        })}
      </Group>
      <Group name="score">
        {popover('key', 'Key signature', 'Key')}
        {popover('time', 'Time signature', 'Time')}
        {popover('clef', 'Clef', 'Clef')}
        {select('barline', 'Barline', g?.barline ?? 'regular', BARLINES.map((b) => ({ value: b, label: `${b[0].toUpperCase()}${b.slice(1)} barline` })), (v) =>
          store.dispatch(setBarline, { measureId, barline: v as (typeof BARLINES)[number] }))}
        <Btn label="Repeat start" title="Repeat start" active={!!g?.repeatStart} onClick={() => { store.dispatch(toggleRepeatStart, { measureId }); refocus(); }}>|:</Btn>
        <Btn label="Repeat end" title="Repeat end" active={!!g?.repeatEnd} onClick={() => { store.dispatch(setRepeatEnd, { measureId, times: g?.repeatEnd ? null : undefined }); refocus(); }}>:|</Btn>
        {select('ending', 'Ending', g?.ending?.numbers.join(',') ?? '', ENDINGS, (v) => store.dispatch(setEnding, { measureId, numbers: ENDINGS.find((x) => x.value === v)?.numbers ?? null }))}
        {select('jump', 'Jump', jumpValue(g?.jump), JUMPS, (v) => store.dispatch(setJump, { measureId, jump: JUMPS.find((j) => j.value === v)?.jump ?? null }))}
      </Group>
      <Group name="marks">
        {MARKS.map((m) => (
          <Btn key={m.mark} label={m.label} title={m.label} active={!!g?.[m.mark]} onClick={() => { store.dispatch(toggleMark, { measureId, mark: m.mark }); refocus(); }}>{m.label}</Btn>
        ))}
        {select('dynamic', 'Dynamic', '', [{ value: '', label: 'Dynamic…' }, ...DYNAMICS.map((d) => ({ value: d, label: d }))], (v) => {
          if (v) store.dispatch(addDynamic, { anchor: { measureId, tick: Math.round(cursor.tick), staff: cursor.staff }, value: v as Dynamic, partId: cursor.partId });
        })}
        {popover('text', 'Text', 'Text')}
      </Group>
      <Group name="measures">
        <Btn label="Insert measure" title="Insert a measure after this one" onClick={() => { store.dispatch(insertMeasure, { afterMeasureId: measureId }); refocus(); }}>+ Bar</Btn>
        <Btn label="Delete measure" title="Delete this measure" disabled={document.global.measures.length <= 1} onClick={() => { store.dispatch(deleteMeasure, { measureId }); refocus(); }}>− Bar</Btn>
      </Group>
      <Group name="file">
        <button type="button" className={`ps-btn ps-btn-play ${props.playing ? 'ps-btn-active' : ''}`.trim()} aria-label={props.playing ? 'Stop' : 'Play'} title={tip(props.playing ? 'Stop' : 'Play from the cursor', 'Play')} onClick={props.onPlay}>
          {props.playing ? '■ Stop' : '▶ Play'}
        </button>
        <button type="button" className="ps-btn ps-btn-export" title="Download MusicXML" onClick={props.onExport}>Export MusicXML</button>
        <button type="button" className="ps-btn ps-btn-save" title="Download .pepperscore" disabled={!editable} onClick={props.onSave}>Save</button>
        <label className={`ps-btn ps-btn-open ${editable ? '' : 'ps-btn-disabled'}`.trim()} title="Open .pepperscore or MusicXML">
          Open
          <input className="ps-open-input" type="file" accept={OPEN_ACCEPT} hidden disabled={!editable} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) props.onOpen(file); }} />
        </label>
      </Group>
    </div>
    </ButtonCtx.Provider>
  );
}
