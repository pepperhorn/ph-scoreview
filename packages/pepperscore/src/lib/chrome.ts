import { BAR_CONTROL_GROUP } from './bar-items.ts';
import type { BarItemId } from './skin';
/** Chrome presets (docs/specs/pepperscore-embeddable-component.md, "Chrome presets") and per-control overrides. Pure data resolution, also loaded directly by Node validation. */
export type ChromePreset = 'full' | 'minimal' | 'none';
export type PepperScoreControls = Partial<Record<'mixer' | 'openFile' | 'drawer' | 'transport' | 'viewToggle' | 'zoom' | 'tabToggle' | 'instrumentSwitch' | 'octaveTool' | 'pdf', boolean>>;
export type ResolvedChrome = {
  header: boolean; transport: boolean; viewToggle: boolean; openFile: boolean; mixer: boolean; drawer: boolean; zoom: boolean;
  /** The Notation / TAB / Both switch (shown only for a score with a stave that can take TAB). */
  tabToggle: boolean;
  /** The instrument switcher (instrument, level and fit to range per part). */
  instrumentSwitch: boolean;
  /** The reader's octave tool (move notes or passages by an octave). */
  octaveTool: boolean;
  pdf: boolean;
  /** The overlaid play/stop button of `minimal`. */
  compactPlay: boolean;
  /** Playhead, note highlight and follow. */
  playhead: boolean;
  /** Part icons, instrument picker and stave eyes (they follow `mixer`). */
  partControls: boolean;
  /** Whether playback (and so any audio asset) can load at all. */
  audio: boolean;
};

/**
 * `transport` covers stop, play, BPM, transpose, key flip and bars; `viewToggle` the Vertical/Endless toggle; `openFile` the
 * Open button, file input, open dialog and reopen offer; `mixer` the mixer and the part icons / instrument picker / stave
 * eyes; `zoom` the stave-scale slider, pinch zoom and the page arrows row; `drawer` the bottom drawer and its handle;
 * `tabToggle` the Notation / TAB / Both switch (header and drawer); `instrumentSwitch` the instrument switcher;
 * `octaveTool` the octave tool. Each defaults to on for `full`, off otherwise.
 */
export function resolveChrome(preset: ChromePreset = 'full', controls: PepperScoreControls = {}, bar?: BarItemId[] | null, renderableBar: BarItemId[] | null | undefined = bar?.filter(id => id !== 'pitchColours')): ResolvedChrome {
  const composed = preset !== 'none' && Boolean(renderableBar?.length);
  const on = (key: keyof PepperScoreControls) => controls[key] ?? (preset === 'full' || (composed && Boolean(bar?.some(id => BAR_CONTROL_GROUP[id] === key))));
  const transport = on('transport'), viewToggle = on('viewToggle'), openFile = on('openFile'), mixer = on('mixer'), drawer = on('drawer'), zoom = on('zoom'), tabToggle = on('tabToggle');
  const instrumentSwitch = on('instrumentSwitch'), octaveTool = on('octaveTool'), pdf = on('pdf');
  return {
    header: composed ? Boolean(renderableBar?.length) : transport || viewToggle || openFile || mixer || zoom || tabToggle || pdf,
    transport, viewToggle, openFile, mixer, drawer, zoom, tabToggle, instrumentSwitch, octaveTool, pdf,
    compactPlay: preset === 'minimal' && !composed && !transport,
    playhead: preset !== 'none' || transport,
    partControls: mixer,
    audio: preset !== 'none' || transport,
  };
}
