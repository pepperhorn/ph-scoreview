# pepperscore editor: design

Status: draft for review, 2026-10-13. Branch `feat/score-editor`.

## Goal

A score editor layered on the public `pepperscore` viewer and playback, shipped as a separate, licence-gated package (`pepperscore-editor`, max 4 staves). The editor owns a JSON score model that compiles to MusicXML; the viewer engraves and plays that MusicXML exactly as it does any other file. MusicXML is the only interchange export in v1. A `.pepperscore` JSON wrapper is the native save format and is what makes a score editable again later.

Not a goal in v1: lyrics, tablature, percussion kits, chord symbols as editable objects, parts/layout editing, real-time collaboration, MEI export.

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
type Direction = { id: string; tick: Tick; staff: number; placement?: 'above'|'below' }
  & ({ kind: 'dynamic'; value: 'ppp'|'pp'|'p'|'mp'|'mf'|'f'|'ff'|'fff'|'sfz'|'fp' }
   | { kind: 'wedge'; shape: 'cresc'|'dim'; endTick: Tick; endMeasureId?: string }
   | { kind: 'text'; text: string; style?: 'plain'|'expression'|'tempo' });
type Tick = number;  // divisions per quarter = 960, position from bar start
```

Invariants (checked by `invariants.ts`, run after every command in dev and in tests):
- each sequence's content sums to exactly the bar length (rests are filled in automatically);
- beams reference events in one sequence, consecutive, all shorter than a quarter;
- ties connect notes of equal pitch in consecutive events; slurs reference events in the same part;
- endings only follow a `repeatStart`; `jump` to `coda` requires a `toCoda` and a `coda`; `fine` requires a `jump` targeting it;
- staff count across parts ≤ 4.

## Compiler: model → MusicXML

`compileToMusicXml(doc): string`. Partwise 4.0. Deterministic ids: each event/note gets `id="<model id>"` so the viewer's identity map links SVG ↔ model with no extra work (the viewer already injects ids where missing and exposes them as `data-note-id`). Divisions 960. Beams emitted as begin/continue/end from the beam list; tuplets as time-modification plus tuplet notations; slurs/ties as notations with numbers allocated per overlap; endings, repeats, jumps as barline and direction-sound elements the viewer's navigation reader already consumes (`notation/navigation.ts`). Directions placed by `<offset>` ticks.

Exported MusicXML is the same compiler output, so "what you hear is what you export".

## Importer: MusicXML → model

`importMusicXml(text): { document, dropped[] }`, using the existing streaming tokenizer (`notation/xml-stream.ts`). Covers everything in the model; anything else (ottavas, lyrics, harmony, pedal, tremolo, cross-staff beams, cue notes, unpitched) is counted into `dropped` and shown as a one-time warning in the editor. Opening a score with more than 4 staves is refused with the licence message. Round-trip tests: import → compile → import must be a fixed point for every fixture in `validation/fixtures/` that is within scope.

## Editor engine

**State.** `EditorState = { document, selection, cursor, history, dirty }`, held in a Zustand store (as chordee2) with Immer. No framework-level context beyond that; the engine is UI-free and runs in Node for tests.

**Commands.** Every edit is a pure function `(state, args) => void` under Immer `produceWithPatches`. The command's forward and inverse patches, plus a label, are pushed on the history stack. Consecutive commands with the same `coalesceKey` within 500 ms merge (typing a pitch, nudging). Checkpoint snapshot of the document every 50 entries for cheap persistence. Undo applies inverse patches; patches are over id-keyed objects wherever possible so later concurrent-edit work can reuse them.

Score level: `setTime`, `setKey`, `setClef`, `setBarline`, `toggleRepeatStart`, `setRepeatEnd`, `setEnding`, `setJump`, `toggleSegno/Coda/ToCoda/Fine`, `insertMeasure`, `deleteMeasure`, `setTempo`.
Stave level: `enterEvent` (at cursor, duration from the active value), `setPitch`, `addChordNote`, `toggleRest`, `setDuration`, `toggleDot`, `makeTuplet`, `setBeamGroup` (groups of n), `breakBeam`, `joinBeam`, `toggleTie`, `addSlur`, `toggleArticulation`, `addDynamic`, `addWedge`, `addText`, `deleteSelection`, `moveSelection` (cut/paste).

Bar-length discipline follows MuseScore: entering an event at the cursor overwrites the duration to its right and refills the remainder with rests; it never pushes content into the next bar.

**Selection and cursor.** Selection is a set of model ids (events, notes, directions, measures). Cursor is `{ partId, staff, voice, measureId, tick }` with an active duration and entry mode (`select` | `enter`). Clicks resolve SVG → model id through the viewer's `data-note-id`; empty-staff clicks resolve to a measure and tick via the render geometry, which maps y to a staff line for pitch.

**Keymap** (`keymap.ts`, one table, also drives tooltips and the touch palette):
`N` toggle entry mode · `1`–`7` durations (32nd…whole) · `A`–`G` pitch · `0` rest · `.` dot · `↑ ↓` step pitch, `Ctrl` octave · `← →` move cursor, `Shift` extend selection · `T` tie · `S` slur · `Shift+.` `-` `>` `^` staccato, tenuto, accent, marcato · `Ctrl+3..9` tuplet · `B` cycle beam group, `/` break beam · `D` dynamic popover · `K` key, `Q` time, `C` clef · `R` barline cycle (regular → double → repeat start → repeat end → final) · `V` ending · `J` jump popover · `Ctrl+Z / Ctrl+Shift+Z` undo/redo · `Space` play from cursor · `Esc` select mode.

**Touch.** A bottom palette (durations, pitch up/down, accidentals, rest, dot, tie, slur, articulations, undo/redo) and a long-press context sheet on the selection. Tap sets the cursor; the palette dispatches the same commands. Minimum 44 px targets; palette scrolls horizontally; tested at 390 px width.

## Rendering loop

On every history entry: compile → `musicXml` prop of the wrapped `<PepperScore>` → existing import worker → engrave. Debounced 80 ms; the viewer's revision tickets drop stale renders. Scroll position and zoom are preserved by the viewer; the editor re-applies the selection highlight after `onReady` using the ids. At ≤ 4 staves and a few hundred bars this is well under 100 ms per edit on the existing pipeline; measured in phase 2 against the chunked-engraving fixtures and recorded in the spec's results section.

Playback during editing uses the same compiled MusicXML; `Space` plays from the cursor's bar via the existing `seek`.

## Viewer extension surface (public package, phase 1)

Small and generic, nothing editor-specific:

- `onElementClick?(info: { noteId?: string; measureIndex: number; partId: string; staff: number; tick: number; staffLine: number; clientX, clientY })`, fired in addition to seek; when the host returns `false` the viewer does not seek.
- `overlay?: (geometry: RenderGeometry) => ReactNode`, rendered in a positioned layer over the SVG; `RenderGeometry` is the existing `RenderResult` points/measures/systems subset, in CSS pixels, plus `onChange`.
- `interactive?: boolean` to disable the built-in click-to-seek when a host takes over.
- `PepperScoreHandle.scrollToMeasure(index)`, `getGeometry()`.

Documented in the README as the plugin surface. No licence logic in the public package.

## Licence and gating

`<PepperScoreEditor licenceKey="…">`. v1 key is an Ed25519-signed JSON `{ sub, exp, maxStaves }` verified client-side with the public key baked into the build; no key means read-only (viewer plus toolbar disabled) with an "Editing requires a licence" banner. `maxStaves` defaults to 4. Server-side checks are out of scope for v1; the gate is for packaging and product shape, not anti-piracy.

## Testing

- Editor package uses vitest (pure Node for model, compiler, importer, engine). Each command has forward and undo tests; invariants run after every test command.
- Round-trip fixtures: `fixtures/*.musicxml` → import → compile → import equality; compile output validated against the MusicXML 4.0 XSD in CI.
- Golden MusicXML snapshots for each score-level feature (repeats, endings, DC al Coda, DS al Fine, key/time/clef changes).
- Browser tests follow the repo's `validation/*.mjs` pattern: open `apps/reader` editor page, drive the keymap, assert on `data-note-id` elements and exported MusicXML; mobile viewport pass at 390 px.

## Phases

1. Viewer extension surface (public package): `onElementClick`, `overlay`, `interactive`, handle additions. Changelog, docs.
2. Model, schema, invariants, compiler, importer, `.pepperscore` wrapper, round-trip fixtures, performance measurement.
3. Score-level editing: toolbar + popovers for key, time, clef, barlines, endings, jumps, measure insert/delete; undo/redo; keymap skeleton.
4. Stave-level editing: cursor, entry mode, durations, pitches, chords, rests, dots, tuplets, beam groups, ties, slurs, articulations, dynamics, wedges, text; touch palette.
5. Persistence, licence gating, open/save `.pepperscore`, export MusicXML, demo page polish.

Each phase is its own plan and PR.

## Open risks

- Verovio's MusicXML import may render some constructs differently from a direct MEI path (ending brackets across systems, wedge endpoints). Phase 2 measures this on fixtures; the fallback is a targeted MEI post-process in the viewer like the existing chord-symbol view transform.
- The viewer refreshes the whole document per edit. Acceptable at the 4-stave cap; incremental engraving is not planned.
- MNX is still a draft, so the model copies its shape, not its schema. An MNX exporter is possible later but not promised.
