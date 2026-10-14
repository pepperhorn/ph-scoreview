import { setChordMode } from '../engine/commands/index';
import type { Cursor } from '../engine/types';
import { describeKey, KEYMAP, type KeyBinding, type KeyContext } from './keymap';
import { useEditorStore } from './useEditorStore';

const GROUPS = ['entry', 'duration', 'pitch', 'edit'] as const;
const SHORT: Record<string, string> = {
  'Toggle note entry': 'N', 'Select mode': 'Esc', 'Whole note': '𝅝', 'Half note': '𝅗𝅥', 'Quarter note': '♩', 'Eighth note': '♪', '16th note': '𝅘𝅥𝅯',
  '32nd note': '𝅘𝅥𝅰', Rest: 'Rest', 'Toggle dot': '.', 'Pitch up': '↑', 'Pitch down': '↓', 'Octave up': '8va', 'Octave down': '8vb', Tie: 'Tie',
  'Semitone up': '½↑', 'Semitone down': '½↓', Sharp: '♯', Flat: '♭', Natural: '♮',
  Slur: 'Slur', Staccato: '·', Tenuto: '–', Accent: '>', Marcato: '^', 'Tuplet (3)': '3', 'Tuplet (5)': '5', 'Tuplet (6)': '6',
  'Tuplet (7)': '7', 'Beam grouping 2/3/4/auto': 'Beam', 'Break beam': '/', Delete: 'Del', Undo: '↶', Redo: '↷',
};
const short = (b: KeyBinding) => SHORT[b.label] ?? b.label.replace(/^Note /, '');

/** Pressed state for the mode toggle and the entry duration; undefined for one-shot actions. */
function pressed(b: KeyBinding, cursor: Cursor): boolean | undefined {
  if (b.label === 'Toggle note entry') return cursor.mode === 'enter';
  if (b.group === 'duration' && b.label.endsWith(' note')) return b.label.toLowerCase() === `${cursor.duration.base} note`;
  return undefined;
}

/** Touch palette (shown on narrow containers): the keymap's entry, duration, pitch and edit bindings as 44px buttons, and the "Add to chord" toggle. */
export function Palette({ ctx, editable, refocus }: { ctx: KeyContext; editable: boolean; refocus(): void }) {
  const cursor = useEditorStore(ctx.store, (s) => s.cursor);
  return (
    <div className="ps-palette" role="toolbar" aria-label="Note entry palette">
      {GROUPS.map((group) => (
        <div key={group} className={`ps-palette-group ps-palette-${group}`} role="group" aria-label={group}>
          {KEYMAP.filter((b) => b.group === group).map((b) => {
            const on = pressed(b, cursor);
            return (
            <button
              key={b.label}
              type="button"
              className={`ps-btn ps-palette-btn ${on ? 'ps-btn-active' : ''}`.trim()}
              aria-label={b.label}
              aria-pressed={on}
              title={`${b.label} (${describeKey(b)})`}
              disabled={!editable}
              onClick={() => {
                b.action(ctx);
                refocus();
              }}
            >
              {short(b)}
            </button>
            );
          })}
        </div>
      ))}
      <div className="ps-palette-group ps-palette-chord" role="group" aria-label="chord">
        <button
          type="button"
          className={`ps-btn ps-palette-btn ps-palette-chord-toggle ${cursor.chord ? 'ps-btn-active' : ''}`.trim()}
          aria-label="Add to chord"
          aria-pressed={!!cursor.chord}
          title="Add to chord: note letters add to the chord"
          disabled={!editable}
          onClick={() => {
            ctx.store.dispatch(setChordMode, { on: !cursor.chord }, { record: false });
            refocus();
          }}
        >
          +Chord
        </button>
      </div>
    </div>
  );
}
