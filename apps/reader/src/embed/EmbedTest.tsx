import { useEffect, useState } from 'react';
import { Reader } from 'pepperscore';
import ensemble from '../../../../validation/fixtures/ensemble.musicxml?raw';

/** Host page for validation/embed.mjs: several readers on one page, inside host-styled boxes. */
export default function EmbedTest() {
  // Until each reader gets its own Verovio channel (Task 3.3), a second reader engraving at the same time supersedes
  // the first one's import and stays blank: B mounts once A has drawn its score.
  const [second, setSecond] = useState<'waiting' | 'shown' | 'removed'>('waiting');
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.querySelector('.embed-a .score-system svg') || document.querySelector('.embed-a .score-loading')) return;
      window.clearInterval(timer);
      setSecond(state => state === 'waiting' ? 'shown' : state);
    }, 100);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="embed-test">
    <div className="host-box embed-box-a"><Reader className="embed-a" height="fill" assetBaseUrl="/" musicXml={ensemble} /></div>
    <button type="button" className="host-unmount" onClick={() => setSecond('removed')}>Remove the second reader</button>
    {second === 'shown' && <div className="host-box host-box-short embed-box-b"><Reader className="embed-b" height="400px" assetBaseUrl="/" /></div>}
  </div>;
}
