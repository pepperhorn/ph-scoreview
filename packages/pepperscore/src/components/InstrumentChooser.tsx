// The instrument switch's chooser: "As written" then the given instruments (icon and short name), the range level
// (Beginner / Intermediate / Advanced) and the Fit to range toggle. Shared by the reader's mixer picker and the embed
// switcher (`compact`). It only reports choices; the reader holds the switch state (instrument-switch-state.ts).
import { Music2 } from 'lucide-react';
import { instrumentName, LEVELS, type InstrumentId, type Level } from '../lib/instrument-model';
import { instrumentDetails } from '../lib/score';

export const LEVEL_NAMES: Record<Level, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

export type InstrumentChooserProps = {
  instruments: InstrumentId[];
  /** The instrument shown; undefined = as written. */
  current: InstrumentId | undefined;
  level: Level;
  autoRange: boolean;
  onInstrument(id: InstrumentId | undefined): void;
  onLevel(level: Level): void;
  onAutoRange(on: boolean): void;
  /** Smaller options in a list (the embed switcher). */
  compact?: boolean;
  /** The "As written" option's icon (the part's own instrument); a note glyph when absent. */
  asWrittenIcon?: string;
};

export default function InstrumentChooser({ instruments, current, level, autoRange, onInstrument, onLevel, onAutoRange, compact, asWrittenIcon }: InstrumentChooserProps) {
  const option = (id: InstrumentId | undefined, label: string, icon: React.ReactNode) => (
    <button key={id ?? 'as-written'} type="button" className={`instrument-chooser-option ${id ? `instrument-chooser-option-${id}` : 'instrument-chooser-as-written'} ${current === id ? 'is-selected' : ''}`}
      aria-pressed={current === id} onClick={() => onInstrument(id)}>
      {icon}<span className="instrument-chooser-name">{label}</span>
    </button>
  );
  return (
    <div className={`instrument-chooser ${compact ? 'is-compact' : ''}`}>
      <div className="instrument-chooser-options" role="group" aria-label="Instrument">
        {option(undefined, 'As written', asWrittenIcon ? <img className="instrument-chooser-icon" src={asWrittenIcon} alt=""/> : <Music2 className="instrument-chooser-icon" size={compact ? 18 : 24} aria-hidden="true"/>)}
        {instruments.map(id => option(id, instrumentName(id), <img className="instrument-chooser-icon" src={instrumentDetails(id).icon} alt=""/>))}
      </div>
      <div className="instrument-chooser-settings">
        <div className="font-toggle instrument-level" role="group" aria-label="Range level">
          {LEVELS.map(item => <button key={item} type="button" className={`instrument-level-option ${level === item ? 'is-selected' : ''}`} aria-pressed={level === item} onClick={() => onLevel(item)}>{LEVEL_NAMES[item]}</button>)}
        </div>
        <div className="instrument-fit-toggle">
          <span className="instrument-fit-label">Fit to range</span>
          <button type="button" className={`ps-switch instrument-fit-switch ${autoRange ? 'is-on' : ''}`} role="switch" aria-label="Fit to range" aria-checked={autoRange} onClick={() => onAutoRange(!autoRange)}/>
        </div>
      </div>
    </div>
  );
}
