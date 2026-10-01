# Large-score performance

Date: 2026-10-01 · Status: Phases 1–3 implemented (`perf/large-scores-1`, `-2`, `-3`)

## Problem

Large scores take minutes to open and can crash the tab. A 32 MB orchestral MusicXML (670 measures, 30 parts) takes **335 s** to first paint on desktop and **635 s** with the phone profile. The renderer process peaks at 4.5–7.9 GB, and an Android tab is OOM-killed. Five causes, in order of cost:

1. **Whole-score layouts on every render.** `renderScore` made three worker requests for one paint: a height-fit probe, page 1 and the rest. Each one re-loaded the full MEI into a fresh Verovio layout (3 × ~42 s on orch32), then serialized every page (71 s of SVG). Verovio lays out the whole document even when one page is rendered.
2. **Verovio's MusicXML import is roughly quadratic in measures.** On a 5-part score, 1024 measures take 4.2 s, 2048 take 15.6 s, 4096 take 71.7 s and 9640 take 229 s. The WASM heap is capped at 2 GiB, and ens32 at phone width threw `WebAssembly.Exception`.
3. **Main-thread parsing.** The 32 MB XML is DOM-parsed 5× (timewise normalisation even when the file is partwise, ID injection, the model, the feature inventory twice), plus SHA-256 twice. Rendering parsed and re-serialized the whole MEI again for each view.
4. **All SVG at once.** Every page's SVG (72–157 MB) was parsed, sanitised and inserted together: 0.8–1.8 M DOM nodes, with `getBBox` per note across the whole score.
5. **Copies and caches.** About 10 copies of the score text, MEI and SVG were held by view and render caches keyed by full joined MEI strings, by import caches keyed by the source text, and by sliced byte copies. The timeline was built on the main thread during render, parsed the text twice, and was rebuilt on every BPM change.

### Measurements (before)

Desktop is Chromium headless on a 12-core WSL2 host. The phone profile is 390×844 at DPR 3 with 4× CPU throttling, which applies to the main thread only, so worker phases are under-estimated by 3–4×. The fixtures are synthetic (`ens*` repeats the 5-part ensemble fixture; `orch*` is an orchestral generator). Probe numbers come from instrumented modules; e2e numbers are the built app with a real file input.

| Fixture | Profile | First paint | Peak renderer RSS | DOM nodes | Longest main-thread block |
|---|---|---|---|---|---|
| orch12 (12.5 MB, 265 m × 30 parts) | desktop | 76 s | 2.5 GB | 311 k | 11.1 s |
| orch12 | phone | 192 s | 3.2 GB | 397 k | 66.7 s |
| orch32 (31.6 MB, 670 m × 30) | desktop | 335 s | 5.9 GB | 795 k | 31.8 s |
| orch32 | phone | 635 s | 6.8 GB | 832 k | 132.6 s |
| ens12 (12.4 MB, 3768 m × 5) | desktop | ~101 s (probe) | 3.2 GB | 694 k | 25.5 s |
| ens32 (31.9 MB, 9640 m × 5) | desktop | ~408 s (probe) | 7.9 GB | 1.78 M | 49.4 s |
| ens32 | phone | fails (`WebAssembly.Exception`, 2 GiB WASM cap) | — | — | — |

orch32 desktop by phase: hash ×2 1.7 s, parse 20.3 s, inventory ×2 3.8 s, Verovio import 35.3 s, timeline 9.9 s, and render 226.8 s. Render splits into 60.9 s of main-thread MEI work, three worker loads (126 s), 71 s of SVG, 10.6 s of sanitising and 9.9 s of geometry.

Verovio 6.3.0 in Node, on the view MEI (one system per page): orch32 takes 29.8 s to load and 21.6 s for the **first** `renderToSVG` after a layout, whatever the page. Later pages take about 0.2 s each. `redoLayout` takes 4.5 s, plus about 10 s for the next first render. A first-system document (the first 16 measures) takes 0.26 s to load and 0.7 s to render on orch12, against 6.0 s + 4.5 s for the whole score.

## Targets

| Measure | Target |
|---|---|
| orch32 first paint, desktop | ≤ 8 s |
| orch32 first paint, phone profile | ≤ 30 s, and no main-thread block > 200 ms after the file is read |
| Peak process memory to first paint | ≤ 1 GB |
| ens12 / orch12 | proportionally better (≤ 40% of the orch32 budgets) |
| Small scores (sample, ensemble, Cielito) | first paint within +10% of before |

