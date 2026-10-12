# pepperscore 0.2: External Clock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a host drive the PepperScore playhead from its own clock (`clock` prop), turn sound off (`audio={false}`), receive seek requests from clicks (`onSeek`) and time updates (`onTimeUpdate`), and seek and read the time through the handle (`seek`, `currentTime`). This ships as pepperscore 0.2.0.

**Architecture:** Pure time-mapping helpers go in a new type-import-only module, `src/lib/playback/clock-time.ts`, which Node tests directly. A MusicXML contract fixture with a pickup bar and two tempo changes pins note onset seconds within 1 ms in a browser test. ivories runs the same fixture on its side. `PepperScore.tsx` gets a clock-mode effect. It subscribes to the host clock and, on every animation frame while the clock plays, maps `clock.now()` through the existing `playbackPositionAt(timeline, seconds, timeline.initialBpm)`. In clock mode the internal play loop, audio and transport never start. The self-driven mode gains `audio={false}`, `onTimeUpdate`, `seek` and `currentTime`.

**Tech Stack:** React 19, TypeScript 5.9, Vite 8, Astro (demo `apps/reader`), playwright-core + `node:assert/strict` validation scripts, and Node 22+ (type stripping) for the pure-module tests.

**Spec:** `/home/shaun/ivories-mvp/docs/superpowers/specs/2026-10-12-ivories-mvp-design.md`, section 4.3 "Notation via pepperscore". Read it before every task. The summary below is binding where it is more specific.

## Requirement summary (from spec section 4.3 plus the caller's brief)

- `clock?: ExternalClock`, where `ExternalClock = { now(): number; playing: boolean; subscribe(fn: (e: { type: 'play' | 'pause' | 'seek' | 'rate'; time: number }) => void): () => void }`. When set, the rAF cursor reads `clock.now()` (seconds) and maps it to the score through `playbackPositionAt(timeline, seconds, bpm)`. The internal play loop never starts. Endless/Vertical follow keeps working off the clock time.
- `audio?: boolean`, default `true`. `false` skips sound loading and scheduling entirely.
- `onSeek?(seconds)`: in clock mode, a user click on a note or measure reports the time and does not seek internally.
- Handle additions: `seek(seconds)` and `currentTime()`.
- Clock mode uses the score's own tempo and ignores the BPM preference, so seconds match an external tempo map. A contract test asserts that note onset seconds from a fixture MusicXML (with a pickup bar and a tempo change) are within 1 ms of the expected values.
- Export the `ExternalClock` type. Bump to 0.2.0, with CHANGELOG and README docs.
- `onTimeUpdate?(seconds)`, throttled to about 10 Hz, in self-driven mode (it is trivial, so it is included).

## Decisions made in this plan (flag to the user at review if any is wrong)

1. **No click-to-seek exists today.** PepperScore has no note or measure click handling. This plan adds click-to-time mapping **only in clock mode**, where it is reported through `onSeek`. Self-driven readers keep today's behaviour: clicks do nothing.
2. **Clock mode is visual only.** With `clock` set, no audio loads or plays whatever `audio` says. The header play, stop and BPM controls and the compact play button are hidden. `handle.play()` and `handle.stop()` are no-ops. The host owns transport.
3. **Clock mode forces the playhead on.** ivories passes `chrome="none"`, whose preset turns the playhead off (`resolveChrome('none').playhead === false`). With `clock` set, the playhead, note highlight and follow are on for every preset.
4. **`handle.seek(s)` in clock mode calls `onSeek(s)`**, the same path as a click. The host then calls its own `clock.seek`. In self-driven mode it moves the playhead. While playing, it restarts scheduling from there without an `onStop`/`onPlay` pair.
5. **`currentTime()`** returns `clock.now()` in clock mode, else the self-driven playhead seconds (BPM-scaled, as today).
6. **A negative clock time (count-in) shows no playhead.** A time past the end holds at the end (`positionAtSeconds` clamps), and nothing stops.
7. **`onPlay`/`onStop` are not fired for clock play/pause.** The host already knows its own clock state.
8. **Self-driven `audio={false}` plays silently on wall-clock time** (the existing silent path) with no "Audio couldn't start" notice. It does not claim the page-wide playback slot, so it never stops another reader's sound.
9. `noteOnsetSeconds` is exported from `src/lib/playback/clock-time.ts`, not from the package root. ivories copies the fixture and the expected JSON, not the function.

## Global Constraints

- Work only in the worktree **`/home/shaun/pepperscore-clock`**, on branch **`feat/external-clock`** (created from `main` @ `707884d`). Do not touch the main checkout `/home/shaun/ph-vexflow-view`. Do not start, stop or restart its dev server on port 4321.
- Any dev server you start yourself uses `--host 0.0.0.0` on a port other than 4321 (for example `npm run dev -- --host 0.0.0.0 --port 4400`).
- **No publishing.** Do not run `npm publish`, `npm version` with git tags, or push tags. Publishing 0.2.0 is a user-approved gate and is out of scope.
- `react`/`react-dom` stay peer dependencies `>=19`. Add no runtime dependencies.
- Every new element gets a **contextual class name** (for example `className="clock-test"`, `className="host-snippet clock-box-a"`).
- All library CSS stays scoped under `.pepperscore` (checked by `npm run test:css`).
- The component never reads `window.location` (checked by `npm run test:api`).
- Tests are plain Node scripts under `validation/`. Pure `.ts` modules that Node imports directly may only have `import type` imports. Browser tests use playwright-core + `node:assert/strict`. There is no test framework.
- `tests/` and `examples/` are gitignored. Never edit or commit them. New fixtures go in `validation/fixtures/`.
- The browser suites make no remote requests. Test pages pass `assetBaseUrl="/custom-assets"`.
- Browser tests that run against the demo build (`validation/embed.mjs`, `layout.mjs`, the new `clock-embed.mjs`) need `npm run build` first. The build compiles the library, then the demo against the library's `dist`.
- Commit messages end with a blank line and then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Count-in: the clock reports a negative time** (ivories counts in before 0). The reader should show no highlighted note and no playback line, and must not throw. Pinned in Task 4, test step 1.
2. **The host passes a new clock object on every render** (an inline adapter). The reader should keep exactly one live subscription on the underlying clock and should not leak listeners or loop. Pinned in Task 4, test step 6.
3. **The score re-engraves while the clock is paused** (view change, resize). The playhead should come back on the same note at the clock's time, not reset to the start. Pinned in Task 4, test step 5.
4. **A click lands on whitespace or a rest inside a measure, or on a note that repeats.** Whitespace or a rest should report that measure's start. A repeated note should report the occurrence nearest the current time. Pinned in Task 1 (nearest occurrence, measure start) and Task 4, test step 3 (whitespace click).
5. **A silent or clock-driven reader loads sound** (an AudioContext, `pack.json`, soundfonts), or a seek while playing fires `onStop` then `onPlay`. Neither should happen. Pinned in Task 3, test steps 2–3, and Task 4, test step 8.

---

## File map

```
packages/pepperscore/
  src/lib/clock.ts                      NEW  ExternalClock / ClockEvent types (types only)
  src/lib/playback/clock-time.ts        NEW  scoreSecondsScale, noteOnsetSeconds, noteSeekSeconds, measureSeekSeconds (type-only imports)
  src/components/PepperScore.tsx        MOD  props, handle, audio=false, onTimeUpdate, seek/currentTime, clock mode, click → onSeek
  src/styles.css                        MOD  pointer cursor on notes in clock mode
  src/index.ts                          MOD  export ExternalClock, ClockEvent
  package.json                          MOD  version 0.2.0, files += CHANGELOG.md
  README.md                             MOD  props table, ref, "Driving the playhead from your own clock"
  CHANGELOG.md                          NEW
validation/
  clock.mjs                             NEW  Node test of clock-time.ts
  clock-contract.mjs                    NEW  browser contract test (Vite dev server + Chromium)
  clock-embed.mjs                       NEW  browser test against the build (/embed-clock)
  fixtures/clock-contract.musicxml      NEW  pickup bar + tempo 120 → 60 → 180 (mid-bar)
  fixtures/clock-contract.expected.json NEW  expected onsets (shared with ivories)
apps/reader/src/
  embed/ClockTest.tsx                   NEW  host page for clock-embed.mjs
  pages/embed-clock.astro               NEW
package.json (root)                     MOD  test:clock, test:clock-contract, test:clock-embed, test:validation chain
package-lock.json                       MOD  workspace version 0.2.0 (via npm version)
```

## Baseline (recorded 2026-10-12 while writing this plan)

- `npm run check` (main checkout, HEAD `707884d`): 0 errors, 0 warnings.
- `npm run test:validation` (main checkout, against its existing build): passed through `test:api`, `css`, `assets`, `sounds`, `spelling`, `transpose`, `document`, `parser-diff`, `score-db`, `performance` (9 fixtures, 111 regressions), `reader`, `chunks`, `large`, `guardrails`. It failed at `test:embed` ("the compact play button is on top with a header (hit "topbar")") only because the main checkout's `apps/reader/dist` is from Oct 9 and predates commit `164a833`.
- Fresh build in the worktree (`npm ci && npm run build`, then `npm run test:embed && npm run test:layout`): **both pass** (`chromium: embedding (...) passed`, `Layout validation passed (chromium)`). The whole suite is green at `707884d` once rebuilt. **Always run `npm run build` before the build-based suites.** A red `test:embed` on this branch is a real regression.

---

### Task 1: Clock types and pure time-mapping helpers

**Files:**
- Create: `packages/pepperscore/src/lib/clock.ts`
- Create: `packages/pepperscore/src/lib/playback/clock-time.ts`
- Create: `validation/clock.mjs`
- Modify: `package.json` (root): scripts

