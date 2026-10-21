import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import type { PepperScoreClickInfo, PepperScoreHandle } from 'pepperscore';
import { compileToMusicXml } from '../compile/to-musicxml';
import { setCursor, setEntryMode, setSelection } from '../engine/commands/index';
import type { EditorStore } from '../engine/store';
import { importMusicXml } from '../import/from-musicxml';
import { DEFAULT_MAX_STAVES, readOnlyMessage } from '../licence';
import { measureIndex, staffCount } from '../model/query';
import type { Document } from '../model/schema';
import type { ViewerMode } from './CanvasHeader';
import { clickTarget } from './click-mapping';
import { UiProvider, type EditorUi } from './controls';
import { DesktopShell } from './desktop/DesktopShell';
import { EditorViewer } from './EditorViewer';
import { checkStaffCap, describeDropped, download, exportMusicXml, newScore, readScoreFile, savePepperScore, staffLimitMessage, type Opened } from './files';
import { useGlyphFont } from './icons';
import { handleKey, type KeyContext, type PopoverName } from './keymap';
import { PhoneShell } from './phone/PhoneShell';
import { useIsPhone } from './phone/useIsPhone';
import { openSession, useLeaveGuard, useLicence, type Session } from './session';
import type { ShellProps } from './shell';
import { createDrawSignal } from './useCanvasGeometry';
import { useEditorStore } from './useEditorStore';

