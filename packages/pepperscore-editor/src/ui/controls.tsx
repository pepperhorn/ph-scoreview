import { createContext, useContext, type ReactNode } from 'react';
import type { EditorStore } from '../engine/store';
import type { Cursor } from '../engine/types';
import { measureTicks } from '../model/durations';
import { effectiveTime, measureIndex } from '../model/query';
import type { Document, GlobalMeasure } from '../model/schema';
import { Glyph } from './icons';
import { describeKey, KEYMAP, type KeyBinding, type KeyContext, type PopoverName } from './keymap';
import { useEditorStore } from './useEditorStore';

/** What every shell control needs: the store, the key context, editability and focus return. */
export type EditorUi = {
  store: EditorStore;
  ctx: KeyContext;
  editable: boolean;
  /** Returns keyboard focus to the editor after a control is used. */
  refocus(): void;
  /** Opens popover `name`, or closes it when it is open. */
  togglePopover(name: PopoverName): void;
  /** Scrolls the engraving to measure `index` (0-based); absent where there is no viewer. */
  scrollToMeasure?(index: number): void;
};
const UiContext = createContext<EditorUi | null>(null);
export const UiProvider = UiContext.Provider;
export function useUi(): EditorUi {
  const ui = useContext(UiContext);
  if (!ui) throw new Error('Editor controls need a UiProvider');
  return ui;
}

export const binding = (label: string): KeyBinding | undefined => KEYMAP.find((b) => b.label === label);
/** `title (keys)` for the binding labelled `label`, else `title`. */
export const tip = (title: string, label = title): string => {
  const b = binding(label);
  return b ? `${title} (${describeKey(b)})` : title;
};

/** Runs the keymap binding labelled `label`, then refocuses the editor. */
export function useRun(): (label: string) => void {
  const { ctx, refocus } = useUi();
  return (label) => {
    binding(label)?.action(ctx);
    refocus();
  };
}

/** Dispatches through the store, then refocuses the editor. */
export function useDispatch(): EditorStore['dispatch'] {
  const { store, refocus } = useUi();
  return (command, args, options) => {
    store.dispatch(command, args, options);
    refocus();
  };
}

export type Position = { document: Document; cursor: Cursor; index: number; g: GlobalMeasure | undefined; bars: number; beat: number; partName: string };

/** The cursor's bar: index, global measure, bar count, 1-based beat and part name. */
export function usePosition(): Position {
  const { store } = useUi();
  const document = useEditorStore(store, (s) => s.document);
  const cursor = useEditorStore(store, (s) => s.cursor);
  const index = Math.max(measureIndex(document, cursor.measureId), 0);
  const time = effectiveTime(document, index);
  const beatTicks = measureTicks(time) / time.count;
  return {
    document, cursor, index, g: document.global.measures[index], bars: document.global.measures.length,
    beat: Math.floor(cursor.tick / beatTicks) + 1, partName: document.parts.find((p) => p.id === cursor.partId)?.name ?? '',
  };
}

/** The cursor's bar (0-based) and the bar count, as primitives: a move within the bar re-renders nothing. */
export function useCursorBar(): { index: number; bars: number } {
  const { store } = useUi();
  const index = useEditorStore(store, (s) => Math.max(measureIndex(s.document, s.cursor.measureId), 0));
  const bars = useEditorStore(store, (s) => s.document.global.measures.length);
  return { index, bars };
}

/** The name of the cursor's part. */
export function useCursorPartName(): string {
  const { store } = useUi();
  return useEditorStore(store, (s) => s.document.parts.find((p) => p.id === s.cursor.partId)?.name ?? '');
}

/** The cursor's 1-based beat in its bar. */
export function useCursorBeat(): number {
  const { store } = useUi();
  return useEditorStore(store, (s) => {
    const time = effectiveTime(s.document, Math.max(measureIndex(s.document, s.cursor.measureId), 0));
    return Math.floor(s.cursor.tick / (measureTicks(time) / time.count)) + 1;
  });
}

export function Section({ title, className = '', children }: { title: string; className?: string; children: ReactNode }) {
  return <section className={`ps-insp-section ${className}`.trim()}><h4 className="ps-insp-title">{title}</h4>{children}</section>;
}
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="ps-insp-row"><span className="ps-insp-label">{label}</span><div className="ps-insp-control">{children}</div></div>;
}

/** A segmented control; `value` picks the lit item. */
export function Seg<T extends string>({ items, value, label, onSelect, className = '' }: { items: { value: T; label: ReactNode; title?: string }[]; value: T | undefined; label: string; onSelect(value: T): void; className?: string }) {
  const { editable } = useUi();
  return (
    <div className={`ps-seg ${className}`.trim()} role="group" aria-label={label}>
      {items.map((item) => (
        <button key={item.value} type="button" className={`ps-seg-item ${item.value === value ? 'is-on' : ''}`.trim()} aria-pressed={item.value === value} title={item.title} disabled={!editable} onClick={() => onSelect(item.value)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** A square glyph button (clefs, barlines, marks, articulations, dynamics). */
export function GlyphBtn({ c, alt, label, title, on, bar, text, onClick }: { c?: string; alt: string; label: string; title?: string; on?: boolean; bar?: boolean; text?: boolean; onClick(): void }) {
  const { editable } = useUi();
  return (
    <button type="button" className={`ps-btn ps-glyph-btn ${text ? 'ps-glyph-btn-text' : ''} ${on ? 'is-on' : ''}`.replace(/\s+/g, ' ').trim()} title={title ?? label} aria-label={label} aria-pressed={on ?? false} disabled={!editable} onClick={onClick}>
      {c ? <Glyph c={c} alt={alt} className={bar ? 'ps-glyph-bar' : ''} /> : alt}
    </button>
  );
}
