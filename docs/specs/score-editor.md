# pepperscore editor (MVP)

Status: implemented on `feat/score-editor`, 2026-10-13. Design: [docs/superpowers/specs/2026-10-13-score-editor-design.md](../superpowers/specs/2026-10-13-score-editor-design.md). Plan: [docs/superpowers/plans/2026-10-13-score-editor-mvp.md](../superpowers/plans/2026-10-13-score-editor-mvp.md).

## Problem

The `pepperscore` viewer reads, engraves and plays scores, but nothing in the repository can write one. Educational users need to enter and correct short scores in the browser. PepperHorn's engraving factory needs a score model that imports a Sibelius, Dorico or MuseScore export, applies a house style and exports MusicXML without a desktop engraver. Editing MEI or the MusicXML DOM in place would duplicate every notation feature, and Verovio's editor API is experimental and has no MusicXML export.

## Goals

- A keyboard-first score editor with touch parity, licence-gated to 4 staves, shipped as a separate private package (`packages/pepperscore-editor`) that wraps the public viewer.
- One JSON model (MNX-shaped, every object addressed by a stable id), compiled to MusicXML. The viewer engraves and plays that MusicXML like any other file, so the viewer gains no editor-specific code.
- A native `.pepperscore` file that makes a score editable again; MusicXML is the only interchange export.
- A small, generic host surface on the public viewer that any host can use, not only the editor.
- Every edit is an undoable command; keyboard, touch palette and popovers all dispatch the same commands.

## Plan

### Viewer host hooks (public package `pepperscore`)

- `onElementClick(info)` (`PepperScoreClickInfo`): every click on the engraving, with every chrome, reports the note (`noteId`, `sourceId`), the measure, the position across it (`fraction`), the nearest staff and the client coordinates. The engraving shows a pointer cursor while a host listens.
- `highlights` (`PepperScoreHighlight[]`): host classes on notes and measures, re-applied after every draw, with default `ps-cursor`, `ps-selection` and `ps-cursor-measure` styles (`--ps-cursor`, `--ps-selection`).
- Handle: `scrollToMeasure(index)` and `seekToMeasure(index)`.
- A new score source (`musicXml`, `file`, `scoreUrl` or `abc`) draws immediately; the 260 ms redraw fade only applies to setting changes (mode, zoom, fonts, transposition). This is what the editor's per-edit latency needed (see Results).

The design's `overlay`, `interactive`, `layout`, `getGeometry()` and `renderPage()` hooks are not part of the MVP.

### Editor package (`pepperscore-editor`, private)

- **Model** (`src/model`): Zod schema for the document (global measures, parts, sequences, events, tuplets, notes, beams, directions with anchors and offsets, layouts, style sheet), `createDocument`, queries and invariants (bar length, beams, ties, slurs, navigation marks, staff cap). The layouts, overrides, offsets and style sheet are modelled and round-tripped, but have no UI yet.
- **Compiler** (`src/compile`): `compileToMusicXml`, partwise MusicXML 4.0 with divisions 960 and the model ids as element ids, so viewer clicks map back to the model with no extra lookup. Beams, tuplets, ties, slurs, articulations, dynamics, wedges, text, key, time and clef changes, barlines, repeats, endings, segno, coda, To Coda, Fine, D.C. and D.S.
- **Importer** (`src/import`): `importMusicXml` on a streaming tokenizer. Unsupported features (ottavas, lyrics, harmony, pedals, cue notes and others) are counted in `dropped` and shown once as a warning. Scores over the licence's staff cap are refused.
- **Command engine** (`src/engine`): a store with Immer patches, a history with coalescing and undo/redo, and MuseScore-style bar discipline: an entry overwrites to its right and refills with rests, and never spills into the next bar. Commands:
  - Score: `setTime`, `setKey`, `setClef`, `setBarline`, `toggleRepeatStart`, `setRepeatEnd`, `setEnding`, `setJump`, `toggleMark` (segno, coda, To Coda, Fine), `setTempo`, `insertMeasure`, `deleteMeasure`.
  - Notes: `enterEvent`, `addChordNote`, `setPitch`, `stepPitch`, `shiftOctave`, `setAccidental`, `setDuration`, `toggleDot`, `toggleRest`, `deleteEvents`, `makeTuplet`, `toggleArticulation`, `toggleTie`, `addSlur`, `removeSlur`.
  - Beams: `setBeamGroup`, `breakBeam`, `joinBeam` (automatic beaming by beat on entry).
  - Directions: `addDynamic`, `addWedge`, `addText`, `removeDirection`, `nudge` (offset in staff spaces).
  - Cursor and selection: `setCursor`, `moveCursor`, `extendSelection`, `setEntryMode`, `setCursorDuration`, `setSelection`.
- **Keymap** (`src/ui/keymap.ts`): one table, which also drives tooltips and the touch palette, in six groups:
  - entry: `N` entry mode, `Esc` select mode, `0` rest;
  - duration: `1`–`6` (32nd…whole), `.` dot;
  - pitch: `A`–`G` (in the key, nearest octave), `↑ ↓` step, `Ctrl+↑ ↓` octave;
  - edit: `T` tie, `S` slur, `Shift+S` staccato, `-` tenuto, `>` accent, `^` marcato, `Ctrl+3/5/6/7` tuplet, `B` beam group cycle, `/` break beam, `Delete`/`Backspace`, `Ctrl+Z`, `Ctrl+Shift+Z`/`Ctrl+Y`;
  - navigate: `← →` event, `Ctrl+← →` bar, `Shift+← →` extend selection, `Space` play;
  - score: `D` dynamic, `K` key, `Q` time, `C` clef, `V` ending, `J` jump popovers, `R` barline cycle.

  Keymap ruling: symbol keys match the character typed, whatever modifiers produced it, so `>` (accent), `^` (marcato) and `-` (tenuto) work on any layout. Staccato is `Shift+S`, because `Shift+.` types `>` on US layouts and would collide with the accent. The design spec's keymap paragraph was updated to match.
