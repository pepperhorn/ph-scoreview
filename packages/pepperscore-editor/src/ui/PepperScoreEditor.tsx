import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { PepperScore, type PepperScoreClickInfo, type PepperScoreHandle } from 'pepperscore';
import { compileToMusicXml } from '../compile/to-musicxml';
import { setCursor, setSelection } from '../engine/commands/index';
import { createEditorStore, type EditorStore } from '../engine/store';
import type { PepperScoreFile } from '../format/pepperscore-file';
import type { Dropped } from '../import/from-musicxml';
import { importMusicXml } from '../import/from-musicxml';
import { DEFAULT_MAX_STAVES, readOnlyMessage, verifyLicence, type Licence } from '../licence';
import { measureIndex, staffCount } from '../model/query';
import type { Document } from '../model/schema';
import { clickTarget } from './click-mapping';
import { checkStaffCap, describeDropped, download, exportMusicXml, importSource, newScore, readScoreFile, savePepperScore, staffLimitMessage, type Opened } from './files';
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
  /**
   * A signed licence key (see README); its `maxStaves` caps the score size (default 4). Absent, invalid or
   * expired: read-only (banner, disabled toolbar, no keyboard editing). Read-only while it is being checked.
   */
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
export type PepperScoreEditorHandle = {
  getDocument(): Document;
  getMusicXml(): string;
  undo(): void;
  redo(): void;
  /** True when the score has changed since it was opened or last saved (undo back to that point is clean). */
  isDirty(): boolean;
  /** Before replacing the score: true when it is clean or the user confirms discarding the unsaved changes. */
  confirmDiscard(): boolean;
  applyTemplate?: never;
};

export const DISCARD_PROMPT = 'Discard unsaved changes?';

/** True when `store` is clean or the user agrees to lose its changes (`window.confirm`). */
export function confirmDiscard(store: EditorStore): boolean {
  return !store.isDirty() || window.confirm(DISCARD_PROMPT);
}

/** The viewer redraws this long after the last change, so fast typing engraves once. */
const RENDER_DEBOUNCE_MS = 80;

type Source = PepperScoreFile['source'];
/** `source` and `created` are written back when the score is saved as `.pepperscore`. */
type Session = { kind: 'ok'; id: number; store: EditorStore; dropped: Dropped[]; source: Promise<Source>; created: string } | { kind: 'error'; message: string };
let sessionIds = 0;

function openSession(load: () => Opened, musicXml?: string): Session {
  try {
    const { document, dropped, source, editor, created } = load();
    // The staff cap comes from the licence and is checked by the editor (no command changes the staff count).
    const store = createEditorStore(document, { maxStaves: Infinity, cursor: editor?.cursor, activeLayoutId: editor?.activeLayoutId });
    const imported = source ? Promise.resolve(source) : musicXml ? importSource(musicXml, dropped) : Promise.resolve(undefined);
    return { kind: 'ok', id: ++sessionIds, store, dropped, source: imported, created: created ?? new Date().toISOString() };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

/** The verified licence for `key`: `undefined` while it is checked, `null` when absent, invalid or expired. */
function useLicence(key: string | undefined): Licence | null | undefined {
  const [checked, setChecked] = useState<{ key: string | undefined; licence: Licence | null }>();
  useEffect(() => {
    let live = true;
    void verifyLicence(key ?? '').then((licence) => {
      if (live) setChecked({ key, licence });
    });
    return () => {
      live = false;
    };
  }, [key]);
  return checked && checked.key === key ? checked.licence : undefined;
}

/** A score editor around the PepperScore viewer: toolbar, keyboard entry, touch palette, popovers. */
export function PepperScoreEditor(props: PepperScoreEditorProps & { ref?: Ref<PepperScoreEditorHandle> }) {
  const [session, setSession] = useState<Session>(() =>
    openSession(() => {
      if (props.document) return { document: props.document, dropped: [] };
      if (props.musicXml) return importMusicXml(props.musicXml, { maxStaves: Infinity });
      return { document: newScore(), dropped: [] };
    }, props.musicXml),
  );
  const licence = useLicence(props.licenceKey);
  const maxStaves = licence?.maxStaves ?? DEFAULT_MAX_STAVES;
  const className = `ps-editor ${props.className ?? ''}`.trim();
  const refusal = (message: string) => <div className={className}><div className="ps-editor-error" role="alert">{message}</div></div>;
  if (session.kind === 'error') return refusal(session.message);
  if (staffCount(session.store.getState().document) > maxStaves) {
    // Over the default cap: wait for the licence before refusing the score.
    return licence === undefined ? <div className={className} aria-busy="true" /> : refusal(staffLimitMessage(maxStaves));
  }
  return <EditorSession key={session.id} {...props} className={className} editable={Boolean(licence)} checking={licence === undefined} maxStaves={maxStaves} session={session} onOpened={setSession} />;
}

type SessionProps = PepperScoreEditorProps & {
  ref?: Ref<PepperScoreEditorHandle>;
  className: string;
  editable: boolean;
  /** The licence is still being verified: read-only, without the no-licence banner. */
  checking: boolean;
  maxStaves: number;
  session: Extract<Session, { kind: 'ok' }>;
  onOpened(session: Session): void;
};

function EditorSession({ session, editable, checking, maxStaves, onOpened, className, ref, ...props }: SessionProps) {
  const { store, dropped } = session;
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
    isDirty: () => store.isDirty(),
    confirmDiscard: () => confirmDiscard(store),
  }), [store]);

  // Leaving the page with unsaved changes asks first.
  const dirty = useEditorStore(store, (s) => s.dirty);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

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
        checkStaffCap(opened.document, maxStaves);
        if (!confirmDiscard(store)) return;
        onOpened(openSession(() => opened));
        callbacks.current.onChange?.(opened.document);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A refused file (the staff cap included) keeps the open score; only the initial props show the error-only view.
        setBanner(`Could not open ${file.name}: ${message}`);
      }
    },
    [onOpened, maxStaves, store],
  );

  const save = () =>
    void session.source.then((source) => {
      const { document, cursor, activeLayoutId } = store.getState();
      savePepperScore({ document, source, editor: { cursor, activeLayoutId }, created: session.created });
      store.markSaved();
    });

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
        onSave={save}
        onOpen={(file) => void open(file)}
        refocus={refocus}
      />
      {!editable && !checking && <div className="ps-editor-banner ps-editor-readonly" role="status">{readOnlyMessage(props.licenceKey)}</div>}
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
