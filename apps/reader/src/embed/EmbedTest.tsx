import { useRef, useState } from 'react';
import { PepperScore, type PepperScoreControls, type PepperScoreHandle } from 'pepperscore';
import ensemble from '../../../../validation/fixtures/ensemble.musicxml?raw';

const ASSETS = '/custom-assets'; // no trailing slash on purpose (Review Focus 4)
const tune = (title: string, bars: number) => `X:1\nT:${title}\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\n${Array.from({ length: bars }, (_, i) => (i % 2 ? 'E D C D |' : 'C E G E |')).join(' ')}`;
const pianoSource = [{ id: 'embed-piano', kind: 'sample-pack' as const, url: '/embed-sounds/{name}.json', programs: [1] }];
type Events = Array<[string, string, unknown?]>;
type Who = 'full' | 'a' | 'b' | 'c' | 'none';
type View = 'vertical' | 'endless' | undefined;
declare global { interface Window { __embed: Record<string, unknown>; __events: Events } }

/**
 * Host page for validation/embed.mjs: one full reader in a 600px box, three minimal snippets and an engraving-only one,
 * all mounted at once (their imports and engravings share the Verovio worker, one channel each). The test drives the
 * page through `window.__embed`: the snippets' `view` (so every reader can re-engrave at once), B's `controls`, A's
 * ABC source, and removing any reader (mid-import included).
 */
export default function EmbedTest() {
  const [abcA, setAbcA] = useState(tune('Snippet A', 4));
  const [views, setViews] = useState<Record<'a' | 'b' | 'none', View>>({ a: undefined, b: undefined, none: 'endless' });
  const [controlsB, setControlsB] = useState<PepperScoreControls | undefined>(undefined);
  const [mounted, setMounted] = useState<Record<Who, boolean>>({ full: true, a: true, b: true, c: true, none: true });
  const refs = { full: useRef<PepperScoreHandle>(null), a: useRef<PepperScoreHandle>(null), b: useRef<PepperScoreHandle>(null), c: useRef<PepperScoreHandle>(null), none: useRef<PepperScoreHandle>(null) };
  const unmount = (who: Who) => setMounted(previous => ({ ...previous, [who]: false }));
  if (typeof window !== 'undefined') {
    window.__events ??= [];
    window.__embed = { refs, setAbcA, setViews, setControlsB, unmount, unmountNone: () => unmount('none') };
  }
  const log = (who: string) => ({
    onReady: (info: unknown) => window.__events.push([who, 'ready', info]),
    onPlay: () => window.__events.push([who, 'play']),
    onStop: () => window.__events.push([who, 'stop']),
    onError: (error: Error) => window.__events.push([who, 'error', error.message]),
  });
  return <div className="embed-test">
    {mounted.full && <div className="host-box embed-box-full"><PepperScore ref={refs.full} className="embed-full" height="fill" assetBaseUrl={ASSETS} settings={{ noteNames: false }} {...log('full')} /></div>}
    {mounted.a && <div className="host-snippet"><PepperScore ref={refs.a} className="embed-a" chrome="minimal" view={views.a} abc={abcA} assetBaseUrl={ASSETS} soundSources={pianoSource} settings={{ zoom: 1.5 }} {...log('a')} /></div>}
    {mounted.b && <div className="host-snippet"><PepperScore ref={refs.b} className="embed-b" chrome="minimal" view={views.b} controls={controlsB} musicXml={ensemble} height="200px" assetBaseUrl={ASSETS} {...log('b')} /></div>}
    {mounted.c && <div className="host-snippet"><PepperScore ref={refs.c} className="embed-c" chrome="minimal" musicXml="<score-partwise><part" assetBaseUrl={ASSETS} {...log('c')} /></div>}
    {mounted.none && <div className="host-snippet"><PepperScore ref={refs.none} className="embed-none" ariaLabel="Engraving-only example" chrome="none" view={views.none} abc={tune('Engraving only', 8)} assetBaseUrl={ASSETS} {...log('none')} /></div>}
  </div>;
}
