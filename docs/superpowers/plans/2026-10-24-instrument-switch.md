# Instrument Switch (reader + embeds) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Readers and embeds can switch a part to another instrument (sound, clef, written transposition, octave-fitted into range at a chosen level), move notes or passages by an octave themselves, and keep those choices per score.

**Architecture:** The editor's instrument table and range-fitting rules move into pepperscore core behind a framework-free `pepperscore/instruments` entry; the editor re-imports them. In the reader, a pure Score-model transform (`applyInstrumentView`) runs after `scoreForView`: it fits each switched part at final sounding pitch and rewrites it as the target instrument, so playback, note names and the timeline read the switched score. The same result feeds the MEI spelling pass through per-staff `shift` (already used by the concert view), plus new per-staff `octaves` and `clef`, so Verovio engraves exactly what plays.

**Tech Stack:** TypeScript, React 19, Verovio 6.3.0 (worker), Vite library build, vitest (pure modules), Playwright validation scripts (`validation/*.mjs`), Directus (crf-admin), Astro (becreative).

**Spec:** `docs/superpowers/specs/2026-10-24-instrument-switch-and-string-fingering-design.md` (Part 1 only; Part 2 — violin/cello fingering and TAB — gets its own plan once this lands, since it builds on `applyInstrumentView` and the shared instrument model).

## Global Constraints

- Verovio 6.3.0 pinned; every MEI change must work on the whole, probe and chunked paths (`verovio.worker.ts` `viewWhole` / `viewChunk`).
- One implementation of the range-fit rules and one instrument table, shared by editor and reader (anti-goal: diverging copies).
- Never move or change a note without showing it: moved notes carry `ps-transposed`; out-of-range notes carry `ps-out-of-range`.
- Embed switcher list, in this order: Alto Sax, Tenor Sax, Bari Sax, Trumpet, Trombone, Flute, Clarinet, Violin, Viola, Cello, Double Bass, plus "As written" first.
- Levels: `beginner | intermediate | advanced`; host sets the initial level (default `intermediate`), readers can change it.
- Fit to range defaults on.
- A grand-staff source part (piano) switches all its staves together.
- Switched B♭/E♭ parts show written pitch by default, also in concert-basis scores.
- Range fitting runs after the score transpose (`semitones`) and key flip.
- A GM sound pick never implies an instrument switch.
- Embeds and the switcher/octave tool are hideable by the host (`controls.instrumentSwitch`, `controls.octaveTool`).
- becreative embeds pass `persist="becreative"`.
- UI: contextual class names alongside utility classes; Poppins; phone: frequent controls in the bottom toolbar.
- MIT: no copied GPL code.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; work on branch `feat/instrument-switch`; PR → review → fix → merge when CI green.

## Review Focus

- A tie across a bar line or a chunk boundary must never move on one side only (whole tie chain moves) — tests in Task 4 (`ties across bars move together`) and Task 5 (chunked render).
- A part that is already transposing (a B♭ clarinet) switched to alto sax must show alto's written pitch from the clarinet's *sounding* pitch, not its written one — Task 4 test `transposing source part`.
- Transposing the whole score after switching can push notes out of range; they must be refitted, not left out silently — Task 4 test `refits after semitones`.
- Drum-kit/percussion parts and TAB doubling parts (`tabOf`) are never offered, fitted or left orphaned: a TAB staff doubling a switched guitar is hidden — Task 4 test `tab doubling of a switched part is hidden`, Task 7 UI test.
- A saved record with a malformed `switch` entry (bad id, bad level, octave values other than -12, 0 or 12) opens the score with that part as written instead of failing — Task 6 test.

---

### Task 1: Shared instrument model in pepperscore core

