# Plan 0002 — PDF export

- **Spec:** ../specs/0002-pdf-export.md
- **Base:** main, after 0001 T2 merges (bar item `pdf`, theme tokens). Pitch colours need 0001 T4.
- **Verification (whole item):** `npm run check && npm run build && npm run test:manifest && npm run test:validation && npm run test:pack`

## Approach

The PDF is engraved separately from the screen by a dedicated Verovio worker, so the reader's toolkit, scroll and playback are never touched. One pass measures each bar; a pure function breaks bars into lines against the paper's content width; explicit system breaks go into the MEI view; Verovio lays out at the real page size; pages go through `svg2pdf.js` on `jsPDF`. Everything under `lib/pdf/` is reached by dynamic `import()`, so nothing enters the initial bundle.

Per-line fitting is the riskiest part, so T1 proves it before any UI. The reader must keep using `breakEvery` unchanged.

Global rules: vector only; `controls.pdf` off loads no PDF code; new dependencies listed in third-party notices; contextual class names; Poppins for UI; TDD.

## Tasks

### T1 — Page model and per-line break spike
- **Depends on:** 0001 T2
- **Route:** implement (default)
- **Owns:** `packages/pepperscore/src/lib/pdf/paper.ts` (new), `lib/pdf/fit.ts` (new), `lib/pdf/fit.test.ts` (new), `lib/pdf/engrave.ts` (new), `lib/pdf/engrave.worker.ts` (new), `lib/notation/mei-view.ts`, `validation/pdf.mjs` (new), root `package.json` (`test:pdf`, added to `test:validation`)
- **May read:** anything
- **Acceptance:** AC4 (dimensions as data), AC5 (layout half), AC6
- **Verify:** `npm run check && npm run build && npm run test:pdf && npm run test:document && npm run test:layout && npm run test:chunks`
- **Interfaces produced:**
  - `PAPER_SIZES`: `a4` 210×297mm, `a3` 297×420mm, `letter` 215.9×279.4mm, `legal` 215.9×355.6mm
  - `breakLines(barWidths: number[], capacity: number, maxBars: number): number[]`, the zero-based bar indices that start a line. Greedy. A bar wider than `capacity` gets its own line. Unit test: one dense bar among sparse at `maxBars` 4 shortens only its own line.
  - `ViewSpec.breakBefore?: number[]` in `mei-view.ts`. When present it replaces `breakEvery`. Absent, output is byte-identical.
  - `engravePages(input, opts, signal): Promise<{ pages: string[]; lines: LineInfo[]; shrunk: boolean }>`
- **Notes / gotchas:**
  - Stop and report in the return handoff if Verovio doesn't honour the breaks at page size, or bar measurement proves unreliable: this decides whether the rest of the plan stands.
  - Measure with `breakEvery: 1`-style natural widths in the PDF worker. The per-bar overhead (`SYSTEM_OVERHEAD`, `render.ts:111`) applies per line, and clef and key changes add width.
  - Fixed physical stave size: choose one constant and justify it in the return handoff. Page options use a real `pageWidth`/`pageHeight` with `adjustPageHeight: false`, unlike the reader's `render.ts:399`.
  - System taller than page: shrink that system's scale only, and set `shrunk`. If Verovio can't scale one system, shrink the whole document and record it as a decision.

