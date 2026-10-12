import { PepperScore } from 'pepperscore';

const ASSETS = '/custom-assets';
const tune = (title: string, bars: number) => `X:1\nT:${title}\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\n${Array.from({ length: bars }, (_, i) => (i % 2 ? 'E D C D |' : 'C E G E |')).join(' ')}`;

/**
 * Host page for validation/layout.mjs: wide (1100px) minimal snippets at natural height, with Auto and explicit bars per
 * line, a minimal snippet with a header (view toggle), and a full reader with a source in a fixed-height box. With
 * visible (non-overlay) scrollbars none of them may keep re-engraving.
 */
export default function LayoutTest() {
  return <div className="layout-test">
    <div className="host-wide"><PepperScore className="layout-auto" chrome="minimal" ariaLabel="Auto bars" abc={tune('Auto bars', 8)} assetBaseUrl={ASSETS} /></div>
    <div className="host-wide"><PepperScore className="layout-bars4" chrome="minimal" ariaLabel="Four bars per line" abc={tune('Four bars per line', 8)} settings={{ barsPerLine: 4 }} assetBaseUrl={ASSETS} /></div>
    <div className="host-wide"><PepperScore className="layout-bars2" chrome="minimal" ariaLabel="Two bars per line" abc={tune('Two bars per line', 8)} settings={{ barsPerLine: 2 }} assetBaseUrl={ASSETS} /></div>
    <div className="host-wide"><PepperScore className="layout-bars8" chrome="minimal" ariaLabel="Eight bars per line" abc={tune('Eight bars per line', 16)} settings={{ barsPerLine: 8 }} assetBaseUrl={ASSETS} /></div>
    <div className="host-wide"><PepperScore className="layout-bars2-zoom" chrome="minimal" ariaLabel="Two bars per line at a set zoom" abc={tune('Two bars at a set zoom', 8)} settings={{ barsPerLine: 2, zoom: .6 }} assetBaseUrl={ASSETS} /></div>
    <div className="host-wide"><PepperScore className="layout-header" chrome="minimal" controls={{ viewToggle: true }} ariaLabel="Snippet with a view toggle" abc={tune('Snippet with a view toggle', 4)} assetBaseUrl={ASSETS} /></div>
    <div className="host-wide host-tall"><PepperScore className="layout-full" height="fill" ariaLabel="Full reader" abc={tune('Full reader', 24)} persist={false} assetBaseUrl={ASSETS} /></div>
  </div>;
}