**Files:**
- Create: `packages/pepperscore/src/lib/instrument-model.ts` (moved content of `packages/pepperscore-editor/src/model/instruments.ts`)
- Create: `packages/pepperscore/src/instruments.ts` (entry: re-exports `lib/instrument-model.ts` and, in Task 2, `lib/range-fit-core.ts`)
- Create: `packages/pepperscore/vitest.config.ts`, `packages/pepperscore/src/lib/instrument-model.test.ts`
- Modify: `packages/pepperscore/package.json` (exports `./instruments`, script `"test": "vitest run"`, devDependency `vitest` same version as the editor), `packages/pepperscore/vite.config.ts:54` (third lib entry `instruments`), root `package.json` (`test:pepperscore` = `npm run test -w pepperscore`, added to `test:validation` before `test:editor`)
- Modify: `packages/pepperscore-editor/src/model/instruments.ts` → thin re-export of `pepperscore/instruments` (keeps its import sites working), `packages/pepperscore-editor/tsconfig.json` (`paths` add `"pepperscore/instruments": ["../pepperscore/src/instruments.ts"]`), `packages/pepperscore-editor/vitest.config.ts` (`resolve.alias` same mapping)
- Move: `packages/pepperscore-editor/src/model/instruments.test.ts` → `packages/pepperscore/src/lib/instrument-model.test.ts`

