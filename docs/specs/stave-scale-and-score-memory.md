# Stave scale reflow and per-score memory

Date: 2026-09-30 · Status: approved for implementation · Branch: `feat/stave-scale-reflow`

## Problems

1. **Slider is not smooth.** Every committed zoom step runs the full repaint (fade out, re-render, zoom-out reveal).
2. **Zoom does not reflow.** Verovio lays out at a width chosen for zoom 1 and the result is only scaled. Auto bars-per-line is never recomputed, so zooming out leaves unused width and zooming in overflows; systems are not centred.
3. **Default size.** On desktop the default single-stave sample is too large; 75% of today's scale is comfortable.
4. **No memory for unsaved sources.** Per-score settings (including zoom) exist only for opened files, in `localStorage` (`scoreflow-file-v1:<sha256>`). The default sample, pasted ABC and the `musicXml` prop forget their zoom.

## Definitions

- **Stave scale (`zoom`)**: rendered px per Verovio layout unit at `scale: 100`, i.e. an absolute stave size. `1` = Verovio's natural size. It no longer multiplies a width fit.
- **Layout width**: `(viewport width − first-system gutter) / zoom`, in Verovio units. Verovio lays out at that width, so the rendered systems fill the viewport at the chosen stave size.

## Behaviour

### Zoom interaction
- While the slider is dragged (or during a pinch), apply a live CSS `transform: scale(draft / committed)` preview to the current score. It is anchored at the viewport centre and runs on the GPU with no re-render.
- Commit on release (`change` / `pointerup` / pinch end; keyboard steps commit after the existing short debounce). A commit re-lays out at the new layout width.
- A zoom commit **does not** use the paint reveal. The previous score stays visible until the new SVG is ready, then it swaps in place (a ≤120 ms crossfade is allowed). The paint reveal is reserved for loading a score, switching mode and first paint.
- **Anchor:** the measure under the viewport centre before the zoom is still under the viewport centre after the commit, in both Vertical and Endless.

### Layout at the new scale
- **Vertical, Auto bars:** bars per line is recomputed from the layout width and the minimum bar width, in Verovio units. The cap rises from 4 to 8. Explicit choices of 1–4 are unchanged, and their systems are centred horizontally when narrower than the viewport.
- **Endless:** a single system at the chosen stave size; the vertical centring is unchanged.
- **Many staves (more than 4):** the default zoom is the full-stack height fit (as today). After that, zoom is absolute.
- **Staff controls and gutter:** they keep following the rendered stave (from #5). The gutter is included in the layout-width calculation, so notation never collides with the controls.
- **Width changes** (window resize or rotation) re-lay out at the same zoom and do not change it.

### Defaults (when a score has no saved zoom)
| Device class | Default stave scale |
| --- | --- |
| Desktop (`(pointer: fine)` and viewport width > 850px) | 0.75 × today's rendered scale for the single-stave sample (measured; expected ≈ 0.75) |
| Phone and tablet | The current rendered scale of the sample at 390px, so phones look unchanged |
| More than 4 staves | Height fit |

The defaults live in one typed module, `src/lib/stave-scale.ts`, next to the slider range and step.

### Per-score memory (local database)
- A small IndexedDB wrapper, `src/lib/score-db.ts`: database `scoreflow`, object store `scores`, keyed by `sha256`. It stores the existing `FileState` (version bumped to 2 and adding `lastOpened`) plus `view: { zoom, zoomDevice: 'desktop' | 'compact' }`.
- **Keys:**
  - opened files: the original-bytes hash (as today);
  - default sample, pasted ABC and the `musicXml` prop: a hash of the source text with a format prefix (`abc:`, `musicxml:`).
- **Restoring:** on reopen, zoom is restored when the saved `zoomDevice` matches the current device class. Otherwise the device default is used, so a phone zoom doesn't carry over to desktop.
- **Migration:** the first read of a hash falls back to the `localStorage` v1 record and imports it. The `localStorage` copy is kept until the next successful IndexedDB write.
- **Fallbacks:** if IndexedDB is unavailable (private mode, blocked), fall back to `localStorage` silently. All access is wrapped in try/catch. Writes are debounced (about 400ms) and never block rendering.
- **Size limit:** keep only the most recently opened 200 scores; evict the oldest.
- **Privacy:** only settings and hashes are stored, never score content.
- **Loading:** reads are async. Load the record while the score imports (they run in parallel), and apply saved zoom before first paint, so there is no visible jump.

## Validation
- **Unit tests** (`validation/document.mjs` or a new `validation/score-db.mjs`):
  - IndexedDB round trip;
  - `localStorage` v1 migration;
  - fallback when IndexedDB throws;
  - eviction at the cap;
  - sample and ABC keys stay stable across reloads.
- **Reader tests:**
  - dragging the slider changes the preview transform with no re-render until release;
  - releasing the slider shows no `.score-loading` overlay and no paint-reveal animation;
  - the anchor measure stays within half a bar of the viewport centre;
  - at 50% on 1280px, Auto shows more bars per line than at 100% and systems fill at least 90% of the usable width;
  - explicit bar counts produce centred systems;
  - desktop default for the sample is about 0.75× the baseline;
  - reopening a file (and reloading with the sample) restores its zoom;
  - a desktop-saved zoom is not applied at 390px;
  - existing assertions stay green.

## Out of scope / follow-ups
- Restoring the reading position (last measure) on reopen. It could use the same record.
- Syncing across devices.
