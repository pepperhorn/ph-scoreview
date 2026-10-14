# Score Editor Phase 2: Layouts, Instrument Swap and the Mock's Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `pepperscore-editor` up to the approved `/design` mock (desktop shell, phone shell) and implement Layouts with the linked instrument swap and range fitting.

**Architecture:** Layouts stay a model concept; the editor compiles a *view document* for the active layout (`applyLayout`) and feeds that to the viewer, while export compiles the full score. Ids are preserved through the view transform so clicks and highlights keep working. Swapped parts are never copied; `makeCopy` is the explicit unlink. The UI is rebuilt from the mock's CSS and structure (`apps/reader/src/embed/EditorDesign.tsx`, `editor-design.css`), moved into the package as real components driven by the command engine.

**Tech Stack:** as phase 1 (React 19, Zod 4, Immer, Zustand, vitest, playwright-core validation scripts).

**Spec:** `docs/superpowers/specs/2026-10-13-score-editor-design.md` (sections "Layouts", "Instrument swap", "Styling hooks", "View modes"). Mock: `apps/reader/src/pages/design.astro` and `src/embed/EditorDesign.tsx` + `editor-design.css` (PR #37).

## Global Constraints

- Public `pepperscore` stays generic; the only viewer changes allowed here are the two bugs the mock found: the `ps-cursor-measure` outline must be visible at any zoom, and a `--ps-transposed` highlight rule.
- Ids never change through `applyLayout`; the view document's notes carry the same ids as the source.
- Swap never copies staves. `makeCopy` is the only command that creates a part from a swap.
- Range fitting moves by whole octaves only (`0 | 12 | -12`); passages extend to phrase boundaries (rest, slur end, bar line).
- Highlight class for moved notes: `ps-transposed`, colour `--ps-transposed` default `#d9741c`. Selection is `--ps-selection` default `#2f6a9a` (ink blue, as the mock).
- All chrome uses `ps-` class names; Poppins UI, Newsreader for the score title; CSS variables `--ps-paper`, `--ps-ink`, `--ps-accent`, `--ps-cursor`, `--ps-selection`, `--ps-transposed`.
- Phone (container ≤ 760px): header two rows ≤ 88px, auto-collapses to a 28px strip after 4 s idle, returns on scroll or tap; toolbar is a fixed bottom bar with a ≤ 32px tab strip (Value, Pitch, Bar, Score, Layout) and at most two rows of 44px targets; popovers open as an inline strip in the toolbar; the score remains scrollable.
- Desktop: keycap rail (56×52), popovers never cover the cursor bar (left, right, above, below in that order), layout selector beside Page/Endless, inspector tabs Score / Stave / Layout, "+ / −" add-bar buttons at the last system, hint strip, status line.
- Licence model unchanged in this phase (open question in PR #36).
- Tests: unit under `packages/pepperscore-editor/src/**/*.test.ts`; browser in `validation/editor.mjs` (extend) and a new `validation/editor-phone.mjs`.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A swap on a transposing layout with `interval` set must transpose written pitch by instrument transposition *and* the interval, and the highlight must mark only octave-moved notes, not the whole part (Task 2 test `interval plus instrument transposition`).
2. Editing a note in a swapped view must change the source part (ids shared), and the swap re-fits after the edit without losing `rangeOverrides` (Task 2 test `edit through the view keeps overrides`).
3. Undo of `makeCopy` must remove the new part and restore the swap (Task 2 test `makeCopy undo`).
4. Phone header auto-collapse must not steal keyboard focus or cancel note entry; collapse timer resets on any dispatch (Task 5 browser test).
5. Opening a `.pepperscore` saved before this phase (layouts without `kind: 'custom'`, no `transposing`) must load with defaults (Task 1 test `legacy layout defaults`).

---

### Task 1: Model, instruments schema and migration defaults

**Files:**
- Modify: `packages/pepperscore-editor/src/model/schema.ts` (`LayoutSchema`, new `LayoutPartSchema`, `SwapSchema`)
- Create: `packages/pepperscore-editor/src/model/instruments.ts`
- Modify: `src/model/create.ts` (`createDocument` → `layouts[0] = { kind: 'score', name: 'Full score', transposing: true, ... }`), `src/import/from-musicxml.ts` (same), `src/format/pepperscore-file.ts` (no version bump; Zod defaults)
- Test: `src/model/instruments.test.ts`, `src/model/schema.test.ts` (extend), `src/format/pepperscore-file.test.ts` (extend)

**Interfaces (produces):**

```ts
// instruments.ts
export type InstrumentId = 'piano'|'guitar'|'bassguitar'|'double-bass'|'drum-kit'|'alto-saxophone'|'tenor-saxophone'|'bari-saxophone'|'flute'|'clarinet'|'trumpet'|'trombone'|'violin'|'viola'|'cello'|'microphone';
export type Level = 'beginner'|'intermediate'|'advanced';
export type Instrument = { id: InstrumentId; label: string; gmProgram: number; clef: Clef; transposition: { semitones: number; diatonic: number }; // written minus sounding
  ranges?: Record<Level, { low: number; high: number }> };   // sounding MIDI, inclusive; absent for unpitched
export const INSTRUMENTS: Record<InstrumentId, Instrument>;
export function instrumentFor(gmProgram: number): Instrument;   // nearest by GM program, default piano
export function soundingMidi(pitch: Pitch, transposition: { semitones: number }): number;
export function writtenPitch(soundingMidi: number, transposition: { semitones: number; diatonic: number }, keyFifths: number): Pitch;  // spelled for the key
// schema.ts
export const SwapSchema = z.object({ instrument: z.enum([...]), level: z.enum(['beginner','intermediate','advanced']), interval: z.object({ semitones: z.number().int(), diatonic: z.number().int() }).optional(), autoRange: z.boolean().default(true), rangeOverrides: z.record(z.string(), z.union([z.literal(0), z.literal(12), z.literal(-12)])).default({}) });
export const LayoutPartSchema = z.object({ partId: z.string(), staves: z.array(z.number().int()).optional(), swap: SwapSchema.optional() });
export const LayoutSchema = z.object({ id, name, kind: z.enum(['score','part','custom']).default('score'), parts: z.array(LayoutPartSchema), transposing: z.boolean().default(true), breaks, style, overrides });
```

Transposition table (written − sounding, semitones/diatonic): clarinet +2/+1, trumpet +2/+1, alto-saxophone +9/+5, tenor-saxophone +14/+8, bari-saxophone +21/+12, guitar +12/+7, bassguitar +12/+7, double-bass +12/+7, others 0/0. Ranges (sounding MIDI low–high; beginner / intermediate / advanced): flute 60–84 / 60–91 / 59–96; clarinet 50–74 / 50–82 / 50–91; alto-saxophone 49–69 / 49–77 / 49–81; tenor-saxophone 44–64 / 44–72 / 44–76; bari-saxophone 37–57 / 37–65 / 36–69; trumpet 55–72 / 54–79 / 52–86; trombone 46–65 / 40–70 / 34–77; violin 55–81 / 55–91 / 55–105; viola 48–76 / 48–84 / 48–96; cello 36–64 / 36–76 / 36–88; double-bass 28–48 / 28–55 / 28–64; guitar 40–64 / 40–76 / 40–88; bassguitar 28–48 / 28–55 / 28–60; piano 21–108 all; microphone 48–72 / 45–76 / 40–81; drum-kit none.

- [ ] Tests first: `INSTRUMENTS['alto-saxophone'].transposition` is `{9,5}`; `soundingMidi({C,5,0}, alto)` is 63; `writtenPitch(63, alto, 0)` is `{C,5,0}`; `writtenPitch(61, clarinet, 2 fifths)` spells `D#4`→ in D major as `{D,4,1}`; legacy layout `{ id, name, kind:'score', parts:[{partId}], overrides:{} }` parses with `transposing: true`; a saved file from phase 1 (fixture JSON) opens.
- [ ] Implement; run `npm test -w pepperscore-editor`, `npm run check`; commit `feat(editor): instruments schema with ranges; layout kinds, transposing and swap in the model`.

---

### Task 2: Layout engine, `applyLayout`, range fitting, swap commands

**Files:**
- Create: `src/engine/layout/apply-layout.ts`, `src/engine/layout/range-fit.ts`, `src/engine/commands/layouts.ts`
- Modify: `src/engine/commands/index.ts`, `src/engine/types.ts` (`EditorState.activeLayoutId` exists; add `view: { document: Document; moved: string[] }` derived in the store after each change)
- Test: `src/engine/layout/apply-layout.test.ts`, `range-fit.test.ts`, `src/engine/commands/layouts.test.ts`

**Interfaces:**

```ts
export type ViewResult = { document: Document; moved: Record<string, 12 | -12>; counts: { moved: number; partId?: string; direction?: 'up'|'down' } };
export function applyLayout(doc: Document, layoutId: string): ViewResult;
// range-fit.ts
export type Phrase = { eventIds: string[] };
export function fitToRange(part: Part, keyByMeasure: (i: number) => Key, source: Instrument, target: Instrument, level: Level, interval: {semitones;diatonic} | undefined, overrides: Record<string, 0|12|-12>, autoRange: boolean): { part: Part; moved: Record<string, 12|-12> };
// commands/layouts.ts
setActiveLayout({ layoutId })                               // record:false
createCustomLayout({ name, parts: LayoutPart[] })           // becomes active
createPartLayouts()                                         // one 'part' layout per part, idempotent by partId
setLayoutParts({ layoutId, parts })                         // checkboxes
setLayoutTransposing({ layoutId, transposing })
setSwap({ layoutId, partId, swap: Swap | null })
setRangeOverride({ layoutId, partId, eventId, shift: 0|12|-12|null })  // null removes
makeCopy({ layoutId, partId })                              // new Part with baked written pitches (per layout transposing), name "<Target> (from <Source>)", swap removed, layout part replaced by the new part; undoable
```

`applyLayout`: filter and order parts per layout; for each `LayoutPart`: if `staves` set, keep only those sequences/clefs; if `swap`, run `fitToRange` (source instrument from `part.instrument.gmProgram` via `instrumentFor`, target from `swap.instrument`), replace the part's name with the target label and `instrument.gmProgram`; if the layout is not transposing, rewrite written pitches to concert (via `writtenPitch(sounding, {0,0}, key)`). Apply `overrides` (`hidden`, `text`, `offset` onto directions). Return moved ids and a summary.

`fitToRange`: for every note compute sounding (source transposition), add `interval` semitones if set, then new written for the target (`writtenPitch` with target transposition when transposing). Range check against the target `ranges[level]` on the *sounding plus interval* value. Build phrases: walk each sequence; an out-of-range note starts or joins a phrase; the phrase extends backwards and forwards to the nearest boundary (a rest event, the end of a slur, or the bar line); all notes of the phrase shift by the same octave (12 if below range, −12 if above; if the phrase contains notes out of range in both directions, no shift and a diagnostic). `overrides[eventId]` beats the computed shift for that event only. Return the new part and the `moved` map (only events whose shift ≠ 0). Unpitched instruments (`ranges` absent) skip fitting.

The store computes `view = applyLayout(document, activeLayoutId)` after every state change (memoised on document + layout id); the UI compiles `view.document`. Clicks use the same ids. Export uses `compileToMusicXml(document, { layoutId: layouts[0].id })`.

- [ ] Tests first (each asserts invariants clean on the result):
  - `applyLayout` on the full score returns the document unchanged (same reference for parts) and `moved` empty.
  - Custom layout with two of four parts and `staves: [1]` for the piano → view has two parts, piano has one staff.
  - `interval plus instrument transposition`: tenor sax part (written C5 = sounding Bb3) swapped to alto sax, intermediate, interval none → written for alto is G5? compute: sounding 58 → alto written 58+9=67 → `{G,4,1}`? assert exact; with `interval {4,2}` (major third up) sounding 62 → written 71 `{B,4,0}`; `moved` empty because in range.
  - Range fitting: alto beginner (49–69): a phrase C5–E5–G5 (sounding 72–79 after transposition) above range → whole phrase moved −12, `moved` lists the three events, boundary at the following rest; a note in the middle in range still moves with the phrase.
  - Both-direction phrase → no shift and a diagnostic string.
  - `edit through the view keeps overrides`: setRangeOverride on one event, then `setPitch` on another event through the store; `view.moved` still honours the override.
  - `makeCopy undo`: after makeCopy, parts length +1, layout part points to the new part, pitches baked; undo restores.
  - Non-transposing layout renders concert pitch for a clarinet part.
- [ ] Implement; tests pass; commit `feat(editor): layouts engine, applyLayout view transform, range fitting and swap commands`.

---

### Task 3: Viewer fixes from the mock

**Files:**
- Modify: `packages/pepperscore/src/styles.css` (`.ps-cursor-measure` outline using `vector-effect: non-scaling-stroke` or an overlay rect with px stroke; `.ps-transposed` fill/stroke `var(--ps-transposed,#d9741c)`; `.ps-selection` default to `#2f6a9a`), `packages/pepperscore/CHANGELOG.md`
- Test: `validation/embed.mjs` (assert the measure highlight renders a visible outline: computed stroke width ≥ 1.5px in screen space; assert `ps-transposed` class survives a redraw)

- [ ] Implement, run `npm run build && npm run test:embed`; commit `fix(pepperscore): visible measure highlight outline; ps-transposed highlight`.

---

### Task 4: Desktop shell from the mock

**Files:**
- Rewrite: `packages/pepperscore-editor/src/ui/PepperScoreEditor.tsx` (composition only; ≤ 300 lines), `Toolbar.tsx` → `TopBar.tsx` + `Rail.tsx`, `Popover.tsx` (collision placement), `src/style.css` (port `editor-design.css`, keep `ps-` names)
- Create: `src/ui/Inspector.tsx` (tabs Score / Stave / Layout; Layout tab content in Task 6), `src/ui/CanvasHeader.tsx` (entry badge, position, layout selector, Page/Endless, zoom), `src/ui/HintStrip.tsx`, `src/ui/StatusLine.tsx`, `src/ui/AddBarButtons.tsx`, `src/ui/placement.ts` (pure popover placement: `placePopover(cursorRect, popoverSize, viewport): { left, top, side }` with order left, right, above, below)
- Test: `src/ui/placement.test.ts`; `validation/editor.mjs` extended (rail keycaps present, layout selector present, Key popover does not intersect the cursor bar rect, add-bar "+" inserts a bar, "−" deletes)

Behaviour: identical commands as phase 1; the rail replaces the old toolbar's value group; TopBar holds title (Newsreader), composer, key/time/tempo chips (open their popovers), undo/redo, Play, Save, Export, licence badge; CanvasHeader has the Page/Endless toggle wired to the viewer `view` prop and the layout selector (`setActiveLayout`); HintStrip renders six bindings from `KEYMAP`; StatusLine shows invariant state, cursor position and the moved-note count from `view.counts`. The cursor-bar rect for placement comes from the viewer DOM (`[data-ps-highlight~="ps-cursor-measure"]` or the cursor note's element) via `getBoundingClientRect`.

- [ ] Build, verify in the demo at 1440×900 against `/design` side by side (screenshots `/tmp/editor-desktop.png`), browser test passes, `npm run check`; commit `feat(editor): desktop shell from the design mock`.

---

### Task 5: Phone shell

**Files:**
- Create: `src/ui/phone/PhoneHeader.tsx` (two rows, auto-collapse hook `useAutoCollapse(ms=4000)` driven by store dispatches and canvas scroll), `src/ui/phone/PhoneToolbar.tsx` (tabs Value, Pitch, Bar, Score, Layout; ≤ 2 rows; inline strip popovers), `src/ui/phone/useIsPhone.ts` (container query via `ResizeObserver` on the root, ≤ 760px)
- Modify: `PepperScoreEditor.tsx` (switch shells), `style.css`
- Test: `validation/editor-phone.mjs` (390×844, `hasTouch`): header two rows ≤ 88px; after 4.5 s collapsed ≤ 30px; scrolling the canvas restores it; tapping Value→quarter→C adds a note and the header stays expanded while typing (dispatch resets the timer); Bar tab's repeat-start toggles a repeat; Key chip opens an inline strip inside the toolbar (bounding box inside the toolbar's); the canvas scrolls with the toolbar fixed (toolbar rect unchanged after scroll). Add `test:editor-phone` to root scripts and `test:validation`.

