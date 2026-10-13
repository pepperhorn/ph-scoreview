import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { PepperScore, type PepperScoreClickInfo, type PepperScoreHandle } from 'pepperscore';
import { compileToMusicXml } from '../compile/to-musicxml';
import { setCursor, setSelection } from '../engine/commands/index';
import { createEditorStore, type EditorStore } from '../engine/store';
import type { Dropped } from '../import/from-musicxml';
import { importMusicXml } from '../import/from-musicxml';
import { measureIndex } from '../model/query';
import type { Document } from '../model/schema';
import { clickTarget } from './click-mapping';
import { checkStaffCap, describeDropped, download, exportMusicXml, isLicensed, newScore, readScoreFile, savePepperScore, type Opened } from './files';
import { editorHighlights } from './highlights';
import { handleKey, type KeyContext, type PopoverName } from './keymap';
import { Palette } from './Palette';
import { Popover } from './Popover';
import { Toolbar } from './Toolbar';
import { useEditorStore } from './useEditorStore';

export type PepperScoreEditorProps = {
  /** The score to edit; `musicXml` is imported instead when given; neither opens a new 8-bar treble score. */
  document?: Document;
  musicXml?: string;
  /** Absent or invalid: read-only (banner, disabled toolbar, no keyboard editing). */
  licenceKey?: string;
  /** After every change to the document (commands, undo, redo). */
  onChange?(document: Document): void;
  /** Milliseconds from a document change to the viewer finishing the redraw (debounce included). */
  onRender?(ms: number): void;
  /** Focus the editor on mount so typing works at once. */
  autoFocus?: boolean;
  view?: 'vertical' | 'endless';
  height?: string;
  className?: string;
  assetBaseUrl?: string;
  soundPack?: 'core' | 'complete';
};
export type PepperScoreEditorHandle = { getDocument(): Document; getMusicXml(): string; undo(): void; redo(): void; applyTemplate?: never };

/** The viewer redraws this long after the last change, so fast typing engraves once. */
const RENDER_DEBOUNCE_MS = 80;

type Session = { kind: 'ok'; id: number; store: EditorStore; dropped: Dropped[] } | { kind: 'error'; message: string };
let sessionIds = 0;

