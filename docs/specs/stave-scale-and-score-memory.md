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
- **Width changes** (window resize or rotation) re-lay out at the same *user-chosen* zoom and do not change it. A **default** zoom (no slider or pinch change, and no saved user zoom for this score and device class) is re-resolved on every layout, so resize, rotation or a mode switch re-fits it (the Vertical four-bar fit or the Endless device default, or the many-staff height fit).
- **Reachability:** content is never placed above the scroll origin. When a system or stack is taller than the viewport it is top-aligned instead of centred, in Vertical and in Endless (including the short-landscape layout that centres the stage on the viewport).

### Defaults (when a score has no saved zoom)
Revised 2026-09-30 (`feat/four-bar-default`): the fixed Vertical device defaults (desktop 0.75, compact 1.0) are replaced by a four-bar fit, with a readable floor on compact devices. The user can still scale up or down from it.

| View | Default stave scale |
| --- | --- |
| Vertical | The largest scale at which 4 bars fit the first system beside the staff controls at their minimum width, so Auto shows four bars per line. The scale depends on the viewport, not the score length |
| Endless | Unchanged: desktop (`(pointer: fine)` and viewport width > 850px) 0.75, phone and tablet 1.0 |
| More than 4 staves | `min(the view's default above, full-stack height fit)` |
| Compact devices, Vertical | `max(readable floor, the result above)`. The floor is a 40px five-line staff (`COMPACT_MIN_DEFAULT_STAVE_PX`), stave scale ≈ 0.556 |

- **Compact readability floor:** on the compact device class (anything that is not desktop), readability wins over fit. The Vertical default is never below a 40px staff. Auto then shows fewer bars per line (1–3 on phones), and a many-staff stack scrolls vertically instead of being height-fitted smaller. Desktop and Endless are unchanged. Only the default is floored: a user can still zoom below it, and that zoom is saved as usual. One case still draws smaller: when a single bar (for example a lyric bar) cannot fit beside the staff controls, the first system is width-fitted below the floor, while later systems use the full width.

- **Width model:** the fit uses the same model as the layout. The minimum bar width is the Auto one (busiest bar, lyric density from the engraving). The first system needs `bars × barFloor + 120` Verovio units. Its usable width is `(viewport − gutter(zoom) − 4px slack) / zoom`, where the gutter is the staff-control gutter for a `72 × zoom` px staff. Usable width falls as zoom rises, so `barFitZoom` in `src/lib/render.ts` bisects for the largest fitting zoom. It is deterministic, rounded down to 0.001 and clamped to `[0.02, 4]`, and it needs no extra Verovio render. Only the many-staff height fit keeps its one probe render.
- **Short scores:** a score shorter than a full Auto line keeps the same stave size. It is drawn as one centred system at Verovio's natural width, not stretched to fill the viewport. If that natural width does not fit, it fills the line as usual.
- **No wrapped lines:** the bar-width model is an estimate. If Verovio still wraps an Auto line inside its page, the layout drops one bar per line and renders again, keeping the zoom. That extra render happens only when a line wraps.
- **Balancing:** Auto balances lines, so a score whose count leaves a short last line (for example 5 or 6 bars) shows 3 per line at the four-bar zoom.
- **Explicit bar counts** (1–8): without a user zoom, the stave scale is the largest at which that many bars fit the width (capped at 2.5), and systems fill it; with a user zoom they keep that zoom, and their systems are centred as before.
- **Re-resolving:** the reader requests `'fit'` whenever there is no user zoom, and `renderScore` resolves it on every layout (resize, rotation, mode switch).
- **Where it lives:** the constants are in `src/lib/stave-scale.ts`: `DEFAULT_VERTICAL_BARS`, `COMPACT_MIN_DEFAULT_STAVE_PX`, `ENDLESS_STAVE_SCALE` and `HEIGHT_FIT_STAVES`, next to the slider range and step.
- **Slider minimum:** the effective minimum is `min(STAVE_SCALE_MIN, current default)`, so a default below the usual minimum is shown as is and never clamped up.

### Per-score memory (local database)
- A small IndexedDB wrapper, `src/lib/score-db.ts`: database `scoreflow`, object store `scores`, keyed by `sha256`. It stores the existing `FileState` (version bumped to 2 and adding `lastOpened`) plus `view: { zoom, zoomDevice: 'desktop' | 'compact' }`.
- **Keys:**
  - opened files: the original-bytes hash (as today);
  - default sample, pasted ABC and the `musicXml` prop: a hash of the source text with a format prefix (`abc:`, `musicxml:`).
- **Only user zooms are saved:** an automatic default is never written as if chosen; a saved view from another device class is kept when the default is in use.
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
  - with no saved zoom, the sample shows exactly four bars on every Vertical system at 1280×800. At 390 and 320 the sample and the ensemble keep a staff of at least 40px (except a width-fitted first system beside the controls), with at most four bars per line. There is no horizontal overflow, a two-bar score defaults to the same stave scale as the sample (at 1280 on one centred, shorter line), no line wraps inside its system, and the Endless default is unchanged;
  - reopening a file (and reloading with the sample) restores its zoom;
  - a desktop-saved zoom is not applied at 390px;
  - existing assertions stay green.

## Out of scope / follow-ups
- Restoring the reading position (last measure) on reopen. It could use the same record.
- Syncing across devices.
