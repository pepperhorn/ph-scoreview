import { useState, type KeyboardEvent } from 'react';
import { setTempo } from '../engine/commands/index';
import type { EditorStore } from '../engine/store';
import type { Document } from '../model/schema';
import { Glyph, SMUFL } from './icons';

/** The tempo in force at bar `index`. */
export function tempoAt(doc: Document, index: number) {
  for (let i = index; i >= 0; i--) if (doc.global.measures[i]?.tempo) return doc.global.measures[i].tempo;
  return undefined;
}

/**
 * Tempo text and quarter-note BPM for the cursor bar, applied on Enter or blur (never per keystroke). A blank
 * BPM removes this bar's tempo change; an edit where an earlier tempo applies adds a change here.
 */
export function TempoFields({ store, document, measureId, index, editable, onDone }: { store: EditorStore; document: Document; measureId: string; index: number; editable: boolean; onDone?(): void }) {
  const tempo = tempoAt(document, index);
  const [text, setText] = useState(tempo?.text ?? '');
  const [bpm, setBpm] = useState(tempo ? String(tempo.bpm) : '');
  const apply = () => {
    const value = Number(bpm);
    if (!bpm.trim()) {
      store.dispatch(setTempo, { measureId, tempo: null });
      return;
    }
    if (!Number.isFinite(value) || value <= 0 || value > 400) {
      setBpm(tempo ? String(tempo.bpm) : '');
      return;
    }
    if (Math.round(value) === tempo?.bpm && text.trim() === (tempo.text ?? '')) return; // unchanged: no change at this bar
    store.dispatch(setTempo, { measureId, tempo: { bpm: Math.round(value), unit: tempo?.unit ?? 'quarter', ...(text.trim() ? { text: text.trim() } : {}) } });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    apply();
    onDone?.();
  };
  return (
    <div className="ps-tempo" data-ps-target="tempo">
      <input className="ps-input ps-tempo-text" aria-label="Tempo text" placeholder="Tempo text" value={text} disabled={!editable} onChange={(e) => setText(e.target.value)} onBlur={() => bpm.trim() && apply()} onKeyDown={onKeyDown} />
      <span className="ps-tempo-mm">
        <Glyph c={SMUFL.quarter} alt="♩" className="ps-glyph-mm" /> =
        <input className="ps-input ps-tempo-bpm" aria-label="Beats per minute" inputMode="numeric" value={bpm} disabled={!editable} onChange={(e) => setBpm(e.target.value)} onBlur={apply} onKeyDown={onKeyDown} />
      </span>
    </div>
  );
}
