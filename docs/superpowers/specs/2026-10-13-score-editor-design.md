# pepperscore editor: design

Status: draft for review, 2026-10-13. Branch `feat/score-editor`.

## Goal

A score editor layered on the public `pepperscore` viewer and playback, shipped as a separate, licence-gated package (`pepperscore-editor`, max 4 staves). The editor owns a JSON score model that compiles to MusicXML; the viewer engraves and plays that MusicXML exactly as it does any other file. MusicXML is the only interchange export in v1. A `.pepperscore` JSON wrapper is the native save format and is what makes a score editable again later.

The same model and pipeline are the foundation of PepperHorn's engraving factory: import a score from Sibelius, Dorico or MuseScore, apply a house-style template (rules plus engraving options) and get the conductor score and the parts about 95% publish-ready, iterating on templates over time, with LLM-assisted review of rendered pages later. The editor is for in-browser educational users; the factory runs the same code headless. Both are served by the layouts, styles and rules sections below, which are modelled in v1 even where the UI comes later.

Not a goal in v1: lyrics, tablature, percussion kits, chord symbols as editable objects, a layout-editing UI (the model carries layouts from day one), real-time collaboration, MEI export, LLM integration.

## Decisions already made

- Own JSON model, MNX-shaped, compiled to MusicXML. Not editing MEI or MusicXML DOM in place (Verovio's editor API is experimental and has no MusicXML export; DOM surgery duplicates every feature).
- Single compile target. MusicXML goes through the existing import worker, so engraving, hit-testing, repeats, endings and jumps in playback all work with zero new viewer code. A direct MEI compiler is a later optimisation only if Verovio's MusicXML import proves limiting.
- Private workspace package in this repo now (`packages/pepperscore-editor`, `"private": true`), moved to its own repo when it is paywalled. The public package gains only a small generic extension surface.
- Keyboard-first note entry with full touch parity: every edit is a command, keyboard and touch palette both dispatch commands.
- Reuse from chordee2: the volta/repeat region rules (`voltaState.ts`), barline validation, id-addressed store actions, Zod schema style, and the keyboard map conventions.

## Package layout

```
packages/pepperscore/                 public viewer (+ extension surface, phase 1)
packages/pepperscore-editor/          private; schema, compilers, engine, UI
  src/model/        schema.ts (Zod), ids.ts, invariants.ts
  src/compile/      to-musicxml.ts
  src/import/       from-musicxml.ts (model importer, reports dropped features)
  src/engine/       commands.ts, history.ts, selection.ts, cursor.ts
  src/ui/           PepperScoreEditor.tsx, toolbar, palette, keymap.ts
  src/format/       pepperscore-file.ts (.pepperscore wrapper read/write)
  src/licence.ts    key check, staff cap
apps/reader/src/pages/editor.astro    demo page
```

## Native file format (`.pepperscore`)

```jsonc
{
  "pepperscore": { "version": 1 },          // integer, bumped on breaking model changes; loader migrates
  "meta": { "title", "subtitle", "composer", "arranger", "copyright", "created", "modified" },
  "document": { /* Model, below */ },
  "source": {                                // present when the score was imported, never mutated
    "format": "musicxml" | "mxl", "sha256": "…", "filename": "…",
    "dropped": [ { "feature": "ottava", "count": 2, "location": "P1/m12" } ]
  },
  "editor": { "zoom": 1, "cursor": { "partId", "measureId", "voice", "tick" } }   // optional, non-semantic
}
```

MIME `application/vnd.pepperscore+json`, extension `.pepperscore`. The `document` is the only semantic payload. The file is the format that "enables future editing": MusicXML exports are derived and lossy with respect to ids and editor state, the wrapper is not.

## Model

Zod schema in `src/model/schema.ts`. Naming follows MNX (global measures vs part measures, sequences of events, id references) so a future MNX exporter is a mapping, not a redesign. Every object has a stable `id` (nanoid, 10 chars). All references are by id, never by index.

```ts
type Document = {
  global: { measures: GlobalMeasure[] };          // one per bar, shared by all parts
  parts: Part[];                                  // max 4 staves in total (licence)
  layouts: Layout[];                              // at least one 'score' layout; see Layouts
  style: StyleSheet;                              // house style; see Styles and templates
};
type GlobalMeasure = {
  id: string;
  time?: { count: number; unit: 2|4|8|16 };       // change at this bar; inherited otherwise
  key?: { fifths: number; mode?: 'major'|'minor' };
  tempo?: { bpm: number; unit: DurationBase; text?: string };
  barline?: 'regular'|'double'|'final'|'dashed'|'invisible'; // right barline
  repeatStart?: boolean;
  repeatEnd?: { times?: number };                 // default 2 plays
  ending?: { numbers: number[]; open?: boolean }; // volta bracket covering this bar
  segno?: boolean; coda?: boolean; fine?: boolean;
  jump?: { type: 'dc'|'ds'; target: 'fine'|'coda'|'end' }; // D.C./D.S. al Fine, al Coda, D.C.
  toCoda?: boolean;
  rehearsal?: string;
};
type Part = {
  id: string; name: string; abbreviation?: string;
  instrument: { gmProgram: number; midiChannel?: number };
  staves: 1|2;                                    // piano = 2
  transposition?: { semitones: number; diatonic: number };
  measures: PartMeasure[];                         // same length as global.measures
};
type PartMeasure = {
  id: string;
  clefs?: { staff: number; clef: 'treble'|'bass'|'alto'|'tenor'|'percussion'|'treble8vb'; position?: Tick }[];
  sequences: Sequence[];                           // one per voice per staff, each fills the bar
  beams: { id: string; events: string[]; hooks?: { event: string; direction: 'left'|'right' }[] }[];
  directions: Direction[];                         // dynamics, text, wedges, anchored by tick
};
type Sequence = { id: string; voice: 1|2|3|4; staff: number; content: (Event|Tuplet)[] };
type Event = {
  id: string; type: 'event';
  duration: { base: DurationBase; dots: 0|1|2 };   // base: 'whole'|'half'|'quarter'|'eighth'|'16th'|'32nd'
  rest?: true;
  notes?: Note[];                                   // chord = several notes
  grace?: { slash: boolean };
  stem?: 'up'|'down';
  articulations?: ('staccato'|'tenuto'|'accent'|'marcato'|'staccatissimo'|'fermata')[];
  slurs?: { id: string; target: string; side?: 'up'|'down' }[];   // target = end event id
  fullMeasure?: true;                                // whole-bar rest
};
type Tuplet = { id: string; type: 'tuplet'; outer: {multiple: number; base: DurationBase}; inner: {multiple: number; base: DurationBase}; content: Event[]; bracket?: boolean };
type Note = { id: string; pitch: { step: 'A'..'G'; octave: number; alter: -2..2 }; tie?: { target: string }; accidental?: 'auto'|'show'|'hide'|'cautionary' };
type Direction = { id: string; anchor: Anchor; placement?: 'above'|'below'; offset?: Offset }
  & ({ kind: 'dynamic'; value: 'ppp'|'pp'|'p'|'mp'|'mf'|'f'|'ff'|'fff'|'sfz'|'fp' }
   | { kind: 'wedge'; shape: 'cresc'|'dim'; endTick: Tick; endMeasureId?: string }
   | { kind: 'text'; text: string; style?: 'plain'|'expression'|'tempo' });
type Tick = number;  // divisions per quarter = 960, position from bar start
type Anchor = { measureId: string; tick: Tick; staff: number; eventId?: string }; // semantic position; eventId pins to a note when present
type Offset = { x: number; y: number };          // staff spaces, relative to the engraver's default position; x along time, y up
```

Anchors and offsets: every text, symbol, dynamic and wedge endpoint is tied to a semantic `Anchor` (bar, tick, staff, optionally an event id), never to a pixel. Manual nudges are stored as `Offset` in staff spaces, which survive zoom, stave scale, page size and view changes, and compile to MusicXML `relative-x/relative-y` in tenths (1 space = 10 tenths) and to MEI `@ho/@vo`. Offsets live on the object for the score layout and in `Layout.overrides` for any other layout, so a nudge made in a part does not move the score.

Invariants (checked by `invariants.ts`, run after every command in dev and in tests):
- each sequence's content sums to exactly the bar length (rests are filled in automatically);
- beams reference events in one sequence, consecutive, all shorter than a quarter;
- ties connect notes of equal pitch in consecutive events; slurs reference events in the same part;
- endings only follow a `repeatStart`; `jump` to `coda` requires a `toCoda` and a `coda`; `fine` requires a `jump` targeting it;
- staff count across parts ≤ 4.

## Layouts (score and part views)

Today's single-part view is achieved by soloing or hiding staves. The model makes that explicit, following Dorico and MNX. The UI uses Dorico's vocabulary, **Layouts** (Full score, Parts, Custom score), with a layout selector beside the Page/Endless toggle; stave checkboxes plus a saved name make a Custom layout:

```ts
type Layout = {
  id: string; name: string; kind: 'score' | 'part' | 'custom';   // Dorico vocabulary: Full score, Part, Custom score
  parts: LayoutPart[];                                // ordered; omitted staves = all
  transposing: boolean;                               // transposing vs concert-pitch layout (Dorico: a layout property)
  breaks?: { measureId: string; type: 'system' | 'page' }[];
  style?: Partial<StyleSheet>;                        // per-layout overrides (staff size, margins, multirests)
  overrides: Record<string, LayoutOverride>;          // keyed by object id (direction, event, measure)
};
type LayoutPart = {
  partId: string; staves?: number[];
  /** Show this part for another instrument: a linked, view-time transform of the same music (see Instrument swap). */
  swap?: { instrument: InstrumentId; level: 'beginner' | 'intermediate' | 'advanced'; interval?: { semitones: number; diatonic: number };
           autoRange: boolean; rangeOverrides: Record<string, 0 | 12 | -12> };   // event id → octave shift chosen by the user
};
type LayoutOverride = { offset?: Offset; hidden?: boolean; text?: string; cue?: boolean };
```

### Instrument swap (linked parts, range fitting)

Showing a part for a different instrument (tenor sax as alto sax, alto sax as trumpet) never copies or generates staves. It is a `LayoutPart.swap`: the same music, linked to the source part, so any edit to either shows in both. The user is told this plainly in the UI ("Linked to Tenor Sax · changes affect both"). "Make a copy (own stave)" is the explicit action that unlinks it into a new part.

The only content difference a swap introduces is transposition:

- **Written pitch** follows the target instrument's transposition when the layout is transposing.
- **Range fitting.** The instrument schema records a playable range per level (`beginner`, `intermediate`, `advanced`). With `autoRange` on, a note or a whole passage that falls outside the target instrument's range at the chosen level is moved 8va or 8vb automatically; a passage is the run of consecutive out-of-range notes extended to the nearest phrase boundary (rest, slur end or bar line), so a phrase moves as one. The user can override any note or passage (`rangeOverrides`), and the override survives re-fitting.
- **Free transposition.** Because a swap is a transposition, the user may also set an arbitrary `interval` (a major third up, say) and still keep the link; it stays linked until turned into a copy.
- **Change highlights.** Every note whose written pitch differs from the source because of range fitting or a user override is highlighted (`ps-transposed`, default orange `--ps-transposed`), and the status line counts them ("12 notes moved 8vb for Alto Sax · beginner"). Plain instrument transposition (the whole part moving by the instrument's interval) is not highlighted; only notes moved relative to that.

The instrument schema (`src/model/instruments.ts`, later) holds per instrument: transposition, clef, GM program, and the three playable ranges as MIDI bounds; the viewer already carries GM mapping and transposition, so this extends that table rather than adding a second one.

`layouts[0]` is the conductor score. Creating a part layout per part is one command (`createPartLayouts`). The editor has an **active layout**; the viewer renders it through the existing hidden-staff view mechanism (`mei-view.ts`), with breaks and style passed as Verovio options or view MEI. Edits to content (pitches, rhythms, barlines) are global and apply everywhere; edits to position, visibility, cue size and text wording made while a part layout is active are stored as overrides for that layout only. Part-specific state (multirests, cue notes, break positions) is what the factory tunes most, which is why it is modelled now even though the v1 UI only exposes switching between layouts.

The `.pepperscore` file stores all layouts; MusicXML export writes the score layout, and optionally one file per part layout.

## Styles and templates (house style)

`StyleSheet` is a flat, versioned set of named values with three kinds of consumer:

- **Engraving options** passed to Verovio (page size, margins, staff size, spacing, music and text fonts, slur/beam thickness, justification). The existing settings such as `musicFont`, `staveFont`, `barsPerLine` and `zoom` fold into this.
- **Compile rules** applied when writing MusicXML (default placement of dynamics, rehearsal mark style, measure numbering, multirest threshold, whether to show cautionary accidentals, courtesy clefs and key signatures).
- **CSS hooks** (below).

A **template** is a named `StyleSheet` plus an ordered list of **rules**. A rule is a pure, idempotent transform `(document, context) => commands[]` run through the same command engine as user edits, so its results are undoable, inspectable and testable. Examples: rehearsal marks at double barlines, dynamics below the staff for instruments and above for voices, cue size for cue notes, system breaks every n bars in parts, multirests in parts, normalise text to the house vocabulary (rit., a tempo, D.S. al Coda). Templates are JSON files, versioned with the model.

Applying a template is `applyTemplate(document, template)`: set style, run rules, record one history entry. The factory is this function run headless (Node, Verovio WASM) over an imported score and then exported per layout; the editor exposes the same function in the toolbar. Both start in phase 2 with a minimal `StyleSheet` and no rules UI; rule authoring and template management are a later product.

**LLM assistance** (later): the headless pipeline already yields a page PNG plus `RenderGeometry` JSON per page, which is exactly the pair a vision model needs to critique spacing, collisions and placement and to propose fixes as commands. The command API is the integration contract; nothing else is needed in v1.

## Styling hooks

- Every SVG element keeps its Verovio id, and notes keep `data-note-id` (model id). The viewer gains a `highlights` prop: `{ ids: string[]; className: string }[]`, applied as classes on those elements after each draw. The editor uses it for selection, cursor, invariant errors and search hits; the factory uses it for rule diagnostics.
- Stable class names on all editor and viewer chrome (`ps-cursor`, `ps-selection`, `ps-anchor`, `ps-palette`, `ps-toolbar-*`), alongside utility classes, so hosts can restyle without forking.
- CSS custom properties for colours and strokes (`--ps-selection`, `--ps-cursor`, `--ps-highlight-error`, `--ps-anchor-handle`) with defaults in `style.css`.
- Offsets are edited by dragging an anchor handle rendered in the `overlay` layer; the drag delta is converted from pixels to staff spaces using the geometry's staff-space size, so the stored value is view-independent.

## View modes

The editor works in both viewer modes. **Endless** (continuous) is the comfortable editing mode; **vertical** (paged) shows the active layout's breaks and page style, so it is the publishing check. The cursor, selection overlay and anchor handles are positioned from `RenderGeometry`, which the viewer already supplies for both modes with system virtualisation. Switching mode preserves the cursor by id. Breaks are editable only in vertical mode (they have no meaning in endless).

## Compiler: model → MusicXML

`compileToMusicXml(doc): string`. Partwise 4.0. Deterministic ids: each event/note gets `id="<model id>"` so the viewer's identity map links SVG ↔ model with no extra work (the viewer already injects ids where missing and exposes them as `data-note-id`). Divisions 960. Beams emitted as begin/continue/end from the beam list; tuplets as time-modification plus tuplet notations; slurs/ties as notations with numbers allocated per overlap; endings, repeats, jumps as barline and direction-sound elements the viewer's navigation reader already consumes (`notation/navigation.ts`). Directions placed by `<offset>` ticks.

Exported MusicXML is the same compiler output, so "what you hear is what you export".

## Importer: MusicXML → model

`importMusicXml(text): { document, dropped[] }`, using the existing streaming tokenizer (`notation/xml-stream.ts`). Covers everything in the model; anything else (ottavas, lyrics, harmony, pedal, tremolo, cross-staff beams, cue notes, unpitched) is counted into `dropped` and shown as a one-time warning in the editor. Opening a score with more than 4 staves is refused with the licence message. Round-trip tests: import → compile → import must be a fixed point for every fixture in `validation/fixtures/` that is within scope.

## Editor engine

**State.** `EditorState = { document, selection, cursor, history, dirty }`, held in a Zustand store (as chordee2) with Immer. No framework-level context beyond that; the engine is UI-free and runs in Node for tests.

**Commands.** Every edit is a pure function `(state, args) => void` under Immer `produceWithPatches`. The command's forward and inverse patches, plus a label, are pushed on the history stack. Consecutive commands with the same `coalesceKey` within 500 ms merge (typing a pitch, nudging). Checkpoint snapshot of the document every 50 entries for cheap persistence. Undo applies inverse patches; patches are over id-keyed objects wherever possible so later concurrent-edit work can reuse them.

Score level: `setTime`, `setKey`, `setClef`, `setBarline`, `toggleRepeatStart`, `setRepeatEnd`, `setEnding`, `setJump`, `toggleSegno/Coda/ToCoda/Fine`, `insertMeasure`, `deleteMeasure`, `setTempo`.
Layout and style: `setActiveLayout`, `createPartLayouts`, `setBreak`, `setOverride`, `nudge` (offset in staff spaces), `setStyle`, `applyTemplate`.
Stave level: `enterEvent` (at cursor, duration from the active value), `setPitch`, `addChordNote`, `toggleRest`, `setDuration`, `toggleDot`, `makeTuplet`, `setBeamGroup` (groups of n), `breakBeam`, `joinBeam`, `toggleTie`, `addSlur`, `toggleArticulation`, `addDynamic`, `addWedge`, `addText`, `deleteSelection`, `moveSelection` (cut/paste).

Bar-length discipline follows MuseScore: entering an event at the cursor overwrites the duration to its right and refills the remainder with rests; it never pushes content into the next bar.

**Selection and cursor.** Selection is a set of model ids (events, notes, directions, measures). Cursor is `{ partId, staff, voice, measureId, tick }` with an active duration and entry mode (`select` | `enter`). Clicks resolve SVG → model id through the viewer's `data-note-id`; empty-staff clicks resolve to a measure and tick via the render geometry, which maps y to a staff line for pitch.

**Keymap** (`keymap.ts`, one table, also drives tooltips and the touch palette):
`N` toggle entry mode · `1`–`6` durations (32nd…whole) · `A`–`G` pitch (in the key, nearest octave) · `0` rest · `.` dot · `↑ ↓` step pitch, `Ctrl` octave · `← →` move cursor, `Ctrl` by bar, `Shift` extend selection · `T` tie · `S` slur · `Shift+S` staccato, `-` tenuto, `>` accent, `^` marcato · `Ctrl+3` `Ctrl+5` `Ctrl+6` `Ctrl+7` tuplet · `B` cycle beam group (2, 3, 4, automatic), `/` break beam · `D` dynamic popover · `K` key, `Q` time, `C` clef · `R` barline cycle (regular → double → repeat start → repeat end → final) · `V` ending · `J` jump popover · `Delete`/`Backspace` delete · `Ctrl+Z / Ctrl+Shift+Z` (or `Ctrl+Y`) undo/redo · `Space` play from cursor · `Esc` select mode.

Keymap ruling (MVP): symbol keys match the character typed, whatever modifiers produced it, so `>` is the accent and `^` the marcato on every layout, and `-` is the tenuto. Staccato is `Shift+S` rather than `Shift+.`, because `Shift+.` types `>` on US layouts and would collide with the accent.

**Touch.** A bottom palette (durations, pitch up/down, accidentals, rest, dot, tie, slur, articulations, undo/redo) and a long-press context sheet on the selection. Tap sets the cursor; the palette dispatches the same commands. Minimum 44 px targets; palette scrolls horizontally; tested at 390 px width.

## Rendering loop

On every history entry: compile → `musicXml` prop of the wrapped `<PepperScore>` → existing import worker → engrave. Debounced 80 ms; the viewer's revision tickets drop stale renders. Scroll position and zoom are preserved by the viewer; the editor re-applies the selection highlight after `onReady` using the ids. At ≤ 4 staves and a few hundred bars this is well under 100 ms per edit on the existing pipeline; measured in phase 2 against the chunked-engraving fixtures and recorded in the spec's results section.

Playback during editing uses the same compiled MusicXML; `Space` plays from the cursor's bar via the existing `seek`.

## Viewer extension surface (public package, phase 1)

Small and generic, nothing editor-specific:

- `onElementClick?(info: { noteId?: string; measureIndex: number; partId: string; staff: number; tick: number; staffLine: number; clientX, clientY })`, fired in addition to seek; when the host returns `false` the viewer does not seek.
- `overlay?: (geometry: RenderGeometry) => ReactNode`, rendered in a positioned layer over the SVG; `RenderGeometry` is the existing `RenderResult` points/measures/systems subset, in CSS pixels, plus `onChange`.
- `interactive?: boolean` to disable the built-in click-to-seek when a host takes over.
- `highlights?: { ids: string[]; className: string }[]`, applied to SVG elements by id after every draw.
- `layout?: { parts: { partId: string; staves?: number[] }[]; breaks?: …; style?: … }` as the explicit form of today's stave soloing; the existing solo/hide UI is expressed in these terms internally.
- `PepperScoreHandle.scrollToMeasure(index)`, `getGeometry()`, `renderPage(n): Promise<Blob>` (PNG, for the factory and later LLM review).

Documented in the README as the plugin surface. No licence logic in the public package.

## Licence and gating

`<PepperScoreEditor licenceKey="…">`. v1 key is an Ed25519-signed JSON `{ sub, exp, maxStaves }` verified client-side with the public key baked into the build; no key means read-only (viewer plus toolbar disabled) with an "Editing requires a licence" banner. `maxStaves` defaults to 4. Server-side checks are out of scope for v1; the gate is for packaging and product shape, not anti-piracy.

## Testing

- Editor package uses vitest (pure Node for model, compiler, importer, engine). Each command has forward and undo tests; invariants run after every test command.
- Round-trip fixtures: `fixtures/*.musicxml` → import → compile → import equality; compile output validated against the MusicXML 4.0 XSD in CI.
- Golden MusicXML snapshots for each score-level feature (repeats, endings, DC al Coda, DS al Fine, key/time/clef changes).
- Browser tests follow the repo's `validation/*.mjs` pattern: open `apps/reader` editor page, drive the keymap, assert on `data-note-id` elements and exported MusicXML; mobile viewport pass at 390 px.

## Phases

1. Viewer extension surface (public package): `onElementClick`, `overlay`, `interactive`, `highlights`, `layout`, handle additions. Changelog, docs.
2. Model (including layouts, anchors/offsets, minimal `StyleSheet`), schema, invariants, compiler, importer, `.pepperscore` wrapper, `applyTemplate` with a headless Node entry point, round-trip fixtures, performance measurement.
3. Score-level editing: toolbar + popovers for key, time, clef, barlines, endings, jumps, measure insert/delete; undo/redo; keymap skeleton.
4. Stave-level editing: cursor, entry mode, durations, pitches, chords, rests, dots, tuplets, beam groups, ties, slurs, articulations, dynamics, wedges, text; touch palette.
5. Persistence, licence gating, open/save `.pepperscore`, export MusicXML per layout, layout switching, nudge handles, demo page polish.
6. (later products) Rule authoring and template management UI; LLM-assisted engraving review.

Each phase is its own plan and PR.

## Open risks

- Verovio's MusicXML import may render some constructs differently from a direct MEI path (ending brackets across systems, wedge endpoints). Phase 2 measures this on fixtures; the fallback is a targeted MEI post-process in the viewer like the existing chord-symbol view transform.
- The viewer refreshes the whole document per edit. Acceptable at the 4-stave cap; incremental engraving is not planned.
- MNX is still a draft, so the model copies its shape, not its schema. An MNX exporter is possible later but not promised.