- [ ] Build, verify with screenshots `/tmp/editor-phone.png`, `/tmp/editor-phone-collapsed.png`; browser test passes; commit `feat(editor): phone shell with tabbed toolbar and auto-collapsing header`.

---

### Task 6: Layout tab and instrument swap UI

**Files:**
- Create: `src/ui/LayoutTab.tsx` (staves checkboxes with "as <Instrument>" labels, Transposing/Concert toggle, layout chips + "Save as custom layout", Instrument swap card: target select from `INSTRUMENTS`, level segmented control, "Fit to range automatically", extra transposition select (none, m2…P8 up/down as semitone+diatonic pairs), "Linked to <Source> · changes affect both", "Make a copy (own stave)", legend "Moved 8vb to fit range · N notes" with Review (selects the moved events) and "Undo moves" (sets `autoRange: false`)), `src/ui/phone/LayoutStrip.tsx`
- Modify: `Inspector.tsx`, `PhoneToolbar.tsx`, `highlights.ts` (add `{ ids: movedNoteIds, className: 'ps-transposed' }`), `StatusLine.tsx`
- Test: `validation/editor.mjs` extension: swap the Tenor Sax part (use a 2-part fixture built in the demo: Tenor Sax + Piano) to Alto Sax beginner → N `ps-transposed` notes appear, status reads "N notes moved 8vb for Alto Sax · beginner"; Review selects them; Make a copy adds a part and clears the highlights; undo restores.

- [ ] Build, verify, commit `feat(editor): Layout tab, instrument swap card and moved-note highlights`.

---

### Task 7: Docs, results, PR

- [ ] Update `packages/pepperscore-editor/README.md` (layouts, swap, phone toolbar), `docs/specs/score-editor.md` Results (phase 2 screenshots list, phone metrics), `CHANGELOG`s. Run the full chain: `npm run check && npm test -w pepperscore-editor && npm run build && npm run test:api && npm run test:embed && npm run test:editor-browser && npm run test:editor-phone`. Open PR `feat: score editor layouts, instrument swap and the design shell`.
