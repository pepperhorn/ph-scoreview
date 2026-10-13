import { useEffect, useRef, useState, type ReactNode } from 'react';
import { addDynamic, addText, setClef, setEnding, setJump, setKey, setTime } from '../engine/commands/index';
import type { EditorStore } from '../engine/store';
import { effectiveClef, effectiveKey, effectiveTime, measureIndex } from '../model/query';
import type { Clef, Dynamic, Jump } from '../model/schema';
import type { PopoverName } from './keymap';
import { useEditorStore } from './useEditorStore';

const MAJOR = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const MINOR = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];
export const FIFTHS = Array.from({ length: 15 }, (_, i) => i - 7);
export const keyName = (fifths: number, mode: 'major' | 'minor' = 'major') =>
  `${(mode === 'minor' ? MINOR : MAJOR)[fifths + 7]} ${mode}`;
export const CLEFS: { value: Clef; label: string }[] = [
  { value: 'treble', label: 'Treble' }, { value: 'bass', label: 'Bass' }, { value: 'alto', label: 'Alto' },
  { value: 'tenor', label: 'Tenor' }, { value: 'treble8vb', label: 'Treble 8vb' }, { value: 'percussion', label: 'Percussion' },
];
export const DYNAMICS: Dynamic[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'sfz', 'fp'];
export const JUMPS: { value: string; label: string; jump: Jump | null }[] = [
  { value: '', label: 'No jump', jump: null },
  { value: 'dc-end', label: 'D.C.', jump: { type: 'dc', target: 'end' } },
  { value: 'dc-fine', label: 'D.C. al Fine', jump: { type: 'dc', target: 'fine' } },
  { value: 'dc-coda', label: 'D.C. al Coda', jump: { type: 'dc', target: 'coda' } },
  { value: 'ds-end', label: 'D.S.', jump: { type: 'ds', target: 'end' } },
  { value: 'ds-fine', label: 'D.S. al Fine', jump: { type: 'ds', target: 'fine' } },
  { value: 'ds-coda', label: 'D.S. al Coda', jump: { type: 'ds', target: 'coda' } },
];
export const jumpValue = (jump: Jump | undefined) => (jump ? `${jump.type}-${jump.target}` : '');
export const ENDINGS: { value: string; label: string; numbers: number[] | null }[] = [
  { value: '', label: 'No ending', numbers: null },
  { value: '1', label: 'Ending 1', numbers: [1] },
  { value: '2', label: 'Ending 2', numbers: [2] },
  { value: '1,2', label: 'Ending 1, 2', numbers: [1, 2] },
  { value: '3', label: 'Ending 3', numbers: [3] },
];
const TIME_UNITS = [1, 2, 4, 8, 16] as const;
const TEXT_STYLES = ['plain', 'expression', 'tempo'] as const;
const TITLES: Record<PopoverName, string> = {
  key: 'Key signature', time: 'Time signature', clef: 'Clef', dynamic: 'Dynamic', jump: 'Jump', ending: 'Ending', text: 'Text',
};

type Props = { name: PopoverName; store: EditorStore; onClose(): void };

/** Absolutely positioned panel with native controls; Escape or a click outside closes it. */
export function Popover({ name, store, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) onClose();
    };
    window.document.addEventListener('pointerdown', outside, true);
    return () => window.document.removeEventListener('pointerdown', outside, true);
  }, [onClose]);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('select, input')?.focus();
  }, [name]);
  return (
    <div
      ref={root}
      className={`ps-popover ps-popover-${name}`}
      role="dialog"
      aria-label={TITLES[name]}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="ps-popover-title">{TITLES[name]}</div>
      <PopoverBody name={name} store={store} onClose={onClose} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ps-popover-field">
      <span className="ps-popover-label">{label}</span>
      {children}
    </label>
  );
}