export type PepperScoreEditorProps = {
  /** The score to edit; `musicXml` is imported instead when given; neither opens a new 8-bar treble score. */
  document?: Document;
  musicXml?: string;
  /**
   * A signed licence key (see README); its `maxStaves` caps the score size (default 4). Absent, invalid or
   * expired: read-only (banner, disabled editing controls, no keyboard editing). Read-only while it is being checked.
   */
  licenceKey?: string;
  /** After every change to the document (commands, undo, redo). */
  onChange?(document: Document): void;
  /** Milliseconds from a document change to the viewer finishing the redraw (debounce included). */
  onRender?(ms: number): void;
  /** Focus the editor on mount so typing works at once. */
  autoFocus?: boolean;
  /** The initial viewer view (Page is `vertical`); default `endless`. The canvas header switches it. */
  view?: ViewerMode;
  /** Phone shell (tabbed toolbar, auto-collapsing header) when true, desktop when false; default: by width (760px or less is a phone). */
  forcePhone?: boolean;
  /** The editor's height (any CSS length); default 720px. */
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

/** A score editor around the PepperScore viewer: top bar, rail, inspector, keyboard entry, popovers, touch palette. */
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
  const refusal = (message: string) => <div className={`${className} ps-editor-refused`}><div className="ps-editor-error" role="alert">{message}</div></div>;
  if (session.kind === 'error') return refusal(session.message);
  if (staffCount(session.store.getState().document) > maxStaves) {
    // Over the default cap: wait for the licence before refusing the score.
    return licence === undefined ? <div className={`${className} ps-editor-refused`} aria-busy="true" /> : refusal(staffLimitMessage(maxStaves));
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
  // Only the mode: the viewer subscribes to the cursor and selection itself, so a cursor move does not re-render the shell.
  const mode = useEditorStore(store, (s) => s.cursor.mode);
  const glyphs = useGlyphFont();
  const [viewerMode, setViewerMode] = useState<ViewerMode>(props.view ?? 'endless');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PepperScoreHandle>(null);
  const [popover, setPopover] = useState<PopoverName | null>(null);
  const [banner, setBanner] = useState(() => (dropped.length ? `Some notation was not imported: ${describeDropped(dropped)}.` : ''));
  const [playing, setPlaying] = useState(false);

  // A document change starts the render clock; the viewer's next draw stops it.
  const changedAt = useRef<number | null>(null);
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
  // Overlays re-measure after each draw through this signal; the session itself never re-renders for a draw.
  const draws = useMemo(createDrawSignal, []);
  const onReady = useCallback(() => {
    draws.emit();
    if (changedAt.current === null) return;
    const ms = performance.now() - changedAt.current;
    changedAt.current = null;
    callbacks.current.onRender?.(ms);
  }, [draws]);

  useEffect(() => {
    if (props.autoFocus) rootRef.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    getDocument: () => store.getState().document, getMusicXml: () => compileToMusicXml(store.getState().document),
    undo: () => store.undo(), redo: () => store.redo(), isDirty: () => store.isDirty(), confirmDiscard: () => confirmDiscard(store),
  }), [store]);

  useLeaveGuard(store);
  const phone = useIsPhone(rootRef, props.forcePhone);
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  // The phone starts each new or opened score in Entry: its always-visible piano keys then enter notes rather than
  // repitch a lone rest. Decided once per session, when the shell is first measured; the desktop stays select-first.
  const startModeSet = useRef(false);
  useLayoutEffect(() => {
    if (phone === null || startModeSet.current) return;
    startModeSet.current = true;
    if (phone) store.dispatch(setEntryMode, { mode: 'enter' }, { record: false });
  }, [phone, store]);

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
  const togglePopover = useCallback((name: PopoverName) => setPopover((current) => (current === name ? null : name)), []);
  const scrollToMeasure = useCallback((index: number) => void viewerRef.current?.scrollToMeasure(index), []);
  const ui = useMemo<EditorUi>(() => ({ store, ctx, editable, refocus, togglePopover, scrollToMeasure }), [store, ctx, editable, refocus, togglePopover, scrollToMeasure]);

  const onElementClick = useCallback(
    (info: PepperScoreClickInfo) => {
      // The engraving is the active layout's view: its ids are the document's, its staves the layout's visible ones.
      const { document, activeLayoutId } = store.getState();
      const target = clickTarget(document, info, activeLayoutId);
      if (!target) return;
      store.dispatch(setCursor, target.cursor, { record: false });
      store.dispatch(setSelection, { ids: target.selection }, { record: false });
      // On a phone a tap also picks the mode: a note (or a near miss that lands the cursor on one) to edit it (Edit), a
      // rest (an empty bar, past the last note) to enter (Entry).
      // The desktop keeps its mode, where typed letters mean different things in each.
      if (phoneRef.current) store.dispatch(setEntryMode, { mode: target.mode }, { record: false });
      refocus();
    },
    [store, refocus],
  );

  /** Replaces the score (Open, New), after the discard prompt when there are unsaved changes. */
  const replace = useCallback(
    (opened: Opened) => {
      if (!confirmDiscard(store)) return;
      onOpened(openSession(() => opened));
      callbacks.current.onChange?.(opened.document);
    },
    [onOpened, store],
  );
  const onOpen = useCallback(
    async (file: File) => {
      try {
        const opened = await readScoreFile(file);
        checkStaffCap(opened.document, maxStaves);
        replace(opened);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A refused file (the staff cap included) keeps the open score; only the initial props show the error-only view.
        setBanner(`Could not open ${file.name}: ${message}`);
      }
    },
    [replace, maxStaves],
  );
  const onNew = useCallback(() => replace({ document: newScore(), dropped: [] }), [replace]);
  const onExport = useCallback(() => exportMusicXml(store.getState().document), [store]);
  const onSave = useCallback(
    () =>
      void session.source.then((source) => {
        const { document, cursor, activeLayoutId } = store.getState();
        savePepperScore({ document, source, editor: { cursor, activeLayoutId }, created: session.created });
        store.markSaved();
        setSavedAt(new Date());
      }),
    [session, store],
  );
  const onReport = useCallback(() => {
    const { invariantErrors: errors, document } = store.getState();
    download(JSON.stringify({ errors, document }, null, 2), 'pepperscore-report.json', 'application/json');
  }, [store]);
  const onPlayed = useCallback(() => setPlaying(true), []);
  const onStopped = useCallback(() => setPlaying(false), []);

  const banners = useMemo(() => (
    <>
      {!editable && !checking && <div className="ps-editor-banner ps-editor-readonly" role="status">{readOnlyMessage(props.licenceKey)}</div>}
      {banner && (
        <div className="ps-editor-banner ps-editor-notice" role="status">
          <span className="ps-editor-banner-text">{banner}</span>
          <button type="button" className="ps-btn ps-icon-btn ps-editor-banner-close" aria-label="Dismiss" onClick={() => setBanner('')}>×</button>
        </div>
      )}
    </>
  ), [editable, checking, props.licenceKey, banner]);
  const viewer = (
    <EditorViewer
      viewerRef={viewerRef}
      editorRef={rootRef}
      store={store} editable={editable} view={phone ? 'vertical' : viewerMode} changedAt={changedAt}
      assetBaseUrl={props.assetBaseUrl} soundPack={props.soundPack} onElementClick={onElementClick} onReady={onReady} onPlay={onPlayed} onStop={onStopped}
    />
  );
  const licence = useMemo(() => ({ editable, checking, maxStaves }), [editable, checking, maxStaves]);
  const shell: ShellProps = {
    viewer, banners, popover, closePopover, playing, savedAt, draws, viewerMode, setViewerMode, licence,
    onPlay: togglePlay, onSave, onExport, onOpen, onNew, onReport,
  };

  return (
    <div
      ref={rootRef}
      className={className}
      style={props.height ? { height: props.height } : undefined}
      tabIndex={0}
      data-ps-mode={mode}
      data-ps-editable={editable ? '' : undefined}
      data-ps-glyphs={glyphs}
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
      <UiProvider value={ui}>
        {phone === null ? null : phone ? <PhoneShell {...shell} /> : <DesktopShell {...shell} />}
      </UiProvider>
    </div>
  );
}
