import { useEffect, useState } from 'react';
import { PepperScore, CRF_PITCH_COLOURS, mergeSkins, THEME_TOKENS, BAR_ITEM_IDS, type PepperScoreSkin, type PepperScoreControls } from 'pepperscore';

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
  interface Window { __skin: { setSkin: (skin?: PepperScoreSkin) => void; setControls: (controls: PepperScoreControls) => void; tokens: typeof THEME_TOKENS; bars: typeof BAR_ITEM_IDS; renders: number } }
}
const barSkin = mergeSkins(blue, { bar: ['play', 'tempo', 'instrumentSwitch', 'noteNames', 'counts', 'chordSymbols', 'options'] });
export default function SkinTest() {
  const [controls, setControls] = useState<PepperScoreControls>({});
  const [skin, setSkin] = useState<PepperScoreSkin | undefined>(mergeSkins(blue));
  useEffect(() => { if (new URLSearchParams(window.location.search).has('bar')) setSkin(barSkin); }, []);
  if (typeof window !== 'undefined') window.__skin = { setSkin, setControls, tokens: THEME_TOKENS, bars: BAR_ITEM_IDS, renders: window.__skin?.renders ?? 0 };
  return <div className="skin-host" style={{ '--accent-ink': '#235abc', '--accent-ring': '#377be8', '--accent-wash': '#e0ecff', '--accent-wash-strong': '#bbd4ff' } as React.CSSProperties}>
    <PepperScore className="skin-reader" skin={skin} controls={controls} abc={'X:1\nT:Skin fixture\nM:4/4\nL:1/4\nK:C\n[CEG] [CEG] [CEG] [CEG] | [FAC] [FAC] [FAC] [FAC] |'} persist={typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('bar') ? 'skin-bar-test' : false} audio={false} height="650px" onRender={() => { window.__skin.renders++; }} />
    <PepperScore className="skin-minimal" chrome="minimal" skin={skin} controls={controls} persist={false} audio={false} abc={'X:1\nK:C\nC D E F |'} />
    <PepperScore className="skin-none" chrome="none" skin={skin} controls={controls} persist={false} abc={'X:1\nK:C\nC D E F |'} />
  </div>;
}