### T2 — PDF composition
- **Depends on:** T1
- **Route:** implement (default)
- **Owns:** `lib/pdf/compose.ts` (new), `lib/pdf/fonts.ts` (new), `lib/render.ts` (annotation extraction), `package.json` in `packages/pepperscore`, third-party notices, `validation/pdf.mjs`
- **May read:** anything
- **Acceptance:** AC4 (real files), AC7, AC8, AC8a
- **Verify:** `npm run check && npm run build && npm run test:pdf && npm run test:reader`
- **Interfaces produced:** `composePdf(pages: string[], opts: { paper: PaperId; title?: string }, signal): Promise<Blob>`; `exportScore(request, signal): Promise<Blob>`, the only entry point the UI imports.
- **Notes / gotchas:**
  - `jspdf` and `svg2pdf.js` are MIT. chordl uses `jspdf ^4.2.1`; `compress: true` matters (`ChordBoard.tsx:790`).
  - Note names, counts and inferred chords are an overlay added in `render.ts`, not Verovio output. Extract the drawing so PDF pages use the same code, and don't copy it. Pitch colours need inline `fill`/`stroke`, because CSS variables don't reach svg2pdf.
  - `paint-order` is ignored by svg2pdf: use the three-pass render for any stroked note text.
  - Embed Poppins and the notation fonts. Serif and Mono fall back to Poppins. Non-Latin titles need a decision: if Poppins lacks the glyphs, record what happens in the handoff.
  - Parse PDFs in the test for page size, page count and text (`pdf-lib` or similar as a dev dependency).

### T3 — Overlay, button and `controls.pdf`
- **Depends on:** T2
- **Route:** implement (default)
- **Owns:** `components/PdfOverlay.tsx` (new), `lib/chrome.ts`, `lib/bar-items.ts`, `lib/prefs.ts`, `components/PepperScore.tsx`, `src/styles.css`, `validation/pdf.mjs`, `apps/reader/src/embed/SkinTest.tsx`
- **May read:** anything
- **Acceptance:** AC1, AC2, AC3, AC5 (overlay half), AC9
- **Verify:** `npm run check && npm run build && npm run test:pdf && npm run test:embed && npm run test:reader && npm run test:pack`
- **Interfaces:** `controls.pdf`, `chrome.pdf` (on for `full`, else off), bar item `pdf`, new remembered pref `pdfPaper` (default `a4`); bars per line is local overlay state starting at 4.
- **Notes / gotchas:**
  - On default `full`, the button goes in the header registry as secondary and in the drawer via `drawerExtras`. The overlay uses theme tokens, a dialog role and focus trap like the mixer panel, and no `position:fixed` (`test:css`).
  - AC2: assert no `lib/pdf` chunk loads before the button is clicked, and compare initial chunk sizes against main.
  - "Checking fit…" runs the measure pass after the overlay opens and when paper or bars change. Abort the previous run. Save never waits for it.
  - Cancel aborts through `AbortSignal` and terminates the worker. Trigger download with a blob URL; filename is the slugged title or `score.pdf`.

### T4 — Large scores, browsers and docs
- **Depends on:** T3
- **Route:** implement (alt)
- **Owns:** `validation/pdf.mjs`, `lib/pdf/**`, `packages/pepperscore/README.md`, `packages/pepperscore/CHANGELOG.md`, `.github/workflows/ci.yml`, `docs/specs/pepperscore-plugins-and-embeds.md` (phase 2 marked done)
- **May read:** anything
- **Acceptance:** AC10, AC11
- **Verify:** whole-item command, plus `BROWSER=firefox npm run test:pdf` and `BROWSER=webkit npm run test:pdf`
- **Notes / gotchas:** the composition step runs on the main thread (svg2pdf needs a DOM), so compose page by page and yield between pages. Measure against the large-score fixture and report timing in the PR. Add `test:pdf` to the CI browser matrix.

## Merge order

T1 → T2 → T3 → T4

## Risks

- **Spike failure:** per-line breaks may not hold in Verovio at page size. T1 is the stop point; if it fails, come back to the user rather than falling back to whole-score fitting, which they rejected.
- **Score with one bar, an empty score, or very long pickup:** must save a valid one-page PDF. Owner: T1.
- **Score with no title:** filename and page one must still work. Owner: T3.
- **User changes transposition or a part while the overlay is open:** the export uses a snapshot from Save, not a mix. Owner: T3.
- **Popup and download blocking in embeds:** in a sandboxed iframe, blob download can fail silently. Show an error rather than nothing. Owner: T3.
- **Slow first use on poor networks:** chunks and fonts load only on click; a failed load must show a retryable error, not a stuck busy state. Owner: T3.
