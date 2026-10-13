# Score Editor MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working in-browser score editor (`pepperscore-editor`) on top of the `pepperscore` viewer: open or create a score, edit key/time/clef/barlines/endings/jumps and enter notes with the keyboard, hear it, undo it, export MusicXML, save `.pepperscore`.

**Architecture:** The editor owns an MNX-shaped JSON model (Zod). Every edit is a command run through Immer `produceWithPatches`; inverse patches are the undo stack. After each command the model compiles to MusicXML and is handed to the unchanged viewer through its `musicXml` prop, so engraving, hit-testing and playback need no editor-specific code. The public viewer gains three generic hooks: `onElementClick`, `highlights`, and handle methods `scrollToMeasure` / `seekToMeasure`.

**Tech Stack:** TypeScript 5.9, React 19, Zod 4 (root `node_modules`), Immer, Zustand (vanilla store), nanoid, vitest for the editor package, Verovio 6.3 (`verovio/esm`) for compile smoke tests, existing `validation/*.mjs` playwright-core pattern for the browser test, Astro demo page in `apps/reader`.

**Spec:** `docs/superpowers/specs/2026-10-13-score-editor-design.md`

## Global Constraints

- Public package `pepperscore` stays MIT; no licence or editor logic in it. Only the hooks in Task 1 are added there, documented in its README and CHANGELOG.
- `packages/pepperscore-editor` is `"private": true`, name `pepperscore-editor`, version `0.1.0`.
- Max 4 staves total; opening or creating more is refused with the message `Editing is limited to 4 staves.`
- Ticks: 960 per quarter. Duration bases: `whole | half | quarter | eighth | 16th | 32nd`.
- Every model object has a stable `id` (nanoid, 10 chars); all references are by id.
- Compiled MusicXML is partwise 4.0, `<divisions>960</divisions>`, every `<note>` carries `id="<model note id>"` (rests: the event id).
- Class names on all editor chrome use the `ps-` prefix alongside any utility classes (CLAUDE.md rule). Font: Poppins.
- `tests/` and `examples/` at the repo root are gitignored; never put tests there. Editor unit tests live in `packages/pepperscore-editor/src/**/*.test.ts`; browser tests in `validation/`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A note entered at a cursor position that overlaps the bar end must be truncated to the bar, never spill into the next bar (Task 6 test `enterEvent clamps at bar end`).
2. Undo after a coalesced run of pitch changes must restore the pre-run state in one step, and redo must replay it (Task 5 test `coalesced entries undo as one`).
3. Changing the time signature on a bar that already has content must keep each sequence exactly one bar long by padding with rests or truncating (Task 5 test `setTime refills sequences`).
4. Importing MusicXML with a `<backup>`-based second voice must produce two sequences that each fill the bar, not one overlong sequence (Task 4 test `two voices via backup`).
5. A `repeatEnd` set on a bar inside an ending must compile to a backward repeat that the viewer's own navigation reader reports as `repeatEnd` with `endings` on the right bars (Task 3 test `viewer navigation reads compiled repeats`).

---

### Task 1: Viewer hooks (public package)

**Files:**
- Modify: `packages/pepperscore/src/components/PepperScore.tsx` (props at lines 51-118, `onScoreClick` at ~1098-1115, canvas div at ~1307, handle `useImperativeHandle` wherever `seek` is defined)
- Modify: `packages/pepperscore/src/index.ts`
- Modify: `packages/pepperscore/README.md`, `packages/pepperscore/CHANGELOG.md`
- Test: `validation/api.mjs` (extend; read its existing structure first, it asserts the exported surface)

**Interfaces:**
- Consumes: `RenderResult` (`lib/render.ts:19`), `measureSeekSeconds` (`lib/playback/clock-time.ts:37`), `score.document.identity.noteIdToSourceId`.
- Produces (exported types):

```ts
export type PepperScoreClickInfo = {
  /** Viewer note id (data-note-id) when a note or rest was hit. */
  noteId?: string;
  /** Source element id (the MusicXML `id` attribute) of the first pitch of that note, when known. */
  sourceId?: string;
  /** Zero-based measure index, when a measure box was hit. */
  measureIndex?: number;
  /** 0..1 position of the click across the measure's width. */
  fraction?: number;
  /** 1-based index of the nearest visible staff in the system. */
  staff?: number;
  clientX: number; clientY: number;
};
export type PepperScoreHighlight = { ids?: string[]; measures?: number[]; className: string };
// new props
onElementClick?(info: PepperScoreClickInfo): void;
highlights?: PepperScoreHighlight[];
// new handle methods
scrollToMeasure(index: number): Promise<void>;
seekToMeasure(index: number): void;
```

- [ ] **Step 1: Add the prop and handle types** next to `PepperScoreProps`/`PepperScoreHandle`, with the doc comments above. Export `PepperScoreClickInfo` and `PepperScoreHighlight` from `src/index.ts`.

- [ ] **Step 2: Resolve clicks for every chrome, not only clock mode.** Replace the `onClick={clock ? onScoreClick : undefined}` with `onClick={onScoreClick}` and restructure `onScoreClick`:

```tsx
const onScoreClick = (event: React.MouseEvent<HTMLDivElement>) => {
  const result = renderRef.current;
  const target = event.target as Element;
  const noteId = target.closest?.('[data-note-id]')?.getAttribute('data-note-id') ?? undefined;
  const hit = result?.measures.find(measure => {
    const rect = measure.element?.getBoundingClientRect();
    return Boolean(rect && rect.width && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
  });
  if (callbacks.current.onElementClick) {
    const rect = hit?.element?.getBoundingClientRect();
    const system = hit && result ? result.systems[hit.system] : undefined;
    const block = hit?.element?.closest('.score-system')?.getBoundingClientRect();
    let staff: number | undefined;
    if (system && block) {
      const y = event.clientY - block.top;
      staff = system.staffCenters.reduce((best, centre, i) => Math.abs(centre - y) < Math.abs(system.staffCenters[best] - y) ? i : best, 0) + 1;
    }
    callbacks.current.onElementClick({
      noteId, sourceId: noteId ? score.document?.identity?.noteIdToSourceId?.[noteId] ?? noteId : undefined,
      measureIndex: hit?.index, fraction: rect ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : undefined,
      staff, clientX: event.clientX, clientY: event.clientY,
    });
  }
  if (!clock) return;
  const timeline = timelineOf(); if (!timeline || !result) return;
  const bpm = timeline.initialBpm, now = Math.max(0, Number.isFinite(clock.now()) ? clock.now() : 0);
  let seconds = noteId ? noteSeekSeconds(timeline, noteId, now, bpm) : null;
  if (seconds === null && hit) seconds = measureSeekSeconds(timeline, hit.index, now, bpm);
  if (seconds !== null) callbacks.current.onSeek?.(seconds);
};
```

Add `onElementClick` to the `callbacks` ref object (line ~164) and to the destructured props. Note `staffCenters` are relative to the system block; check `SystemGeometry.staffCenters` units in `render.ts` and convert with `result.scale` if they are in Verovio units rather than CSS px (read the code that fills `staffCenters`; if it is already px, no conversion).

- [ ] **Step 3: Apply highlights after every draw.** Add an effect that depends on `highlights` and the render result's `onChange`:

