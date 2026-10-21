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
- Phone Notes tab (was Value), three rows: durations, dot and rest; sharp, natural, flat, 8vb, 8va and Add to chord; then a one-octave piano (7 white, 5 black keys) or the C–B letter buttons, switched by the button at the row's end and remembered in `localStorage`. A piano key is spelled for the cursor bar's key (its signature's spelling, else the natural, else sharps in sharp keys and C, flats in flat keys) and enters like a letter (chord mode included). `enterPitch` (keymap) and `pianoSpelling` (pitch entry) back it.
- Phone Entry/Edit switch in the toolbar's tab strip, on every tab and strip (it was Entry/Select in the header): the mode as a word and a colour. Tapping a note in the score (or a near miss that puts the cursor on one) switches to Edit; tapping a rest or empty staff space switches to Entry (`ClickTarget.mode`; the desktop keeps its mode on click). The piano keys are in pitch order for focus and screen readers.
- The view follows the cursor. Entry, arrow and bar moves, Undo and Redo scroll the score (Endless and Page, desktop and phone) when the cursor comes within a margin of a visible edge. The scroll leaves 40% of the view ahead of the cursor, so it moves every few bars and does not re-centre on each note. On a phone the cursor stays between the header and the toolbar (`--ps-head-h`, `--ps-toolbar-h`). An edit is followed once its in-place swap lands, using the new layout. A click or tap on the score is not followed, and neither is a cursor move while the reader is scrolling, wheeling or touching the score (iOS momentum included) or while the score plays. The scroll is smooth unless the user prefers reduced motion. `cursorScrollTarget` (ui/highlights.ts) gives the cursor's notes, or else its bar.

### Changed

- The compiled and engraved document is the active layout's view; Export still writes the Full score.
- The viewer is mounted with `height="fill"`; `view` is the initial Page or Endless mode.
- The palette is replaced by the phone shell's toolbar.
- The editor redraw gate in `validation/editor.mjs` defaults to 400 ms (fail at 2x), up from 250.
- `ViewResult.movedNotes` (the moved note ids, collected by `applyLayout`); cursor moves no longer re-derive them.
- A cursor move re-renders only the viewer (`EditorViewer`) and the parts of the shell that show the cursor; `renderCounts` exposes shell render counts for tests.
- An edit no longer repaints the whole score with the fade and scale reveal: the viewer swaps the engraving in place (`paintTransition="none"`), with no loading overlay, and keeps the scroll position. Opening another score still reveals.
- A layout switch, custom layout or stave toggle that hides the cursor's staff moves the cursor to the first drawn staff (same bar and tick) and clears the selection.
- The phone header returns focus to the editor after Play, Stop and the overflow menu, and before its collapse makes the first row inert.
- Accidentals, octave shifts and the other target edits act on the highlighted cursor note after a click (that missed the notehead) or an arrow, instead of the note before it; right after entering a note they still act on that note.
- Phone: Undo and Redo move from the Notes tab to the header (disabled with nothing to undo or redo); the Pitch tab becomes Marks (tie, slur, tuplet, beams, dynamic; the articulations), its accidentals, octave and chord buttons now on Notes.
- In select (Edit) mode the toolbar's letter buttons and piano keys repitch the target note (nearest its old octave) instead of entering one, duration buttons resize the target event, and Rest toggles it to a rest. On a target rest a letter or piano key pitches it in place (its duration kept, the cursor still). A longer duration stops at the barline. Typed letters and digits are unchanged (entry mode only). The duration buttons (phone and desktop rail) show the target event's duration in Edit (`shownDuration`).
- Layout selectors show the layout kind; a swap on the Full score notes that Export writes the source part; Escape closes an open popover before the inspector drawer; the zoom readout is a plain label.
- The phone starts a new or opened score in Entry, so its piano keys enter notes straight away (they only repitched the whole-bar rest in Edit). The desktop still starts in Edit.
- The non-entry mode is called Edit everywhere a user sees it: the desktop canvas pill (was "Select"), the status line ("edit", was "select"), the Escape binding ("Edit mode") and the README. The internal mode value stays `'select'` and the switch keeps the aria-label "Toggle note entry".
- Key names use the flat and sharp glyphs ("E♭ major", "F♯ major") in the key chip, the key popover and strip, and the inspector (`keyName`, now in `ui/key-names.ts`). Option values stay the fifths number.

### Fixed

- A click or tap on a note's stem, flag, accidental or dots (anywhere in its drawn box but the notehead ink) selected the next note: without a hit note, `clickTarget` picked the event start nearest the click's time fraction across the bar, and engraved spacing is not proportional to time. The viewer now reports the note for any click in its box, and `clickTarget` maps a click in staff space to the note or rest the viewer engraved nearest (`nearestSourceId`), falling back to the fraction only without one.
- The first entered note landed an octave low (a treble G was G3, below the staff): with no last pitch, entry aimed at C4. It now aims at the clef's middle line (treble G4, bass G3), like MuseScore and Sibelius. The last pitch only carries on the part and staff it was entered on (`Cursor.lastPitchAt`, saved in `.pepperscore` files), so moving to another staff starts from that staff's middle line; a rest pitched in place does the same.
- Ending labels engrave as "1.", "2." and "1., 2." (the compiler writes the label as `<ending>` text; Verovio drew the bare number). An ending ends with a hook (`stop`) only when a repeat closes it; a final ending with no repeat after it is open (`discontinue`). `GlobalMeasure.ending.open` overrides this, and the importer sets it only where the file differs from that default.

### Known limitations

- The compiler writes the concert key signature for transposing and swapped parts.
- Newsreader is loaded from Google Fonts at runtime; bundle it before release.