These targets cover all three phases. Phase 1 alone cannot reach them, because the MusicXML import (35–47 s on orch32, quadratic in measures) and the main-thread parse stay on the critical path until Phases 2 and 3.

## Plan

### Phase 1 (this PR): persistent document, on-demand pages, virtualized systems, fewer copies

- **Worker keeps the document** (`verovio.worker.ts`, `verovio-protocol.ts`, `verovio-runtime.ts`).
  - `import(revision, text)` runs once per source document. The worker keeps Verovio's MEI baseline and returns only its structure (`BaselineInfo`: measure IDs, lyric density, staff definitions and groups). Revisions are keyed by the `SourceDocument` object (a `WeakMap`), not by text.
  - `render(view, options, pages)` builds the view MEI in the worker. It reloads only when the view (breaks, hidden staves, chord symbols) or a load-time option (`transpose`, `transposeToSoundingPitch`, `breaks`, `xmlIdChecksum`) changes. Otherwise it runs `setOptions` + `redoLayout`, which matches a fresh load (ignoring generated system IDs) for width, font and staff spacing. It returns only the requested pages.
  - Requests are serialized with render tickets, so older queued renders are answered `superseded`. The worker holds at most two baselines. It is recycled before importing a new score after a large one, so the WASM heap is returned.
  - Verovio's log is buffered and summarized once per request, instead of tens of thousands of console calls.
  - Out-of-memory gets a clear error.
- **The MEI view lives in the worker** (`notation/mei-view.ts`), as a string transform because workers have no `DOMParser`. Validation checks it against the former DOM transform.
- **No separate height-fit round trip.** The first Vertical system comes from a *probe* document of the first measures. It holds two systems' worth, extended so spans that start in the first system end inside it. The probe also gives the many-staff height fit and the Auto-bars wrap check. The whole score is laid out once, in the background, and only for systems after the first.
- **Virtualized systems** (`render.ts`). Scores up to 1600 staff-measures draw every system before the first paint, as before. Larger scores work like this:
  - Systems are placeholder blocks (`.score-system.is-pending`), sized from layout data: the exact layout width, and the height of the latest drawn system.
  - An `IntersectionObserver` draws systems within ±2 viewports (nearest first, two pages per request, one system per task). Systems beyond ±4 viewports are released back to placeholders; their geometry metadata is kept.
  - When a size above the viewport is corrected, the reader's scroll position is compensated, and browser scroll anchoring is off.
  - Note geometry (`getBBox`) is measured only for drawn systems.
  - Paging, follow, highlights, the playback line, part controls, zoom anchors and Endless all work from block positions or from systems drawn on demand. The playhead's system is drawn when playback reaches it, and a zoom anchor's system is drawn before the re-layout resolves.
  - Endless keeps one system up to 160 bars. Beyond that it uses chunks of 120 bars, drawn and released horizontally.
- **Copies.**
  - The main thread never holds the MEI or the SVG strings after insertion.
  - Caches are keyed by revision, with at most two entries.
  - A text source's original bytes are encoded on demand. A file is read and hashed once, and its feature inventory is reused rather than parsed again.
- **Timeline** is built when playback first needs it, not while the score loads. This is a stop-gap until Phase 2.

### Phase 2: single-pass streaming parse off the main thread (implemented)