**Interfaces:**
- Produces (from `pepperscore/instruments`): `INSTRUMENT_IDS`, `LEVELS`, `type InstrumentId`, `type Level`, `type Transposition = { semitones: number; diatonic: number }`, `type InstrumentClef = 'treble' | 'bass' | 'alto' | 'tenor' | 'percussion' | 'treble8vb'`, `type SpelledPitch = { step: 'A'|'B'|'C'|'D'|'E'|'F'|'G'; octave: number; alter: number }`, `type Instrument` (as today, `clef: InstrumentClef`), `INSTRUMENTS`, `instrumentName`, `instrumentFor(gmProgram)`, `pitchMidi`, `keyAlter`, `spellMidi`, `soundingMidi` (export it as `spelledSoundingMidi` to avoid clashing with `lib/transpose.ts` `soundingMidi`), `writtenPitch`, `transposePitchSpelled`, `transposePitch`, `writtenKeyFifths` (moved from editor `range-fit.ts`), and new `EMBED_INSTRUMENTS: InstrumentId[] = ['alto-saxophone','tenor-saxophone','bari-saxophone','trumpet','trombone','flute','clarinet','violin','viola','cello','double-bass']`.
- The model takes no zod types; editor `schema.ts` `Clef` / `Pitch` stay and must remain assignable to `InstrumentClef` / `SpelledPitch` (add a `satisfies`/type-equality check in the editor's `schema.ts`).

- [ ] **Step 1:** Add the vitest config (`{ test: { globals: true, environment: 'node', include: ['src/**/*.test.ts'] } }`) and move the editor's instruments test to `instrument-model.test.ts`, importing from `./instrument-model`; add `test('embed list is the eleven embed instruments in order', …)` asserting `EMBED_INSTRUMENTS` equals the Global Constraints order and every id is in `INSTRUMENTS` with `ranges`; move the `writtenKeyFifths` cases from `range-fit.test.ts` here.
- [ ] **Step 2:** Run `npm run test -w pepperscore` — expect FAIL (module missing).
- [ ] **Step 3:** Create `lib/instrument-model.ts` with the editor file's content (types switched to `InstrumentClef` / `SpelledPitch`), `writtenKeyFifths`, `EMBED_INSTRUMENTS`; create `src/instruments.ts`; wire exports, vite entry and scripts. Make `lib/score.ts` `InstrumentId` an alias of the model's.
- [ ] **Step 4:** Point the editor at it (re-export file, tsconfig paths, vitest alias); delete the editor's moved code and the `writtenKeyFifths` body in `range-fit.ts` (import it).
- [ ] **Step 5:** Run `npm run test -w pepperscore && npm run test:editor && npm run check && npm run build` — all PASS; `packages/pepperscore/dist/instruments.js` exists and imports no React.
- [ ] **Step 6:** Commit `refactor: shared instrument model in pepperscore/instruments`.

### Task 2: Range-fit core shared by editor and reader

**Files:**
- Create: `packages/pepperscore/src/lib/range-fit-core.ts`, `packages/pepperscore/src/lib/range-fit-core.test.ts`
- Modify: `packages/pepperscore/src/instruments.ts` (re-export), `packages/pepperscore-editor/src/engine/layout/range-fit.ts` (adapter over the core)

**Interfaces:**
- Produces:
  - `type Shift = 0 | 12 | -12`
  - `type FitEvent = { id: string; midi: number[] }` — one event (note or chord), its notes' judged MIDI (sounding plus interval).
  - `function joinRuns(runs: string[][], ties: [string, string][]): string[][]` — union-find merge of event-id runs linked by ties, order kept by first appearance.
  - `function tieChainOf(ties: [string, string][]): (id: string) => string[]` — the ordered chain containing `id` (itself alone if untied).
  - `function planShifts(phrases: FitEvent[][], range: { low: number; high: number } | undefined, autoRange: boolean): { shifts: Record<string, Shift>; bothWays: string[][]; stillOut: string[][] }` — per phrase: any note below → +12 for every event, above → −12, both → 0 (phrase listed in `bothWays`), still out after moving → keep move (listed in `stillOut`); no range or `autoRange` false → all 0. A chord counts as out if any note is out.
  - `function applyOverrides(shifts: Record<string, Shift>, overrides: Record<string, Shift>, chainOf: (id: string) => string[]): Record<string, Shift>` — each override extends along its tie chain; the first override met along a chain wins; overrides beat planned shifts.
- Consumes: nothing from Task 1 beyond the entry file.

- [ ] **Step 1:** Write `range-fit-core.test.ts`: `joinRuns merges runs linked by a tie`, `planShifts moves a phrase below range up as one`, `planShifts leaves a both-ways phrase and reports it`, `planShifts keeps a still-out move and reports it`, `a chord with one note out moves whole`, `no range or autoRange off plans no shifts`, `override extends along its tie chain`, `first override on a chain wins`, `override beats planned shift`. Use alto-sax intermediate range from `INSTRUMENTS` for concrete MIDI values.
- [ ] **Step 2:** Run `npm run test -w pepperscore` — FAIL.
- [ ] **Step 3:** Implement the four functions.
- [ ] **Step 4:** Rewrite editor `fitToRange` / `phrases` to build runs and ties from its schema and call `joinRuns`, `planShifts`, `applyOverrides`; diagnostics strings and octave-0..9 bound checks stay in the editor adapter, byte-identical.
- [ ] **Step 5:** Run `npm run test -w pepperscore && npm run test:editor` — all PASS with the editor's range-fit and apply-layout tests unchanged.
- [ ] **Step 6:** Commit `refactor: one range-fit core for editor and reader`.

### Task 3: Score import facts the switch needs

**Files:**
- Modify: `packages/pepperscore/src/lib/score.ts` (`Part.sourcePartId?: string`; `ScoreNote.slurStop?: boolean`), `packages/pepperscore/src/lib/notation/musicxml-source.ts` (set `sourcePartId` on every staff part at ≈412; set `slurStop` from `<notations><slur type="stop">`)
- Test: `validation/instrument-switch.mjs` (new, Playwright + Vite harness like `validation/transpose.mjs` / `transpose-harness.ts`), `validation/instrument-switch-harness.ts` (new); root `package.json` `test:instrument-switch` added to `test:validation`

**Interfaces:**
- Produces: `Part.sourcePartId` (the MusicXML `<score-part id>` all staves of that part share; undefined for ABC/MIDI single parts, where callers use `part.id`), `ScoreNote.slurStop`.
- Produces helper in `lib/instrument-view.ts` (created here, filled in Task 4): `sourcePartOf(part: Part): string` = `part.sourcePartId ?? part.id`.

- [ ] **Step 1:** Write harness checks: a two-staff piano MusicXML fixture yields two parts with the same `sourcePartId`; a slurred phrase marks `slurStop` on its last note; loading the same file twice yields identical `ScoreNote.id` lists and identical MEI `xml:id`s (proves saved octave moves can key on `ScoreNote.id`).
- [ ] **Step 2:** Run `npm run test:instrument-switch` — FAIL.
- [ ] **Step 3:** Implement the two fields.
- [ ] **Step 4:** Run `npm run test:instrument-switch && npm run test:transpose && npm run test:tab` — PASS.
- [ ] **Step 5:** Commit `feat(score): source part and slur-stop facts for the instrument switch`.

### Task 4: `applyInstrumentView` — the Score-model switch

**Files:**
- Create/fill: `packages/pepperscore/src/lib/instrument-view.ts`, `packages/pepperscore/src/lib/instrument-view.test.ts`

**Interfaces:**
- Consumes: Task 1 model, Task 2 core, Task 3 facts, `lib/transpose.ts` `soundingMidi(part, measure, note, semitones)`.
- Produces:
  - `type PartSwitch = { instrument?: InstrumentId; level: Level; autoRange: boolean; octaves: Record<string, 12 | -12> }` — keyed by part id (one per staff part); `instrument` undefined = as written; `octaves` keyed by `ScoreNote.id`.
  - `type StaffSwitch = { shift: [number, number]; clef?: InstrumentClef; octaves: Record<string, 12 | -12> }` — for the MEI pass: `shift` = [diatonic, semitones] written-view move of the staff, `octaves` keyed by MEI note id (`Pitch.sourceId`).
  - `type InstrumentViewResult = { score: Score; moved: string[]; outOfRange: string[]; staves: Record<string, StaffSwitch>; hiddenTab: string[] }` (`moved`/`outOfRange` are `ScoreNote.id`s; `staves` keyed by part id; `hiddenTab` = ids of TAB parts doubling a switched part).
  - `function switchablePart(part: Part): boolean` — false for drum kit/percussion and `tab` parts.
  - `function phrasesOf(part: Part): string[][]` — runs of pitched notes per voice per measure, broken at rests and after `slurStop`, joined by ties (`joinRuns`).
  - `function applyInstrumentView(score: Score, switches: Record<string, PartSwitch>, scorePitch: 'written' | 'concert'): InstrumentViewResult` — input is `scoreForView(...)` output.
- Rules (from the spec): judged pitch = `soundingMidi(part, measure, pitch, 0)` on the viewed score (already includes `semitones`/flip); range = `INSTRUMENTS[target].ranges[level]`; shifts = `applyOverrides(planShifts(...), octaves, chain)`; manual `octaves` also apply to unswitched parts (range of the part's own instrument for flagging only); output part has `instrument`, `gmProgram` (target's main sound), `clef` = target clef, measure clefs cleared, `transposition` = target's when `scorePitch === 'written'`, pitches rewritten (step/octave/alter/midi) so that **`soundingMidi(outPart, measure, pitch, 0)` equals judged MIDI + shift** for every note; spelling via `writtenPitch(…, writtenKeyFifths(concertKey, target.transposition))`. Grand staff: callers set the same `PartSwitch` on every part with one `sourcePartOf`; this function treats each part independently.

- [ ] **Step 1:** Write tests (fixtures built in-test as small `Score` objects): `piano melody to trumpet written is a major second up, treble clef, trumpet sound`; `concert view keeps sounding pitch`; `phrase below alto beginner range moves up and is listed in moved`; `ties across bars move together`; `transposing source part` (B♭ clarinet → alto sax uses clarinet sounding pitch); `refits after semitones` (same score via `scoreForView(…, 7)` moves a different phrase); `manual octave on an unswitched part moves its tie chain and flags out of range`; `drum kit and tab parts are not switchable`; `tab doubling of a switched part is hidden`; `playback invariant` (soundingMidi of every output note = judged + shift).
- [ ] **Step 2:** Run `npm run test -w pepperscore` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run test -w pepperscore` — PASS.
- [ ] **Step 5:** Commit `feat: applyInstrumentView score transform`.

### Task 5: Engrave the switch (MEI spelling pass)

**Files:**
- Modify: `packages/pepperscore/src/lib/notation/mei-spelling.ts` (`StaffSpec.octaves?: Record<string, 12 | -12>`, `StaffSpec.clef?: InstrumentClef`), `packages/pepperscore/src/lib/render.ts:216` (`spellingSpecFor` merges `InstrumentViewResult.staves`: switched staff gets `shift` and `clef`, any staff with moves gets `octaves`), `packages/pepperscore/src/lib/render.ts:414` (ViewSpec unchanged shape)
- Test: `validation/instrument-switch-harness.ts`, `validation/instrument-switch.mjs`

**Interfaces:**
- Consumes: `StaffSwitch` (Task 4).
- Clef mapping (MEI): treble `G`/2; bass `F`/4; alto `C`/3; tenor `C`/4; treble8vb `G`/2 with `clef.dis="8" clef.dis.place="below"`. The staff's `staffDef` gets it and inline `<clef>` elements in that staff's layers are removed.
- `octaves` move a note's `@oct` by ±1 (and its `@oct.ges` if present) after the staff shift; accidentals are re-evaluated by the existing pass.
- The worker's cache key already includes `view.spelling` (`verovio.worker.ts:177`), so no key change is needed; assert it.

- [ ] **Step 1:** Harness checks: piano fixture switched to alto sax renders the right-hand staff with treble clef and notes a major sixth up (read note `@pname/@oct` from the view MEI); left hand switched too (grand staff) renders treble; a moved phrase renders an octave up with `ps-transposed` on its chord elements; a 40-bar fixture forced into chunked mode (`scoreflow-chunking` hook) with a tie across a chunk boundary renders both tied notes moved.
- [ ] **Step 2:** Run `npm run test:instrument-switch` — FAIL.
- [ ] **Step 3:** Implement `octaves` and `clef` in the pass and the `spellingSpecFor` merge.
- [ ] **Step 4:** Run `npm run test:instrument-switch && npm run test:transpose && npm run test:chunks && npm run test:tab` — PASS.
- [ ] **Step 5:** Commit `feat: engrave switched staves (shift, octave moves, clef)`.

### Task 6: Reader wiring, settings API and saved state

**Files:**
- Modify: `packages/pepperscore/src/components/PepperScore.tsx` (state, pipeline ≈409–412, playback program, highlights, restore ≈509–530, write ≈466), `packages/pepperscore/src/lib/prefs.ts` (`PepperScoreSettings`), `packages/pepperscore/src/lib/chrome.ts` (`PepperScoreControls` adds `instrumentSwitch`, `octaveTool`), `packages/pepperscore/src/lib/file-state.ts` + `file-state.schema.json` (`PartState.switch?`), `packages/pepperscore/src/styles.css` (`.ps-out-of-range`, colour `var(--ps-out-of-range, #c62828)`), `packages/pepperscore/src/index.ts` (export new types)
- Test: `validation/score-db.mjs`, `validation/api.mjs`, `validation/instrument-switch.mjs`

**Interfaces:**
- Consumes: `applyInstrumentView`, `PartSwitch`, `sourcePartOf`, `switchablePart`.
- Produces:
  - Settings: `instrument?: InstrumentId` (first switchable source part), `instruments?: Record<string, InstrumentId>` (keys = 1-based source-part number as a string; wins over `instrument`), `rangeLevel?: Level` (default `'intermediate'`), `autoRange?: boolean` (default `true`). Applied only when the score has no saved record (same precedence as other settings).
  - Controls: `instrumentSwitch`, `octaveTool` (default on in `full`, off otherwise, via `resolveChrome`).
  - Component state: `partSwitches: Record<string, PartSwitch>`; `setPartInstrument(sourcePart: string, instrument: InstrumentId | undefined)` sets every staff part of that source part; `setPartLevel`, `setPartAutoRange` likewise; `setOctaves(partId, octaves)`.
  - Pipeline: `displayScore = applyInstrumentView(scoreForView(score, scorePitch, semitones, flip), partSwitches, scorePitch).score`; `concertBasis` forcing applies only when no part is switched to an instrument with non-zero transposition; `hiddenTab` ids join the hidden set for rendering only (not saved); the Pitch panel hint text covers switched parts ("Switched parts show their instrument's written pitch").
  - Highlights: internal entries `{ ids: moved, className: 'ps-transposed' }` and `{ ids: outOfRange, className: 'ps-out-of-range' }` merged before host `highlights`.
  - Saved: `PartState.switch?: { instrument?: InstrumentId; level: Level; autoRange: boolean; octaves?: Record<string, 12 | -12> }`. Record stays `version: 2` with an optional field (same precedent as the TAB settings — my call, instead of the spec's version bump; older records open unchanged). Invalid entries are dropped per part.

- [ ] **Step 1:** Tests: `score-db.mjs` round-trips a record with `switch` and drops malformed ones (bad id, `level: 'expert'`, octave value 7); `api.mjs` asserts the new settings/controls keys appear in the public types and schema enums match `INSTRUMENT_IDS`/`LEVELS`; `instrument-switch.mjs` mounts `PepperScore` with `settings={{ instrument: 'alto-saxophone' }}` on the piano fixture and checks clef, transposed notes, `ps-transposed` highlights, and that playback schedules alto sax program 66 notes at the fitted sounding pitch (via the timeline exposed in the harness).
- [ ] **Step 2:** Run `npm run test:score-db && npm run test:api && npm run test:instrument-switch` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run those plus `npm run test:reader && npm run test:embed && npm run check` — PASS.
- [ ] **Step 5:** Commit `feat: instrument switch settings, pipeline and saved state`.

### Task 7: Full reader UI — Instrument separate from Sound

**Files:**
- Modify: `packages/pepperscore/src/components/PepperScore.tsx` (picker ≈1511–1526 and UI ≈1638–1642), `packages/pepperscore/src/styles.css`
- Create: `packages/pepperscore/src/components/InstrumentChooser.tsx` (shared with Task 8)
- Test: `validation/reader.mjs` (or the reader UI script that covers the mixer)

**Interfaces:**
- Produces: `InstrumentChooser({ instruments, current, level, autoRange, onInstrument, onLevel, onAutoRange, compact }: { instruments: InstrumentId[]; current: InstrumentId | undefined; level: Level; autoRange: boolean; onInstrument(id: InstrumentId | undefined): void; onLevel(level: Level): void; onAutoRange(on: boolean): void; compact?: boolean })` — renders "As written" first, then `instruments` with icons and `instrumentName`, a level segmented control (Beginner / Intermediate / Advanced), and a "Fit to range" toggle. Class names: `instrument-chooser`, `instrument-chooser-option`, `instrument-level`, `instrument-fit-toggle`.
- Mixer: the part's picker gets two sections, **Instrument** (`InstrumentChooser` with all 16 minus drum kit for pitched parts) and **Sound** (today's GM grid, sound only, unchanged behaviour; heading stays "Choose a playback sound"). Choosing an instrument sets its main sound; a later sound pick changes only `gmProgram`/`gmSoundfont`.
- Hidden when `controls.instrumentSwitch` is false; drum-kit and TAB parts show only Sound.

- [ ] **Step 1:** Test: open the mixer picker for the piano part, choose Trumpet → staff re-renders in treble a tone up, the part icon shows trumpet; then pick the "Orchestral Harp" sound → notes unchanged, instrument still trumpet; choose "As written" → original engraving; with `controls={{ instrumentSwitch: false }}` the Instrument section is absent.
- [ ] **Step 2:** Run the reader test — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run test:reader && npm run test:layout` — PASS.
- [ ] **Step 5:** Commit `feat(reader): instrument choice separate from playback sound`.

### Task 8: Embed switcher

**Files:**
- Modify: `packages/pepperscore/src/components/PepperScore.tsx` (minimal chrome controls), `packages/pepperscore/src/styles.css`
- Test: `validation/embed.mjs`

**Interfaces:**
- Consumes: `InstrumentChooser` (Task 7), `EMBED_INSTRUMENTS`.
- Produces: in `minimal` chrome with `controls.instrumentSwitch`, a button `.instrument-switch` (aria-label "Choose your instrument", shows the current instrument icon) next to the play button; it opens a popover `.instrument-menu` with `InstrumentChooser` (`instruments = EMBED_INSTRUMENTS`, `compact`). Multi-part scores list switchable source parts first (one row per source part, grand staff = one row), then the chooser for the picked part. Phone (`deviceClass` phone): the button lives in the bottom toolbar.

- [ ] **Step 1:** Test: minimal-chrome embed with `controls={{ instrumentSwitch: true }}` shows the button; choosing Cello on the piano fixture renders both staves in bass clef and fitted; the menu lists exactly "As written" + the eleven embed instruments in order; without the control the button is absent; a two-part score lists both parts first.
- [ ] **Step 2:** Run `npm run test:embed` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run test:embed && npm run test:reader` (firefox/webkit matrix runs in CI) — PASS.
- [ ] **Step 5:** Commit `feat(embed): instrument switcher`.

### Task 9: Octave tool

**Files:**
- Create: `packages/pepperscore/src/components/OctaveTool.tsx`
- Modify: `packages/pepperscore/src/components/PepperScore.tsx` (`onScoreClick` ≈1319: when the tool is on, a note click selects instead of seeking/reporting), `packages/pepperscore/src/styles.css`
- Test: `validation/instrument-switch.mjs`

**Interfaces:**
- Consumes: `phrasesOf`, `tieChainOf`, `setOctaves`, `PartSwitch.octaves`.
- Produces: `OctaveTool({ selection, onUp, onDown, onPhrase, onReset, onDone })` toolbar `.octave-toolbar` with buttons `.octave-up` ("8va ↑", aria "Move selection up an octave"), `.octave-down` ("8vb ↓"), `.octave-phrase` ("Select phrase"), `.octave-reset` ("Reset"), `.octave-done` ("Done"). Entry button `.octave-tool-toggle` beside the instrument controls (embed menu and drawer Pitch panel), shown when `controls.octaveTool`.
- Selection rules: click a note → that note's tie chain in its part; Shift-click or a second click with a selection in the same part → all notes of that part whose (measure, start) lies between the two, all voices, each extended to its tie chain; "Select phrase" → the `phrasesOf` phrase(s) containing the selection. Selection shows with `ps-selection`. Up/Down move each selected note an octave relative to its shown pitch, stored in `octaves` as -12, 0 or +12 (a 0 override pins the note as written against range fitting). Reset clears that part's `octaves`. Saved with the part's switch entry.

- [ ] **Step 1:** Test: with the tool on, clicking a note does not seek and selects its tie chain; Shift-click selects the passage; 8va moves it (renders an octave up, `ps-transposed`); moving past the range marks `ps-out-of-range`; 8vb after 8va returns to as-written; Reset clears; reload with persist restores the move; `controls={{ octaveTool: false }}` hides the toggle.
- [ ] **Step 2:** Run `npm run test:instrument-switch` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run test:instrument-switch && npm run test:reader && npm run test:embed` — PASS.
- [ ] **Step 5:** Commit `feat: reader octave tool`.

### Task 10: Docs, version, release prep

**Files:**
- Create: `docs/specs/instrument-switch.md` (behaviour reference in the style of `docs/specs/guitar-tab.md`)
- Modify: `packages/pepperscore/README.md` (settings/controls tables, `pepperscore/instruments` entry), `packages/pepperscore/CHANGELOG.md`, `packages/pepperscore/package.json` version `0.4.0`, `packages/pepperscore-editor/CHANGELOG.md` (model now from pepperscore), root `README.md` if it lists settings

- [ ] **Step 1:** Write the docs; bump version.
- [ ] **Step 2:** Run `npm run check && npm run build && npm run test:validation && npm run test:pack` — PASS.
- [ ] **Step 3:** Commit `docs: instrument switch; pepperscore 0.4.0`; open the PR, review, fix, merge when CI is green.
- [ ] **Step 4:** Publishing pepperscore 0.4.0 to npm is outward-facing: confirm with the user before `npm publish` (0.3.0 is also unpublished; publishing 0.4.0 supersedes it).

### Task 11: Hosts — becreative and crf-admin

**Files (repo `/home/shaun/becreative`, branch from `feat/score-block-all-options`):**
- Modify: `src/components/score/ScoreEmbed.tsx` (`persist="becreative"`; settings `instrument`, `rangeLevel`, `autoRange`; controls `instrumentSwitch`, `octaveTool`; drop the 0.3.0 compat types once on ≥0.4.0), `src/lib/score-block.ts` (`scoreBlockSettings`: `instrument` → `instrument`, `range_level` → `rangeLevel`, `auto_range === false` → `autoRange: false`; `scoreBlockControls`: `show_instrument_switch`, `show_octave_tool` true only), `package.json` (`pepperscore` `0.4.0`), `src/components/score/docs/README.md`
- Test: `tests/score-block.test.ts` (new cases for each field and defaults), existing `tests/guitar-tunings.test.ts` unchanged

**crf-admin (Directus `block_score`, via the crf-admin MCP; confirm with the user before changing the production schema):** new group "Instrument" with `instrument` (select-dropdown: As written (null) + the eleven embed instruments), `range_level` (select-radio Beginner / Intermediate / Advanced, default `intermediate`), `auto_range` (boolean, default true, label "Fit notes into the instrument's range"), `show_instrument_switch` (boolean, label "Let readers switch instrument"), `show_octave_tool` (boolean, label "Let readers move notes by an octave").

- [ ] **Step 1:** Write the score-block tests; run `pnpm vitest run tests/score-block.test.ts` — FAIL.
- [ ] **Step 2:** Implement the mapping and ScoreEmbed changes (after pepperscore 0.4.0 is published).
- [ ] **Step 3:** Run `pnpm vitest run && pnpm astro check` — PASS.
- [ ] **Step 4:** Commit, push, PR in becreative; add the Directus fields after user confirmation.
