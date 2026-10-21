import { memo, useState, type Ref } from 'react';
import { useRun, useUi } from '../controls';
import type { PopoverName } from '../keymap';
import { useEditorStore } from '../useEditorStore';
import { InlineStrip } from './InlineStrip';
import { PhoneTabRows, type PhoneTab } from './PhoneTabs';

const TABS: [PhoneTab, string][] = [['value', 'Notes'], ['marks', 'Marks'], ['bar', 'Bar'], ['score', 'Score'], ['layout', 'Layout']];

type Props = { ref?: Ref<HTMLDivElement>; popover: PopoverName | null; closePopover(): void; onReport(): void };

/**
 * The phone toolbar, pinned to the bottom of the editor within thumb reach: the Entry/Edit mode switch (shown on
 * every tab and strip) and a tab strip (Notes, Marks, Bar, Score, Layout and the
 * score check) over rows of 44px buttons (Notes has three, the last a piano octave or letter buttons; the others at
 * most two); an open popover shows as an inline strip instead.
 */
export const PhoneToolbar = memo(function PhoneToolbar({ ref, popover, closePopover, onReport }: Props) {
  const { store, editable } = useUi();
  const [tab, setTab] = useState<PhoneTab>('value');
  const errors = useEditorStore(store, (s) => s.invariantErrors.length);
  const entry = useEditorStore(store, (s) => s.cursor.mode === 'enter');
  const run = useRun();
  return (
    <div ref={ref} className="ps-ptoolbar" role="toolbar" aria-label="Editing tools">
      <div className="ps-ptabs">
        <button
          type="button"
          className={`ps-btn ps-pmode ${entry ? 'is-entry' : 'is-edit'}`}
          aria-label="Toggle note entry"
          aria-pressed={entry}
          title={entry ? 'Entry: taps add notes (N switches to Edit)' : 'Edit: taps change the highlighted note (N switches to Entry)'}
          disabled={!editable}
          onClick={() => run('Toggle note entry')}
        >
          <span className="ps-mode-dot" /><span className="ps-pmode-text">{entry ? 'Entry' : 'Edit'}</span>
        </button>
        <div className="ps-ptabs-list" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" data-tab={id} aria-selected={tab === id} className={`ps-ptab ${tab === id ? 'is-on' : ''}`.trim()} onClick={() => { setTab(id); if (popover) closePopover(); }}>{label}</button>
          ))}
        </div>
        {errors ? (
          <button type="button" className="ps-btn ps-ptabs-check is-problem" title="Score check found problems: report this score" onClick={onReport}><span className="ps-status-dot" />{errors}</button>
        ) : (
          <span className="ps-ptabs-check" title="Score check: no problems"><span className="ps-status-dot" />OK</span>
        )}
      </div>
      <div className="ps-prows" role="tabpanel" aria-label={TABS.find(([id]) => id === tab)?.[1]}>
        {popover && editable ? <InlineStrip name={popover} store={store} onClose={closePopover} /> : <PhoneTabRows tab={tab} />}
      </div>
    </div>
  );
});
