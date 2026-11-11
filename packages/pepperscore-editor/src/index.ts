import "./style.css";
export * from './model/durations';
export * from './model/ids';
export * from './model/schema';
export * from './model/instruments';
export * from './model/create';
export * from './model/query';
export * from './model/invariants';
export * from './compile/to-musicxml';
export { importMusicXml, type Dropped } from './import/from-musicxml';
export { createEditorStore, type EditorStore, type EditorStoreOptions } from './engine/store';
export type { Command, Cursor, Editable, EditorState, History, HistoryEntry, Selection } from './engine/types';
export { applyLayout, swapPart, type ViewResult } from './engine/layout/apply-layout';
export { fitToRange, phrases, type FitOptions, type FitResult, type Phrase, type Shift } from './engine/layout/range-fit';
export * from './engine/commands/index';
export { KEYMAP, describeKey, handleKey, type KeyBinding, type KeyContext, type PopoverName } from './ui/keymap';
export { PepperScoreEditor, type PepperScoreEditorHandle, type PepperScoreEditorProps } from './ui/PepperScoreEditor';
export { renderCounts } from './ui/render-counts';
export {
  PEPPERSCORE_EXTENSION, PEPPERSCORE_MIME, PepperScoreFileSchema, readPepperScoreFile, writePepperScoreFile, type PepperScoreFile,
} from './format/pepperscore-file';
export { DEFAULT_LICENCE_PUBLIC_KEY_JWK, DEFAULT_MAX_STAVES, verifyLicence, type Licence } from './licence';

export type { EditorHost, EditorPlugin, EditorTarget } from './plugin/host';
