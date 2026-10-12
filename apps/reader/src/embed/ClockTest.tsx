import { useRef, useState } from 'react';
import { PepperScore, type ClockEvent, type ExternalClock, type PepperScoreHandle } from 'pepperscore';
import contract from '../../../../validation/fixtures/clock-contract.musicxml?raw';

const ASSETS = '/custom-assets';
const tune = (title: string, bars: number) => `X:1\nT:${title}\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\n${Array.from({ length: bars }, (_, i) => (i % 2 ? 'E D C D |' : 'C E G E |')).join(' ')}`;
type Listener = (event: ClockEvent) => void;
/** A clock the test moves by hand: seek/play/pause emit events; advance() only moves now() (read every frame while playing). */
function manualClock() {
  let time = 0, playing = false;
  const listeners = new Set<Listener>();
  const emit = (type: ClockEvent['type']) => listeners.forEach(listener => listener({ type, time }));
  const clock: ExternalClock = {
    now: () => time,
    get playing() { return playing; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return {
    clock,
    seek(seconds: number) { time = seconds; emit('seek'); },
    play() { playing = true; emit('play'); },
    pause() { playing = false; emit('pause'); },
    advance(seconds: number) { time = seconds; },
    listeners: () => listeners.size,
  };
}
const clocks = { a: manualClock(), b: manualClock() };
type Events = Array<[string, string, number?]>;
declare global { interface Window {
  __clock: typeof clocks; __clockEvents: Events; __clockRefs: Record<string, React.RefObject<PepperScoreHandle | null>>;
  __clockSetViewA(view: 'vertical' | 'endless'): void; __clockFreshA(on: boolean): void; __clockRerender(): void;
} }

/**
 * Host page for validation/clock-embed.mjs. A: clock-driven, chrome="none", the clock contract fixture (pickup, tempo
 * 120 → 60 → 180). B: clock-driven, Endless, 32 bars (follow). C: self-driven and silent (audio={false}).
 */
export default function ClockTest() {
  const [viewA, setViewA] = useState<'vertical' | 'endless'>('vertical');
  const [freshA, setFreshA] = useState(false);
  const [, setRenders] = useState(0);
  const refs = { a: useRef<PepperScoreHandle>(null), b: useRef<PepperScoreHandle>(null), c: useRef<PepperScoreHandle>(null) };
  if (typeof window !== 'undefined') {
    window.__clockEvents ??= [];
    window.__clock = clocks; window.__clockRefs = refs;
    window.__clockSetViewA = setViewA; window.__clockFreshA = setFreshA; window.__clockRerender = () => setRenders(count => count + 1);
  }
  const log = (who: string) => ({
    onSeek: (seconds: number) => window.__clockEvents.push([who, 'seek', seconds]),
    onTimeUpdate: (seconds: number) => window.__clockEvents.push([who, 'time', seconds]),
    onPlay: () => window.__clockEvents.push([who, 'play']),
    onStop: () => window.__clockEvents.push([who, 'stop']),
    onError: (error: Error) => window.__clockEvents.push([who, `error: ${error.message}`]),
  });
  // A careless host: a new adapter object on every render, wrapping the same clock (Review Focus 2).
  const clockA: ExternalClock = freshA
    ? { now: () => clocks.a.clock.now(), get playing() { return clocks.a.clock.playing; }, subscribe: listener => clocks.a.clock.subscribe(listener) }
    : clocks.a.clock;
  return <div className="clock-test">
    <div className="host-snippet clock-box-a"><PepperScore ref={refs.a} className="clock-a" chrome="none" audio={false} clock={clockA} view={viewA} musicXml={contract} ariaLabel="Clock contract" assetBaseUrl={ASSETS} {...log('a')} /></div>
    <div className="host-snippet clock-box-b"><PepperScore ref={refs.b} className="clock-b" chrome="none" clock={clocks.b.clock} view="endless" abc={tune('Clock follow', 32)} ariaLabel="Clock follow" assetBaseUrl={ASSETS} {...log('b')} /></div>
    <div className="host-snippet clock-box-c"><PepperScore ref={refs.c} className="clock-c" chrome="minimal" audio={false} abc={tune('Silent self-driven', 8)} ariaLabel="Silent self-driven" assetBaseUrl={ASSETS} {...log('c')} /></div>
  </div>;
}
