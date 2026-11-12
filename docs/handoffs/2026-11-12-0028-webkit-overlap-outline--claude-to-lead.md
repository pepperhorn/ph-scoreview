# Handoff: 0028 — WebKit hairline outline on overlapping reader marks (claude → lead)

- **Date:** 2026-11-12
- **Type:** return
- **Ledger:** 0028 (quick; S36)
- **Branch:** orch/0028-webkit-overlap-outline · **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-137c2ce6-5a91a9b6a86ef844
- **Dispatch:** [lead → claude](2026-11-12-0028-webkit-overlap-outline--lead-to-claude.md)
- **Base commit:** f1f24b0
- **Status:** closed
- **Outcome:** done

## What changed
Cause, confirmed in WebKit: Verovio emits `path{stroke:currentColor}`. WebKit applies it inside the referenced notehead glyph, so a pitch head's `color` shows as a ~1-unit outline once a reader mark replaces the 18-unit pitch outline with the mark's 1-unit stroke. The old rules set `color` per mark by *any matching ancestor* (later rule wins), while `fill`/`stroke` are inherited from the *nearest* ancestor and, on one element, the higher-specificity `.reader-note.is-playing` wins. Two ways they disagree:
- one element with playing + any other mark: `color` took the later mark, stroke/fill took playing;
- a transposed or selected chord with a mark on a `.note` inside it: `color` took the later rule, stroke/fill took the inner note.

Fix (`packages/pepperscore/src/styles.css`, pitch-colour block): each mark now sets a custom property `--ps-mark` with the same selector specificity and order as the mark rules at the top of the file; marked pitch heads use `color:var(--ps-mark)`. A custom property inherits from the nearest marked ancestor exactly like `fill` and `stroke`, so the three always agree. `color` could not go on the marks themselves: every engraved path strokes with `currentColor`, so stems and ledger lines would change colour in all browsers. The playing selector is now `.reader-note.is-playing` as the review suggested. No JS or markup change. `--ps-mark` is internal; it is registered in the known-variables list in `validation/skin.mjs` (one line).

Assertion (`validation/pdf.mjs`, `assertMarkOverlapOutline`, runs in all engines after the #91 raster parity): 10 overlap cases on a real engraved score with far-apart mark colours (note: playing+each of cursor/selection/transposed/out-of-range, selected+transposed, transposed+out-of-range; chord: playing+transposed, transposed chord + selected note, selected chord + transposed note, out-of-range chord + selected note). For each head it asserts (1) computed `color`, `stroke` and `fill` agree, and (2) the raster as drawn equals the raster with `currentColor` forced to the stroke (same picture when nothing leaks).

## Acceptance criteria
- [x] Both overlap cases render without a foreign-colour outline in WebKit; assertion fails on base and passes after.
- [x] #91 assertions still pass in chromium, firefox, webkit.

## Verification
Base commit f1f24b0 CSS, WebKit (`BROWSER=webkit PITCH_PARITY_ONLY=1 node validation/pdf.mjs`), **fails**:
```text
AssertionError: note playing + ps-cursor head 0: glyph currentColor rgb(0, 200, 200), stroke rgb(0, 0, 255) and fill rgb(0, 0, 255) must agree
```
Raster-only check on the base (style assertion disabled) also fails in WebKit: `263 channel values differ from the same head with currentColor = stroke`; the same raster check passes in chromium and firefox on the base (Chromium/Firefox pixels are not affected by `color`, so their rendering does not change).

After the fix (`VALIDATION_BUDGET_SCALE=2` on a loaded host):
```text
npm run check            0 errors / 0 warnings / 0 hints
npm run build            ok
npm run test:manifest    GM manifest: 128 local packs ... verified
npm run test:css, test:skin, test:reader, test:embed, test:pepperscore (716 tests)   pass
BROWSER=chromium|firefox|webkit npm run test:pdf, each:
  Pitch raster default C: screen 89,89,89 / 0.0456 (webkit), PDF 89,89,89 / 0.0442
  Mark overlap outline: 10 overlapping-mark cases draw no foreign-colour outline (<engine>).
  PDF page model spike passed (<engine>)
```
Not run: the rest of `npm run test:validation` (api, audio, clock, assets, sounds, spelling, transpose, document, parser-diff, score-db, performance, editor*, chunks, large, guardrails, layout, tab*, instrument-switch). The change is CSS-only and unreachable from them; CI will run them. `test:skin` is Chromium-only by design.

## Decisions made
- `--ps-mark` custom property rather than `color` on the marks (stems/ledger lines would recolour in every browser). Worth a one-line note if the lead keeps a CSS gotchas page.
- The assertion compares against a forced-`currentColor` raster instead of counting pixels near the loser colour: the leak is a sub-pixel hairline whose antialiased pixels are not near the loser colour (a first attempt passed on the base for that reason).
- The full WebKit PDF suite takes ~4m40s on this host; no budgets changed.

## Out-of-scope issues found
None. (S34 appears fixed: the full WebKit PDF suite, overlay recovery included, passed.)

## For the ABC guide
No ABC import behaviour change.

## Follow-ups
None.

## For GBrain (lead to promote)
WebKit paints Verovio's `path{stroke:currentColor}` inside referenced `<use>` glyphs from the head's computed `color`: keep `color` derived from the same inherited source as `fill`/`stroke` (a custom property set per mark inherits like them; ancestor selectors do not). `GBrain: unavailable` in this session.
