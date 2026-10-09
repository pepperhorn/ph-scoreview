import { PepperScore } from 'pepperscore';

declare global { interface Window { __missingEvents: Array<[string, string?]> } }

/**
 * Host page for validation/embed.mjs: a snippet whose assetBaseUrl has nothing behind it (every font and sound 404s, as
 * the default CDN URL does before the sounds packages are published). Engraving still works and playback runs silently.
 */
const tune = 'X:1\nT:Missing assets\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\n!f! C E G E | D F A F | !p! E G c G | c4 |';
export default function MissingAssets() {
  if (typeof window !== 'undefined') window.__missingEvents ??= [];
  const log = (kind: string) => (error?: Error) => window.__missingEvents.push([kind, error?.message]);
  return <div className="missing-assets-test host-snippet">
    <PepperScore className="embed-missing" chrome="minimal" abc={tune} assetBaseUrl="/missing-assets/" onPlay={log('play')} onStop={log('stop')} onError={log('error')} />
  </div>;
}