- **UI** (`src/ui`): `<PepperScoreEditor>` wraps `<PepperScore>` with a toolbar, popovers, a touch palette (44 px targets) and a status line. Each edit compiles the document and hands it to the viewer as `musicXml`, debounced by 80 ms. Clicks map to a note, or to the nearest event start in a measure. The selection and cursor show through `highlights`. `onRender(ms)` reports change-to-redraw time.
- **`.pepperscore` format** (`src/format`): JSON `{ pepperscore: { version: 1 }, meta, document, source?, editor? }`, MIME `application/vnd.pepperscore+json`. `source` keeps the imported file's format, hash, name and dropped features. `editor` holds non-semantic state (cursor, active layout). Open and Save are in the toolbar, and Export writes MusicXML.
- **Licence** (`src/licence.ts`): an Ed25519-signed `{ sub, exp, maxStaves }` key, verified client-side with Web Crypto against a public key baked into the build. With no key, an invalid key or an expired key, the editor is read-only, with a banner and a disabled toolbar. `maxStaves` defaults to 4, and larger scores are refused on open and on initial load. `'dev'` is accepted in development builds only. The gate shapes the product; it is not anti-piracy.
- **Demo**: `apps/reader/src/pages/editor.astro` (`/editor`), with a signed 4-staff demo licence, a live MusicXML sidebar, New and an "Open ensemble fixture" button (5 staves, refused).

### Deferred

Layouts UI (switching, part layouts, breaks), overlay anchor handles and offset nudging in the UI, lyrics, tablature and percussion kits, MEI export, templates and rules (`applyTemplate`, rule authoring, template management), LLM-assisted engraving review, and the remaining viewer hooks listed above.

## Validation

- `npm test -w pepperscore-editor`: 153 vitest tests (model, invariants, compiler golden output, importer, round trips, commands with forward and undo, history, keymap, `.pepperscore` format, licence, README examples).
- `npm run test:editor-browser` (`validation/editor.mjs`, against the build). It drives `/editor`: keyboard entry engraves, undo, click to cursor, key popover, MusicXML export, `.pepperscore` save and reopen, the staff cap on open and on initial load, read-only without a licence, and the touch palette at a phone viewport. It requires every logged change-to-redraw time to be under 250 ms.
- `npm run test:api` and `npm run test:embed` cover the viewer hooks (exported types, `onElementClick`, `highlights`, `scrollToMeasure`, `seekToMeasure`) and the unchanged embedding behaviour.

Review Focus items and the tests that cover them:

| # | Risk | Test |
| --- | --- | --- |
| 1 | A note entered near the bar end spills into the next bar | `enterEvent clamps at bar end` (`src/engine/commands/notes.test.ts`) |
| 2 | Undo after a coalesced run of pitch changes takes more than one step, or redo does not replay it | `coalesced entries undo as one` (`src/engine/history.test.ts`) |
| 3 | A time signature change leaves sequences longer or shorter than the bar | `setTime refills sequences` (`src/engine/commands/score.test.ts`) |
| 4 | A `<backup>`-based second voice imports as one overlong sequence | `two voices via backup` (`src/import/from-musicxml.test.ts`) |
| 5 | Compiled repeats and endings are misread by the viewer's navigation reader | `viewer navigation reads compiled repeats` (`src/compile/to-musicxml.test.ts`) |

## Results

Edit-to-engrave latency is measured from the document change (one keystroke in entry mode) to the viewer's `onReady` after the redraw. It includes the 80 ms editor debounce, the compile, the import worker and Verovio's engraving. The measurements were taken in headless Chromium against the production build on the development machine (WSL2).

`node validation/editor.mjs` on the default 8-bar treble score:

| | Render ms logged |
| --- | --- |
| Before (`b1766c0`, 260 ms redraw fade on every draw) | 434, 403 |
| After (new score source draws immediately) | 183, 149, 137 |

By score size: six notes entered one at a time (`C D E F G A`, quarters) into an empty score, with the median of the six. The figures came from a temporary `?bars=&staves=` switch in the demo, which was removed afterwards. Four staves alternate treble and bass clefs.

| Bars · staves | Before: median (range) | After: median (range) |
| --- | --- | --- |
| 8 · 1 | 391 (388–407) | **136** (127–151) |
| 32 · 1 | 405 (402–421) | **150** (142–183) |
| 128 · 1 | 470 (451–501) | **198** (186–223) |
| 8 · 4 | 395 (391–411) | **137** (134–153) |
| 32 · 4 | 420 (412–436) | **162** (152–188) |
| 128 · 4 | 530 (503–667) | **247** (232–348) |

The fixed fade accounted for about 260 ms of every edit. Without it, an edit costs the 80 ms debounce plus roughly 50–170 ms of compile and engraving, growing with bars × staves because the whole document is re-imported on every edit. The design's "well under 100 ms" estimate holds for the work after the debounce on small scores only. At the 4-staff cap with 128 bars, an edit takes about a quarter second. Incremental engraving would be the next step if longer scores matter, and it is not planned.
