import { PepperScore } from 'pepperscore';
import { useState } from 'react';
import ensemble from '../../../../validation/fixtures/ensemble.musicxml?raw';
import piano from '../../../../validation/fixtures/instrument-switch-piano.musicxml?raw';

/**
 * Host page for validation/embed.mjs: minimal snippets with the instrument switcher (`controls.instrumentSwitch`): the
 * grand-staff piano fixture, a piano and violin duo (two source parts), and the piano without the control.
 */
const violinPart = '<score-part id="PVn"><part-name>Violin</part-name></score-part>';
const violinMusic = '<part id="PVn"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>';
const duo = piano.replace('</part-list>', `${violinPart}</part-list>`).replace('</score-partwise>', `${violinMusic}</score-partwise>`);
const controls = { instrumentSwitch: true };
/**
 * `?wrap=a|button` adds a short multi-page reader inside a host link / role=button card (Space must still turn its page);
 * `?toggle` adds a reader whose switcher the host can remove (a button flips `controls.instrumentSwitch`).
 */
const query = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
export default function SwitchTest() {
  const [switcher, setSwitcher] = useState(true);
  const wrap = query.get('wrap');
  const reader = <PepperScore className="embed-switch-wrapped" chrome="minimal" controls={controls} musicXml={ensemble} height="200px" assetBaseUrl="/custom-assets" />;
  return <div className="switch-test">
    {wrap === 'a' && <a className="host-card-link" href="#card">{reader}</a>}
    {wrap === 'button' && <div className="host-card-button" role="button" tabIndex={-1}>{reader}</div>}
    {query.has('toggle') && <div className="host-snippet" style={{ maxWidth: "100%" }}>
      <button type="button" className="host-toggle-switcher" onClick={() => setSwitcher(on => !on)}>Toggle switcher</button>
      <PepperScore className="embed-switch-toggle" chrome="minimal" controls={{ instrumentSwitch: switcher }} musicXml={ensemble} height="200px" assetBaseUrl="/custom-assets" />
    </div>}
    <div className="host-snippet" style={{ maxWidth: "100%" }}><PepperScore className="embed-switch-piano" chrome="minimal" controls={controls} musicXml={piano} assetBaseUrl="/custom-assets" /></div>
    <div className="host-snippet" style={{ maxWidth: "100%" }}><PepperScore className="embed-switch-duo" chrome="minimal" controls={controls} musicXml={duo} assetBaseUrl="/custom-assets" /></div>
    <div className="host-snippet" style={{ maxWidth: "100%" }}><PepperScore className="embed-switch-off" chrome="minimal" musicXml={piano} assetBaseUrl="/custom-assets" /></div>
  </div>;
}