```tsx
useEffect(() => {
  const result = renderRef.current, canvas = canvasRef.current;
  if (!canvas) return;
  const apply = () => {
    canvas.querySelectorAll('[data-ps-highlight]').forEach(el => { for (const name of (el.getAttribute('data-ps-highlight') || '').split(' ')) if (name) el.classList.remove(name); el.removeAttribute('data-ps-highlight'); });
    for (const item of highlights ?? []) {
      const targets: Element[] = [];
      for (const id of item.ids ?? []) {
        const byPoint = result?.point(id)?.element;
        const el = byPoint ?? canvas.querySelector(`[data-note-id="${CSS.escape(id)}"]`) ?? canvas.querySelector(`#${CSS.escape(id)}`);
        if (el) targets.push(el.closest('.chord') ?? el);
      }
      for (const index of item.measures ?? []) { const el = result?.measure(index)?.element; if (el) targets.push(el); }
      for (const el of targets) { el.classList.add(item.className); el.setAttribute('data-ps-highlight', `${el.getAttribute('data-ps-highlight') ?? ''} ${item.className}`.trim()); }
    }
  };
  apply();
  return result?.onChange(apply);
}, [highlights, loaded, renderGeneration]);
```

Use whatever state already changes when a render completes (search for where `renderRef.current = result` is set and the state it updates, e.g. a `drawn`/`generation` counter) as the last dependency so the effect re-runs on a new render. Elements may be re-created on each draw, so the removal loop is only for still-present elements.

- [ ] **Step 4: Handle methods.** In the `useImperativeHandle` block add:

```tsx
scrollToMeasure: async (index) => {
  const result = renderRef.current; if (!result) return;
  await result.ensureSystem(result.systemOfMeasure(index));
  result.measure(index)?.element?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
},
seekToMeasure: (index) => {
  void loadTimeline().then(timeline => { const s = measureSeekSeconds(timeline, index, 0, prefs.bpm); if (s !== null) seekTo(s); });
},
```

(`loadTimeline`, `seekTo`, `prefs.bpm` exist in the component; `measureSeekSeconds` takes `ClockTimeline`; if `loadTimeline` resolves a different timeline type, use the same adapter the clock path uses around line 1101 `timelineOf()`.)

- [ ] **Step 5: Styles.** In `packages/pepperscore/src/styles.css` add after the `.reader-note.is-playing` rule:

```css
.pepperscore .score-system svg .ps-cursor{filter:drop-shadow(0 0 3px var(--ps-cursor,#2f6fed));stroke:var(--ps-cursor,#2f6fed);fill:var(--ps-cursor,#2f6fed)}
.pepperscore .score-system svg .ps-selection{stroke:var(--ps-selection,#1f9d55);fill:var(--ps-selection,#1f9d55)}
.pepperscore .score-system svg .measure.ps-cursor-measure{outline:2px dashed var(--ps-cursor,#2f6fed);outline-offset:2px}
.pepperscore[data-ps-clickable] .score-system svg .reader-note,.pepperscore[data-ps-clickable] .score-system svg .measure{cursor:pointer}
```

Set `data-ps-clickable` on the root when `onElementClick` is provided (same pattern as `data-ps-clock`).

- [ ] **Step 6: Tests.** Open `validation/api.mjs`; extend its exported-type assertions to include `PepperScoreClickInfo` and `PepperScoreHighlight`. Then add to `apps/reader/src/embed/EmbedTest.tsx` a `highlights` state and an `onElementClick` that pushes `['click', 'full', info]` to `window.__events`, and expose `setHighlights` on `window.__embed`. In `validation/embed.mjs` add one scenario: click the first `.reader-note` in the full reader, assert `__events` has a `click` entry with `noteId` and `measureIndex === 0`; call `setHighlights([{ ids: [thatNoteId], className: 'ps-selection' }])` and assert the element gains the class; call `refs.full.current.scrollToMeasure(3)` and assert it resolves.

Run: `npm run build -w pepperscore && npm run test:api && npm run test:embed`
Expected: PASS.

- [ ] **Step 7: Docs and commit.** README: a "Host hooks" section listing the three additions. CHANGELOG under `## Unreleased` → `### Added`. Commit:

```bash
git add packages/pepperscore apps/reader/src/embed/EmbedTest.tsx validation/api.mjs validation/embed.mjs
git commit -m "feat(pepperscore): onElementClick, highlights, scrollToMeasure and seekToMeasure host hooks"
```

---

### Task 2: Editor package scaffold and model

**Files:**
- Create: `packages/pepperscore-editor/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`
- Create: `packages/pepperscore-editor/src/model/schema.ts`, `src/model/ids.ts`, `src/model/durations.ts`, `src/model/create.ts`, `src/model/query.ts`, `src/model/invariants.ts`, `src/test-helpers.ts` (exports `helloDoc()`: one treble Flute part, 1 bar 4/4, C5 D5 quarters + half rest, title 'Hello'; `threeQuarterNotesDoc()`: one part, 1 bar, three quarter notes C4 D4 E4 + quarter rest; `twoVoicePianoDoc()` is added in Task 3)
- Test: `src/model/schema.test.ts`, `src/model/invariants.test.ts`, `src/model/query.test.ts`
- Modify: root `package.json` (add `"test:editor": "npm run test -w pepperscore-editor"` and append it to `test:validation` before `test:reader`).

**Interfaces (produces):**

```ts
// durations.ts
export const TICKS_PER_QUARTER = 960;
export const DURATION_BASES = ['whole','half','quarter','eighth','16th','32nd'] as const;
export type DurationBase = typeof DURATION_BASES[number];
export type Duration = { base: DurationBase; dots: 0|1|2 };
export const BASE_TICKS: Record<DurationBase, number>; // 3840,1920,960,480,240,120
export function durationTicks(d: Duration): number;
export function measureTicks(time: { count: number; unit: number }): number;   // count * 4/unit * 960
export function ticksToDurations(ticks: number): Duration[]; // greedy fill: largest undotted/dotted bases, for rest padding
// ids.ts
export function newId(): string;             // nanoid(10)
// schema.ts  (Zod schemas + inferred types, names exactly as below)
export const TimeSchema, KeySchema, GlobalMeasureSchema, NoteSchema, EventSchema, TupletSchema, SequenceSchema, BeamSchema, DirectionSchema, PartMeasureSchema, PartSchema, LayoutSchema, StyleSheetSchema, DocumentSchema;
export type Time, Key, GlobalMeasure, Note, Event, Tuplet, Sequence, Beam, Direction, PartMeasure, Part, Layout, StyleSheet, Document;
export type Clef = 'treble'|'bass'|'alto'|'tenor'|'percussion'|'treble8vb';
export type Articulation = 'staccato'|'tenuto'|'accent'|'marcato'|'staccatissimo'|'fermata';
export type Dynamic = 'ppp'|'pp'|'p'|'mp'|'mf'|'f'|'ff'|'fff'|'sfz'|'fp';
export type Jump = { type: 'dc'|'ds'; target: 'fine'|'coda'|'end' };
export const parseDocument = (value: unknown): Document;   // DocumentSchema.parse
// create.ts
export type NewPart = { name: string; clef: Clef; gmProgram: number; staves?: 1|2 };
export function createDocument(args: { meta?: { title?: string; composer?: string }; parts: NewPart[]; measures: number; time?: Time; key?: Key }): Document;
export function emptyPartMeasure(part: Part, time: Time): PartMeasure;   // one full-measure rest sequence per staff, voice 1
export function restEvent(d: Duration): Event;
export function fullMeasureRest(): Event;  // { type:'event', rest:true, fullMeasure:true, duration:{base:'whole',dots:0} }
// query.ts
export function measureIndex(doc: Document, measureId: string): number;        // -1 if absent
export function effectiveTime(doc: Document, index: number): Time;            // walk back; default {count:4,unit:4}
export function effectiveKey(doc: Document, index: number): Key;              // default {fifths:0}
export function effectiveClef(part: Part, index: number, staff: number): Clef; // walk back through clefs[]; default part.clefs[staff-1]
export function sequenceFor(pm: PartMeasure, staff: number, voice: number): Sequence | undefined;
export function ensureSequence(pm: PartMeasure, staff: number, voice: number): Sequence;   // create if absent (mutates)
export type Located = { partIndex: number; measureIndex: number; sequenceIndex: number; contentIndex: number; tick: number; event: Event };
export function locateEvent(doc: Document, eventId: string): Located | undefined;   // searches tuplet content too (contentIndex is the tuplet's index, event is the inner event)
export function eventStarts(seq: Sequence): { event: Event; tick: number; ticks: number }[];   // flattened, tuplets scaled
export function sequenceTicks(seq: Sequence): number;
export function noteToEvent(doc: Document): Map<string, string>;  // note id -> event id
export function staffCount(doc: Document): number;
// invariants.ts
export function checkInvariants(doc: Document): string[];   // [] when valid
```

Schema shape (copy the spec's model; the additions are explicit here):

```ts
export const TimeSchema = z.object({ count: z.number().int().min(1).max(32), unit: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16)]) });
export const KeySchema = z.object({ fifths: z.number().int().min(-7).max(7), mode: z.enum(['major','minor']).optional() });
export const GlobalMeasureSchema = z.object({
  id: z.string(), time: TimeSchema.optional(), key: KeySchema.optional(),
  tempo: z.object({ bpm: z.number().positive(), unit: z.enum(DURATION_BASES), text: z.string().optional() }).optional(),
  barline: z.enum(['regular','double','final','dashed','invisible']).optional(),
  repeatStart: z.boolean().optional(), repeatEnd: z.object({ times: z.number().int().min(2).max(16).optional() }).optional(),
  ending: z.object({ numbers: z.array(z.number().int().min(1)).min(1), open: z.boolean().optional() }).optional(),
  segno: z.boolean().optional(), coda: z.boolean().optional(), fine: z.boolean().optional(), toCoda: z.boolean().optional(),
  jump: z.object({ type: z.enum(['dc','ds']), target: z.enum(['fine','coda','end']) }).optional(),
  rehearsal: z.string().optional(),
});
export const PitchSchema = z.object({ step: z.enum(['A','B','C','D','E','F','G']), octave: z.number().int().min(0).max(9), alter: z.number().int().min(-2).max(2) });
export const NoteSchema = z.object({ id: z.string(), pitch: PitchSchema, tie: z.object({ target: z.string() }).optional(), accidental: z.enum(['auto','show','hide','cautionary']).optional() });
export const DurationSchema = z.object({ base: z.enum(DURATION_BASES), dots: z.union([z.literal(0), z.literal(1), z.literal(2)]) });
export const EventSchema = z.object({
  id: z.string(), type: z.literal('event'), duration: DurationSchema, rest: z.literal(true).optional(), fullMeasure: z.literal(true).optional(),
  notes: z.array(NoteSchema).optional(), grace: z.object({ slash: z.boolean() }).optional(), stem: z.enum(['up','down']).optional(),
  articulations: z.array(z.enum(['staccato','tenuto','accent','marcato','staccatissimo','fermata'])).optional(),
  slurs: z.array(z.object({ id: z.string(), target: z.string(), side: z.enum(['up','down']).optional() })).optional(),
});
export const TupletSchema = z.object({ id: z.string(), type: z.literal('tuplet'), outer: z.object({ multiple: z.number().int().min(1), base: z.enum(DURATION_BASES) }), inner: z.object({ multiple: z.number().int().min(1), base: z.enum(DURATION_BASES) }), content: z.array(EventSchema), bracket: z.boolean().optional() });
export const SequenceSchema = z.object({ id: z.string(), voice: z.number().int().min(1).max(4), staff: z.number().int().min(1).max(2), content: z.array(z.union([EventSchema, TupletSchema])) });
export const BeamSchema = z.object({ id: z.string(), events: z.array(z.string()).min(2) });
export const AnchorSchema = z.object({ measureId: z.string(), tick: z.number().int().min(0), staff: z.number().int().min(1), eventId: z.string().optional() });
export const OffsetSchema = z.object({ x: z.number(), y: z.number() });
export const DirectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dynamic'), id: z.string(), anchor: AnchorSchema, placement: z.enum(['above','below']).optional(), offset: OffsetSchema.optional(), value: z.enum(['ppp','pp','p','mp','mf','f','ff','fff','sfz','fp']) }),
  z.object({ kind: z.literal('wedge'), id: z.string(), anchor: AnchorSchema, placement: z.enum(['above','below']).optional(), offset: OffsetSchema.optional(), shape: z.enum(['cresc','dim']), endTick: z.number().int().min(0), endMeasureId: z.string().optional() }),
  z.object({ kind: z.literal('text'), id: z.string(), anchor: AnchorSchema, placement: z.enum(['above','below']).optional(), offset: OffsetSchema.optional(), text: z.string(), style: z.enum(['plain','expression','tempo']).optional() }),
]);
export const PartMeasureSchema = z.object({ id: z.string(), clefs: z.array(z.object({ staff: z.number().int().min(1), clef: z.enum(['treble','bass','alto','tenor','percussion','treble8vb']), tick: z.number().int().min(0).optional() })).optional(), sequences: z.array(SequenceSchema), beams: z.array(BeamSchema), directions: z.array(DirectionSchema) });
export const PartSchema = z.object({ id: z.string(), name: z.string(), abbreviation: z.string().optional(), instrument: z.object({ gmProgram: z.number().int().min(1).max(128), midiChannel: z.number().int().optional() }), staves: z.union([z.literal(1), z.literal(2)]), clefs: z.array(z.enum(['treble','bass','alto','tenor','percussion','treble8vb'])), transposition: z.object({ semitones: z.number().int(), diatonic: z.number().int() }).optional(), measures: z.array(PartMeasureSchema) });
export const LayoutSchema = z.object({ id: z.string(), name: z.string(), kind: z.enum(['score','part']), parts: z.array(z.object({ partId: z.string(), staves: z.array(z.number().int()).optional() })), breaks: z.array(z.object({ measureId: z.string(), type: z.enum(['system','page']) })).optional(), overrides: z.record(z.string(), z.object({ offset: OffsetSchema.optional(), hidden: z.boolean().optional(), text: z.string().optional(), cue: z.boolean().optional() })) });
export const StyleSheetSchema = z.object({ musicFont: z.enum(['Bravura','Petaluma']).optional(), staffSize: z.number().positive().optional() });
export const DocumentSchema = z.object({ global: z.object({ measures: z.array(GlobalMeasureSchema) }), parts: z.array(PartSchema), layouts: z.array(LayoutSchema).min(1), style: StyleSheetSchema, meta: z.object({ title: z.string().optional(), composer: z.string().optional() }) });
```

`Part.clefs` is the initial clef per staff (index 0 = staff 1); `PartMeasure.clefs` are changes.

Invariants to implement in `checkInvariants` (each returns a message `"<code>: <detail>"`):
- `measure-count`: every part has `global.measures.length` measures.
- `bar-length`: every sequence's `sequenceTicks` equals `measureTicks(effectiveTime)`; a `fullMeasure` rest alone counts as the full bar.
- `beam-events`: each beam's events exist in one sequence of that measure, are consecutive in `eventStarts` order, and every one has `durationTicks < 960` (tuplet-scaled ticks allowed).
- `tie-target`: each tie target is a note of equal pitch in the next event of the same sequence (or the first event of the same voice/staff in the next measure).
- `slur-target`: each slur target is an event in the same part.
- `ending-after-repeat`: an `ending` must be preceded (walking back without crossing a `repeatEnd` that is not inside an ending) by a `repeatStart`.
- `jump-targets`: `jump.target === 'coda'` requires some `toCoda` and some `coda`; `jump.type === 'ds'` requires a `segno`; `fine` only with a jump targeting fine.
- `staff-cap`: `staffCount(doc) <= 4`.

- [ ] **Step 1: Scaffold.** `package.json`:

```json
{ "name": "pepperscore-editor", "version": "0.1.0", "private": true, "type": "module",
  "exports": { ".": { "types": "./src/index.ts", "import": "./src/index.ts" }, "./style.css": "./src/style.css" },
  "scripts": { "test": "vitest run", "check": "tsc --noEmit -p ." },
  "peerDependencies": { "react": ">=19", "react-dom": ">=19", "pepperscore": "*" },
  "dependencies": { "immer": "^10.1.1", "zustand": "^5.0.0", "zod": "^4.0.0", "nanoid": "^3.3.0" },
  "devDependencies": { "vitest": "^3.0.0", "typescript": "^5.9.3", "@types/react": "^19.2.0", "verovio": "6.3.0" } }
```

`tsconfig.json` copies `packages/pepperscore/tsconfig.json` with `"types": ["vite/client", "vitest/globals"]`. `vitest.config.ts`: `export default { test: { globals: true, environment: 'node', include: ['src/**/*.test.ts'] } }`. Run `npm install` at the root (workspace install). Verify `node_modules/immer` and `node_modules/zustand` exist.

- [ ] **Step 2: Failing tests** (`schema.test.ts`, `query.test.ts`, `invariants.test.ts`):

```ts
import { createDocument, parseDocument, checkInvariants, measureTicks, durationTicks, ticksToDurations, locateEvent, eventStarts, staffCount } from '..';  // adjust to module paths
test('createDocument makes full-measure rests that pass invariants', () => {
  const doc = createDocument({ parts: [{ name: 'Piano', clef: 'treble', gmProgram: 1, staves: 2 }], measures: 4 });
  expect(doc.global.measures).toHaveLength(4);
  expect(doc.parts[0].measures[0].sequences).toHaveLength(2);
  expect(checkInvariants(doc)).toEqual([]);
  expect(parseDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
});
test('duration maths', () => {
  expect(durationTicks({ base: 'quarter', dots: 1 })).toBe(1440);
  expect(measureTicks({ count: 6, unit: 8 })).toBe(2880);
  expect(ticksToDurations(1440)).toEqual([{ base: 'quarter', dots: 1 }]);
  expect(ticksToDurations(600)).toEqual([{ base: 'eighth', dots: 0 }, { base: '32nd', dots: 0 }]);
});
test('bar-length invariant catches a short sequence', () => {
  const doc = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 1 });
  doc.parts[0].measures[0].sequences[0].content = [{ id: 'e1', type: 'event', duration: { base: 'half', dots: 0 }, rest: true }];
  expect(checkInvariants(doc).some(m => m.startsWith('bar-length'))).toBe(true);
});
test('staff cap', () => {
  const doc = createDocument({ parts: [1,2,3].map(n => ({ name: `P${n}`, clef: 'treble', gmProgram: 1, staves: 2 })), measures: 1 });
  expect(staffCount(doc)).toBe(6);
  expect(checkInvariants(doc)).toContain('staff-cap: 6 staves, limit 4');
});
test('locateEvent and eventStarts handle tuplets', () => {
  const doc = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 1 });
  const seq = doc.parts[0].measures[0].sequences[0];
  const e = (id: string) => ({ id, type: 'event' as const, duration: { base: 'eighth' as const, dots: 0 as const }, rest: true as const });
  seq.content = [{ id: 't1', type: 'tuplet', outer: { multiple: 3, base: 'eighth' }, inner: { multiple: 2, base: 'eighth' }, content: [e('a'), e('b'), e('c')] }, { id: 'h', type: 'event', duration: { base: 'half', dots: 0 }, rest: true }, e('x'), e('y')];
  expect(eventStarts(seq).map(s => [s.event.id, s.tick, s.ticks])).toEqual([['a',0,320],['b',320,320],['c',640,320],['h',960,1920],['x',2880,480],['y',3360,480]]);
  expect(locateEvent(doc, 'b')).toMatchObject({ contentIndex: 0, tick: 320 });
  expect(checkInvariants(doc)).toEqual([]);
});
```

- [ ] **Step 3: Run tests, confirm they fail** (`npm test -w pepperscore-editor`).

- [ ] **Step 4: Implement** `durations.ts`, `ids.ts`, `schema.ts`, `create.ts`, `query.ts`, `invariants.ts` to the interfaces above. `ticksToDurations`: iterate bases largest first, try dotted (×1.5) first when it fits, then plain, subtracting until 0; throw if a remainder under 120 is left. `createDocument` builds `layouts: [{ id, name: 'Score', kind: 'score', parts: parts.map(p => ({ partId: p.id })), overrides: {} }]`, `style: {}`, first global measure carrying `time` and `key`. Refuse with `Error('Editing is limited to 4 staves.')` only in the editor UI, not here (tests above need 6 staves to exercise the invariant).

- [ ] **Step 5: Tests pass. Type-check** (`npm run check -w pepperscore-editor`). Commit:

```bash
git add packages/pepperscore-editor package.json package-lock.json
git commit -m "feat(editor): package scaffold, MNX-shaped model, queries and invariants"
```

---

### Task 3: Compiler to MusicXML

**Files:**
- Create: `packages/pepperscore-editor/src/compile/to-musicxml.ts`, `src/compile/xml.ts` (escape + tiny builder)
- Test: `src/compile/to-musicxml.test.ts`, fixtures under `src/compile/__fixtures__/*.musicxml` (golden snapshots written by the test on first run with `UPDATE_GOLDEN=1`, committed)

**Interfaces:**
- Consumes: Task 2 model and queries.
- Produces: `export function compileToMusicXml(doc: Document, options?: { layoutId?: string }): string`.

Rules:
- Header: `<?xml version="1.0" encoding="UTF-8"?>`, `<score-partwise version="4.0">`, `<work><work-title>` from `meta.title`, `<identification><creator type="composer">` when set, `<part-list>` with `<score-part id="P<n>"><part-name>` and `<midi-instrument id="P<n>-I1"><midi-program>gmProgram</midi-program>`. Part ids are `P1..Pn` in layout order (the layout's parts filter which parts are written).
- Each `<measure number="<index+1>">`. First measure: `<attributes><divisions>960</divisions><key><fifths/>[<mode/>]</key><time><beats/><beat-type/></time><staves>n</staves>(if 2)<clef number="s"><sign/><line/>[<clef-octave-change>-1 for treble8vb]</clef>…</attributes>`. Later measures: `<attributes>` only with what changed in that global measure (`time`, `key`) or part measure (`clefs` with `tick === undefined || 0`; mid-bar clefs are emitted as `<attributes>` between notes at that tick with a `<backup>`/`<forward>` dance; MVP: only bar-start clefs, mid-bar dropped with a console warning).
- Clef map: treble G2, bass F4, alto C3, tenor C4, percussion `percussion` 2, treble8vb G2 with `<clef-octave-change>-1</clef-octave-change>`.
- Left barline: `<barline location="left">` with `<bar-style>heavy-light</bar-style><repeat direction="forward"/>` for `repeatStart`; `<ending number="1,2" type="start"/>` for an `ending` whose previous measure does not have the same ending numbers (an ending spans consecutive bars with identical `numbers`).
- Right barline: `bar-style` from `barline` (`regular` omitted, `double` → `light-light`, `final` → `light-heavy`, `dashed` → `dashed`, `invisible` → `none`); `repeatEnd` → `light-heavy` + `<repeat direction="backward" times="n"/>`; ending ends → `<ending number="…" type="stop"/>` when the next bar does not continue the same ending (`open` → `type="discontinue"`).
- Directions, written before the first note of the bar in part order: `segno` → `<direction placement="above"><direction-type><segno/></direction-type><sound segno="segno<index>"/></direction>`; `coda` → `<coda/>` + `<sound coda="coda<index>"/>`; `toCoda` → `<words>To Coda</words>` + `<sound tocoda="coda<index of the coda bar>"/>` (written after notes, at bar end); `fine` → `<words>Fine</words><sound fine="yes"/>` at bar end; `jump` → `<words>` one of `D.C. al Fine`, `D.C. al Coda`, `D.C.`, `D.S. al Fine`, `D.S. al Coda`, `D.S.` with `<sound dacapo="yes"/>` or `<sound dalsegno="segno<index>"/>`, at bar end; `tempo` → `<metronome><beat-unit>…</beat-unit><per-minute>…</per-minute></metronome>` + `<sound tempo="…"/>` (tempo in quarter BPM); `rehearsal` → `<rehearsal>`.
- Sequences: write staff 1 voice 1, then for each further sequence `<backup><duration>measureTicks</duration></backup>` then its content. `<voice>` = `(staff-1)*4 + voice`; `<staff>` present when `part.staves === 2`.
- Event → `<note id="…">`: for rests `<rest measure="yes"/>` when `fullMeasure` (and `<duration>` = full bar, no `<type>`), else `<rest/>`; notes: first `<note>` plain, following notes of a chord `<chord/>`; `<pitch><step/><alter/>(if ≠0)<octave/></pitch>`, `<duration>` ticks (tuplet-scaled), `<type>` (whole, half, quarter, eighth, 16th, 32nd), `<dot/>` × dots, `<accidental>` when `accidental === 'show'` or the alter differs from the key signature's for that step (track a per-bar accidental state like an engraver: an altered step earlier in the bar carries), `<stem>`, `<time-modification>` for tuplet members, `<beam number="1">begin|continue|end</beam>` from beams (compute per beam: first event `begin`, last `end`, others `continue`; secondary beams `number="2"` for consecutive 16ths within the group, `number="3"` for 32nds, using MusicXML's begin/continue/end on each level; a lone 16th between eighths gets `forward hook`/`backward hook`), `<notations>` with `<tied type="start|stop"/>`, `<slur type="start|stop" number="n"/>` (allocate numbers so overlapping slurs differ), `<tuplet type="start|stop"/>` on first/last tuplet member, `<articulations>` with `<staccato/>` etc., `<fermata/>` directly under notations. Grace: `<grace slash="yes"/>` before `<pitch>`, no `<duration>`.
- Directions from `partMeasure.directions`: emitted immediately before the event whose start tick is the first `>= anchor.tick` in staff 1 voice 1 sequence (or at bar end if none), with `<offset>` = `anchor.tick - that event's tick`, `placement` attribute, `<staff>` when 2 staves. `dynamic` → `<dynamics><p/></dynamics>` + `<sound dynamics="…"/>` (ppp 25, pp 38, p 50, mp 62, mf 75, f 88, ff 100, fff 112, sfz 100, fp 75); `wedge` → `<wedge type="crescendo|diminuendo"/>` and a matching `<wedge type="stop"/>` at `endTick` (same bar or `endMeasureId`); `text` → `<words>` (style `tempo` → `font-weight="bold"`, `expression` → `font-style="italic"`); offsets → `relative-x`/`relative-y` = `offset.x*10` / `offset.y*10`.

- [ ] **Step 1: Failing tests.**

```ts
import { VerovioToolkit } from 'verovio/esm'; import createVerovioModule from 'verovio/wasm';
import { musicXmlTextNavigation } from '../../../pepperscore/src/lib/notation/navigation';
test('hello world compiles', () => {
  const doc = createDocument({ meta: { title: 'Hello' }, parts: [{ name: 'Flute', clef: 'treble', gmProgram: 74 }], measures: 1 });
  const seq = doc.parts[0].measures[0].sequences[0];
  seq.content = [
    { id: 'e1', type: 'event', duration: { base: 'quarter', dots: 0 }, notes: [{ id: 'n1', pitch: { step: 'C', octave: 5, alter: 0 } }] },
    { id: 'e2', type: 'event', duration: { base: 'quarter', dots: 0 }, notes: [{ id: 'n2', pitch: { step: 'D', octave: 5, alter: 0 } }] },
    { id: 'e3', type: 'event', duration: { base: 'half', dots: 0 }, rest: true },
  ];
  const xml = compileToMusicXml(doc);
  expect(xml).toContain('<score-partwise version="4.0">');
  expect(xml).toContain('<divisions>960</divisions>');
  expect(xml).toMatch(/<note id="n1">\s*<pitch>\s*<step>C<\/step>\s*<octave>5<\/octave>\s*<\/pitch>\s*<duration>960<\/duration>\s*<voice>1<\/voice>\s*<type>quarter<\/type>/);
  expect(xml).toMatch(/<note id="e3">\s*<rest\/>/);
});
test('chords, beams, ties, slurs, articulations, tuplets, dynamics', () => { /* build a 2-bar doc covering each, assert the expected XML fragments: <chord/>, <beam number="1">begin</beam>…end, <tied type="start"/> then stop, <slur type="start" number="1"/>, <staccato/>, <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes>, <dynamics><mf/></dynamics>, <wedge type="crescendo"/> */ });
test('viewer navigation reads compiled repeats', () => {
  const doc = createDocument({ parts: [{ name: 'Fl', clef: 'treble', gmProgram: 74 }], measures: 6 });
  const g = doc.global.measures;
  g[0].segno = true; g[1].repeatStart = true; g[2].ending = { numbers: [1] }; g[2].repeatEnd = {}; g[3].ending = { numbers: [2] }; g[3].toCoda = true; g[4].jump = { type: 'ds', target: 'coda' }; g[4].fine = false; g[5].coda = true;
  const nav = musicXmlTextNavigation(compileToMusicXml(doc), 6, []);
  expect(nav[0].segno).toBe(true); expect(nav[1].repeatStart).toBe(true);
  expect(nav[2]).toMatchObject({ repeatEnd: true, endings: [1] }); expect(nav[3]).toMatchObject({ endings: [2], toCoda: true });
  expect(nav[4].dalSegno).toBe(true); expect(nav[5].coda).toBe(true);
});
test('Verovio loads the compiled score', async () => {
  const tk = new VerovioToolkit(await createVerovioModule());
  expect(tk.loadData(compileToMusicXml(twoVoicePianoDoc()))).toBe(true);
  expect(tk.getPageCount()).toBeGreaterThan(0);
});
test('golden: every fixture', () => { /* for each src/compile/__fixtures__/*.json document: compile, compare to the sibling .musicxml; write when process.env.UPDATE_GOLDEN */ });
```

Build `twoVoicePianoDoc()` in a test helper `src/test-helpers.ts`: a piano (2 staves) with 2 bars, staff 1 voices 1 and 2, staff 2 voice 1, a tie across the barline, one beam of four eighths, a cresc wedge.

- [ ] **Step 2: Run, confirm failures.**
- [ ] **Step 3: Implement `xml.ts` and `to-musicxml.ts`** to the rules above. Keep the writer as a flat function per element (`writeMeasure`, `writeEvent`, `writeBarlines`, `writeNavigation`, `writeDirection`), each returning a string; no DOM.
- [ ] **Step 4: Tests pass**; generate goldens with `UPDATE_GOLDEN=1 npm test -w pepperscore-editor`, inspect one by eye, commit them.
- [ ] **Step 5: Commit** `feat(editor): compile model to MusicXML`.

---

### Task 4: Importer MusicXML → model

**Files:**
- Create: `packages/pepperscore-editor/src/import/xml-stream.ts` (copy of `packages/pepperscore/src/lib/notation/xml-stream.ts` with a header comment `// Copied from pepperscore/src/lib/notation/xml-stream.ts (MIT); keep in sync.`), `src/import/from-musicxml.ts`
- Test: `src/import/from-musicxml.test.ts`

**Interfaces:**
- Produces: `export type Dropped = { feature: string; count: number; location: string }; export function importMusicXml(text: string): { document: Document; dropped: Dropped[] }`. Throws `Error('Only partwise MusicXML is supported.')` for `score-timewise`; throws `Error('Editing is limited to 4 staves.')` when staves exceed 4.

Mapping (use `parseXmlTree` then walk `XmlElement.children`): `part-list` → parts (name, `midi-program` or 1, `<staves>` from first measure attributes); divisions per part; for each measure keep a tick cursor: `note` with `<chord/>` joins the previous event; `backup`/`forward` move the cursor; the (staff, voice) pair selects the sequence; an event starting past the sequence's current end gets rests inserted first (`ticksToDurations`), so sequences stay gap-free; `<type>`+`<dot>` give the duration (fall back from `<duration>` ticks via the largest base that fits when `<type>` is absent); `<time-modification>` groups consecutive events with the same actual/normal into a tuplet until the `<tuplet type="stop"/>`; `<beam number="1">` begin…end groups into beams; `<tied>`/`<slur>` by number stacks; `<articulations>` children; `<grace>`; `<rest measure="yes"/>` → `fullMeasure`; `<attributes>` (`divisions`, `key`, `time`, `clef` at bar start → global/part measure); barlines → `repeatStart`, `repeatEnd.times`, `ending` (number list via a copy of the viewer's `endingNumbers` regex), bar-style map; directions: `dynamics`, `wedge`, `words` (navigation words via `navigationWord`-equivalent regexes copied into `src/import/navigation-words.ts`, otherwise `text`), `segno`, `coda`, `metronome`, `rehearsal`; `<sound>` attributes set navigation flags; `<offset>` adds to the anchor tick; `relative-x/-y` → offset /10. Everything else (lyric, harmony, ottava, pedal, tremolo, cue, unpitched, notehead, lyric…) increments `dropped` with location `P<n>/m<n>`. After the walk: pad every sequence to the bar with rests, then `checkInvariants`; if it reports anything, throw `Error('Import produced an invalid document: ' + messages[0])`.

- [ ] **Step 1: Failing tests.**

```ts
test('round trip is a fixed point', () => {
  for (const file of ['ensemble', 'expressive', 'clock-contract', 'idless-sibelius']) {
    const text = readFileSync(new URL(`../../../../validation/fixtures/${file}.musicxml`, import.meta.url), 'utf8');
    let first; try { first = importMusicXml(text); } catch (e) { if (/4 staves|partwise/.test(String(e))) continue; throw e; }
    const second = importMusicXml(compileToMusicXml(first.document));
    const strip = (d: Document) => JSON.parse(JSON.stringify(d, (k, v) => k === 'id' ? undefined : v));
    expect(strip(second.document)).toEqual(strip(first.document));
  }
});
test('two voices via backup', () => {
  const xml = compileToMusicXml(twoVoicePianoDoc());
  const { document } = importMusicXml(xml);
  const m0 = document.parts[0].measures[0];
  expect(m0.sequences.map(s => [s.staff, s.voice, sequenceTicks(s)])).toEqual([[1,1,3840],[1,2,3840],[2,1,3840]]);
});
test('reports dropped features', () => {
  const xml = compileToMusicXml(helloDoc()).replace('</note>', '<lyric><text>la</text></lyric></note>');
  expect(importMusicXml(xml).dropped).toEqual([{ feature: 'lyric', count: 1, location: 'P1/m1' }]);
});
test('refuses timewise and >4 staves', () => { /* assert both throws */ });
```

- [ ] **Step 2: Run, confirm failures.** **Step 3: Implement.** **Step 4: Pass, type-check.** If a fixture's round trip is not a fixed point because of a legitimately unmodelled feature, record it in `dropped`, do not special-case the test. **Step 5: Commit** `feat(editor): import MusicXML into the model`.

---

### Task 5: Engine, history and score-level commands

**Files:**
- Create: `packages/pepperscore-editor/src/engine/store.ts`, `src/engine/history.ts`, `src/engine/commands/score.ts`, `src/engine/commands/index.ts`, `src/engine/types.ts`
- Test: `src/engine/history.test.ts`, `src/engine/commands/score.test.ts`

**Interfaces:**

```ts
// types.ts
export type Cursor = { partId: string; staff: number; voice: 1|2|3|4; measureId: string; tick: number; duration: Duration; mode: 'select'|'enter'; lastPitch?: Pitch };
export type Selection = { ids: string[] };     // event, note, direction or measure ids
export type Editable = { document: Document; cursor: Cursor; selection: Selection };
export type HistoryEntry = { label: string; patches: Patch[]; inverse: Patch[]; coalesceKey?: string; at: number };
export type EditorState = Editable & { history: { past: HistoryEntry[]; future: HistoryEntry[] }; dirty: boolean; activeLayoutId: string; invariantErrors: string[] };
export type Command<A> = { label: string; coalesceKey?: (args: A) => string | undefined; run: (draft: Editable, args: A) => void };
// store.ts
export type EditorStore = ReturnType<typeof createEditorStore>;
export function createEditorStore(document: Document): StoreApi<EditorState> & {
  dispatch<A>(command: Command<A>, args: A, options?: { record?: boolean }): void;  // record defaults true
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
};
```

`dispatch`: `enablePatches()` once; `const [next, patches, inverse] = produceWithPatches(editable, draft => command.run(draft, args))`; `invariantErrors = checkInvariants(next.document)`; if `record` and `patches.length`: coalesce with `past.at(-1)` when both have the same `coalesceKey` and `at` within 500 ms (concatenate `patches`, prepend `inverse`), else push; clear `future`. `undo`: pop `past`, `applyPatches(editable, entry.inverse)`, push onto `future`. Cursor/selection-only commands are dispatched with `record: false`.

Score commands (all take `measureId` where relevant; all keep every sequence exactly one bar long by calling `refillMeasure(draft.document, measureIndex)` which truncates content past the bar (splitting the last event with `ticksToDurations` of the remaining room) and pads with rests):
`setTime({measureId, time})`, `setKey({measureId, key})`, `setClef({partId, measureId, staff, clef})` (measure 0 → `part.clefs[staff-1]`), `setBarline({measureId, barline})`, `toggleRepeatStart({measureId})`, `setRepeatEnd({measureId, times|null})`, `setEnding({measureId, numbers|null})`, `setJump({measureId, jump|null})`, `toggleMark({measureId, mark:'segno'|'coda'|'toCoda'|'fine'})`, `setTempo({measureId, tempo|null})`, `insertMeasure({afterMeasureId|null})` (new global measure plus a full-rest part measure per part; cursor moves there), `deleteMeasure({measureId})` (refuse when it is the last one; move cursor to the previous), `setCursor(cursor partial)` (record:false), `setSelection({ids})` (record:false).

- [ ] **Step 1: Failing tests.**

```ts
test('setTime refills sequences', () => {
  const store = createEditorStore(threeQuarterNotesDoc());  // 4/4 bar: three quarter notes + quarter rest
  const m = store.getState().document.global.measures[0].id;
  store.dispatch(setTime, { measureId: m, time: { count: 2, unit: 4 } });
  const seq = store.getState().document.parts[0].measures[0].sequences[0];
  expect(sequenceTicks(seq)).toBe(1920); expect(seq.content).toHaveLength(2);
  store.dispatch(setTime, { measureId: m, time: { count: 6, unit: 4 } });
  expect(sequenceTicks(store.getState().document.parts[0].measures[0].sequences[0])).toBe(5760);
  expect(store.getState().invariantErrors).toEqual([]);
});
test('coalesced entries undo as one', () => {
  const store = createEditorStore(helloDoc());
  const cmd: Command<{ v: string }> = { label: 'title', coalesceKey: () => 'title', run: (d, a) => { d.document.meta.title = a.v; } };
  store.dispatch(cmd, { v: 'a' }); store.dispatch(cmd, { v: 'ab' }); store.dispatch(cmd, { v: 'abc' });
  expect(store.getState().history.past).toHaveLength(1);
  store.undo(); expect(store.getState().document.meta.title).toBe('Hello');
  store.redo(); expect(store.getState().document.meta.title).toBe('abc');
});
test('insert and delete measure keep parts aligned', () => { /* insert after bar 0, expect 2 global + 2 part measures, invariants clean; delete, expect 1; delete last refused (document unchanged, no history entry) */ });
test('repeat and ending commands compile to valid navigation', () => { /* toggleRepeatStart m1, setEnding m2 [1], setRepeatEnd m2, setEnding m3 [2]: invariants clean; setEnding on m0 without repeatStart → invariantErrors contains ending-after-repeat */ });
```

- [ ] **Step 2–5:** run, implement, pass, commit `feat(editor): command engine with patch history and score-level commands`.

---

### Task 6: Stave-level commands

**Files:**
- Create: `src/engine/commands/notes.ts`, `src/engine/commands/beams.ts`, `src/engine/commands/directions.ts`, `src/engine/autobeam.ts`
- Test: `src/engine/commands/notes.test.ts`, `beams.test.ts`, `directions.test.ts`

**Interfaces (all `Command<…>`):**
- `enterEvent({ pitch?: Pitch; rest?: boolean })`: at the cursor (part, staff, voice, measure, tick, duration). Removes/splits whatever occupies `[tick, tick+durationTicks)` in that sequence, inserts the event (with one note of `pitch` unless `rest`), clamps the duration to the bar end (Review Focus 1), refills, runs `autoBeam` on the sequence, advances `cursor.tick` by the inserted ticks (moving to the next measure's tick 0 when at the bar end, inserting a measure when at the last bar), sets `cursor.lastPitch`. `coalesceKey` undefined (each entry undoable).
- `addChordNote({ eventId, pitch })`, `setPitch({ noteId, pitch })` (coalesceKey `pitch:<noteId>`), `stepPitch({ noteId, steps: number })` diatonic in the key (coalesceKey `pitch:<noteId>`), `shiftOctave({ noteId, octaves })`, `setAccidental({ noteId, alter })`.
- `setDuration({ eventId, duration })` (overwrite semantics as enterEvent), `toggleDot({ eventId })`, `toggleRest({ eventId })`, `deleteEvents({ ids })` (replace by rests, merge adjacent rests), `makeTuplet({ eventId, multiple: 3|5|6|7 })` (replace the event by a tuplet of `multiple` equal events fitting the same span), `toggleArticulation({ eventId, articulation })`, `toggleTie({ noteId })` (to the next event's equal pitch; create that note if the next event is a rest of any length by converting it… MVP: only when a matching pitch exists, else no-op), `addSlur({ fromEventId, toEventId })`, `removeSlur({ slurId })`.
- Beams: `setBeamGroup({ measureId, staff, voice, group: number })` regroups all sub-quarter events into runs of `group` events, rests break groups; `breakBeam({ eventId })`, `joinBeam({ eventId })` (join with the previous event's beam).
- `autoBeam(seq, time)`: groups by beat: for `unit 4` one beat = 960 ticks, for `unit 8` with count divisible by 3, beat = 1440; events shorter than a quarter within one beat form a beam; rests break it.
- Directions: `addDynamic({ anchor, value })`, `addWedge({ anchor, shape, endTick, endMeasureId? })`, `addText({ anchor, text, style? })`, `removeDirection({ id })`, `nudge({ id, dx, dy })` (coalesceKey `nudge:<id>`).

- [ ] **Step 1: Failing tests** including:

```ts
test('enterEvent clamps at bar end', () => {
  const store = createEditorStore(helloDoc());    // 4/4, one bar of rests
  store.dispatch(setCursor, { tick: 3360, duration: { base: 'half', dots: 0 }, mode: 'enter' }, { record: false });
  store.dispatch(enterEvent, { pitch: { step: 'G', octave: 4, alter: 0 } });
  const seq = store.getState().document.parts[0].measures[0].sequences[0];
  expect(seq.content.at(-1)).toMatchObject({ duration: { base: 'eighth', dots: 0 }, notes: [{ pitch: { step: 'G' } }] });
  expect(sequenceTicks(seq)).toBe(3840);
  expect(store.getState().cursor.measureId).not.toBe(store.getState().document.global.measures[0].id); // advanced into a new bar
});
test('entering four eighths auto-beams them', () => { /* cursor eighth at 0; enter C D E F; beams[0].events length 4 */ });
test('setBeamGroup 2 splits them', () => { /* two beams of 2 */ });
test('toggleTie links equal pitches across the barline', () => { /* last note bar 1 C4, first note bar 2 C4 */ });
test('deleteEvents merges rests', () => { /* delete 2 of 4 quarters → sequence has quarter, half rest? no: quarter, rest quarter, rest quarter merge to half rest, quarter */ });
test('makeTuplet 3 on a quarter', () => { /* tuplet of 3 eighths, sequence still 3840 */ });
test('addDynamic compiles with offset', () => { /* anchor tick 480 → xml contains <offset>480</offset> before? assert <dynamics><mf/> present and invariants clean */ });
```

- [ ] **Step 2–5:** run, implement, pass, commit `feat(editor): note entry, beams, ties, slurs, articulations, directions`.

---

### Task 7: Keymap and cursor navigation

**Files:**
- Create: `src/ui/keymap.ts`, `src/engine/commands/cursor.ts`
- Test: `src/ui/keymap.test.ts`

**Interfaces:**
```ts
export type KeyBinding = { keys: string[]; label: string; group: 'entry'|'duration'|'pitch'|'edit'|'navigate'|'score'; action: (ctx: KeyContext) => void };
export type KeyContext = { store: EditorStore; openPopover(name: 'key'|'time'|'clef'|'dynamic'|'jump'|'ending'|'text'): void; play(): void };
export const KEYMAP: KeyBinding[];
export function handleKey(event: KeyboardEvent, ctx: KeyContext): boolean;  // true when consumed
export function describeKey(binding: KeyBinding): string;  // "Ctrl+Shift+Z"
// cursor.ts commands (record:false): moveCursor({ by: 'event'|'measure', delta: ±1 }), setEntryMode({ mode }), setCursorDuration({ duration }), extendSelection({ delta })
```

Bindings (from the spec): `n` toggle entry mode; `1`–`7` → 32nd,16th,eighth,quarter,half,whole,(7 unused → ignore; map 1..6); `a`–`g` enter note at cursor with octave nearest `cursor.lastPitch` (default C4 region); `0` rest; `.` toggleDot on the selected/last event; `ArrowUp/Down` stepPitch ±1 (with Ctrl: shiftOctave); `ArrowLeft/Right` moveCursor by event (Shift extends selection; Ctrl moves by measure); `t` toggleTie on the last note; `s` addSlur between the two selected events (or last two entered); `Shift+.` staccato, `-` tenuto, `>` accent (`Shift+,`), `^` marcato (`Shift+6`); `Ctrl+3/5/6/7` makeTuplet; `b` cycle setBeamGroup 2→3→4→auto; `/` breakBeam; `d` dynamic popover; `k` key, `q` time, `c` clef popovers; `r` cycle barline on cursor measure (`regular→double→repeatStart→repeatEnd→final→regular`); `v` ending popover; `j` jump popover; `Delete`/`Backspace` deleteEvents(selection or last); `Ctrl+z`/`Ctrl+Shift+z`/`Ctrl+y` undo/redo; `Space` play; `Escape` select mode. Ignore events whose target is an input/textarea.

- [ ] **Step 1: Failing tests:** `handleKey` with synthetic `KeyboardEvent`-like objects: `n` toggles mode; `4` then `c` enters a quarter C; `ArrowUp` raises it to D; `Ctrl+z` undoes; a key in an `<input>` target is not consumed.
- [ ] **Step 2–5:** run, implement, pass, commit `feat(editor): keymap and cursor commands`.

---

### Task 8: Editor UI and demo page

**Files:**
- Create: `src/ui/PepperScoreEditor.tsx`, `src/ui/Toolbar.tsx`, `src/ui/Palette.tsx`, `src/ui/Popover.tsx`, `src/ui/useEditorStore.ts`, `src/style.css`, `src/index.ts` (exports below)
- Create: `apps/reader/src/pages/editor.astro`, `apps/reader/src/embed/EditorDemo.tsx`
- Modify: `apps/reader/package.json` (add `"pepperscore-editor": "0.1.0"`), `apps/reader/astro.config.mjs` (alias `pepperscore-editor` → `../../packages/pepperscore-editor/src/index.ts` in dev, same pattern as `pepperscore`), `apps/reader/tsconfig.json` paths.

**Interfaces:**
```ts
export type PepperScoreEditorProps = {
  document?: Document; musicXml?: string;            // one of; neither = new 8-bar treble score
  licenceKey?: string;                                // absent → read-only banner, toolbar disabled
  onChange?(document: Document): void;                // after every recorded command
  view?: 'vertical'|'endless'; height?: string; className?: string;
  assetBaseUrl?: string; soundPack?: 'core'|'complete';
};
export type PepperScoreEditorHandle = { getDocument(): Document; getMusicXml(): string; undo(): void; redo(): void; applyTemplate?: never };
export function PepperScoreEditor(props: PepperScoreEditorProps & { ref?: Ref<PepperScoreEditorHandle> }): JSX.Element;
export { createEditorStore, compileToMusicXml, importMusicXml, createDocument, parseDocument, checkInvariants } and all model types.
```

Behaviour:
- Store created once from `document` / `importMusicXml(musicXml)` / `createDocument({ parts:[{name:'Treble', clef:'treble', gmProgram:1}], measures: 8 })`. If import throws the staff-cap error, render the message in a `ps-editor-error` banner and nothing else.
- `musicXml` for the viewer: `useMemo(() => compileToMusicXml(document), [document])`, passed through a 80 ms debounce (`useDeferredValue` is not enough; use a `setTimeout` state) to `<PepperScore musicXml chrome="minimal" view height onElementClick highlights ref />`.
- Highlights: cursor → `{ ids: noteIdsOf(cursor event), className: 'ps-cursor' }` when the cursor sits on an event, else `{ measures: [cursorMeasureIndex], className: 'ps-cursor-measure' }`; selection → `{ ids: all note ids of selected events, className: 'ps-selection' }`.
- Clicks: `onElementClick` → if `sourceId` resolves through `noteToEvent` to an event, `setCursor` to it (part/staff/voice/measure/tick from `locateEvent`) and `setSelection([eventId])`; else if `measureIndex` defined, set cursor to that measure, `staff` from info, tick = nearest event start to `fraction * measureTicks` in staff 1 voice 1.
- Toolbar (`ps-toolbar`): undo/redo, entry-mode toggle, duration buttons (whole…32nd, dot), rest, tie, slur, articulation group, tuplet 3, beam group select, key/time/clef buttons opening popovers, barline select, repeat start toggle, repeat end toggle, ending select (none/1/2/1,2/3), jump select (none, D.C., D.C. al Fine, D.C. al Coda, D.S., D.S. al Fine, D.S. al Coda), marks (segno/coda/to coda/fine) toggles, dynamic select, text input popover, insert/delete measure, play (uses `handle.seekToMeasure(cursorMeasureIndex)` then `handle.play()`), export MusicXML (download `<title>.musicxml`), save `.pepperscore` (download) and open (file input accepting `.pepperscore,.musicxml,.xml`).
- Palette (`ps-palette`, shown at container width ≤ 760px via container query, mirrors the keymap groups entry/duration/pitch/edit with 44 px buttons, horizontal scroll).
- Keyboard: `onKeyDown` on the root `div.ps-editor` (tabIndex 0) → `handleKey`.
- Popovers are simple absolutely positioned `div.ps-popover` with native `<select>`/`<input>` controls; no library.
- Invariant errors shown in a `ps-editor-status` line (should be empty; a non-empty list is a bug surfaced to the user with "Report this score").
- Read-only (no licence): the toolbar renders disabled, the keymap is not bound, banner `Editing requires a licence.` Licence check for the MVP: `licenceKey === 'dev'` or any key parsing as JSON with `exp` in the future; the Ed25519 check is Task 9.

Demo page `EditorDemo.tsx`: full-width `<PepperScoreEditor licenceKey="dev" view="endless" height="70vh" />` with a sidebar showing the live MusicXML (collapsible), buttons "New", "Open ensemble fixture" (imports `validation/fixtures/ensemble.musicxml?raw`; if it exceeds 4 staves, show the refusal), and `window.__editor = { ref }` for the browser test.

- [ ] **Step 1: Build the component and demo**; run `npm run dev` (Astro, `--host 0.0.0.0`) and open `/editor`; manual check: type `n 4 c d e f`, see four quarters engrave and the cursor move; `Ctrl+z` removes the last; `r` cycles the barline; `k` sets a key; export downloads.
- [ ] **Step 2: Browser test** `validation/editor.mjs` (copy the server/browser boilerplate from `validation/embed.mjs`): open `/editor`, focus `.ps-editor`, press `n 4 c d e f`, wait for four `.reader-note` elements, assert `window.__editor.ref.current.getMusicXml()` contains `<step>F</step>`; press `Control+z`, assert three notes; click the first note, assert it gains `ps-cursor`; set viewport 390×800, assert `.ps-palette` is visible and tapping its "quarter" then "C" buttons adds a note. Add `"test:editor-browser": "node validation/editor.mjs"` to the root scripts and to `test:validation`.
- [ ] **Step 3: `npm run check` across workspaces passes.** Commit `feat(editor): PepperScoreEditor UI, palette, demo page and browser test`.

---

### Task 9: Native file format, licence, export

**Files:**
- Create: `src/format/pepperscore-file.ts`, `src/licence.ts`
- Test: `src/format/pepperscore-file.test.ts`, `src/licence.test.ts`
- Modify: `src/ui/PepperScoreEditor.tsx` (use both), `packages/pepperscore-editor/README.md` (new: usage, keymap table generated from `KEYMAP` via `describeKey`, file format)

**Interfaces:**
```ts
export type PepperScoreFile = { pepperscore: { version: 1 }; meta: { title?: string; composer?: string; created: string; modified: string }; document: Document; source?: { format: 'musicxml'|'mxl'; sha256: string; filename?: string; dropped: Dropped[] }; editor?: { cursor?: Cursor; activeLayoutId?: string } };
export function writePepperScoreFile(args: { document: Document; source?: PepperScoreFile['source']; editor?: PepperScoreFile['editor']; created?: string }): string;   // JSON, 2-space
export function readPepperScoreFile(text: string): PepperScoreFile;   // validates with Zod; throws Error('Not a .pepperscore file') / ('Unsupported .pepperscore version N')
export type Licence = { sub: string; exp: number; maxStaves: number };
export async function verifyLicence(key: string, publicKeyJwk?: JsonWebKey): Promise<Licence | null>;  // key = base64url(payloadJson) + '.' + base64url(ed25519 signature); 'dev' → { sub:'dev', exp: Infinity, maxStaves: 4 } only when import.meta.env.DEV
```

- [ ] **Step 1: Failing tests:** write/read round trip preserves the document and rejects version 2 and non-JSON; `verifyLicence` accepts a key signed in the test with a generated Ed25519 pair (`crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign','verify'])`, Node 20+), rejects a tampered payload and an expired `exp`.
- [ ] **Step 2–4:** implement, pass, wire into the UI: licence resolved asynchronously on mount (`useEffect`), `maxStaves` replaces the hard-coded 4; open accepts `.pepperscore`; save writes it; `source.sha256` computed with `crypto.subtle.digest` on import. README written. Commit `feat(editor): .pepperscore file format and Ed25519 licence check`.

---

### Task 10: Branch finish

- [ ] Run `npm run check && npm test -w pepperscore-editor && npm run build && npm run test:api && npm run test:embed && npm run test:editor-browser`.
- [ ] Update `packages/pepperscore/CHANGELOG.md` (Unreleased) and add `docs/specs/score-editor.md` with a Results section recording the measured edit-to-engrave latency from the demo (log `performance.now()` deltas in `EditorDemo` for 8, 32 and 128 bars, 1 and 4 staves).
- [ ] Open a PR `feat: score editor MVP (pepperscore-editor)` against `main` following the repo's PR workflow memory (review, fix, merge when CI green).
