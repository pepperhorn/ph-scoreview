import { memo, useEffect, useMemo, useState, type RefObject } from 'react';
import { PepperScore, type PepperScoreClickInfo, type PepperScoreHandle } from 'pepperscore';
import { compileToMusicXml } from '../compile/to-musicxml';
import type { EditorStore } from '../engine/store';
import type { ViewerMode } from './CanvasHeader';
import { editorHighlights } from './highlights';
import { useEditorStore } from './useEditorStore';

/** The viewer redraws this long after the last change, so fast typing engraves once. */
const RENDER_DEBOUNCE_MS = 80;

export type EditorViewerProps = {
  viewerRef: RefObject<PepperScoreHandle | null>;
  store: EditorStore;
  editable: boolean;
  view: ViewerMode;
  /** Set when a document change starts the render clock; cleared here when a change compiles to the same MusicXML. */
  changedAt: RefObject<number | null>;
  assetBaseUrl?: string;
  soundPack?: 'core' | 'complete';
  onElementClick(info: PepperScoreClickInfo): void;
  onReady(): void;
  onPlay(): void;
  onStop(): void;
};

/**
 * The engraving: the active layout's view compiled 80 ms after the last change, with the cursor, selection and
 * moved-note highlights. It subscribes to the cursor and selection itself, so a cursor move re-renders only this.
 * An edit swaps the engraving in place (`paintTransition="none"`): no fade, no loading overlay, scroll position kept.
 * Opening another score remounts the session, so its first paint still reveals.
 */
export const EditorViewer = memo(function EditorViewer({ viewerRef, store, editable, view: mode, changedAt, assetBaseUrl, soundPack, onElementClick, onReady, onPlay, onStop }: EditorViewerProps) {
  const document = useEditorStore(store, (s) => s.document);
  const cursor = useEditorStore(store, (s) => s.cursor);
  const selection = useEditorStore(store, (s) => s.selection);
  const view = useEditorStore(store, (s) => s.view);

  const compiled = useMemo(() => compileToMusicXml(view.document), [view]);
  const [musicXml, setMusicXml] = useState(compiled);
  useEffect(() => {
    const timer = setTimeout(() => {
      setMusicXml((previous) => {
        if (previous === compiled) changedAt.current = null;
        return compiled;
      });
    }, RENDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [compiled, changedAt]);

  const highlights = useMemo(() => (editable ? editorHighlights(document, cursor, selection, view) : []), [editable, document, cursor, selection, view]);
  return (
    <PepperScore
      ref={viewerRef}
      className="ps-editor-viewer"
      musicXml={musicXml}
      chrome="minimal"
      view={mode}
      height="fill"
      assetBaseUrl={assetBaseUrl}
      soundPack={soundPack}
      onElementClick={editable ? onElementClick : undefined}
      highlights={highlights}
      paintTransition="none"
      onReady={onReady}
      onPlay={onPlay}
      onStop={onStop}
    />
  );
});
