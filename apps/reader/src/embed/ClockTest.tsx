import { useRef } from 'react';
import { PepperScore, type PepperScoreHandle } from 'pepperscore';

const ASSETS = '/custom-assets';
const tune = (title: string, bars: number) => `X:1\nT:${title}\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\n${Array.from({ length: bars }, (_, i) => (i % 2 ? 'E D C D |' : 'C E G E |')).join(' ')}`;
type Events = Array<[string, string, number?]>;
declare global { interface Window { __clockEvents: Events; __clockRefs: Record<string, React.RefObject<PepperScoreHandle | null>> } }

/** Host page for validation/clock-embed.mjs: C is a self-driven, silent (audio={false}) minimal snippet. */
export default function ClockTest() {
  const refs = { c: useRef<PepperScoreHandle>(null) };
  if (typeof window !== 'undefined') { window.__clockEvents ??= []; window.__clockRefs = refs; }
  const log = (who: string) => ({
    onSeek: (seconds: number) => window.__clockEvents.push([who, 'seek', seconds]),
    onTimeUpdate: (seconds: number) => window.__clockEvents.push([who, 'time', seconds]),
    onPlay: () => window.__clockEvents.push([who, 'play']),
    onStop: () => window.__clockEvents.push([who, 'stop']),
    onError: (error: Error) => window.__clockEvents.push([who, `error: ${error.message}`]),
  });
  return <div className="clock-test">
    <div className="host-snippet clock-box-c"><PepperScore ref={refs.c} className="clock-c" chrome="minimal" audio={false} abc={tune('Silent self-driven', 8)} ariaLabel="Silent self-driven" assetBaseUrl={ASSETS} {...log('c')} /></div>
  </div>;
}
