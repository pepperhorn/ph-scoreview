# Large-score performance

Date: 2026-10-01 · Status: Phase 1 implemented (`perf/large-scores-1`); Phases 2–3 proposed

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

### Phase 2: single-pass streaming parse off the main thread

- A SAX-style parser in a worker produces, in one pass: the Score model, the ID-tagged engraving text, the feature inventory and the navigation marks. This replaces the 5 DOM parses and the timewise normalisation of partwise files.
- One hash: `crypto.subtle.digest` when available (secure contexts); otherwise incremental SHA-256 in the worker while the file streams.
- The timeline is built in the worker in beats, from the parse's marks, and BPM is applied at playback, so a BPM change no longer rebuilds it. The main thread receives typed arrays.
- Exit criteria: no main-thread task over 200 ms after the file is read (phone profile), and one copy of the source text on the main thread.

### Phase 3: chunked import and guardrails for very long scores

- **Chunked import.** Import and lay out measure-range slices (MusicXML slices with carried attributes, or Verovio `select({measureRange})` on a loaded slice). This bounds the quadratic import and the 2 GiB heap.
  - Cross-chunk ties, slurs, hairpins and beam spans are resolved by overlapping slices and by trimming spans to the drawn chunk.
  - The current clef, key, meter and transposition are carried into each slice.
  - The chunk index maps measures to chunks for paging and playback.
- **Guardrails.**
  - A large-file warning with an estimated time, before import.
  - A clear WASM out-of-memory message with a retry at a smaller chunk size.
  - The last opened file is remembered in IndexedDB (a blob handle and its hash), so after a crash the reader offers to reopen it.

## Risks

- **First-system fidelity.** The probe document is cut after a few systems. A span reaching further than four systems from the first one (rare; it appears in synthetic data with unterminated beam spans) is drawn as dangling on the first system only. The first system's height can differ from a whole-score layout by about 1%. *Mitigation:* the span-aware limit; small scores (≤ 1600 staff-measures) lay out whole documents up to the probe limit.
- **Estimated placeholder heights.** Before a system is drawn, its height is estimated. Paging over far placeholders is approximate until they draw, and a scrollbar drag can land a little off. *Mitigation:* scroll compensation, and the estimate follows the latest drawn system.
- **Auto bars wrap check.** Verovio can still wrap a line. It is checked on the probe and on the systems drawn for the first paint. A later system that wraps is drawn as two lines in one block rather than relaid out.
- **`redoLayout` equivalence** was verified with a Node probe on Verovio 6.3.0 (ensemble and Cielito fixtures, every page) for width, font, staff spacing and their combinations. Any option outside that set is treated as a reload key.
- **Worker restarts** (crash, or recycling after a large score) drop baselines. The runtime re-imports the current score once on `missing`.

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
