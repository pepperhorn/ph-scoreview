import { useEffect, useRef, useState } from 'react';
import { compileToMusicXml, PepperScoreEditor, type Document, type PepperScoreEditorHandle } from 'pepperscore-editor';
import ensemble from '../../../../validation/fixtures/ensemble.musicxml?raw';

declare global { interface Window { __editor: { ref: React.RefObject<PepperScoreEditorHandle | null> } } }

type Source = { key: number; musicXml?: string };
/** The demo's signed licence (4 staves, expires 2028-01-01); `'dev'` would only work in development builds. */
const DEMO_LICENCE = 'eyJzdWIiOiJwZXBwZXJzY29yZS1kZW1vIiwiZXhwIjoxODMwMjk3NjAwLCJtYXhTdGF2ZXMiOjR9.htvTu3iKMVooELSmmTmArtBQpsDE9tcvtuebGyZZ3BGbvuxBAZ1ip25IGtfNJCuE0_OlRTvGM6v1NcLsaL04Bg';
/** `?licence=<key>` overrides the demo licence (`?licence=` shows the read-only editor). */
const licenceKey = () => new URLSearchParams(window.location.search).get('licence') ?? DEMO_LICENCE;

/**
 * The editor demo (/editor): a licensed editor in Endless view with a collapsible live-MusicXML sidebar.
 * validation/editor.mjs drives it through `window.__editor.ref` (the editor handle).
 */
export default function EditorDemo() {
  const ref = useRef<PepperScoreEditorHandle>(null);
  const [source, setSource] = useState<Source>({ key: 0 });
  const [showXml, setShowXml] = useState(true);
  const [xml, setXml] = useState('');
  window.__editor = { ref };
  /** New and the fixture replace the score: with unsaved changes, only after the editor's discard prompt. */
  const replace = (next: Omit<Source, 'key'>) => {
    if (ref.current && !ref.current.confirmDiscard()) return;
    setSource(s => ({ key: s.key + 1, ...next }));
  };
  const refreshXml = (document: Document) => { if (showXml) setXml(compileToMusicXml(document)); };
  // A new or opened score: show its MusicXML (the editor handle is set before this effect runs).
  useEffect(() => { const doc = ref.current?.getDocument(); setXml(doc ? compileToMusicXml(doc) : ''); }, [source.key]);
  return <div className="editor-demo">
    <header className="editor-demo-header">
      <h1 className="editor-demo-title">pepperscore editor</h1>
      <div className="editor-demo-actions">
        <button type="button" className="editor-demo-btn editor-demo-new" onClick={() => replace({})}>New</button>
        <button type="button" className="editor-demo-btn editor-demo-ensemble" onClick={() => replace({ musicXml: ensemble })}>Open ensemble fixture</button>
        <button type="button" className="editor-demo-btn editor-demo-toggle-xml" aria-pressed={showXml} onClick={() => { setShowXml(v => !v); const doc = ref.current?.getDocument(); if (!showXml && doc) setXml(compileToMusicXml(doc)); }}>{showXml ? 'Hide' : 'Show'} MusicXML</button>
      </div>
    </header>
    <div className={`editor-demo-main ${showXml ? 'has-sidebar' : ''}`}>
      <PepperScoreEditor
        key={source.key}
        ref={ref}
        className="editor-demo-editor"
        musicXml={source.musicXml}
        licenceKey={licenceKey()}
        view="endless"
        height="70vh"
        assetBaseUrl="/"
        autoFocus
        onChange={refreshXml}
        onRender={ms => console.info('ps-editor render ms', Math.round(ms))}
      />
      {showXml && <aside className="editor-demo-sidebar" aria-label="Live MusicXML">
        <pre className="editor-demo-xml">{xml}</pre>
      </aside>}
    </div>
  </div>;
}
