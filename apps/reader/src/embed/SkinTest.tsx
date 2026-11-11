import { useEffect, useState } from 'react';
import { PepperScore, CRF_PITCH_COLOURS, mergeSkins, THEME_TOKENS, BAR_ITEM_IDS, type PepperScoreSkin, type PepperScoreControls, type PepperScoreSettings } from 'pepperscore';

// These compile-time assertions are also checked by the reader's normal tsc check.
const badToken: PepperScoreSkin = { theme: {
  // @ts-expect-error Unknown theme role
  acccent: 'red',
} };
const badBar: PepperScoreSkin = { bar: [
  // @ts-expect-error Unknown bar id
  'paly',
] };
void badToken; void badBar;
const blue: PepperScoreSkin = { theme: { accent: 'var(--accent-ink)', focusRing: 'var(--accent-ring)', accentWash: 'var(--accent-wash)', accentWashStrong: 'var(--accent-wash-strong)' }, pitchColours: CRF_PITCH_COLOURS };
declare global {
  interface Window { __skin: { setSkin: (skin?: PepperScoreSkin) => void; setControls: (controls: PepperScoreControls) => void; tokens: typeof THEME_TOKENS; bars: typeof BAR_ITEM_IDS; renders: number; plays: number; stops: number; time: number; setAbc: (abc: string) => void; setSettings: (settings: PepperScoreSettings) => void } }
}
const barSkin = mergeSkins(blue, { bar: ['play', 'tempo', 'instrumentSwitch', 'noteNames', 'counts', 'chordSymbols', 'options'] });
export default function SkinTest() {
  const [abc, setAbc] = useState('X:1\nT:Skin fixture\nM:4/4\nL:1/4\nK:C\n[CEG] [CEG] [CEG] [CEG] | [FAC] [FAC] [FAC] [FAC] |');
  const [settings, setSettings] = useState<PepperScoreSettings>({});
  const [controls, setControls] = useState<PepperScoreControls>({});
  const [skin, setSkin] = useState<PepperScoreSkin | undefined>(mergeSkins(blue));
  useEffect(() => { if (new URLSearchParams(window.location.search).has('bar')) setSkin(barSkin); }, []);
  if (typeof window !== 'undefined') window.__skin = { setSkin, setControls, setAbc, setSettings, plays: window.__skin?.plays ?? 0, stops: window.__skin?.stops ?? 0, time: window.__skin?.time ?? 0, tokens: THEME_TOKENS, bars: BAR_ITEM_IDS, renders: window.__skin?.renders ?? 0 };
  return <div className="skin-host" style={{ '--accent-ink': '#235abc', '--accent-ring': '#377be8', '--accent-wash': '#e0ecff', '--accent-wash-strong': '#bbd4ff' } as React.CSSProperties}>
    <PepperScore className="skin-reader" skin={skin} controls={controls} abc={abc} settings={settings} onPlay={() => { window.__skin.plays++; }} onStop={() => { window.__skin.stops++; }} onTimeUpdate={event => { window.__skin.time = event; }} persist={typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('pdf') ? 'pdf-overlay-test' : typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('bar') ? 'skin-bar-test' : false} audio={false} height="650px" onRender={() => { window.__skin.renders++; }} />
    <PepperScore className="skin-minimal" chrome="minimal" skin={skin} controls={controls} persist={false} audio={false} abc={'X:1\nK:C\nC D E F |'} />
    <PepperScore className="skin-none" chrome="none" skin={skin} controls={controls} persist={false} abc={'X:1\nK:C\nC D E F |'} />
  </div>;
}
