/** Chrome presets (docs/specs/pepperscore-embeddable-component.md, "Chrome presets") and per-control overrides. No runtime imports. */
export type ChromePreset = 'full' | 'minimal' | 'none';
export type PepperScoreControls = Partial<Record<'mixer' | 'openFile' | 'drawer' | 'transport' | 'viewToggle' | 'zoom' | 'tabToggle' | 'instrumentSwitch' | 'octaveTool', boolean>>;
export type ResolvedChrome = {
  header: boolean; transport: boolean; viewToggle: boolean; openFile: boolean; mixer: boolean; drawer: boolean; zoom: boolean;
  /** The Notation / TAB / Both switch (shown only for a score with a stave that can take TAB). */
  tabToggle: boolean;
  /** The instrument switcher (instrument, level and fit to range per part). */
  instrumentSwitch: boolean;
  /** The reader's octave tool (move notes or passages by an octave). */
  octaveTool: boolean;
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
export function resolveChrome(preset: ChromePreset = 'full', controls: PepperScoreControls = {}): ResolvedChrome {
  const on = (key: keyof PepperScoreControls) => controls[key] ?? preset === 'full';
  const transport = on('transport'), viewToggle = on('viewToggle'), openFile = on('openFile'), mixer = on('mixer'), drawer = on('drawer'), zoom = on('zoom'), tabToggle = on('tabToggle');
  const instrumentSwitch = on('instrumentSwitch'), octaveTool = on('octaveTool');
  return {
    header: transport || viewToggle || openFile || mixer || zoom || tabToggle,
    transport, viewToggle, openFile, mixer, drawer, zoom, tabToggle, instrumentSwitch, octaveTool,
    compactPlay: preset === 'minimal' && !transport,
    playhead: preset !== 'none' || transport,
    partControls: mixer,
    audio: preset !== 'none' || transport,
  };
}
