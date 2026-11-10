import { useEffect, useRef, useState } from 'react';
import { compileToMusicXml, PepperScoreEditor, renderCounts, type Document, type PepperScoreEditorHandle } from 'pepperscore-editor';
import { editorStubPlugin } from './EditorStubPlugin';
import ensemble from '../../../../validation/fixtures/ensemble.musicxml?raw';
import { tenorPianoDocument } from './editor-fixtures';

declare global { interface Window { __editor: { ref: React.RefObject<PepperScoreEditorHandle | null>; renderCounts: Record<string, number> } } }

type Source = { key: number; musicXml?: string; document?: Document; startedNew?: boolean };
/** The demo's signed licence (4 staves, expires 2028-01-01); `'dev'` would only work in development builds. */
const DEMO_LICENCE = 'eyJzdWIiOiJwZXBwZXJzY29yZS1kZW1vIiwiZXhwIjoxODMwMjk3NjAwLCJtYXhTdGF2ZXMiOjR9.htvTu3iKMVooELSmmTmArtBQpsDE9tcvtuebGyZZ3BGbvuxBAZ1ip25IGtfNJCuE0_OlRTvGM6v1NcLsaL04Bg';
/** `?licence=<key>` overrides the demo licence (`?licence=` shows the read-only editor). */
const licenceKey = () => new URLSearchParams(window.location.search).get('licence') ?? DEMO_LICENCE;
/** `?phone=1` forces the phone shell at any width (otherwise a container 760px wide or less gets it). */
const forcePhone = () => (new URLSearchParams(window.location.search).get('phone') === '1' ? true : undefined);

/**
 * The editor demo (/editor): a licensed editor in Endless view with an optional live-MusicXML sidebar (hidden at first).
 * validation/editor.mjs drives it through `window.__editor.ref` (the editor handle), reads `window.__editor.renderCounts`
 * (shell render counts) and uses the fixture buttons (the tenor sax + piano fixture is the instrument swap's).
 */
export default function EditorDemo() {
  const ref = useRef<PepperScoreEditorHandle>(null);
  const [source, setSource] = useState<Source>({ key: 0 });
  const [showXml, setShowXml] = useState(false);
  const [xml, setXml] = useState('');
  window.__editor = { ref, renderCounts };
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
        <button type="button" className="editor-demo-btn editor-demo-new" onClick={() => replace({ startedNew: true })}>New</button>
        <button type="button" className="editor-demo-btn editor-demo-ensemble" onClick={() => replace({ musicXml: ensemble })}>Open ensemble fixture</button>
        <button type="button" className="editor-demo-btn editor-demo-tenor" onClick={() => replace({ document: tenorPianoDocument() })}>Open tenor sax + piano fixture</button>
        <button type="button" className="editor-demo-btn editor-demo-toggle-xml" aria-pressed={showXml} onClick={() => { setShowXml(v => !v); const doc = ref.current?.getDocument(); if (!showXml && doc) setXml(compileToMusicXml(doc)); }}>{showXml ? 'Hide' : 'Show'} MusicXML</button>
      </div>
    </header>
    <div className={`editor-demo-main ${showXml ? 'has-sidebar' : ''}`}>
      <PepperScoreEditor
        key={source.key}
        ref={ref}
        className="editor-demo-editor"
        plugins={new URLSearchParams(window.location.search).get('stubPlugin') === '1' ? [editorStubPlugin] : undefined}
        startedNew={source.startedNew}
        musicXml={source.musicXml}
        document={source.document}
        licenceKey={licenceKey()}
        forcePhone={forcePhone()}
        view="endless"
        height="calc(100vh - 82px)"
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
