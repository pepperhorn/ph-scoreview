# Changelog

## Unreleased

Phase 2: layouts, instrument swap and the design shells. `pepperscore-editor` stays private.

### Added

- Layouts: Full score, Parts and Custom, each transposing or concert. Hiding a stave in the Full score creates a custom layout instead of editing the score. Commands `setActiveLayout`, `createCustomLayout`, `createPartLayouts`, `setLayoutParts`, `setLayoutTransposing`. `.pepperscore` files from phase 1 open unchanged (layout `kind` and `transposing` default).
- Instrument swap: a linked, view-time transform of a part for another instrument (`LayoutPart.swap`), with level, automatic range fitting by phrase (tie chains kept whole), manual octave overrides, an extra interval, "Make a copy (own stave)" and "Remove swap". Commands `setSwap`, `setRangeOverride`, `makeCopy`. Notes moved to fit the range are highlighted (`ps-transposed`) and counted in the status line.
- `INSTRUMENTS` (the viewer's 16 ids, transposition, clef, GM program, ranges per level), `instrumentFor`, `soundingMidi`, `writtenPitch`, `transposePitch`, `applyLayout`, `fitToRange` and the layout types, exported from the package.
- `setMeta` command (title and composer, edited in the top bar).
- Desktop shell: top bar, keycap rail, canvas header with the layout selector, Score / Stave / Layout inspector tabs, cursor-avoiding popovers, add-bar buttons, hint strip, and an inspector drawer between 761 and 960px.
- Phone shell: two-row header that collapses from 78px to 28px, tabbed bottom toolbar, inline strips instead of popovers, overflow menu. Always shows Page view.
- `forcePhone` prop (choose the shell explicitly; default: phone at 760px or less).
- `npm run test:editor-phone` (390x844 touch run: header collapse, toolbar geometry, strips, layouts).

### Changed

- The compiled and engraved document is the active layout's view; Export still writes the Full score.
- The viewer is mounted with `height="fill"`; `view` is the initial Page or Endless mode.
- The palette is replaced by the phone shell's toolbar.
- The editor redraw gate in `validation/editor.mjs` defaults to 400 ms (fail at 2x), up from 250.
- `ViewResult.movedNotes` (the moved note ids, collected by `applyLayout`); cursor moves no longer re-derive them.
- A cursor move re-renders only the viewer (`EditorViewer`) and the parts of the shell that show the cursor; `renderCounts` exposes shell render counts for tests.
- A layout switch, custom layout or stave toggle that hides the cursor's staff moves the cursor to the first drawn staff (same bar and tick) and clears the selection.
- The phone header returns focus to the editor after Play, Stop and the overflow menu, and before its collapse makes the first row inert.
- Accidentals, octave shifts and the other target edits act on the highlighted cursor note after a click (that missed the notehead) or an arrow, instead of the note before it; right after entering a note they still act on that note.
- Layout selectors show the layout kind; a swap on the Full score notes that Export writes the source part; Escape closes an open popover before the inspector drawer; the zoom readout is a plain label.

### Known limitations

- The compiler writes the concert key signature for transposing and swapped parts.
- Newsreader is loaded from Google Fonts at runtime; bundle it before release.