**Interfaces:**
- Consumes: `PerformanceTimeline`, `PerformanceEvent`, `PlaybackPosition` types from `packages/pepperscore/src/lib/playback/timeline.ts` (type-only).
- Produces:
  - `export type ClockEvent = { type: 'play' | 'pause' | 'seek' | 'rate'; time: number }`
  - `export type ExternalClock = { now(): number; readonly playing: boolean; subscribe(listener: (event: ClockEvent) => void): () => void }`
  - `export type ClockTimeline = Pick<PerformanceTimeline, 'events' | 'positions' | 'initialBpm'>`
  - `export function scoreSecondsScale(timeline: Pick<PerformanceTimeline, 'initialBpm'>, bpm: number): number`: playback seconds per timeline unit.
  - `export type NoteOnset = { noteId: string; midi: number; measureIndex: number; occurrence: number; seconds: number }`
  - `export function noteOnsetSeconds(timeline: Pick<PerformanceTimeline, 'events' | 'initialBpm'>): NoteOnset[]`: onsets in seconds at the score's own tempo.
  - `export function noteSeekSeconds(timeline: ClockTimeline, noteId: string, nearSeconds: number, bpm: number): number | null`
  - `export function measureSeekSeconds(timeline: ClockTimeline, measureIndex: number, nearSeconds: number, bpm: number): number | null`

- [ ] **Step 0: Prepare the worktree (once, before any task)**

```bash
cd /home/shaun/pepperscore-clock
git status            # expect: On branch feat/external-clock, clean
npm ci                # workspace install (needs network)
npm run check         # expect 0 errors
```

If `npm run build` later complains about missing `packages/pepperscore-sounds-core` assets, run `npm run sounds:core` once. Its outputs are gitignored.

- [ ] **Step 1: Write the failing test** `validation/clock.mjs`

```js
// Clock-mode time mapping (packages/pepperscore/src/lib/playback/clock-time.ts), a pure module run in Node.
// Timelines here are hand-built in timeline units (opening-tempo beats); at 120 bpm one unit is 0.5 s.
import assert from 'node:assert/strict';
import { measureSeekSeconds, noteOnsetSeconds, noteSeekSeconds, scoreSecondsScale } from '../packages/pepperscore/src/lib/playback/clock-time.ts';

const event = (noteId, measureIndex, occurrence, start, end, midi = 60) => ({
  id: `${noteId}:0:${occurrence}`, noteId, pitchId: `${noteId}:0`, pitchIndex: 0, partId: 'P1', voice: '1', measureIndex, occurrence,
  scoreBeat: 0, endScoreBeat: 0, startSeconds: start, endSeconds: end, soundEndSeconds: end, midi, velocity: 82,
  visualNoteIds: [noteId], visualSegments: [{ noteId, startSeconds: start, endSeconds: end }],
});
const position = (seconds, measureIndex, occurrence, measureBeat = 0) => ({ seconds, scoreBeat: 0, measureIndex, occurrence, measureBeat, noteId: null, activeNoteIds: [] });
// Bar 0 (notes a, b) is played twice (a repeat), then bar 1: c is tied into d (d is c's second visual segment).
const tied = event('c', 1, 0, 8, 12, 64);
tied.visualNoteIds.push('d');
tied.visualSegments.push({ noteId: 'd', startSeconds: 10, endSeconds: 12 });
const timeline = {
  initialBpm: 120,
  events: [event('a', 0, 0, 0, 2), event('b', 0, 0, 2, 4), event('a', 0, 1, 4, 6), event('b', 0, 1, 6, 8), tied],
  positions: [position(0, 0, 0), position(2, 0, 0, 2), position(4, 0, 1), position(8, 1, 0), position(10, 1, 0, 2), position(12, 1, 0, 4)],
};

// Scale: seconds per unit at a BPM; an invalid BPM falls back to the score's opening tempo.
assert.equal(scoreSecondsScale(timeline, 120), .5);
assert.equal(scoreSecondsScale(timeline, 60), 1);
assert.equal(scoreSecondsScale(timeline, 0), .5, 'zero BPM uses the opening tempo');
assert.equal(scoreSecondsScale(timeline, Number.NaN), .5, 'NaN BPM uses the opening tempo');

// Onsets are at the score's own tempo, one per performed pitch, in performed order.
assert.deepEqual(noteOnsetSeconds(timeline).map(onset => [onset.noteId, onset.occurrence, onset.midi, onset.seconds]),
  [['a', 0, 60, 0], ['b', 0, 60, 1], ['a', 1, 60, 2], ['b', 1, 60, 3], ['c', 0, 64, 4]]);
assert.deepEqual(Object.keys(noteOnsetSeconds(timeline)[0]).sort(), ['measureIndex', 'midi', 'noteId', 'occurrence', 'seconds']);

// A note seeks to its occurrence nearest the current time (Review Focus 4); a tie continuation seeks to its own segment.
assert.equal(noteSeekSeconds(timeline, 'a', 0, 120), 0);
assert.equal(noteSeekSeconds(timeline, 'a', 2.9, 120), 2, 'the repeat\'s occurrence is nearer');
assert.equal(noteSeekSeconds(timeline, 'a', 1, 120), 0, 'equidistant occurrences pick the earlier one');
assert.equal(noteSeekSeconds(timeline, 'd', 0, 120), 5, 'tie continuation d starts at unit 10');
assert.equal(noteSeekSeconds(timeline, 'b', 0, 60), 2, 'the BPM scales the result');
assert.equal(noteSeekSeconds(timeline, 'missing', 0, 120), null, 'a rest or unknown note has no time');

// A measure seeks to the start of its occurrence nearest the current time.
assert.equal(measureSeekSeconds(timeline, 0, 0, 120), 0);
assert.equal(measureSeekSeconds(timeline, 0, 3, 120), 2, 'second pass of bar 0');
assert.equal(measureSeekSeconds(timeline, 1, 0, 120), 4);
assert.equal(measureSeekSeconds(timeline, 9, 0, 120), null, 'a measure never performed has no time');
console.log('Clock time: scale, onsets at score tempo, note and measure seek targets passed');
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `cd /home/shaun/pepperscore-clock && node validation/clock.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `clock-time.ts`.

- [ ] **Step 3: Create** `packages/pepperscore/src/lib/clock.ts`

```ts
/** A host-owned clock that drives the playhead (the `clock` prop). Types only: no runtime imports. */
export type ClockEvent = { type: 'play' | 'pause' | 'seek' | 'rate'; time: number };
export type ExternalClock = {
  /** Current time in seconds from the start of the score (score beat 0, the pickup's first beat when there is one). May be negative during a count-in. */
  now(): number;
  /** Whether the clock is running; the playhead updates every animation frame while it is. */
  readonly playing: boolean;
  /** Called on play, pause, seek and rate changes; returns an unsubscribe function. */
  subscribe(listener: (event: ClockEvent) => void): () => void;
};
```

- [ ] **Step 4: Create** `packages/pepperscore/src/lib/playback/clock-time.ts`

```ts
// Time mapping for clock mode and seeking. Type-only imports, so Node can run it directly (validation/clock.mjs).
import type { PerformanceTimeline } from './timeline';

export type ClockTimeline = Pick<PerformanceTimeline, 'events' | 'positions' | 'initialBpm'>;
export type NoteOnset = { noteId: string; midi: number; measureIndex: number; occurrence: number; seconds: number };

/** Playback seconds per timeline unit at `bpm`; an invalid BPM plays at the score's opening tempo (same rule as playbackScale). */
export function scoreSecondsScale(timeline: Pick<PerformanceTimeline, 'initialBpm'>, bpm: number): number {
  return 60 / (Number.isFinite(bpm) && bpm > 0 ? bpm : timeline.initialBpm);
}

/**
 * Note onsets in seconds at the score's own tempo map: the times clock mode maps `clock.now()` against. One entry per
 * performed pitch (repeats included), in performed order. Seconds count from score beat 0, a pickup's first beat.
 */
export function noteOnsetSeconds(timeline: Pick<PerformanceTimeline, 'events' | 'initialBpm'>): NoteOnset[] {
  const scale = scoreSecondsScale(timeline, timeline.initialBpm);
  return timeline.events.map(event => ({ noteId: event.noteId, midi: event.midi, measureIndex: event.measureIndex, occurrence: event.occurrence, seconds: event.startSeconds * scale }));
}

/** The candidate nearest `near`; on a tie, the earlier one. */
function nearest(candidates: number[], near: number): number | null {
  let best: number | null = null;
  for (const value of candidates) if (best === null || Math.abs(value - near) < Math.abs(best - near) - 1e-9 || (Math.abs(Math.abs(value - near) - Math.abs(best - near)) <= 1e-9 && value < best)) best = value;
  return best;
}

/** Playback seconds (at `bpm`) where a written note sounds, at its performed occurrence nearest `nearSeconds`; null for a rest or unknown note. */
export function noteSeekSeconds(timeline: ClockTimeline, noteId: string, nearSeconds: number, bpm: number): number | null {
  const scale = scoreSecondsScale(timeline, bpm);
  const starts: number[] = [];
  for (const event of timeline.events) for (const segment of event.visualSegments) if (segment.noteId === noteId) starts.push(segment.startSeconds * scale);
  return nearest(starts, nearSeconds);
}

/** Playback seconds (at `bpm`) where a measure's performed occurrence nearest `nearSeconds` starts; null if it is never performed. */
export function measureSeekSeconds(timeline: ClockTimeline, measureIndex: number, nearSeconds: number, bpm: number): number | null {
  const scale = scoreSecondsScale(timeline, bpm);
  const firstByOccurrence = new Map<number, number>();
  for (const position of timeline.positions) {
    if (position.measureIndex !== measureIndex) continue;
    const old = firstByOccurrence.get(position.occurrence);
    if (old === undefined || position.seconds < old) firstByOccurrence.set(position.occurrence, position.seconds);
  }
  return nearest([...firstByOccurrence.values()].map(seconds => seconds * scale), nearSeconds);
}
```

- [ ] **Step 5: Run the test and check that it passes**

