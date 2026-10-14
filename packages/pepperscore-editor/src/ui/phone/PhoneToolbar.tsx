import { memo, useState, type Ref } from 'react';
import { useUi } from '../controls';
import type { PopoverName } from '../keymap';
import { useEditorStore } from '../useEditorStore';
import { InlineStrip } from './InlineStrip';
import { PhoneTabRows, type PhoneTab } from './PhoneTabs';

const TABS: [PhoneTab, string][] = [['value', 'Value'], ['pitch', 'Pitch'], ['bar', 'Bar'], ['score', 'Score'], ['layout', 'Layout']];

type Props = { ref?: Ref<HTMLDivElement>; popover: PopoverName | null; closePopover(): void; onReport(): void };

/**
 * The phone toolbar, pinned to the bottom of the editor: a tab strip (Value, Pitch, Bar, Score, Layout and the
 * score check) over at most two rows of 44px buttons; an open popover shows as an inline strip instead.
 */
export const PhoneToolbar = memo(function PhoneToolbar({ ref, popover, closePopover, onReport }: Props) {
  const { store, editable } = useUi();
  const [tab, setTab] = useState<PhoneTab>('value');
  const errors = useEditorStore(store, (s) => s.invariantErrors.length);
  return (
    <div ref={ref} className="ps-ptoolbar" role="toolbar" aria-label="Editing tools">
      <div className="ps-ptabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" data-tab={id} aria-selected={tab === id} className={`ps-ptab ${tab === id ? 'is-on' : ''}`.trim()} onClick={() => { setTab(id); if (popover) closePopover(); }}>{label}</button>
        ))}
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
