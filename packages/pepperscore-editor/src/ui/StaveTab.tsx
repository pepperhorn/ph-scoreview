import { useState } from 'react';
import { addDynamic, addText, setBeamGroup } from '../engine/commands/index';
import { findEvent } from '../engine/sequence-edit';
import type { Dynamic } from '../model/schema';
import { GlyphBtn, Row, Section, Seg, useDispatch, usePosition, useRun, useUi } from './controls';
import { SMUFL } from './icons';
import { autoBeamSequence, targetEvent } from './key-actions';
import { DYNAMICS } from './Popover';
import { useEditorStore } from './useEditorStore';

const ARTICULATIONS = [
  { label: 'Accent', value: 'accent', c: SMUFL.accent, alt: '>' },
  { label: 'Staccato', value: 'staccato', c: SMUFL.staccato, alt: '·' },
  { label: 'Tenuto', value: 'tenuto', c: SMUFL.tenuto, alt: '–' },
  { label: 'Marcato', value: 'marcato', c: SMUFL.marcato, alt: '^' },
] as const;
const TEXT_STYLES = [{ value: 'expression', label: 'Expr.' }, { value: 'plain', label: 'Plain' }, { value: 'tempo', label: 'Tempo' }] as const;
type TextStyle = (typeof TEXT_STYLES)[number]['value'];

/** Stave-level marks at the cursor: articulations on the target event, dynamics, text and beam grouping. */
export function StaveTab() {
  const { store, editable, refocus } = useUi();
  const run = useRun();
  const dispatch = useDispatch();
  const { cursor } = usePosition();
  const target = useEditorStore(store, (s) => {
    const id = targetEvent(s);
    return id ? findEvent(s.document, id)?.event : undefined;
  });
  const [text, setText] = useState('');
  const [style, setStyle] = useState<TextStyle>('expression');
  const anchor = { measureId: cursor.measureId, tick: Math.round(cursor.tick), staff: cursor.staff };
  return (
    <>
      <Section title="Articulations">
        <div className="ps-glyph-row ps-glyph-row-wrap">
          {ARTICULATIONS.map((a) => <GlyphBtn key={a.value} c={a.c} alt={a.alt} label={a.label} on={!!target?.articulations?.includes(a.value)} onClick={() => run(a.label)} />)}
        </div>
      </Section>
      <Section title="Dynamics">
        <div className="ps-glyph-row ps-glyph-row-wrap ps-dynamics">
          {DYNAMICS.map((d) => <GlyphBtn key={d} c={SMUFL[d]} alt={d} label={`Dynamic ${d}`} title={`Add ${d} at the cursor`} onClick={() => dispatch(addDynamic, { anchor, value: d as Dynamic, partId: cursor.partId })} />)}
        </div>
      </Section>
      <Section title="Text">
        <Row label="Style"><Seg<TextStyle> label="Text style" value={style} items={TEXT_STYLES.map((s) => ({ ...s }))} onSelect={setStyle} /></Row>
        <input
          className="ps-input ps-text-input"
          aria-label="Stave text"
          placeholder="Text at the cursor, Enter adds"
          value={text}
          disabled={!editable}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !text.trim()) return;
            store.dispatch(addText, { anchor, text: text.trim(), style, partId: cursor.partId });
            setText('');
            refocus();
          }}
        />
      </Section>
      <Section title="Beam group">
        <Seg
          label="Beam grouping"
          value={undefined}
          items={[{ value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }, { value: '0', label: 'Auto' }]}
          onSelect={(v) => {
            const group = Number(v);
            if (group) dispatch(setBeamGroup, { measureId: cursor.measureId, staff: cursor.staff, voice: cursor.voice, group });
            else dispatch(autoBeamSequence, { partId: cursor.partId, measureId: cursor.measureId, staff: cursor.staff, voice: cursor.voice });
          }}
        />
      </Section>
    </>
  );
}
