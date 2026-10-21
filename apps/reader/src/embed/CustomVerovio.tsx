import { PepperScore } from 'pepperscore';

declare global { interface Window { __verovioEvents: Array<[string, string?]> } }

/**
 * Host page for validation/embed.mjs: a snippet engraved by the Verovio at `verovioBaseUrl`, taken from the page's
 * `?verovio=` query (none: the copy shipped with pepperscore). Client-only: the query is only known in the browser.
 */
const tune = 'X:1\nT:Custom Verovio\nM:4/4\nL:1/4\nK:G\nG A B c | d B G2 |';
export default function CustomVerovio() {
  window.__verovioEvents ??= [];
  const base = new URLSearchParams(window.location.search).get('verovio') ?? undefined;
  return <div className="custom-verovio-test host-snippet">
    <PepperScore className="embed-verovio" chrome="none" abc={tune} verovioBaseUrl={base} onReady={() => window.__verovioEvents.push(['ready'])} onError={error => window.__verovioEvents.push(['error', error.message])} />
  </div>;
}