- **Import worker** (`import.worker.ts`, `import-protocol.ts`, `import.ts`). A short-lived worker per import, separate from Verovio's: the Verovio worker keeps a WASM heap that never shrinks and is recycled between large scores, while the import worker is terminated when it is done, which frees everything the parse allocated. The main thread posts the `File` (a handle, not its bytes); the worker reads it, hashes it, reads MusicXML/MXL, and transfers the bytes back. MEI, ABC and MIDI are small and are still read on the main thread from those bytes. The Reader's `musicXml` prop uses the same worker.
- **One streaming pass** (`notation/xml-stream.ts`, `notation/musicxml-source.ts`). A small, strict SAX-style tokenizer (no dependency; it rejects what DOMParser rejects for these documents) feeds a reader that produces, in one pass: the Score model, the engraving text, the feature inventory, the navigation marks and the playback marks (articulations, fermatas, cue notes, pedals). Only one measure subtree is held as a light tree at a time. The engraving text is the source spliced with note IDs and expanded multi-measure rests, instead of a re-serialized DOM; it parses to the same document. Timewise sources are converted to partwise text first. The DOM MusicXML path is gone; a frozen copy (`validation/reference/musicxml-dom.ts`) is the oracle for `validation/parser-diff.mjs`.
- **One hash** (`file-state.ts`): `crypto.subtle.digest` when available, otherwise an incremental JavaScript SHA-256, both in the worker.
- **Timeline in the worker, in beats** (`playback/timeline.ts`). It is built once per score for every part, in beats at the opening tempo and at 0 semitones, and registered for the score's document. BPM is a scale and transposition a MIDI offset, both applied while scheduling. Hiding parts filters events and re-applies the sustain pedal. None of these rebuild it. One deliberate change: the 30 ms grace-note floor applies at the opening tempo, so it scales with BPM.
- **Transfer.** Bytes are transferred ArrayBuffers. The document keeps bytes, not strings: `originalText`/`engravingText` are decoded on demand, and an unedited engraving reuses the source bytes. Verovio gets a transferred copy of the engraving bytes and decodes them itself. The Score and the timeline are plain objects posted in chunks (4000 notes, 8000 events), because one structured clone of orch32's Score costs about 0.5 s and its events about 0.4 s to deserialize. In chunks each message costs a few milliseconds, so a compact typed-array form was not needed.
- Exit criteria: no main-thread task over 200 ms while the file is read and imported (phone profile), and one copy of the source on the main thread (as bytes).

### Phase 3: chunked engraving and guardrails for very long scores (implemented)

**Choice: per-chunk MusicXML slices, not one document with `select`.** Both options were measured in Node on Verovio 6.3.0 with orch32 (30 parts, 670 measures):

| Approach | Cost before a page can be drawn | WASM heap |
|---|---|---|
| (a) Slice the MusicXML, then import, lay out and draw page 1 of a 16 / 32 / 64-bar chunk (one system every 4 bars) | 0.6 / 1.4 / 2.7 s | 134 MB |
| (b) Import the whole score once, load its MEI, `select({measureRange})` 16 bars, then draw page 1 | 35.5 s import + 86 s MEI load + 12.9 s first render | 980 MB |

Option (b) needs the whole-score import, which is the cost Phase 3 must remove. There is no cheaper way to get MEI: our MusicXML reader builds a reduced Score, not MEI. A whole-score MEI document also loads and lays out at O(document) (item 14 in `docs/verovio-upstream-notes.md`). Slices bound both the time and the heap by the chunk size.

- **Index, not import** (`notation/musicxml-chunks.ts`, in the Verovio worker). A MusicXML engraving of at least 2400 staff-measures (parts × measures) is indexed in one string pass: about 0.1 s for 32 MB. The pass records:
  - each part's measure offsets;
  - its `<attributes>` blocks;
  - lyric density;
  - where spans start and stop (slur, wedge, octave shift, pedal, bracket, dashes, tuplet, glissando, slide, ending and cross-bar beams).

  Verovio converts only the first measure, for the staff structure (staffDef numbers, IDs and groups). Smaller scores, MEI, ABC and MIDI keep the whole-document path. Timewise sources are already partwise text (Phase 2). A namespace-prefixed or malformed source does not index and is engraved whole.
- **Slices** (`sliceMusicXml`). A slice of measures `[from, to)` is a complete partwise score:
  - It keeps the header and part-list. Credits are kept only in a slice that starts at bar 1.
  - Each part's prevailing attributes before `from` are carried into its first measure: divisions, key, time, staves, part symbol, instruments, clefs, staff details, transposition and `for-part`. A key, clef, time or transposition without `number` replaces any per-staff ones.
  - The carried time signature gets `print-object="no"`, so a chunk start does not reprint the meter (Verovio maps this to `meterSig@visible="false"`). A real meter change in the first measure still prints.
  - Every measure gets the ID `reader-m<n>`. Verovio uses a MusicXML measure `id` as its MEI `xml:id`, so the engraving maps 1:1 to Score measures in every chunk. Note IDs are the spliced Phase 2 IDs, so they are stable too.
