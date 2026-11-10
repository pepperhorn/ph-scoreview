import { deleteMeasure, insertMeasure, setBarline, setClef, setEnding, setJump, setRepeatEnd, setTime, toggleMark, toggleRepeatStart } from '../engine/commands/index';
import { effectiveClef, effectiveKey, effectiveTime } from '../model/query';
import type { Clef, GlobalMeasure } from '../model/schema';
import { GlyphBtn, Row, Section, Seg, useDispatch, usePosition, useUi } from './controls';
import { Icon, SMUFL } from './icons';
import { ENDINGS, JUMPS, jumpValue, keyName } from './Popover';
import { TempoFields } from './TempoFields';

type Barline = NonNullable<GlobalMeasure['barline']>;
export const BARLINES: { value: Barline; label: string; c?: string; alt: string }[] = [
  { value: 'regular', label: 'Regular barline', c: SMUFL.barSingle, alt: '|' },
  { value: 'double', label: 'Double barline', c: SMUFL.barDouble, alt: '||' },
  { value: 'final', label: 'Final barline', c: SMUFL.barFinal, alt: '|‖' },
  { value: 'dashed', label: 'Dashed barline', c: SMUFL.barDashed, alt: '¦' },
  { value: 'invisible', label: 'Invisible barline', alt: 'None' },
];
export const CLEF_BUTTONS: { value: Clef; label: string; c: string; alt: string }[] = [
  { value: 'treble', label: 'Treble clef', c: SMUFL.gClef, alt: 'G' },
  { value: 'bass', label: 'Bass clef', c: SMUFL.fClef, alt: 'F' },
  { value: 'alto', label: 'Alto clef', c: SMUFL.cClef, alt: 'C' },
];
export const TIMES = ['4/4', '3/4', '6/8'] as const;
export const MARKS = [{ mark: 'segno', label: 'Segno', c: SMUFL.segno, alt: '𝄋' }, { mark: 'coda', label: 'Coda', c: SMUFL.coda, alt: '𝄌' }, { mark: 'toCoda', label: 'To Coda', alt: 'To ⊕' }, { mark: 'fine', label: 'Fine', alt: 'Fine' }] as const;

/** Score-wide settings at the cursor bar: key, time, clef, barlines and form, tempo, insert and delete bars. */
export function ScoreTab() {
  const { store, editable, togglePopover, refocus } = useUi();
  const dispatch = useDispatch();
  const { document, cursor, index, g } = usePosition();
  const measureId = cursor.measureId;
  const key = effectiveKey(document, index);
  const time = effectiveTime(document, index);
  const timeValue = `${time.count}/${time.unit}`;
  const part = document.parts.find((p) => p.id === cursor.partId);
  const clef = part ? effectiveClef(part, index, cursor.staff) : undefined;
  return (
    <>
      <Section title="Key & time">
        <Row label="Key">
          <button type="button" className="ps-btn ps-select ps-select-button" aria-label="Edit key signature" data-ps-target="key" data-ps-popover-for="key" disabled={!editable} onClick={() => togglePopover('key')}>
            <span className="ps-select-value">{keyName(key.fifths, key.mode ?? 'major')}</span><Icon name="chevron" size={14} />
          </button>
        </Row>
        <Row label="Time" target="time">
          <Seg
            label="Time signature"
            value={(TIMES as readonly string[]).includes(timeValue) ? timeValue : 'more'}
            items={[...TIMES.map((t) => ({ value: t as string, label: t })), { value: 'more', label: '…', title: 'Other time signature' }]}
            onSelect={(v) => {
              if (v === 'more') return togglePopover('time');
              const [count, unit] = v.split('/').map(Number);
              dispatch(setTime, { measureId, time: { count, unit: unit as 4 | 8 } });
            }}
          />
        </Row>
        <Row label="Clef">
          <div className="ps-glyph-row" data-ps-target="clef">
            {CLEF_BUTTONS.map((c) => <GlyphBtn key={c.value} c={c.c} alt={c.alt} label={c.label} on={clef === c.value} onClick={() => part && dispatch(setClef, { partId: part.id, measureId, staff: cursor.staff, clef: c.value })} />)}
            <GlyphBtn alt="…" text label="Other clef" onClick={() => togglePopover('clef')} />
          </div>
        </Row>
      </Section>
      <Section title="Barlines & form">
        <Row label="Barline">
          <div className="ps-glyph-row">
            {BARLINES.map((b) => <GlyphBtn key={b.value} c={b.c} alt={b.alt} text={!b.c} bar label={b.label} on={(g?.barline ?? 'regular') === b.value} onClick={() => dispatch(setBarline, { measureId, barline: b.value })} />)}
          </div>
        </Row>
        <Row label="Repeat">
          <div className="ps-glyph-row">
            <GlyphBtn c={SMUFL.repeatLeft} alt="|:" bar label="Repeat start" on={!!g?.repeatStart} onClick={() => dispatch(toggleRepeatStart, { measureId })} />
            <GlyphBtn c={SMUFL.repeatRight} alt=":|" bar label="Repeat end" on={!!g?.repeatEnd} onClick={() => dispatch(setRepeatEnd, { measureId, times: g?.repeatEnd ? null : undefined })} />
          </div>
        </Row>
        <Row label="Ending">
          <Seg
            label="Ending"
            value={g?.ending?.numbers.join(',') ?? ''}
            items={ENDINGS.map((e) => ({ value: e.value, label: e.value ? `${e.value.replace(',', '–')}.` : 'None', title: e.label }))}
            onSelect={(v) => dispatch(setEnding, { measureId, numbers: ENDINGS.find((x) => x.value === v)?.numbers ?? null })}
          />
        </Row>
        <Row label="Jump">
          <select className="ps-select ps-select-jump" aria-label="Jump" value={jumpValue(g?.jump)} disabled={!editable} onChange={(e) => dispatch(setJump, { measureId, jump: JUMPS.find((j) => j.value === e.target.value)?.jump ?? null })}>
            {JUMPS.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
          </select>
        </Row>
        <Row label="Marks">
          <div className="ps-glyph-row ps-glyph-row-wrap">
            {MARKS.map((m) => <GlyphBtn key={m.mark} c={'c' in m ? m.c : undefined} alt={m.alt} text={!('c' in m)} label={m.label} on={!!g?.[m.mark]} onClick={() => dispatch(toggleMark, { measureId, mark: m.mark })} />)}
          </div>
        </Row>
      </Section>
      <Section title="Tempo">
        <TempoFields key={`${measureId}:${JSON.stringify(g?.tempo ?? null)}`} store={store} document={document} measureId={measureId} index={index} editable={editable} onDone={refocus} />
      </Section>
      <Section title="Bars" className="ps-insp-bars">
        <div className="ps-bar-actions">
          <button type="button" className="ps-btn ps-btn-ghost" aria-label="Insert measure" title="Insert a bar after this one" disabled={!editable} onClick={() => dispatch(insertMeasure, { afterMeasureId: measureId })}><Icon name="plus" size={14} />Insert bar</button>
          <button type="button" className="ps-btn ps-btn-ghost ps-btn-danger" aria-label="Delete measure" title="Delete this bar" disabled={!editable || document.global.measures.length <= 1} onClick={() => dispatch(deleteMeasure, { measureId })}><Icon name="minus" size={14} />Delete bar</button>
        </div>
      </Section>
    </>
  );
}
