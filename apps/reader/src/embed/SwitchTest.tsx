import { PepperScore } from 'pepperscore';
import piano from '../../../../validation/fixtures/instrument-switch-piano.musicxml?raw';

/**
 * Host page for validation/embed.mjs: minimal snippets with the instrument switcher (`controls.instrumentSwitch`): the
 * grand-staff piano fixture, a piano and violin duo (two source parts), and the piano without the control.
 */
const violinPart = '<score-part id="PVn"><part-name>Violin</part-name></score-part>';
const violinMusic = '<part id="PVn"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>';
const duo = piano.replace('</part-list>', `${violinPart}</part-list>`).replace('</score-partwise>', `${violinMusic}</score-partwise>`);
const controls = { instrumentSwitch: true };
export default function SwitchTest() {
  return <div className="switch-test">
    <div className="host-snippet" style={{ maxWidth: "100%" }}><PepperScore className="embed-switch-piano" chrome="minimal" controls={controls} musicXml={piano} assetBaseUrl="/custom-assets" /></div>
    <div className="host-snippet" style={{ maxWidth: "100%" }}><PepperScore className="embed-switch-duo" chrome="minimal" controls={controls} musicXml={duo} assetBaseUrl="/custom-assets" /></div>
    <div className="host-snippet" style={{ maxWidth: "100%" }}><PepperScore className="embed-switch-off" chrome="minimal" musicXml={piano} assetBaseUrl="/custom-assets" /></div>
  </div>;
}
