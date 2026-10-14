import { binding } from './controls';
import { Kbd } from './icons';
import { describeKey } from './keymap';

const key = (label: string) => {
  const b = binding(label);
  return b ? describeKey(b).split(' / ')[0] : '';
};
const range = (from: string, to: string) => `${key(from)}–${key(to)}`;

/** Six bindings from the keymap, so the strip follows any rebinding. */
export const HINTS: [keys: string, text: string][] = [
  [key('Toggle note entry'), 'Entry'],
  [range('Note A', 'Note G'), 'Pitch'],
  [range('32nd note', 'Whole note'), 'Duration'],
  [key('Accent'), 'Accent'],
  [key('Undo'), 'Undo'],
  [key('Play'), 'Play'],
];

/** Keyboard hints under the score. */
export function HintStrip() {
  return (
    <div className="ps-hints" aria-label="Keyboard hints">
      {HINTS.map(([keys, text]) => <span key={text} className="ps-hint"><Kbd>{keys}</Kbd><span className="ps-hint-text">{text}</span></span>)}
      <span className="ps-hint-caption">Popovers avoid the cursor bar</span>
    </div>
  );
}
