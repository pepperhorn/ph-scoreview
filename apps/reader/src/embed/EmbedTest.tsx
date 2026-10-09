import { useState } from 'react';
import { Reader } from 'pepperscore';
import ensemble from '../../../../validation/fixtures/ensemble.musicxml?raw';
import expressive from '../../../../validation/fixtures/expressive.musicxml?raw';

/**
 * Host page for validation/embed.mjs: several readers on one page, inside host-styled boxes. Both readers mount at
 * once, so their imports and engravings run together on the shared Verovio worker (one channel each).
 */
export default function EmbedTest() {
  const [second, setSecond] = useState(true);
  return <div className="embed-test">
    <div className="host-box embed-box-a"><Reader className="embed-a" height="fill" assetBaseUrl="/" musicXml={ensemble} /></div>
    <button type="button" className="host-unmount" onClick={() => setSecond(false)}>Remove the second reader</button>
    {second && <div className="host-box host-box-short embed-box-b"><Reader className="embed-b" height="400px" assetBaseUrl="/" musicXml={expressive} /></div>}
  </div>;
}
