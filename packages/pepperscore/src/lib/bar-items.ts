import type { ChromePreset, PepperScoreControls, ResolvedChrome } from './chrome';
import type { HeaderControlId } from './header-controls';
import { BAR_ITEM_IDS, type BarItemId, type PepperScoreSkin } from './skin.ts';

/** Public skin ids deliberately differ from the historical private header ids. */
export const BAR_HEADER_ID = {
  play: 'play', stop: 'stop', tempo: 'bpm', transpose: 'transpose', keyFlip: 'keyFlip', bars: 'bars',
  viewToggle: 'mode', tab: 'tab', zoom: 'staveScale', mixer: 'mixer', openFile: 'openFile',
  instrumentSwitch: 'instrumentSwitch', octaveTool: 'octaveTool', options: 'options',
  noteNames: 'noteNames', counts: 'counts', chordSymbols: 'chordSymbols', pitchColours: 'pitchColours', pdf: 'pdf',
} as const satisfies Record<BarItemId, HeaderControlId>;
export const BAR_CONTROL_GROUP: Record<BarItemId, keyof PepperScoreControls | null> = {
  play: 'transport', stop: 'transport', tempo: 'transport', transpose: 'transport', keyFlip: 'transport', bars: 'transport',
  viewToggle: 'viewToggle', tab: 'tabToggle', zoom: 'zoom', mixer: 'mixer', openFile: 'openFile',
  instrumentSwitch: 'instrumentSwitch', octaveTool: 'octaveTool', options: 'drawer',
  noteNames: null, counts: null, chordSymbols: null, pitchColours: null, pdf: 'pdf',
};

/** Null retains the legacy header. An empty array explicitly requests no bar. */
export function resolveBar(skin: PepperScoreSkin | undefined, preset: ChromePreset, controls: PepperScoreControls = {}): BarItemId[] | null {
  if (preset === 'none' || !skin?.bar) return null;
  return [...new Set(skin.bar)].filter(id => BAR_ITEM_IDS.includes(id) && (!BAR_CONTROL_GROUP[id] || controls[BAR_CONTROL_GROUP[id]!] !== false));
}

/** Called only by the component's development-gated effect. Resolution itself is pure. */
export function warnUnknownBar(skin?: PepperScoreSkin) {
  for (const id of new Set(skin?.bar ?? [])) {
    if (!BAR_ITEM_IDS.includes(id)) console.warn(`[pepperscore] Unknown bar item: ${id}`);
  }
}

/** Only the six missing drawer actions; null preserves the legacy drawer exactly. */
export function drawerExtras(bar: BarItemId[] | null, chrome: ResolvedChrome): BarItemId[] {
  if (bar === null) return chrome.pdf ? ['pdf'] : [];
  return (['stop', 'viewToggle', 'bars', 'zoom', 'mixer', 'openFile', 'pdf'] as const)
    .filter(id => chrome[BAR_CONTROL_GROUP[id]!] && !bar.includes(id));
}