function PopoverBody({ name, store, onClose }: Props) {
  const document = useEditorStore(store, (s) => s.document);
  const cursor = useEditorStore(store, (s) => s.cursor);
  const index = Math.max(measureIndex(document, cursor.measureId), 0);
  const measureId = cursor.measureId;
  const anchor = { measureId, tick: Math.round(cursor.tick), staff: cursor.staff };
  const g = document.global.measures[index];
  const [text, setText] = useState('');
  const [style, setStyle] = useState<(typeof TEXT_STYLES)[number]>('plain');

  switch (name) {
    case 'key': {
      const key = effectiveKey(document, index);
      const mode = key.mode ?? 'major';
      return (
        <>
          <Field label="Key">
            <select className="ps-select ps-select-fifths" value={key.fifths} onChange={(e) => store.dispatch(setKey, { measureId, key: { fifths: Number(e.target.value), mode } })}>
              {FIFTHS.map((f) => <option key={f} value={f}>{keyName(f, mode)}</option>)}
            </select>
          </Field>
          <Field label="Mode">
            <select className="ps-select ps-select-mode" value={mode} onChange={(e) => store.dispatch(setKey, { measureId, key: { fifths: key.fifths, mode: e.target.value as 'major' | 'minor' } })}>
              <option value="major">Major</option>
              <option value="minor">Minor</option>
            </select>
          </Field>
        </>
      );
    }
    case 'time': {
      const time = effectiveTime(document, index);
      const apply = (count: number, unit: number) => {
        if (Number.isInteger(count) && count >= 1 && count <= 32) store.dispatch(setTime, { measureId, time: { count, unit: unit as (typeof TIME_UNITS)[number] } });
      };
      return (
        <>
          <Field label="Beats">
            <input className="ps-input ps-input-count" type="number" min={1} max={32} value={time.count} onChange={(e) => apply(Number(e.target.value), time.unit)} onKeyDown={(e) => e.key === 'Enter' && onClose()} />
          </Field>
          <Field label="Beat unit">
            <select className="ps-select ps-select-unit" value={time.unit} onChange={(e) => apply(time.count, Number(e.target.value))}>
              {TIME_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
        </>
      );
    }
    case 'clef': {
      const part = document.parts.find((p) => p.id === cursor.partId);
      if (!part) return null;
      return (
        <>
          {Array.from({ length: part.staves }, (_, i) => i + 1).map((staff) => (
            <Field key={staff} label={part.staves > 1 ? `Staff ${staff}` : 'Clef'}>
              <select className="ps-select ps-select-clef" value={effectiveClef(part, index, staff)} onChange={(e) => store.dispatch(setClef, { partId: part.id, measureId, staff, clef: e.target.value as Clef })}>
                {CLEFS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
          ))}
        </>
      );
    }
    case 'dynamic':
      return (
        <Field label="Dynamic at the cursor">
          <select className="ps-select ps-select-dynamic" value="" onChange={(e) => { store.dispatch(addDynamic, { anchor, value: e.target.value as Dynamic, partId: cursor.partId }); onClose(); }}>
            <option value="" disabled>Choose…</option>
            {DYNAMICS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
      );
    case 'jump':
      return (
        <Field label="Jump at the end of this bar">
          <select className="ps-select ps-select-jump" value={jumpValue(g?.jump)} onChange={(e) => { store.dispatch(setJump, { measureId, jump: JUMPS.find((j) => j.value === e.target.value)!.jump }); onClose(); }}>
            {JUMPS.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
          </select>
        </Field>
      );
    case 'ending':
      return (
        <Field label="Ending on this bar">
          <select className="ps-select ps-select-ending" value={g?.ending?.numbers.join(',') ?? ''} onChange={(e) => { store.dispatch(setEnding, { measureId, numbers: ENDINGS.find((x) => x.value === e.target.value)?.numbers ?? null }); onClose(); }}>
            {ENDINGS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        </Field>
      );
    case 'text':
      return (
        <>
          <Field label="Text">
            <input
              className="ps-input ps-input-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !text.trim()) return;
                store.dispatch(addText, { anchor, text: text.trim(), style, partId: cursor.partId });
                onClose();
              }}
            />
          </Field>
          <Field label="Style">
            <select className="ps-select ps-select-text-style" value={style} onChange={(e) => setStyle(e.target.value as (typeof TEXT_STYLES)[number])}>
              {TEXT_STYLES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </Field>
        </>
      );
  }
}