Run: `node validation/clock.mjs`
Expected: `Clock time: scale, onsets at score tempo, note and measure seek targets passed`

- [ ] **Step 6: Register the script in root `package.json`**

Add after the line `"test:api": "node validation/api.mjs",`:

```json
    "test:clock": "node validation/clock.mjs",
```

In `"test:validation"`, replace `npm run test:api && npm run test:css` with `npm run test:api && npm run test:clock && npm run test:css`.

Run: `npm run test:clock && npm run check`. Expected: the test passes and check reports 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/pepperscore/src/lib/clock.ts packages/pepperscore/src/lib/playback/clock-time.ts validation/clock.mjs package.json
git commit -m "feat(clock): ExternalClock types and score-tempo time mapping helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Onset contract fixture and browser contract test

**Files:**
- Create: `validation/fixtures/clock-contract.musicxml`
- Create: `validation/fixtures/clock-contract.expected.json`
- Create: `validation/clock-contract.mjs`
- Modify: `package.json` (root): scripts

**Interfaces:**
- Consumes: `noteOnsetSeconds` (Task 1); `parseMusicXml` from `src/lib/import.ts`; `buildBaseTimeline` and `playbackPositionAt` from `src/lib/playback/timeline.ts`.
- Produces: the fixture and the expected JSON that ivories copies verbatim. Times are in seconds from score beat 0 (the pickup's first beat), at the score's own tempo map.

Expected onsets, by hand: the pickup is 1 beat at 120 bpm (0.5 s per quarter). Bar 1 has four quarters at 120. Bar 2 has tempo 60 (1 s per quarter) and two halves. Bar 3 has a quarter at 60, then at beat 1 tempo 180 (1/3 s per quarter) with eighth, eighth, half. That gives 0, 0.5, 1, 1.5, 2, 2.5, 4.5, 6.5, 7.5, 7.666667 and 7.833333.

- [ ] **Step 1: Create** `validation/fixtures/clock-contract.musicxml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Clock contract</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="0" implicit="yes">
      <attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
    </measure>
    <measure number="1">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
    </measure>
    <measure number="2">
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>60</per-minute></metronome></direction-type><sound tempo="60"/></direction>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
    </measure>
    <measure number="3">
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>180</per-minute></metronome></direction-type><sound tempo="180"/></direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>half</type></note>
      <barline location="right"><bar-style>light-heavy</bar-style></barline>
    </measure>
  </part>
</score-partwise>
```

- [ ] **Step 2: Create** `validation/fixtures/clock-contract.expected.json`

```json
{
  "description": "pepperscore/ivories clock contract: note onsets of clock-contract.musicxml in seconds from score beat 0 (the pickup's first beat) at the score's own tempo map (120, then 60 from bar 2, then 180 from beat 1 of bar 3). Both repos assert these within the tolerance.",
  "tolerance": 0.001,
  "onsets": [
    { "measureIndex": 0, "midi": 67, "seconds": 0 },
    { "measureIndex": 1, "midi": 60, "seconds": 0.5 },
    { "measureIndex": 1, "midi": 62, "seconds": 1 },
    { "measureIndex": 1, "midi": 64, "seconds": 1.5 },
    { "measureIndex": 1, "midi": 65, "seconds": 2 },
    { "measureIndex": 2, "midi": 67, "seconds": 2.5 },
    { "measureIndex": 2, "midi": 69, "seconds": 4.5 },
    { "measureIndex": 3, "midi": 71, "seconds": 6.5 },
    { "measureIndex": 3, "midi": 72, "seconds": 7.5 },
    { "measureIndex": 3, "midi": 74, "seconds": 7.666667 },
    { "measureIndex": 3, "midi": 76, "seconds": 7.833333 }
  ]
}
```

- [ ] **Step 3: Write the test** `validation/clock-contract.mjs`

```js
// Clock contract (ivories spec section 4.3): note onsets of validation/fixtures/clock-contract.musicxml (a pickup bar, tempo 120 → 60
// → 180 mid-bar), read through the real MusicXML import and performance timeline, must match
// validation/fixtures/clock-contract.expected.json within its tolerance (1 ms). ivories asserts the same file against its
// own tempo map. Clock mode maps a time to the score through playbackPositionAt at the score's own tempo, so each onset
// must also land on its note.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const fixture = readFileSync(new URL('./fixtures/clock-contract.musicxml', import.meta.url), 'utf8');
const expected = JSON.parse(readFileSync(new URL('./fixtures/clock-contract.expected.json', import.meta.url), 'utf8'));
const port = 43986;
const server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0', '--port', String(port), '--strictPort'], { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch(`http://127.0.0.1:${port}/validation/performance.html`); if (response.ok) break; }
    catch { /* wait for Vite */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/validation/performance.html`);
  const actual = await page.evaluate(async xml => {
    const { parseMusicXml } = await import('/packages/pepperscore/src/lib/import.ts');
    const { buildBaseTimeline, playbackPositionAt } = await import('/packages/pepperscore/src/lib/playback/timeline.ts');
    const { noteOnsetSeconds } = await import('/packages/pepperscore/src/lib/playback/clock-time.ts');
    const timeline = buildBaseTimeline(parseMusicXml(xml));
    const onsets = noteOnsetSeconds(timeline);
    const landed = onsets.map(onset => playbackPositionAt(timeline, onset.seconds + 1e-4, timeline.initialBpm).activeNoteIds.includes(onset.noteId));
    // The BPM preference never enters clock mode: the same clock time maps to the same note at the score tempo only.
    const atScoreTempo = playbackPositionAt(timeline, 7.7, timeline.initialBpm).activeNoteIds;
    return { initialBpm: timeline.initialBpm, onsets, landed, atScoreTempo, d5: onsets.find(onset => onset.midi === 74)?.noteId, diagnostics: timeline.diagnostics };
  }, fixture);
  assert.equal(actual.initialBpm, 120, 'the opening tempo is the fixture\'s 120');
  assert.equal(actual.onsets.length, expected.onsets.length, `onset count (${actual.onsets.map(onset => onset.seconds).join(', ')})`);
  expected.onsets.forEach((want, index) => {
    const got = actual.onsets[index];
    assert.equal(got.midi, want.midi, `onset ${index} pitch`);
    assert.equal(got.measureIndex, want.measureIndex, `onset ${index} measure`);
    assert.ok(Math.abs(got.seconds - want.seconds) < expected.tolerance, `onset ${index} (midi ${want.midi}): ${got.seconds} s, expected ${want.seconds} s ± ${expected.tolerance}`);
  });
  assert.ok(actual.landed.every(Boolean), `every onset maps back to its own note through playbackPositionAt: ${actual.landed}`);
  assert.deepEqual(actual.atScoreTempo, [actual.d5], '7.7 s is inside D5 (7.666667–7.833333 s)');
  console.log(`Clock contract: ${actual.onsets.length} onsets within ${expected.tolerance * 1000} ms (pickup, tempo 120 → 60 → 180 mid-bar) passed`);
  if (actual.diagnostics.length) console.log(`Diagnostics: ${actual.diagnostics.join('; ')}`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
```

- [ ] **Step 4: Run the test**

Run: `cd /home/shaun/pepperscore-clock && node validation/clock-contract.mjs`
Expected: `Clock contract: 11 onsets within 1 ms … passed`.

Task 1 already exists, so this test should pass the first time. **If it fails, do not edit the expected JSON.** The expected values come from the fixture's notated tempo map, and ivories asserts the same file. Find out which side is wrong instead. Print `actual.onsets` and check how the pickup measure (`implicit="yes"`, `musicxml-source.ts` line ~488) and the mid-bar tempo (`tempoPoints` in `timeline.ts`) were read. Report the finding before you change anything other than the test harness.

- [ ] **Step 5: Show that the test can fail** (one-off, do not commit)

Temporarily change `"seconds": 7.666667` to `7.67` in the expected JSON and rerun. Expected: FAIL with `onset 9 (midi 74): 7.666666… s, expected 7.67 s ± 0.001`. Then revert: `git checkout validation/fixtures/clock-contract.expected.json` (or undo the edit if the file is not committed yet).

- [ ] **Step 6: Register the script in root `package.json`**

Add after the `"test:clock"` line:

```json
    "test:clock-contract": "node validation/clock-contract.mjs",
```

In `"test:validation"`, replace `npm run test:performance && npm run test:reader` with `npm run test:performance && npm run test:clock-contract && npm run test:reader`.

Run: `npm run test:clock-contract`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add validation/fixtures/clock-contract.musicxml validation/fixtures/clock-contract.expected.json validation/clock-contract.mjs package.json
git commit -m "test(clock): onset contract fixture (pickup, tempo changes) within 1 ms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Self-driven host API: `audio={false}`, `onTimeUpdate`, `seek`, `currentTime`

**Files:**
- Modify: `packages/pepperscore/src/components/PepperScore.tsx`
- Modify: `packages/pepperscore/src/index.ts`
- Create: `apps/reader/src/embed/ClockTest.tsx`
- Create: `apps/reader/src/pages/embed-clock.astro`
- Create: `validation/clock-embed.mjs`
- Modify: `package.json` (root): scripts

**Interfaces:**
- Consumes: `ExternalClock`, `ClockEvent` (Task 1, `src/lib/clock.ts`).
- Produces (later tasks rely on these exact names):
  - Props: `clock?: ExternalClock; audio?: boolean; onSeek?(seconds: number): void; onTimeUpdate?(seconds: number): void;` (`clock` and `onSeek` are declared here and wired in Task 4).
  - Handle: `seek(seconds: number): void; currentTime(): number;`
  - Component internals used by Task 4: `positionRef` (`useRef<number>`), `moveTo(seconds: number): void`, `halt(): void`, `play(from?: number): Promise<void>`, `clockRef` (`useRef<ExternalClock | undefined>`), `callbacks.current.onSeek` and `callbacks.current.onTimeUpdate`.
  - Package root exports: `type ExternalClock`, `type ClockEvent`.
  - Test page `/embed-clock` with reader `.clock-c` and the globals `window.__clockEvents` and `window.__clockRefs`.

- [ ] **Step 1: Write the failing browser test, part 1 (host page)**

Create `apps/reader/src/pages/embed-clock.astro`:

```astro
---
import ClockTest from '../embed/ClockTest';
import 'pepperscore/style.css';
import '../embed/host.css';
---
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>pepperscore clock test</title></head>
  <body class="host-page">
    <ClockTest client:load />
  </body>
</html>
```

Create `apps/reader/src/embed/ClockTest.tsx`. This is the Task 3 version. Task 4 replaces it whole.

```tsx
import { useRef } from 'react';
import { PepperScore, type PepperScoreHandle } from 'pepperscore';

const ASSETS = '/custom-assets';
const tune = (title: string, bars: number) => `X:1\nT:${title}\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\n${Array.from({ length: bars }, (_, i) => (i % 2 ? 'E D C D |' : 'C E G E |')).join(' ')}`;
type Events = Array<[string, string, number?]>;
declare global { interface Window { __clockEvents: Events; __clockRefs: Record<string, React.RefObject<PepperScoreHandle | null>> } }

/** Host page for validation/clock-embed.mjs: C is a self-driven, silent (audio={false}) minimal snippet. */
export default function ClockTest() {
  const refs = { c: useRef<PepperScoreHandle>(null) };
  if (typeof window !== 'undefined') { window.__clockEvents ??= []; window.__clockRefs = refs; }
  const log = (who: string) => ({
    onSeek: (seconds: number) => window.__clockEvents.push([who, 'seek', seconds]),
    onTimeUpdate: (seconds: number) => window.__clockEvents.push([who, 'time', seconds]),
    onPlay: () => window.__clockEvents.push([who, 'play']),
    onStop: () => window.__clockEvents.push([who, 'stop']),
    onError: (error: Error) => window.__clockEvents.push([who, `error: ${error.message}`]),
  });
  return <div className="clock-test">
    <div className="host-snippet clock-box-c"><PepperScore ref={refs.c} className="clock-c" chrome="minimal" audio={false} abc={tune('Silent self-driven', 8)} ariaLabel="Silent self-driven" assetBaseUrl={ASSETS} {...log('c')} /></div>
  </div>;
}
```

- [ ] **Step 2: Write the failing browser test, part 2** `validation/clock-embed.mjs`

```js
// Clock mode and the 0.2 host API, against the build (apps/reader /embed-clock). Task 3: C, a self-driven silent reader
// (audio={false}): onTimeUpdate about 10 Hz, seek/currentTime, a seek while playing without a stop/play pair, and no
// sound loaded. BROWSER=chromium|firefox|webkit.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';
import { root, serveDist } from './serve-dist.mjs';

const engine = process.env.BROWSER || 'chromium';
const launcher = { chromium, firefox, webkit }[engine];
if (!launcher) throw new Error(`BROWSER must be chromium, firefox or webkit (got "${engine}")`);
const server = await serveDist();
const browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
const sounds = join(root, 'packages/pepperscore-sounds-complete');
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/poppins/i, route => route.abort());
  const requests = [];
  context.on('request', request => requests.push(request.url()));
  await context.route('**/custom-assets/**', async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/custom-assets\//, ''));
    try { return route.fulfill({ status: 200, body: await readFile(join(sounds, path)) }); } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await context.addInitScript(() => {
    window.__contexts = 0;
    const Native = window.AudioContext;
    if (Native) window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__contexts++; } };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.url}/embed-clock`);
  const rendered = selector => page.waitForFunction(selector => { const root = document.querySelector(selector); return root && root.querySelector('.score-system svg .reader-note') && !root.querySelector('.score-loading'); }, selector, { timeout: 60000 });
  await rendered('.pepperscore.clock-c');
  const events = (who, type) => page.evaluate(([who, type]) => window.__clockEvents.filter(([w, t]) => w === who && t === type).map(([, , value]) => value), [who, type]);
  const handle = (who, call) => page.evaluate(([who, call]) => { const h = window.__clockRefs[who].current; return call === 'time' ? h.currentTime() : call === 'stop' ? h.stop() : null; }, [who, call]);

  // 1. Seek while stopped: currentTime() reports it and the playhead shows there (3 s at 120 = bar 2, beat 3).
  await page.evaluate(() => window.__clockRefs.c.current.seek(3));
  assert.equal(await handle('c', 'time'), 3, 'currentTime() after seek(3) while stopped');
  await page.waitForFunction(() => document.querySelectorAll('.clock-c .reader-note.is-playing').length > 0, null, { timeout: 10000 });

  // 2. Silent playback on wall time: onPlay once, onTimeUpdate about 10 Hz, rising from the seek point.
  await page.evaluate(() => { window.__clockEvents.length = 0; return window.__clockRefs.c.current.play(); });
  await page.waitForTimeout(1500);
  const updates = await events('c', 'time');
  assert.ok(updates.length >= 8 && updates.length <= 25, `onTimeUpdate fired ${updates.length} times in 1.5 s (about 10 Hz expected)`);
  assert.ok(updates[0] >= 3 && updates.every((seconds, index) => index === 0 || seconds > updates[index - 1]), `time updates rise from 3 s: ${updates.join(', ')}`);
  assert.ok(await handle('c', 'time') > 3.5, 'currentTime() advances while playing');

  // 3. Seek while playing restarts from there, with no onStop/onPlay pair (Review Focus 5).
  await page.evaluate(() => window.__clockRefs.c.current.seek(1));
  await page.waitForTimeout(300);
  const afterSeek = await handle('c', 'time');
  assert.ok(afterSeek >= 1 && afterSeek < 1.8, `currentTime() ${afterSeek} after seek(1) while playing`);
  assert.deepEqual(await page.evaluate(() => window.__clockEvents.filter(([w, t]) => w === 'c' && (t === 'play' || t === 'stop')).map(([, t]) => t)), ['play'], 'one play edge and no stop across a seek while playing');
  await handle('c', 'stop');

  // 4. Nothing on the page created an AudioContext or fetched a sound (Review Focus 5).
  assert.equal(await page.evaluate(() => window.__contexts), 0, 'no AudioContext was created');
  assert.deepEqual(requests.filter(url => /pack\.json|\/soundfonts\/|\/instruments\//.test(url)), [], 'no sound asset was requested');
  assert.deepEqual(await page.evaluate(() => window.__clockEvents.filter(([, type]) => type.startsWith('error'))), [], 'no reader reported an error');
  assert.deepEqual(errors, [], 'no page errors');
  console.log(`${engine}: silent self-driven playback, onTimeUpdate, seek/currentTime and seek-while-playing passed`);
} finally {
  await browser.close();
  await server.close();
}
```

- [ ] **Step 3: Build and check that the test fails**

Run: `cd /home/shaun/pepperscore-clock && npm run build && node validation/clock-embed.mjs`
Expected: FAIL. `seek` is not a function on the handle (`TypeError … seek is not a function` inside `page.evaluate`).

- [ ] **Step 4: Implement the props, handle and silent playback in `PepperScore.tsx`**

Apply these edits in `packages/pepperscore/src/components/PepperScore.tsx`.

4a. Imports. After `import { ensureMusicFonts } from '../lib/asset-fonts';` add:

```ts
import type { ExternalClock } from '../lib/clock';
```

4b. Constants. After `const SILENT_PLAYBACK_NOTICE = …;` add:

```ts
/** onTimeUpdate fires at most this often during self-driven playback (about 10 Hz). */
const TIME_UPDATE_MS = 100;
```

4c. Handle type. Replace the `PepperScoreHandle` type with:

```ts
export type PepperScoreHandle = {
  /** Start playback (no-op while playing, when the chrome loads no audio, or with a `clock`). */
  play(): Promise<void>;
  /** Stop and rewind (no-op with a `clock`: the host owns time). */
  stop(): void;
  /** Set the absolute transposition in semitones (clamped to -12…12), like `settings.semitones`. */
  transpose(semitones: number): void;
  /**
   * Self-driven: move the playhead to `seconds` (playback seconds at the current BPM); while playing, playback continues
   * from there. With a `clock`: report `seconds` through `onSeek` (the host seeks its clock).
   */
  seek(seconds: number): void;
  /** Seconds of the playhead: `clock.now()` with a `clock`, else the self-driven position. */
  currentTime(): number;
};
```

4d. Props. In `PepperScoreProps`, replace

```ts
  onError?(error: Error): void;
```

with

```ts
  onError?(error: Error): void;
  /**
   * A host clock that drives the playhead (seconds from score beat 0, at the score's own tempo; the BPM setting is ignored).
   * With a clock, the reader never plays sound or runs its own transport, and the playhead shows for every chrome preset.
   * Pass a stable object (a new object re-subscribes).
   */
  clock?: ExternalClock;
  /** `false` never loads or schedules sound: self-driven playback runs silently on wall-clock time. Default `true`. */
  audio?: boolean;
  /** With a `clock`: a click on a note or measure (or `handle.seek`) reports its time here instead of seeking. */
  onSeek?(seconds: number): void;
  /** Self-driven playback time, about 10 times a second while playing. */
  onTimeUpdate?(seconds: number): void;
```

4e. Component signature and callbacks. Replace

```ts
export default function PepperScore({ musicXml, file, scoreUrl, abc, chrome: preset = 'full', controls, view, height, className, ariaLabel, settings, persist, assetBaseUrl, soundPack = 'core', soundSources, onReady, onPlay, onStop, onError, autoFocus, ref }: PepperScoreProps) {
```

with

```ts
export default function PepperScore({ musicXml, file, scoreUrl, abc, chrome: preset = 'full', controls, view, height, className, ariaLabel, settings, persist, assetBaseUrl, soundPack = 'core', soundSources, onReady, onPlay, onStop, onError, clock, audio: withAudio = true, onSeek, onTimeUpdate, autoFocus, ref }: PepperScoreProps) {
```

and replace

```ts
  const callbacks = useRef({ onReady, onPlay, onStop, onError });
  callbacks.current = { onReady, onPlay, onStop, onError };
```

with

```ts
  const callbacks = useRef({ onReady, onPlay, onStop, onError, onSeek, onTimeUpdate });
  callbacks.current = { onReady, onPlay, onStop, onError, onSeek, onTimeUpdate };
  const clockRef = useRef(clock);
  clockRef.current = clock;
```

4f. Position ref. Replace

```ts
  const [position, setPosition] = useState(0);
```

with

```ts
  const [position, setPosition] = useState(0);
  /** The playhead seconds as of the last move (state lags a render; the handle's currentTime() reads this). */
  const positionRef = useRef(0);
  const moveTo = useCallback((seconds: number) => { positionRef.current = seconds; setPosition(seconds); }, []);
```

4g. Split `stop` into `halt` + `stop`. Replace the whole `const stop = useCallback((reset = false) => { … }, []);` block (lines 337–347 at HEAD) with:

```ts
  /** End the running playback (loop, scheduling, sounding notes) without changing the playing/loading state. */
  const halt = useCallback(() => {
    releasePlayback(playbackOwner);
    playRunRef.current += 1;
    if (playRef.current) { cancelAnimationFrame(playRef.current.frame); clearInterval(playRef.current.interval); }
    playRef.current = null;
    scheduledStopsRef.current.splice(0).forEach(item => item.stop());
    audioRef.current?.players.forEach(players => players.forEach(player => player.stop()));
  }, []);
  const stop = useCallback((reset = false) => {
    halt();
    setPlaying(false);
    setLoadingAudio(false);
    if (reset) { moveTo(0); setActive(null); setActiveNotes([]); }
  }, []);
```

4h. `play`. Replace the beginning of `play`, from `const play = async () => {` through `const events = playbackEventsFrom(timeline, secondsStart, bpm, prefs.semitones);`, with:

```ts
  /** Start playback, or toggle it off. `from` (seconds) restarts from there without a stop/play edge: a seek. */
  const play = async (from?: number) => {
    // Nothing to play until a supplied score has loaded: an unloaded, loading or failed snippet never plays the hidden sample.
    // A host clock owns time: the reader never runs its own transport then.
    if (clockRef.current || !chrome.audio || !loaded) return;
    if (from === undefined && (playing || loadingAudio)) { stop(); return; }
    if (from !== undefined) halt();
    const run = ++playRunRef.current;
    // A silent reader (audio={false}) has nothing to stop on another reader, so it never claims the page's playback slot.
    if (withAudio) claimPlayback(playbackOwner);
    try {
      setLoadingAudio(true);
      const timeline = await loadTimeline();
      if (run !== playRunRef.current) return;
      const audio = withAudio ? await ensureAudio(timeline) : null;
      if (run !== playRunRef.current) return;
      setLoadingAudio(false);
      setNotice(audio || !withAudio ? '' : SILENT_PLAYBACK_NOTICE);
      // One clock drives scheduling and the cursor: audio time when sound works, wall time when playing silently.
      const now = audio ? () => audio.context.currentTime : () => performance.now() / 1000;
      const bpm = prefs.bpm;
      const duration = playbackDuration(timeline, bpm);
      const secondsStart = Math.max(0, Math.min(from ?? positionRef.current, duration));
      const started = now() + (audio ? .09 : 0);
      const events = playbackEventsFrom(timeline, secondsStart, bpm, prefs.semitones);
```

Then **delete** the now-duplicated line `const duration = playbackDuration(timeline, bpm);` that followed `const events = …` in the original. Leave `let nextEvent = 0;` and the `schedule` block unchanged.

4i. Tick. Replace

```ts
      const tick = () => {
        const seconds = secondsStart + Math.max(0, now() - started);
        if (seconds >= duration) { stop(true); return; }
        const current = playbackPositionAt(timeline, seconds, bpm);
        setActive(current.noteId);
        setActiveNotes(previous => previous.join('|') === current.activeNoteIds.join('|') ? previous : current.activeNoteIds);
        setPosition(seconds);
        if (playRef.current) playRef.current.frame = requestAnimationFrame(tick);
      };
```

with

```ts
      let lastTimeUpdate = -Infinity;
      const tick = () => {
        const seconds = secondsStart + Math.max(0, now() - started);
        if (seconds >= duration) { stop(true); return; }
        const current = playbackPositionAt(timeline, seconds, bpm);
        setActive(current.noteId);
        setActiveNotes(previous => previous.join('|') === current.activeNoteIds.join('|') ? previous : current.activeNoteIds);
        moveTo(seconds);
        const wall = performance.now();
        if (wall - lastTimeUpdate >= TIME_UPDATE_MS) { lastTimeUpdate = wall; callbacks.current.onTimeUpdate?.(seconds); }
        if (playRef.current) playRef.current.frame = requestAnimationFrame(tick);
      };
```

4j. Seek and handle. Replace

```ts
  useImperativeHandle(ref, () => ({
    play: async () => { if (chrome.audio && !busyRef.current) await latestPlayRef.current(); },
    stop: () => stopRef.current(true),
    transpose: semitones => changePitchRef.current({ semitones: clampSemitones(Math.round(Number(semitones) || 0)) }),
  }), [chrome.audio]);
```

with

```ts
  /** handle.seek: with a clock, report to the host; else move the playhead (and keep playing from there when playing). */
  const seekTo = (seconds: number) => {
    const target = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    if (clockRef.current) { callbacks.current.onSeek?.(target); return; }
    if (!loaded) return;
    positionRef.current = target;
    if (busyRef.current) { void play(target); return; }
    void loadTimeline().then(timeline => {
      if (busyRef.current || clockRef.current) return;
      const bpm = prefs.bpm;
      const clamped = Math.min(target, playbackDuration(timeline, bpm));
      const current = playbackPositionAt(timeline, clamped, bpm);
      moveTo(clamped);
      setActive(current.noteId);
      setActiveNotes(current.activeNoteIds);
    }).catch(e => showError(e, 'Could not build the playback timeline.'));
  };
  const seekRef = useRef(seekTo);
  seekRef.current = seekTo;
  useImperativeHandle(ref, () => ({
    play: async () => { if (chrome.audio && !clockRef.current && !busyRef.current) await latestPlayRef.current(); },
    stop: () => { if (!clockRef.current) stopRef.current(true); },
    transpose: semitones => changePitchRef.current({ semitones: clampSemitones(Math.round(Number(semitones) || 0)) }),
    seek: seconds => seekRef.current(Number(seconds)),
    currentTime: () => { const host = clockRef.current; return host ? host.now() : positionRef.current; },
  }), [chrome.audio]);
```

4k. The header play button passes its click event as `from`. Fix it: in `headerElements.play`, replace `onClick={play}` with `onClick={() => void play()}`.

4l. Package exports. In `packages/pepperscore/src/index.ts`, after the `PepperScoreSettings` type export add:

```ts
export type { ExternalClock, ClockEvent } from './lib/clock';
```

- [ ] **Step 5: Typecheck, build and run the test**

Run: `npm run check && npm run build && node validation/clock-embed.mjs`
Expected: check reports 0 errors, and the test prints `chromium: silent self-driven playback, onTimeUpdate, seek/currentTime and seek-while-playing passed`.

- [ ] **Step 6: Run the regressions that cover playback and the embed API**

Run: `npm run test:api && npm run test:performance && npm run test:reader && npm run test:embed && npm run test:layout`
Expected: all pass (the baseline is green after a fresh `npm run build`).

- [ ] **Step 7: Register the script in root `package.json`**

Add after the `"test:clock-contract"` line:

```json
    "test:clock-embed": "node validation/clock-embed.mjs",
```

In `"test:validation"`, replace `npm run test:embed && npm run test:layout` with `npm run test:embed && npm run test:clock-embed && npm run test:layout`.

- [ ] **Step 8: Commit**

```bash
git add packages/pepperscore/src/components/PepperScore.tsx packages/pepperscore/src/index.ts apps/reader/src/embed/ClockTest.tsx apps/reader/src/pages/embed-clock.astro validation/clock-embed.mjs package.json
git commit -m "feat: audio={false}, onTimeUpdate, handle seek/currentTime; export ExternalClock

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Clock mode: playhead from `clock.now()`, follow, click → `onSeek`

**Files:**
- Modify: `packages/pepperscore/src/components/PepperScore.tsx`
- Modify: `packages/pepperscore/src/styles.css`
- Modify (replace whole file): `apps/reader/src/embed/ClockTest.tsx`
- Modify (replace whole file): `validation/clock-embed.mjs`

**Interfaces:**
- Consumes: `noteSeekSeconds` and `measureSeekSeconds` (Task 1); `ExternalClock` and `ClockEvent` (Task 1); `positionRef`, `moveTo`, `clockRef`, `callbacks.current.onSeek` and the handle (Task 3); the existing `loadTimeline`, `timelineOf`, `playbackPositionAt`, `renderRef` and `showError`.
- Produces: the `data-ps-clock` attribute on the `.pepperscore` root when a clock is set. Readers `.clock-a` and `.clock-b` and the globals `window.__clock`, `window.__clockSetViewA`, `window.__clockFreshA` and `window.__clockRerender` on `/embed-clock`.

- [ ] **Step 1: Replace** `apps/reader/src/embed/ClockTest.tsx` **with the full test page**

```tsx
import { useRef, useState } from 'react';
import { PepperScore, type ClockEvent, type ExternalClock, type PepperScoreHandle } from 'pepperscore';
import contract from '../../../../validation/fixtures/clock-contract.musicxml?raw';

const ASSETS = '/custom-assets';
const tune = (title: string, bars: number) => `X:1\nT:${title}\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\n${Array.from({ length: bars }, (_, i) => (i % 2 ? 'E D C D |' : 'C E G E |')).join(' ')}`;
type Listener = (event: ClockEvent) => void;
/** A clock the test moves by hand: seek/play/pause emit events; advance() only moves now() (read every frame while playing). */
function manualClock() {
  let time = 0, playing = false;
  const listeners = new Set<Listener>();
  const emit = (type: ClockEvent['type']) => listeners.forEach(listener => listener({ type, time }));
  const clock: ExternalClock = {
    now: () => time,
    get playing() { return playing; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return {
    clock,
    seek(seconds: number) { time = seconds; emit('seek'); },
    play() { playing = true; emit('play'); },
    pause() { playing = false; emit('pause'); },
    advance(seconds: number) { time = seconds; },
    listeners: () => listeners.size,
  };
}
const clocks = { a: manualClock(), b: manualClock() };
type Events = Array<[string, string, number?]>;
declare global { interface Window {
  __clock: typeof clocks; __clockEvents: Events; __clockRefs: Record<string, React.RefObject<PepperScoreHandle | null>>;
  __clockSetViewA(view: 'vertical' | 'endless'): void; __clockFreshA(on: boolean): void; __clockRerender(): void;
} }

/**
 * Host page for validation/clock-embed.mjs. A: clock-driven, chrome="none", the clock contract fixture (pickup, tempo
 * 120 → 60 → 180). B: clock-driven, Endless, 32 bars (follow). C: self-driven and silent (audio={false}).
 */
export default function ClockTest() {
  const [viewA, setViewA] = useState<'vertical' | 'endless'>('vertical');
  const [freshA, setFreshA] = useState(false);
  const [, setRenders] = useState(0);
  const refs = { a: useRef<PepperScoreHandle>(null), b: useRef<PepperScoreHandle>(null), c: useRef<PepperScoreHandle>(null) };
  if (typeof window !== 'undefined') {
    window.__clockEvents ??= [];
    window.__clock = clocks; window.__clockRefs = refs;
    window.__clockSetViewA = setViewA; window.__clockFreshA = setFreshA; window.__clockRerender = () => setRenders(count => count + 1);
  }
  const log = (who: string) => ({
    onSeek: (seconds: number) => window.__clockEvents.push([who, 'seek', seconds]),
    onTimeUpdate: (seconds: number) => window.__clockEvents.push([who, 'time', seconds]),
    onPlay: () => window.__clockEvents.push([who, 'play']),
    onStop: () => window.__clockEvents.push([who, 'stop']),
    onError: (error: Error) => window.__clockEvents.push([who, `error: ${error.message}`]),
  });
  // A careless host: a new adapter object on every render, wrapping the same clock (Review Focus 2).
  const clockA: ExternalClock = freshA
    ? { now: () => clocks.a.clock.now(), get playing() { return clocks.a.clock.playing; }, subscribe: listener => clocks.a.clock.subscribe(listener) }
    : clocks.a.clock;
  return <div className="clock-test">
    <div className="host-snippet clock-box-a"><PepperScore ref={refs.a} className="clock-a" chrome="none" audio={false} clock={clockA} view={viewA} musicXml={contract} ariaLabel="Clock contract" assetBaseUrl={ASSETS} {...log('a')} /></div>
    <div className="host-snippet clock-box-b"><PepperScore ref={refs.b} className="clock-b" chrome="none" clock={clocks.b.clock} view="endless" abc={tune('Clock follow', 32)} ariaLabel="Clock follow" assetBaseUrl={ASSETS} {...log('b')} /></div>
    <div className="host-snippet clock-box-c"><PepperScore ref={refs.c} className="clock-c" chrome="minimal" audio={false} abc={tune('Silent self-driven', 8)} ariaLabel="Silent self-driven" assetBaseUrl={ASSETS} {...log('c')} /></div>
  </div>;
}
```

Reader B leaves `audio` at its default (`true`) on purpose. Clock mode must still load no sound.

- [ ] **Step 2: Replace** `validation/clock-embed.mjs` **with the full test**

```js
// Clock mode and the 0.2 host API, against the build (apps/reader /embed-clock). A: clock-driven chrome="none" reader of
// the clock contract fixture; B: clock-driven Endless reader (follow); C: self-driven silent reader (audio={false}).
// BROWSER=chromium|firefox|webkit.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';
import { root, serveDist } from './serve-dist.mjs';

const engine = process.env.BROWSER || 'chromium';
const launcher = { chromium, firefox, webkit }[engine];
if (!launcher) throw new Error(`BROWSER must be chromium, firefox or webkit (got "${engine}")`);
const server = await serveDist();
const browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}) });
const sounds = join(root, 'packages/pepperscore-sounds-complete');
const near = (actual, expected) => typeof actual === 'number' && Math.abs(actual - expected) < 1e-3;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/poppins/i, route => route.abort());
  const requests = [];
  context.on('request', request => requests.push(request.url()));
  await context.route('**/custom-assets/**', async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/custom-assets\//, ''));
    try { return route.fulfill({ status: 200, body: await readFile(join(sounds, path)) }); } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await context.addInitScript(() => {
    window.__contexts = 0;
    const Native = window.AudioContext;
    if (Native) window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__contexts++; } };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.url}/embed-clock`);
  const rendered = selector => page.waitForFunction(selector => { const root = document.querySelector(selector); return root && root.querySelector('.score-system svg .reader-note') && !root.querySelector('.score-loading'); }, selector, { timeout: 60000 });
  await Promise.all(['.pepperscore.clock-a', '.pepperscore.clock-b', '.pepperscore.clock-c'].map(rendered));
  const events = (who, type) => page.evaluate(([who, type]) => window.__clockEvents.filter(([w, t]) => w === who && t === type).map(([, , value]) => value), [who, type]);
  const lastSeek = async who => (await events(who, 'seek')).at(-1);
  const playingIds = who => page.$$eval(`.pepperscore.clock-${who} .reader-note.is-playing`, elements => elements.map(element => element.getAttribute('data-note-id')));
  const waitPlaying = (who, test) => page.waitForFunction(([who, test]) => {
    const ids = [...document.querySelectorAll(`.pepperscore.clock-${who} .reader-note.is-playing`)].map(element => element.getAttribute('data-note-id'));
    return test.notIn ? ids.length === 1 && !test.notIn.includes(ids[0]) : test.same ? ids.join() === test.same.join() : ids.length === 1;
  }, [who, test], { timeout: 10000 });
  // A click on the highlighted note's notehead, dispatched so the target is exactly that note.
  const clickPlaying = who => page.$eval(`.pepperscore.clock-${who} .reader-note.is-playing`, element => (element.querySelector('.notehead') || element).dispatchEvent(new MouseEvent('click', { bubbles: true })));

  // 1. Count-in: a negative clock time shows no playhead (Review Focus 1); chrome="none" still shows it from 0 on.
  await page.evaluate(() => window.__clock.a.seek(-1));
  await page.waitForTimeout(200);
  assert.deepEqual(await playingIds('a'), [], 'no note is highlighted before time 0');
  assert.equal(await page.locator('.clock-a .playback-line').count(), 0, 'no playback line before time 0');
  await page.evaluate(() => window.__clock.a.seek(2.6));
  await waitPlaying('a', {});
  const atG4 = await playingIds('a');

  // 2. A click on a note reports its onset at the score tempo, and the playhead stays where the clock is.
  await clickPlaying('a');
  assert.ok(near(await lastSeek('a'), 2.5), `click on the bar-2 G4 reports 2.5 s (got ${await lastSeek('a')})`);
  await page.waitForTimeout(200);
  assert.deepEqual(await playingIds('a'), atG4, 'the click did not move the playhead');
  await page.evaluate(() => window.__clock.a.seek(7.7));
  await waitPlaying('a', { notIn: atG4 });
  await clickPlaying('a');
  assert.ok(near(await lastSeek('a'), 7.666667), `click on D5 after the mid-bar tempo change reports 7.666667 s (got ${await lastSeek('a')})`);

  // 3. A click on empty space in a measure reports that measure's start: bar index 2 starts at 2.5 s (Review Focus 4).
  await page.$eval('.pepperscore.clock-a', root => {
    const measure = root.querySelectorAll('g.measure')[2];
    const rect = measure.getBoundingClientRect();
    measure.ownerSVGElement.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
  });
  assert.ok(near(await lastSeek('a'), 2.5), `whitespace click in bar index 2 reports 2.5 s (got ${await lastSeek('a')})`);

  // 4. The handle in clock mode: currentTime() reads the clock; seek() reports through onSeek and moves nothing; stop() is a no-op.
  assert.equal(await page.evaluate(() => window.__clockRefs.a.current.currentTime()), 7.7);
  const beforeHandle = await playingIds('a');
  await page.evaluate(() => { window.__clockRefs.a.current.seek(1); window.__clockRefs.a.current.stop(); });
  assert.equal(await lastSeek('a'), 1, 'handle.seek(1) reports 1 s');
  await page.waitForTimeout(200);
  assert.deepEqual(await playingIds('a'), beforeHandle, 'handle.seek/stop did not move the playhead');

  // 5. Re-engraving while paused keeps the playhead at the clock's time (Review Focus 3).
  await page.evaluate(() => window.__clockSetViewA('endless'));
  await page.waitForFunction(() => document.querySelector('.clock-a .reader-area.ps-landscape .score-system svg .reader-note') && !document.querySelector('.clock-a .score-loading'), null, { timeout: 60000 });
  await waitPlaying('a', { same: beforeHandle });

  // 6. A new clock object on every host render keeps exactly one subscription (Review Focus 2).
  await page.evaluate(async () => {
    window.__clockFreshA(true);
    for (let i = 0; i < 20; i++) { window.__clockRerender(); await new Promise(resolve => requestAnimationFrame(() => resolve())); }
  });
  assert.equal(await page.evaluate(() => window.__clock.a.listeners()), 1, 'one live subscription after 20 re-renders with fresh adapters');
  await page.evaluate(() => window.__clock.a.seek(0.6));
  await waitPlaying('a', { notIn: beforeHandle });

  // 7. Endless follow runs off the clock: playing at 30 s scrolls B sideways.
  await page.evaluate(() => { window.__clock.b.play(); window.__clock.b.advance(30); });
  await page.waitForFunction(() => document.querySelector('.clock-b .score-viewport').scrollLeft > 100, null, { timeout: 15000 });
  await page.evaluate(() => window.__clock.b.pause());

  // 8. Self-driven silent reader C: seek/currentTime, onTimeUpdate about 10 Hz, seek while playing (Review Focus 5).
  await page.evaluate(() => window.__clockRefs.c.current.seek(3));
  assert.equal(await page.evaluate(() => window.__clockRefs.c.current.currentTime()), 3, 'currentTime() after seek(3) while stopped');
  await page.waitForFunction(() => document.querySelectorAll('.clock-c .reader-note.is-playing').length > 0, null, { timeout: 10000 });
  await page.evaluate(() => { window.__clockEvents.length = 0; return window.__clockRefs.c.current.play(); });
  await page.waitForTimeout(1500);
  const updates = await events('c', 'time');
  assert.ok(updates.length >= 8 && updates.length <= 25, `onTimeUpdate fired ${updates.length} times in 1.5 s (about 10 Hz expected)`);
  assert.ok(updates[0] >= 3 && updates.every((seconds, index) => index === 0 || seconds > updates[index - 1]), `time updates rise from 3 s: ${updates.join(', ')}`);
  await page.evaluate(() => window.__clockRefs.c.current.seek(1));
  await page.waitForTimeout(300);
  const afterSeek = await page.evaluate(() => window.__clockRefs.c.current.currentTime());
  assert.ok(afterSeek >= 1 && afterSeek < 1.8, `currentTime() ${afterSeek} after seek(1) while playing`);
  assert.deepEqual(await page.evaluate(() => window.__clockEvents.filter(([w, t]) => w === 'c' && (t === 'play' || t === 'stop')).map(([, t]) => t)), ['play'], 'one play edge and no stop across a seek while playing');
  await page.evaluate(() => window.__clockRefs.c.current.stop());
  assert.deepEqual(await events('a', 'play'), [], 'clock play/pause never fires onPlay');

  // 9. Nothing on the page created an AudioContext or fetched a sound, including clock reader B with audio left on (Review Focus 5).
  assert.equal(await page.evaluate(() => window.__contexts), 0, 'no AudioContext was created');
  assert.deepEqual(requests.filter(url => /pack\.json|\/soundfonts\/|\/instruments\//.test(url)), [], 'no sound asset was requested');
  assert.deepEqual(await page.evaluate(() => window.__clockEvents.filter(([, type]) => type.startsWith('error'))), [], 'no reader reported an error');
  assert.deepEqual(errors, [], 'no page errors');
  console.log(`${engine}: clock playhead and count-in, onSeek note/measure clicks, clock handle, re-engrave while paused, one subscription, Endless follow, silent self-driven playback, onTimeUpdate and seek passed`);
} finally {
  await browser.close();
  await server.close();
}
```

- [ ] **Step 3: Build and check that the test fails**

Run: `npm run build && node validation/clock-embed.mjs`
Expected: FAIL in step 1 or step 2 (a `waitForFunction` timeout: no `.clock-a .reader-note.is-playing`, because `chrome="none"` has no playhead and nothing reads the clock yet).

- [ ] **Step 4: Implement clock mode in `PepperScore.tsx`**

4a. Imports. After the `import type { ExternalClock } from '../lib/clock';` line add:

```ts
import { measureSeekSeconds, noteSeekSeconds } from '../lib/playback/clock-time';
```

4b. Playhead. After `const chrome = useMemo(() => resolveChrome(…), […]);` add:

```ts
  /** A host clock always shows the playhead (ivories uses chrome="none" with a clock). */
  const playhead = chrome.playhead || Boolean(clock);
```

4c. Clock state. After the `moveTo` line added in Task 3 add:

```ts
  /** Whether the host clock is running (clock mode only); drives the measure cursor and follow like `playing`. */
  const [clockPlaying, setClockPlaying] = useState(false);
  /** Follow in clock mode: while the clock plays, and once after each clock seek. */
  const clockFollowRef = useRef({ playing: false, seekPending: false });
```

4d. Measure cursor. Replace the whole `const measureCursor = useMemo(() => { … }, [active, playing, position, timelineOf, visibleScore, layoutTick, prefs.bpm]);` block with:

```ts
  const measureCursor = useMemo(() => {
    // A negative time is a host count-in: no playhead yet.
    if (position < 0 || (!playing && !clockPlaying && position <= 0)) return null;
    if (active && renderRef.current?.point(active)?.element) return null;
    const timeline = timelineOf();
    if (!timeline) return null;
    // A host clock runs at the score's own tempo; the BPM setting only scales self-driven playback.
    const current = playbackPositionAt(timeline, position, clock ? timeline.initialBpm : prefs.bpm);
    const length = visibleScore.parts[0]?.measures[current.measureIndex]?.beats || 0;
    const fraction = length > 0 ? Math.max(0, Math.min(1, current.measureBeat / length)) : 0;
    return { measureIndex: current.measureIndex, fraction: Math.floor(fraction * 32) / 32 };
  }, [active, playing, clockPlaying, position, timelineOf, visibleScore, layoutTick, prefs.bpm, clock]);
```

4e. Playhead effect. In the effect that follows (`useEffect(() => { const result = renderRef.current; …`), replace

```ts
    if (!chrome.playhead) return;
```

with

```ts
    if (!playhead) return;
```

and replace

```ts
    if (!viewport || !playRef.current || performance.now() - userScrollAtRef.current < FOLLOW_SUSPEND_MS || pendingScroll()) return;
```

with

```ts
    const following = Boolean(playRef.current) || (clock ? clockFollowRef.current.playing || clockFollowRef.current.seekPending : false);
    if (!viewport || !following || performance.now() - userScrollAtRef.current < FOLLOW_SUSPEND_MS || pendingScroll()) return;
    clockFollowRef.current.seekPending = false;
```

4f. Clock effect. Directly after the line `useEffect(() => { if (error) callbacks.current.onError?.(new Error(error)); }, [error]);` add:

```ts
  // Clock mode: the host clock drives the playhead. Each animation frame while it plays (and once per clock event), its
  // time maps to the score at the score's own tempo. Nothing is scheduled and no audio loads.
  useEffect(() => {
    if (!clock || !loaded) return;
    let cancelled = false, frame = 0;
    let timeline: BaseTimeline | null = null;
    const paint = () => {
      if (!timeline) return;
      const raw = clock.now();
      const seconds = Number.isFinite(raw) ? raw : 0;
      moveTo(seconds);
      if (seconds < 0) { setActive(null); setActiveNotes([]); return; }
      const current = playbackPositionAt(timeline, seconds, timeline.initialBpm);
      setActive(current.noteId);
      setActiveNotes(previous => previous.join('|') === current.activeNoteIds.join('|') ? previous : current.activeNoteIds);
    };
    const loop = () => { paint(); frame = clock.playing ? requestAnimationFrame(loop) : 0; };
    const restart = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(loop); };
    clockFollowRef.current.playing = clock.playing;
    setClockPlaying(clock.playing);
    const unsubscribe = clock.subscribe(event => {
      if (event.type === 'play' || event.type === 'pause') { clockFollowRef.current.playing = event.type === 'play'; setClockPlaying(event.type === 'play'); }
      if (event.type === 'seek') clockFollowRef.current.seekPending = true;
      restart();
    });
    loadTimeline().then(built => { if (cancelled) return; timeline = built; restart(); })
      .catch(e => { if (!cancelled) showError(e, 'Could not build the playback timeline.'); });
    return () => { cancelled = true; cancelAnimationFrame(frame); unsubscribe(); };
  }, [clock, loaded, loadTimeline]);
```

4g. Click → `onSeek`. Directly after the clock effect add:

```ts
  /** Clock mode: a click on a note (or anywhere in a measure) reports its time to the host instead of seeking. */
  const onScoreClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!clock) return;
    const timeline = timelineOf(), result = renderRef.current;
    if (!timeline || !result) return;
    const bpm = timeline.initialBpm;
    const now = Math.max(0, Number.isFinite(clock.now()) ? clock.now() : 0);
    const noteId = (event.target as Element).closest?.('[data-note-id]')?.getAttribute('data-note-id');
    let seconds = noteId ? noteSeekSeconds(timeline, noteId, now, bpm) : null;
    if (seconds === null) {
      const hit = result.measures.find(measure => {
        const rect = measure.element?.getBoundingClientRect();
        return Boolean(rect && rect.width && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
      });
      if (hit) seconds = measureSeekSeconds(timeline, hit.index, now, bpm);
    }
    if (seconds !== null) callbacks.current.onSeek?.(seconds);
  };
```

4h. Hide the self-driven transport in clock mode. In `headerElements`:
- change `stop: <button className="icon-button stop-button" …>…</button>,` to `stop: clock ? null : <button className="icon-button stop-button" …>…</button>,` (keep the button markup as it is);
- change `play: <button className={`play-button …`} …>…</button>,` to `play: clock ? null : <button …>…</button>,`;
- change `bpm: <label className="bpm-control">…</label>,` to `bpm: clock ? null : <label className="bpm-control">…</label>,`.

`renderControls` already skips falsy entries. Change

```ts
  const compactPlay = chrome.compactPlay && loaded ? <button
```

to

```ts
  const compactPlay = chrome.compactPlay && loaded && !clock ? <button
```

4i. Root attribute and click target. In the root `<div ref={rootRef} className={`pepperscore …`} data-ps-height={heightMode} …>`, add `data-ps-clock={clock ? '' : undefined}` after `data-ps-height={heightMode}`. Replace

```tsx
            <div className="score-staves" ref={canvasRef}/>
```

with

```tsx
            <div className="score-staves" ref={canvasRef} onClick={clock ? onScoreClick : undefined}/>
```

4j. CSS. Append to the end of `packages/pepperscore/src/styles.css`:

```css
.pepperscore[data-ps-clock] .score-system svg .reader-note,.pepperscore[data-ps-clock] .score-system svg .measure{cursor:pointer}
```

- [ ] **Step 5: Typecheck, build and run the test**

Run: `npm run check && npm run build && node validation/clock-embed.mjs`
Expected: 0 errors, then `chromium: clock playhead and count-in, onSeek note/measure clicks, … passed`.

- [ ] **Step 6: Cross-browser and regressions**

Run: `BROWSER=firefox node validation/clock-embed.mjs && npm run test:api && npm run test:css && npm run test:performance && npm run test:reader && npm run test:embed && npm run test:layout`
Expected: all pass. If Firefox is not installed (`npm run test:browsers` installs it), record that and run Chromium only.

- [ ] **Step 7: Commit**

```bash
git add packages/pepperscore/src/components/PepperScore.tsx packages/pepperscore/src/styles.css apps/reader/src/embed/ClockTest.tsx validation/clock-embed.mjs
git commit -m "feat: clock prop drives the playhead at score tempo; clicks report onSeek

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Version 0.2.0, CHANGELOG, README, full validation

**Files:**
- Modify: `packages/pepperscore/package.json` (version, `files`)
- Modify: `package-lock.json` (workspace version, via npm)
- Create: `packages/pepperscore/CHANGELOG.md`
- Modify: `packages/pepperscore/README.md`

**Interfaces:**
- Consumes: everything above. The documented names must match exactly: `clock`, `audio`, `onSeek`, `onTimeUpdate`, `seek`, `currentTime`, `ExternalClock`, `ClockEvent`.
- Produces: the release-ready (unpublished) 0.2.0 package.

- [ ] **Step 1: Bump the version without a git tag**

Run: `cd /home/shaun/pepperscore-clock && npm version 0.2.0 -w pepperscore --no-git-tag-version`
Expected: `packages/pepperscore/package.json` has `"version": "0.2.0"`, and `git diff package-lock.json` shows the workspace version changed (or no lockfile change if it does not record it). **Do not run `npm publish`.**

In `packages/pepperscore/package.json`, change `"files"` to:

```json
  "files": [
    "dist",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "LICENSES"
  ],
```

- [ ] **Step 2: Create** `packages/pepperscore/CHANGELOG.md`

```markdown
# Changelog

## 0.2.0

### Added

- `clock` prop (`ExternalClock`: `{ now(): number; playing: boolean; subscribe(listener): unsubscribe }`). A host clock drives the playhead, note highlight and Vertical/Endless follow. Its seconds map to the score at the score's own tempo map (tempo changes included, pickup bar starting at 0). The BPM setting is ignored. With a clock the reader plays no sound and hides its own play, stop and BPM controls. The playhead shows for every `chrome` preset, `"none"` included. A negative time (count-in) shows no playhead.
- `onSeek(seconds)`: with a `clock`, a click on a note (nearest performed occurrence) or anywhere in a measure (its start) reports the time instead of seeking.
- `audio` prop (default `true`). `false` never loads or schedules sound, and self-driven playback runs silently.
- `onTimeUpdate(seconds)`: about 10 Hz during self-driven playback.
- Handle: `seek(seconds)` and `currentTime()`. With a `clock`, `seek` reports through `onSeek` and `currentTime` returns `clock.now()`.
- Type exports `ExternalClock` and `ClockEvent`.

### Changed

- `handle.play()` and `handle.stop()` do nothing while a `clock` is set.

## 0.1.1

- Initial public release.
```

- [ ] **Step 3: Update `packages/pepperscore/README.md`**

3a. In the Props table, insert these rows after the `onError` row:

```markdown
| `clock` | `ExternalClock` | | A host clock that drives the playhead, see "Driving the playhead from your own clock". |
| `audio` | `boolean` | `true` | `false` never loads or schedules sound. Self-driven playback then runs silently on wall-clock time. |
| `onSeek` | `(seconds: number) => void` | | With a `clock`: a click on a note or measure (and `ref.seek`) reports its time here. The reader does not move. |
| `onTimeUpdate` | `(seconds: number) => void` | | About 10 times a second during self-driven playback. |
```

3b. Replace the `ref` row with:

```markdown
| `ref` | `Ref<PepperScoreHandle>` | | `{ play(): Promise<void>; stop(): void; transpose(semitones: number): void; seek(seconds: number): void; currentTime(): number }`. `play` does nothing while playing, before a score has loaded, with `chrome="none"`, or with a `clock`. `stop` does nothing with a `clock`. `transpose` sets the **absolute** transposition (clamped to −12…12), the same as `settings.semitones`. It does not add to the current value. `seek` moves the playhead (and keeps playing from there when playing). With a `clock` it calls `onSeek` instead. `currentTime` returns the playhead seconds, or `clock.now()` with a `clock`. |
```

3c. In the sentence that starts "The package also exports the types", replace `` `SoundSource` and `SoundPackName` `` with `` `SoundSource`, `SoundPackName`, `ExternalClock` and `ClockEvent` ``.

3d. Insert this section immediately before `### Chrome presets and \`controls\``:

````markdown
### Driving the playhead from your own clock

Pass `clock` when something else owns time, such as your own audio engine, a video, or a practice app's transport. The reader then only shows where that clock is:

```tsx
import { PepperScore, type ExternalClock } from 'pepperscore';

// Adapt your transport once (keep the object stable: a new object re-subscribes).
const clock: ExternalClock = {
  now: () => transport.seconds,            // seconds from score beat 0; negative during a count-in
  get playing() { return transport.playing; },
  subscribe: listener => transport.on('change', event => listener({ type: event.type, time: transport.seconds })),
};

<PepperScore chrome="none" audio={false} musicXml={xml} clock={clock} onSeek={seconds => transport.seek(seconds)} />
```

- **Time mapping.** Seconds count from score beat 0 (the first beat of a pickup bar, if there is one). They follow the score's own tempo map, so every `<sound tempo>` / metronome change is included. The BPM setting is ignored. Repeats and jumps play in performed order. A fermata adds half its note's length.
- **Events.** `subscribe` should call the listener on `play`, `pause`, `seek` and `rate`. While `playing` is true, the reader reads `now()` every animation frame. Otherwise it reads it once per event.
- **No sound, no transport.** With a clock the reader never loads sound, whatever `audio` says. It also hides its own play, stop and BPM controls. The playhead, note highlight and Vertical/Endless follow work for every `chrome`, including `"none"`.
- **Seeking.** A click on a note reports that note's time (its performed occurrence nearest the clock), and a click elsewhere in a measure reports the measure's start. Both go through `onSeek`, and so does `ref.seek(seconds)`. Seek your clock there. The reader follows on the next `seek` event.
- `onPlay`/`onStop` are not called for clock play/pause.
- `validation/fixtures/clock-contract.musicxml` with `clock-contract.expected.json` (in the repository) pins the onset seconds within 1 ms (a pickup bar, and tempo 120 → 60 → 180 mid-bar). Use them to check your own tempo map against the reader's.
````

3e. In the "Chrome presets" table, change the row `| Playhead, note highlight, follow | yes | yes | no |` to `| Playhead, note highlight, follow | yes | yes | no (yes with a \`clock\`) |`.

- [ ] **Step 4: Full verification**

Run: `npm run check && npm run build && npm run test:manifest && npm run test:validation`
Expected: `check` reports 0 errors, the build succeeds, the manifest passes, and every validation script passes, including `test:clock`, `test:clock-contract` and `test:clock-embed`.

Then: `npm run test:pack`. It needs network and installs from the registry, but publishes nothing. Expected: PASS, and the tarball lists `CHANGELOG.md`. If there is no network, record that it was skipped.

- [ ] **Step 5: Commit**

```bash
git add packages/pepperscore/package.json package-lock.json packages/pepperscore/CHANGELOG.md packages/pepperscore/README.md
git commit -m "chore: pepperscore 0.2.0 (external clock) docs and changelog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Out of scope

- **Publishing** `pepperscore@0.2.0` to npm, pushing tags, or creating a GitHub release. These are user-approved gates.
- Opening the PR. That happens via superpowers:finishing-a-development-branch after the whole-branch review, with the user's go-ahead.
- Audio synced to an external clock (scheduling sound against `clock.now()`).
- Click-to-seek in self-driven mode.
- ivories-side work (`<Notation>`, the clock adapter, ivories' copy of the contract test).

## Self-review notes

- Spec coverage: `clock` → Tasks 1, 4. `audio` → Task 3. `onSeek` → Task 4. Handle `seek`/`currentTime` → Tasks 3, 4. Score tempo in clock mode → Task 4 (4d, 4f, 4g) plus the Task 2 contract. Contract test with a pickup and tempo changes → Task 2. `ExternalClock` export → Task 3 (4l). 0.2.0 + CHANGELOG + README → Task 5. `onTimeUpdate` → Task 3. No publishing → Out of scope.
- Names used across tasks: `noteOnsetSeconds`, `noteSeekSeconds`, `measureSeekSeconds`, `scoreSecondsScale` (Task 1) are consumed unchanged in Tasks 2 and 4. `positionRef`, `moveTo`, `halt`, `play(from?)`, `clockRef` and `seekTo` (Task 3) are consumed unchanged in Task 4.

## Baseline in the worktree

Recorded while writing this plan. `npm ci` has already been run in `/home/shaun/pepperscore-clock`, and `npm run build` at `707884d` succeeded (`Demo build uses the library dist (worker chunks match)`). `npm run test:embed` passed and `npm run test:layout` passed. Task 1's Step 0 `npm ci` can be skipped if `node_modules` is present.
