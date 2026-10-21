import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { PepperScore, type PepperScoreClickInfo, type PepperScoreHandle, type PepperScoreInsets, type PepperScoreScrollOptions } from 'pepperscore';
import { compileToMusicXml } from '../compile/to-musicxml';
import type { EditorStore } from '../engine/store';
import type { ViewerMode } from './CanvasHeader';
import { cursorScrollTarget, editorHighlights } from './highlights';
import { useEditorStore } from './useEditorStore';

/** The viewer redraws this long after the last change, so fast typing engraves once. */
const RENDER_DEBOUNCE_MS = 80;
/**
 * Following the cursor: it scrolls only when the cursor comes within these margins of a visible edge (more room
 * ahead, to the right), then leaves FOLLOW_LEAD of the view ahead of it, so typing scrolls every few bars rather than
 * every note and never re-centres.
 */
const FOLLOW_MARGIN: PepperScoreInsets = { top: 12, right: 72, bottom: 12, left: 32 };
const FOLLOW_LEAD = 0.4;
/** A cursor move is followed for this long, so the swap that engraves it (a few hundred ms later) lands in view. */
const FOLLOW_WINDOW_MS = 3000;
/**
 * A click, tap, touch, wheel or scroll on the score this long before a cursor move (or any time after it) cancels the
 * follow: a click already shows its cursor, and the reader's own scrolling wins.
 */
const FOLLOW_INTERACTION_MS = 600;

/** On a phone, the band between the header and the toolbar overlays (`--ps-head-h`, `--ps-toolbar-h`). */
function overlayBounds(root: HTMLElement | null): PepperScoreInsets | undefined {
  const shell = root?.querySelector<HTMLElement>('.ps-shell-phone');
  if (!shell) return undefined;
  const style = getComputedStyle(shell), rect = shell.getBoundingClientRect();
  const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
  return { top: rect.top + px('--ps-head-h'), bottom: rect.bottom - px('--ps-toolbar-h') };
}

export type EditorViewerProps = {
  viewerRef: RefObject<PepperScoreHandle | null>;
  /** The editor root: the phone shell's overlays are read from it. */
  editorRef?: RefObject<HTMLElement | null>;
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
 *
 * The view follows the cursor (entry, arrow and bar moves, undo and redo): once the move is engraved (`onRender`, with
 * the new layout), or at once when nothing needs engraving, the viewer scrolls the cursor into view if it is near or
 * past an edge. A click or tap on the score, and the reader's own scrolling, are never followed.
 */
export const EditorViewer = memo(function EditorViewer({ viewerRef, editorRef, store, editable, view: mode, changedAt, assetBaseUrl, soundPack, onElementClick, onReady, onPlay, onStop }: EditorViewerProps) {
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

  // Follow the cursor: each move opens a follow window; the viewer skips it if the reader touched the score since.
  const target = useMemo(() => cursorScrollTarget(document, cursor), [document, cursor]);
  const targetRef = useRef(target);
  targetRef.current = target;
  const followRef = useRef<{ since: number; until: number } | null>(null);
  const follow = useCallback(() => {
    const armed = followRef.current;
    if (!armed) return;
    if (performance.now() > armed.until) { followRef.current = null; return; }
    const options: PepperScoreScrollOptions = { margin: FOLLOW_MARGIN, lead: FOLLOW_LEAD, bounds: overlayBounds(editorRef?.current ?? null), interactedSince: armed.since };
    void viewerRef.current?.scrollIntoView(targetRef.current, options);
  }, [viewerRef, editorRef]);
  const pending = compiled !== musicXml;
  useEffect(() => {
    if (!editable) return;
    const now = performance.now();
    followRef.current = { since: now - FOLLOW_INTERACTION_MS, until: now + FOLLOW_WINDOW_MS };
    // A move that changed the document is followed when its engraving lands (onRender); a plain move at once.
    if (!pending) follow();
  }, [cursor, editable]); // eslint-disable-line react-hooks/exhaustive-deps -- only a cursor move opens a follow window

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
      onRender={follow}
      onPlay={onPlay}
      onStop={onStop}
    />
  );
});