function openSession(load: () => Opened): Session {
  try {
    const { document, dropped } = load();
    return { kind: 'ok', id: ++sessionIds, store: createEditorStore(document), dropped };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

/** A score editor around the PepperScore viewer: toolbar, keyboard entry, touch palette, popovers. */
export function PepperScoreEditor(props: PepperScoreEditorProps & { ref?: Ref<PepperScoreEditorHandle> }) {
  const [session, setSession] = useState<Session>(() =>
    openSession(() => {
      if (props.document) return { document: checkStaffCap(props.document), dropped: [] };
      if (props.musicXml) return importMusicXml(props.musicXml);
      return { document: newScore(), dropped: [] };
    }),
  );
  const className = `ps-editor ${props.className ?? ''}`.trim();
  if (session.kind === 'error') return <div className={className}><div className="ps-editor-error" role="alert">{session.message}</div></div>;
  return <EditorSession key={session.id} {...props} className={className} store={session.store} dropped={session.dropped} onOpened={setSession} />;
}

type SessionProps = PepperScoreEditorProps & { ref?: Ref<PepperScoreEditorHandle>; className: string; store: EditorStore; dropped: Dropped[]; onOpened(session: Session): void };

function EditorSession({ store, dropped, onOpened, className, ref, ...props }: SessionProps) {
  const editable = isLicensed(props.licenceKey);
  const document = useEditorStore(store, (s) => s.document);
  const cursor = useEditorStore(store, (s) => s.cursor);
  const selection = useEditorStore(store, (s) => s.selection);
  const invariantErrors = useEditorStore(store, (s) => s.invariantErrors);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PepperScoreHandle>(null);
  const [popover, setPopover] = useState<PopoverName | null>(null);
  const [banner, setBanner] = useState(() => (dropped.length ? `Some notation was not imported: ${describeDropped(dropped)}.` : ''));
  const [playing, setPlaying] = useState(false);

  // The viewer gets the compiled score 80 ms after the last change; a change starts the render clock.
  const compiled = useMemo(() => compileToMusicXml(document), [document]);
  const [musicXml, setMusicXml] = useState(compiled);
  const changedAt = useRef<number | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setMusicXml((previous) => {
        if (previous === compiled) changedAt.current = null;
        return compiled;
      });
    }, RENDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [compiled]);

  const callbacks = useRef(props);
  callbacks.current = props;
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        if (state.document === previous.document) return;
        changedAt.current ??= performance.now();
        callbacks.current.onChange?.(state.document);
      }),
    [store],
  );
  const onReady = useCallback(() => {
    if (changedAt.current === null) return;
    const ms = performance.now() - changedAt.current;
    changedAt.current = null;
    callbacks.current.onRender?.(ms);
  }, []);

  useEffect(() => {
    if (props.autoFocus) rootRef.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    getDocument: () => store.getState().document,
    getMusicXml: () => compileToMusicXml(store.getState().document),
    undo: () => store.undo(),
    redo: () => store.redo(),
  }), [store]);

  const highlights = useMemo(() => (editable ? editorHighlights(document, cursor, selection) : []), [editable, document, cursor, selection]);

  const refocus = useCallback(() => rootRef.current?.focus({ preventScroll: true }), []);
  const closePopover = useCallback(() => {
    setPopover(null);
    refocus();
  }, [refocus]);
  const togglePlay = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (playing) {
      viewer.stop();
      return;
    }
    const state = store.getState();
    viewer.seekToMeasure(Math.max(measureIndex(state.document, state.cursor.measureId), 0));
    void viewer.play();
  }, [playing, store]);
  const ctx = useMemo<KeyContext>(() => ({ store, openPopover: setPopover, play: togglePlay }), [store, togglePlay]);

  const onElementClick = useCallback(
    (info: PepperScoreClickInfo) => {
      const target = clickTarget(store.getState().document, info);
      if (!target) return;
      store.dispatch(setCursor, target.cursor, { record: false });
      store.dispatch(setSelection, { ids: target.selection }, { record: false });
      refocus();
    },
    [store, refocus],
  );

  const open = useCallback(
    async (file: File) => {
      try {
        const opened = await readScoreFile(file);
        onOpened(openSession(() => opened));
        callbacks.current.onChange?.(opened.document);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/limited to \d+ staves/.test(message)) onOpened({ kind: 'error', message });
        else setBanner(`Could not open ${file.name}: ${message}`);
      }
    },
    [onOpened],
  );

  const reportErrors = () =>
    download(JSON.stringify({ errors: invariantErrors, document: store.getState().document }, null, 2), 'pepperscore-report.json', 'application/json');

  return (
    <div
      ref={rootRef}
      className={className}
      tabIndex={0}
      data-ps-mode={cursor.mode}
      data-ps-editable={editable ? '' : undefined}
      onKeyDownCapture={(event) => {
        if (!editable) return;
        if (popover) {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closePopover();
          }
          return;
        }
        // Capture phase, so a consumed key never reaches the viewer's own page-turn keys.
        if (handleKey(event.nativeEvent, ctx)) event.stopPropagation();
      }}
    >
      <Toolbar
        store={store}
        ctx={ctx}
        editable={editable}
        playing={playing}
        onPopover={(name) => setPopover((current) => (current === name ? null : name))}
        onPlay={togglePlay}
        onExport={() => exportMusicXml(store.getState().document)}
        onSave={() => savePepperScore(store.getState().document)}
        onOpen={(file) => void open(file)}
        refocus={refocus}
      />
      {!editable && <div className="ps-editor-banner ps-editor-readonly" role="status">Editing requires a licence.</div>}
      {banner && (
        <div className="ps-editor-banner ps-editor-notice" role="status">
          <span className="ps-editor-banner-text">{banner}</span>
          <button type="button" className="ps-btn ps-editor-banner-close" aria-label="Dismiss" onClick={() => setBanner('')}>×</button>
        </div>
      )}
      <div className="ps-editor-stage">
        {popover && editable && <Popover name={popover} store={store} onClose={closePopover} />}
        <PepperScore
          ref={viewerRef}
          className="ps-editor-viewer"
          musicXml={musicXml}
          chrome="minimal"
          view={props.view}
          height={props.height}
          assetBaseUrl={props.assetBaseUrl}
          soundPack={props.soundPack}
          onElementClick={editable ? onElementClick : undefined}
          highlights={highlights}
          onReady={onReady}
          onPlay={() => setPlaying(true)}
          onStop={() => setPlaying(false)}
        />
      </div>
      <Palette ctx={ctx} editable={editable} refocus={refocus} />
      <div className="ps-editor-status" role="status" aria-live="polite">
        {invariantErrors.length > 0 && (
          <>
            <span className="ps-editor-status-text">Score check found {invariantErrors.length} problem{invariantErrors.length > 1 ? 's' : ''}: {invariantErrors.join('; ')}.</span>
            <button type="button" className="ps-btn ps-editor-report" onClick={reportErrors}>Report this score</button>
          </>
        )}
      </div>
    </div>
  );
}
