# 0002 — PDF export

- **Status:** approved
- **Ledger:** 0002 · **Plan:** ../plans/0002-pdf-export.md
- **Author:** lead · **Date:** 2026-10-31

## Problem

The player can't produce anything to print or share. `docs/specs/pepperscore-plugins-and-embeds.md` lists free PDF export with a formatting overlay as phase 2, and nothing has been built. People want sheets they can play from.

## Goals

- Save the score as a real, paged, vector PDF from the player.
- Each integration decides whether it's available.
- An overlay sets paper size and bars per line before saving.

## Non-goals

- Part extraction: printing each part as its own file. The PDF contains the parts currently shown.
- Screenshot or raster output. chordl's board PDF is one large screenshot on a single page (`ChordBoard.tsx:785`); that is what this avoids.
- CMYK output. The CRF CMYK values are a print reference only.
- Paper sizes beyond the four below, landscape pages, custom margins, headers and footers.
- Print-server or server-side rendering. It all happens in the browser.
- Any paywall. This is a free feature.
- The score editor.

## User-visible behaviour

### Availability

`controls.pdf` (boolean), added to `PepperScoreControls`. It follows the same rule as other controls: on for `full` chrome, off otherwise (lead's call). With it off, no button appears and no PDF code loads. It also provides bar item `pdf` (0001).

### Overlay

Clicking the PDF button opens an overlay, and nothing saves until the user confirms.

- **Paper size:** A4 (default), A3, Letter, Legal.
- **Bars per line:** 1 to `BARS_PER_LINE_MAX`, default 4. This is a fresh default each time and doesn't change or read the on-screen `prefs.barsPerLine` (lead's call).
- **Fit note:** once measured, the overlay says how the score fits, e.g. "12 lines will have fewer than 4 bars on A4". It reads "Checking fit…" until then and never blocks Save.
- **Save** and **Cancel**. While building: a busy state, and Cancel stops it.

Chosen paper size is remembered for next time (lead's call).

### Fitting

Bars per line is a ceiling, not a demand, and it's applied line by line (user decision). Bars fill a line up to the requested count, and a line that can't fit them all at the fixed stave size takes fewer, so one dense bar affects only its own line. Lines needn't match.

This is new work. The on-screen `portraitBarLimit` (`PepperScore.tsx:1733`) and the engine's `breakEvery` use one count for the whole score, sized from the busiest bar, so the PDF needs its own per-bar width measurement and line breaking. It must not change on-screen layout. This takes chordl's idea of a picker with bars standing in for cards, but not its code: chordl has no overlay and no paged output.

Stave size is one fixed physical size on every paper size, set by the builder from a readable default, and doesn't carry over the on-screen stave scale (lead's call). If one system is taller than the page, as in a score with around 30 parts, the system alone shrinks to fit the page height, and the overlay says so (lead's call).

Bigger paper therefore fits more: a line that takes 3 bars on A4 can take 4 on A3.

### Content

The PDF matches what the reader shows, apart from layout:

- transposition, instrument switches, TAB view and hidden parts
- note names, chord symbols and counts, with their sizes
- pitch colours, when switched on (0001), as RGB
- notation font
- title, subtitle, composer and credits on page one
- page numbers, portrait pages

Screen-only marks are left out: playhead, selection, host highlights, part controls.

Filename is the slugged score title, falling back to `score.pdf`.

## Constraints

- **Vector output:** notation stays sharp at any print size, text is selectable. Verovio already emits SVG with real page layout.
- **Lazy loading:** PDF libraries must not enter the initial bundle. They load on first use, in the same spirit as the Verovio runtime, and `npm run test:pack` must stay green. Likely `jspdf` + `svg2pdf.js` (both MIT), but the builder may choose otherwise with reasons. Record new dependencies in third-party notices.
- **`paint-order`:** `svg2pdf.js` ignores it. Any stroked note text needs the three-pass render from the house style.
- **Fonts:** Poppins and the notation fonts are embedded. Serif (Georgia) and Mono (`ui-monospace`) are system fonts that can't be embedded, so text in those options falls back to Poppins in the PDF (lead's call).
- **On-screen state:** exporting must not disturb the reader's Verovio state, scroll, playback or chunked engraving. Audio keeps playing.
- **Large scores:** must complete without freezing the page (see `docs/specs/large-score-performance.md`).
- Works in Chromium, Firefox and WebKit, as the reader does.
- Depends on 0001 for the bar slot and overlay colours.

## Acceptance criteria

- [ ] AC1 — `controls={{ pdf: false }}` shows no button and loads no PDF code; `controls={{ pdf: true }}` on `minimal` shows it.
- [ ] AC2 — The initial bundle size is unchanged with the feature unused.
- [ ] AC3 — The overlay defaults to A4 and 4 bars per line, and saving is impossible without confirming.
- [ ] AC4 — Exported page dimensions are exact: A4 210×297mm, A3 297×420mm, Letter 8.5×11in, Legal 8.5×14in.
- [ ] AC5 — In a fixture with one very dense bar among sparse ones at 4 per line on A4, only that bar's line has fewer bars; the others keep 4, and the overlay reported it.
- [ ] AC6 — The same score never needs more lines on A3 than on A4.
- [ ] AC7 — A multi-page score paginates with no cut-off staves, and the text layer contains the title.
- [ ] AC8 — Transposition, annotations and hidden parts on screen appear in the PDF; playhead and selection don't.
- [ ] AC8a — With pitch colours on, noteheads in the PDF match the screen, with their outlines.
- [ ] AC9 — Export leaves the reader's scroll position and engraving unchanged, and doesn't stop playback.
- [ ] AC10 — The large-score fixture exports without freezing the page and can be cancelled.
- [ ] AC11 — Passes in Chromium, Firefox and WebKit.

## Open questions

None yet.