- **Chunks follow systems** (`planChunk`). Systems keep their global grid: a page break before every multiple of `bars`, as in the whole score. A chunk holds whole systems: about 640 staff-measures, for example 5 systems of 4 bars × 30 staves, or 32 systems of 4 bars × 5 staves.
  - Its document adds *overlap* measures before and after the chunk. They cover the spans crossing its edges, at least one bar on each side (a tie from or into the next bar) and at most 16 bars.
  - Overlap measures fall on pages of their own, split at the same multiples of `bars`, and are never drawn.
  - A span crossing a chunk edge is therefore laid out exactly as at a system break in the whole score: open at the end of the last drawn system, continued at the start of the next chunk's first system. Overlap pages are at most one system's width, so a page never overflows into an extra page.
  - The worker caches the converted MEI of the last 8 chunk ranges per score. Scrolling back or changing the view (hidden parts, chord symbols) does not convert the MusicXML again. A width, font or spacing change re-lays out the loaded chunk with `redoLayout`.
- **Rendering** (`render.ts`). Virtualization (Phase 1) is unchanged: a system that scrolls near asks the worker for its page, and the worker loads the chunk that holds it.
  - The first-system probe is the first two systems plus their tail overlap.
  - For a large score, the first paint parses and draws only the first system (and a zoom anchor's) after a yield. Other systems fetched with it are kept as SVG text, sized from it, and drawn by the pump one per task.
  - In Endless, a chunked score uses blocks of about 480 staff-measures (16 bars for 30 staves, at most 120) instead of 120 bars. The single Endless system is kept only while it is a small document.
  - Auto bars per line, the 4-bar default, wrap checks, measure numbering, per-system clefs and keys, paging, follow, highlights, zoom anchors and playback are unchanged. They work on the same system grid.
- **WASM memory.** Each chunk is converted in a toolkit of its own, destroyed afterwards, and laid out in the main toolkit, so the heap stays near the largest chunk: 128 MB for the 5 MB test score. Every worker reply reports the heap size. The runtime:
  - recycles the worker before the next import when the heap is above 384 MB;
  - recycles it as soon as it is idle when the heap is above 1 GiB;
  - recycles it after an out-of-memory error.
  The next request re-imports the score it needs, which costs one index pass.
- **Guardrails** (`Reader.tsx`, `large-file.ts`, `last-file.ts`).
  - **Large-score notice.** It appears for a file of at least 8 MB, or for a score of at least 2400 staff-measures once it is read, with an expected wait from a linear model. It is non-blocking, dismissible and `role="status"`, and it clears when the score paints.
  - **Out of memory.** Verovio's WASM exceptions, `RangeError` and allocation failures become a clear message with guidance. A *Try again with smaller sections* button halves the chunk budget, forces chunking (even for a score below the threshold) on a fresh worker, and opens or draws the score again.
  - **Reopen after a reload or crash.**
    - After a successful open, the original file bytes (up to the 64 MB limit) are kept in IndexedDB (`scoreflow-last-file`), on this device only.
    - On start the reader offers *Reopen <name>?* with *Reopen*, *Not now* (for this tab) and *Forget*. It never opens the file automatically. The settings drawer also has *Forget last opened file*.
- **Diagnostics.**
  - localStorage `scoreflow-chunking` = `{"force": true, "budget": N}` engraves every MusicXML score in chunks of N staff-measures.
  - `scoreflow-simulate-oom` fails the next render as out of memory, once.
  - `scoreflow-large-file-bytes` lowers the notice threshold.
  - `window.__scoreflowVerovioHeapPeak` is the largest WASM heap reported.

## Risks

- **First-system fidelity.** The probe document is cut after a few systems. A span reaching further than four systems from the first one (rare; it appears in synthetic data with unterminated beam spans) is drawn as dangling on the first system only. The first system's height can differ from a whole-score layout by about 1%. *Mitigation:* the span-aware limit; small scores (≤ 1600 staff-measures) lay out whole documents up to the probe limit.
- **Estimated placeholder heights.** Before a system is drawn, its height is estimated. Paging over far placeholders is approximate until they draw, and a scrollbar drag can land a little off. *Mitigation:* scroll compensation, and the estimate follows the latest drawn system.
- **Auto bars wrap check.** Verovio can still wrap a line. It is checked on the probe and on the systems drawn for the first paint. A later system that wraps is drawn as two lines in one block rather than relaid out.
- **`redoLayout` equivalence** was verified with a Node probe on Verovio 6.3.0 (ensemble and Cielito fixtures, every page) for width, font, staff spacing and their combinations. Any option outside that set is treated as a reload key.
- **Worker restarts** (crash, or recycling after a large score) drop baselines. The runtime re-imports the current score once on `missing`.
- **Chunk edges (Phase 3).** A span that reaches more than 16 bars across a chunk edge is cut there. Verovio drops a span whose start is not in the document ("could not be matched to a start element"), and keeps one whose end is missing as open at the end of the chunk. Such a span is drawn open at the edge, and its continuation in the next chunk is missing. Sixteen bars cover ties, slurs and most hairpins, pedals and octave lines.
  - Things that depend on a whole-score scan are local to the chunk: a cautionary key or clef at the end of the last drawn system (the next bar is always in the overlap, so these usually match), and repeat/ending brackets (spans, carried by the overlap like any other).
  - `measure-style` (slash and beat-repeat state) is not carried into a slice; multi-measure rests are already expanded (Phase 2).
  - Lyric density for a chunked score is read from the MusicXML per part, not per MEI staff.
- **Chunked first paint differs from Phase 1/2 only in where the document comes from.** `validation/chunks.mjs` checks a fixture with spans across chunk edges: system by system, the chunked engraving has the same measures, mapped notes and engraved elements as the whole engraving.

## Validation

- Every existing suite stays green: document, score-db, performance (timeline) and reader on Chromium and Firefox, plus `tests/cielito-import.mjs` locally. Small scores take the eager path, so the existing layout assertions still cover all-systems rendering.
- `validation/document.mjs` compares the worker MEI view with the former DOM transform (32 cases) and checks the baseline scan.
- `validation/large-score.mjs` (`npm run test:large`, part of `test:validation`) generates a ~5 MB, 30-part score and asserts:
  - the first paint budget;
  - that at most 8 systems are drawn;
  - that scrolling to the end draws the last system and releases the first;
  - that notes are mapped in systems drawn on demand;
  - that playback highlights a note in a system not drawn at first paint;
  - the JS heap stays at or under 400 MB on Chromium.
- The perf probe (`e2e` on the built app) is re-run for orch12 and orch32 on desktop and the phone profile, with small scores (median of 5) on main and on the branch. See *Results*.
- Phase 3 adds:
  - **`validation/chunks.mjs`** (`test:chunks`; Chromium in `test:validation`, Firefox and WebKit in CI). It engraves a 16-bar, three-staff fixture twice: whole, and forced into chunks of two systems. The fixture has a tie, slurs, a hairpin, an octave line and a pedal across a chunk edge, a triplet in a chunk's last bar, and key, clef and meter changes. Every system must have the same first bar, bar count, mapped Score notes and counts of slurs, ties, hairpins, octave lines, pedals, tuplets, key and meter signatures, clefs, barlines and notes. Measure IDs are `reader-m1…16` in order, no note is mapped twice, the spans are drawn on both sides of the edge, and no meter is reprinted at a chunk start.
  - **`validation/document.mjs`** checks the chunk slices directly: carried attributes per staff, the unprinted meter, credits only in the first slice, stable IDs, span-aware overlaps, page-aligned plans, and that timewise, prefixed and malformed sources are rejected.
  - **`validation/large-score.mjs`** now checks a system deep in the score: it draws on demand with its bar under the stable chunk ID, and its notes are mapped. Verovio's WASM heap must stay at or under 512 MB, and it measures 128 MB.
  - **`validation/guardrails.mjs`** (`test:guardrails`) checks reopen after a reload (offered, never opened automatically; Reopen, Not now and Forget), the out-of-memory message and its retry (simulated), and the large-file notice.

## Results (Phase 1)

These use the same machine, fixtures and e2e probe as *Measurements*: the built app, a real file input, and time until the loading status clears with a drawn system. Before is `main` at `eaa440e`.

| Fixture · profile | First paint | Peak renderer RSS | DOM nodes | Longest main-thread block |
|---|---|---|---|---|
| orch12 · desktop | 76.1 s → **15.0 s** | 2498 → **969 MB** | 311 k → **10.1 k** | 11.1 → 7.1 s |
| orch12 · phone | 192.0 s → **38.5 s** | 3198 → **899 MB** | 397 k → **2.1 k** | 66.7 → 30.8 s |
| orch32 · desktop | 335.3 s → **50.8 s** | 5886 → **2057 MB** | 795 k → **9.3 k** | 31.8 → 18.3 s |
| orch32 · phone | 634.9 s → **112.4 s** | 6825 → **2124 MB** | 832 k → **2.6 k** | 132.6 → 77.9 s |

Small scores, median of 5 runs, time to a painted score:

| Score | Desktop before → after | Phone viewport (unthrottled) before → after |
|---|---|---|
| Sample (page load) | 1004 → 969 ms | 1033 → 981 ms |
| Ensemble (file) | 633 → 599 ms | 628 → 581 ms |
| Cielito, 12 staves (file) | 1564 → 1242 ms | 1603 → 1254 ms |

What remains on the critical path is now Phase 2 and Phase 3 work:

- **Main-thread parse.** The longest blocks above are the DOM parses in `import.ts`: about 7 s on desktop and 31–78 s on the phone profile.
- **Verovio's MusicXML import** takes 35–47 s on orch32 in the worker.
- **Memory.** Peak memory is now the import's WASM heap plus the main-thread parse, above the 1 GB target on orch32.
- **Background layout.** The rest of the score is laid out in the background after the first paint. Systems below the first show as placeholders until that layout finishes, which takes about 30 s on orch32.

## Results (Phase 2)

The same machine, fixtures and probe as Phase 1. The probe chooses the file by path, so Playwright does not decode a buffer in the page, and it also records when the score is first *shown* (its title renders, which ends the import). Before is `main` at `74c121a` (Phase 1), measured in the same session.

| Fixture · profile | First paint | Shown (import done) | Longest task during import | Longest task to first paint | Peak renderer RSS |
|---|---|---|---|---|---|
| orch12 · desktop | 15.2 s → **8.6 s** | 12.8 → 6.3 s | 7374 → **0 ms** | 7374 → 316 ms | 962 → **730 MB** |
| orch12 · phone | 38.9 s → **8.4 s** | 37.7 → 7.3 s | 31457 → **155 ms** | 31457 → 272 ms | 904 → **648 MB** |
| orch32 · desktop | 52.3 s → **31.7 s** | 49.8 → 29.4 s | 18651 → **0 ms** | 18651 → 315 ms | 2059 → **1069 MB** |
| orch32 · phone | 112.9 s → **37.6 s** | 111.6 → 36.3 s | 78915 → **150 ms** | 78915 → 353 ms | 2124 → **1079 MB** |

The phone profile throttles only the main thread (CDP CPU throttling does not reach workers), so its worker phases are under-estimated: on a real phone the worker parse and Verovio's import are also slower.

On orch32 the import worker reads the 31.6 MB file in about 1.0 s and builds the timeline in about 0.25 s (orch12: 0.5 s and 0.17 s), measured on desktop.

Small scores, median of 5 runs, time to a painted score (Phase 1 → Phase 2):

| Score | Desktop | Phone viewport (unthrottled) |
|---|---|---|
| Sample (page load) | 957 → 945 ms | 987 → 988 ms |
| Ensemble (file) | 599 → 610 ms | 589 → 601 ms |
| Cielito, 12 staves (file) | 1251 → 1058 ms | 1248 → 1057 ms |

Against the targets:

- **Main-thread blocking during import:** met. No task over 200 ms on either profile, also asserted by `validation/large-score.mjs`.
- **Main-thread blocking to first paint:** not yet. One 270–350 ms task remains after the score is shown, while the first system is drawn.
- **orch32 first paint:** not yet; 31.7 s on desktop (target 8 s) and 37.6 s on the phone profile (target 30 s). Most of what remains is Verovio's MusicXML import of the whole score in its worker, about 25 s. That is Phase 3: chunked import.
- **Peak memory:** about 1.07 GB on orch32 (target 1 GB), down from 2.1 GB. Most of it is Verovio's WASM heap for the whole-score import, which is also Phase 3.
- **Small scores:** within the +10% budget.

## Results (Phase 3)

These runs use the same machine, fixtures and e2e probe as before, extended:
- Peak renderer RSS is reported twice: up to first paint, and after scrolling.
- After first paint, the probe scrolls to the middle and then to the end, and times how long until a drawn system is in view.

Before is the Phase 2 build (`main` at `e96bbeb`), measured in the same session. The machine was busier than in the Phase 2 session, so the Phase 2 orch32 numbers are higher than the ones reported there (phone: 58.6 s here, 37.6 s there).

| Fixture · profile | First paint | Longest main-thread task | Peak RSS to first paint | Peak RSS after scrolling | Middle / end of score drawn after scrolling |
|---|---|---|---|---|---|
| orch12 · desktop | 9.9 s → **3.3 s** | 355 → **186 ms** | 734 → **561 MB** | 1263 → 816 MB | 13.7 s / 1.7 s → **4.3 s / 1.4 s** |
| orch12 · phone | 8.8 s → **3.1 s** | 262 → **196 ms** | 652 → **473 MB** | 856 → 541 MB | 13.0 s / 0.6 s → **1.8 s / 0.7 s** |
| orch32 · desktop | 33.0 s → **4.4 s** | 326 → **158 ms** | 1074 → **768 MB** | 1593 → 1084 MB | 49.6 s / 2.5 s → **3.2 s / 3.9 s** |
| orch32 · phone | 58.6 s → **6.0 s** | 1196 → **244 ms** | 996 → **777 MB** | 1634 → 777 MB | 80.8 s / 0.9 s → **3.2 s / 1.3 s** |
| ens32 · desktop | 197.9 s → **3.7 s** | 91 → **83 ms** | 1441 → **737 MB** | 1738 → 1005 MB | 11.8 s / 0.3 s → **1.1 s / 0.2 s** |
| ens32 · phone | 173.2 s → **9.5 s** | 1176 → **682 ms** | 1538 → **922 MB** | 3259 → 962 MB | never drawn → **2.5 s / 0.7 s** |

- **ens32 at phone width** (9640 one-bar systems) no longer runs out of WASM memory. Phase 2 painted its first system after 173 s, but systems never drew on scroll, and the renderer peaked at 3.3 GB. Phase 3 paints it in 9.5 s and draws the middle and the end of the score, with Verovio's heap bounded by one chunk.
- **Endless** (Phase 3 build):
  - orch32 on desktop paints in 5.4 s, with a longest task of 255 ms and 805 MB to first paint (1.3 GB after scrolling across 42 blocks of 16 bars).
  - ens32 on the phone profile paints in 11.7 s, with a longest task of 1166 ms (one 96-bar block).
- **Small scores** (median of 5, time to a painted score, Phase 2 → Phase 3, with a second Phase 2 run for noise) stay within the +10% budget:

| Score | Desktop | Phone viewport (unthrottled) |
|---|---|---|
| Sample (page load) | 967 / 998 → 983 ms | 1021 / 1025 → 1021 ms |
| Ensemble (file) | 608 / 627 → 625 ms | 600 / 603 → 605 ms |
| Cielito, 12 staves (file) | 1024 / 1073 → 1070 ms | 1117 / 1091 → 1080 ms |

Against the targets:

- **orch32 first paint:** met. 4.4 s on desktop (target 8 s) and 6.0 s on the phone profile (target 30 s).
  - About 2.2 s of that is the import worker, until the score is shown; the rest is the index pass and the first chunk.
  - The phone profile throttles only the main thread, so a real phone's workers are slower than measured here.
- **Peak memory to first paint:** met. 768–777 MB on orch32 and 737–922 MB on ens32 (target 1 GB). After scrolling through the score, the renderer peaks at 1.0–1.1 GB on desktop. That is the drawn systems' DOM and the chunk documents; Verovio's heap stays at one chunk.
- **orch12 / ens12 at ≤ 40% of the orch32 budgets:**
  - orch12 met (3.3 s and 3.1 s).
  - ens12 was not re-measured separately; ens32, which is larger, paints in 3.7 s on desktop.
- **Main-thread blocks over 200 ms:**
  - Met on desktop for every fixture.
  - On the phone profile, orch32 has one 244 ms task: parsing and sanitizing its first 30-staff system, at 4× CPU throttling. orch12 stays under 200 ms.
  - ens32 on the phone profile is not met. Opening it creates 9640 placeholder blocks (one bar per line at 390 px with lyrics), whose layout and first geometry take one 682 ms task. Its Phase 2 import also posts about 70 tasks of 100–200 ms. Virtualizing the placeholders themselves (one spacer instead of a block per system) is the next step if very long scores on phones matter.
- **Small scores:** within the +10% budget.
