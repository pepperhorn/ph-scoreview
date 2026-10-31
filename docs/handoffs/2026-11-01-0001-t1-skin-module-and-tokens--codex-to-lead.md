# Handoff: 0001-t1 — Skin module and theme tokens (codex → lead)

- **Date:** 2026-11-01
- **Type:** return
- **Ledger:** 0001 · **Spec:** [0001-composable-player-skins](../specs/0001-composable-player-skins.md) · **Plan:** [0001-composable-player-skins](../plans/0001-composable-player-skins.md), T1
- **Dispatch:** [lead-to-codex](2026-11-01-0001-t1-skin-module-and-tokens--lead-to-codex.md)
- **Branch:** orch/0001-t1-skin-tokens
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-66013276
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/59 (draft; no watching or polling)
- **Review addressed:** [5725393241](https://github.com/pepperhorn/ph-scoreview/pull/59#pullrequestreview-5725393241), reviewed head `462eb0eaa74fe30b910d65bff4e805e009f976bf`
- **Base commit:** 3396bbf (dispatch), pinned task base 320bd6f9913854ddf88d06cf3b863ba168c5096c
- **Port:** 5211, bound to 0.0.0.0 only while the development-consumer validation runs; always closed in finally. Other browser checks use the built-dist test server.
- **Status:** closed

## Goal
Deliver T1's plain-data skin API and live theme overrides without changing default appearance or engraving behaviour. Address all seven review findings. Later tasks implement bar composition, drawer additions, pitch colouring, and release documentation.

## Context you need
The linked spec and plan govern the task. The lead explicitly decided in the 2026-11-01 review-fix brief that `playback` also recolours `.reader-note.is-playing`: these are interface marks, with today's colours retained as fallbacks. Ownership otherwise remains T1's list. GBrain consulted: `default:projects/scoreflow-music-reader` (historical project context). Implementer has made no GBrain writes; the lead owns promotion.

## Scope
- **In:** T1 skin interfaces/public exports, theme-only prop/root styles, colour audit, typed fixture, JS/browser/unit validation, and playback interface marks in `styles.css` per the lead decision.
- **Out:** bar rendering, new toggles, drawer changes, pitch colouring, package version/release, README/changelog work.
- **Files owned:** `packages/pepperscore/src/lib/skin.ts`, `packages/pepperscore/src/lib/skin.test.ts`, `packages/pepperscore/src/styles.css`, `packages/pepperscore/src/components/open-score-dialog.css`, `packages/pepperscore/src/index.ts`, `packages/pepperscore/src/components/PepperScore.tsx` (prop/root style integration only), `apps/reader/src/embed/SkinTest.tsx`, `apps/reader/src/pages/embed-skin.astro`, `validation/skin.mjs`, root `package.json` (skin script and validation registration), and this task's two handoff files.
- **Do not touch:** other files, particularly `render.ts`, `chrome.ts`, and the ledger. Those remain unchanged.

## Acceptance criteria and review fixes
1. **Consumer-development warnings (high):** `process.env.NODE_ENV` is retained through the library build and replaced by the consumer build. A local type declaration avoids adding Node types to the browser component. Validation asserts the diagnostic exists in `dist/index.js`, is absent from the production host JS, is silent in the real production host, and actually warns for an invalid host variable in a real Vite development consumer importing the built package. Dependency optimisation is forced fresh, so cached library code cannot mask a regression. This replaces the library-time `import.meta.env.DEV` gate.
2. **Accent roles (medium):** interactive hover/focus backgrounds use `accentWash`; selected washes use the new `accentWashStrong`; selected borders/rings and focused staff text use `accent`. Every original literal fallback remains intact. Browser checks prove the blue host reaches hover, selected backgrounds and selected edges while neutral panels stay white. Static assertions prevent routing these states through neutral/shadow roles again.
3. **Whole-interface guard (medium):** a PostCSS scan checks both stylesheets for colour literals outside `var(--ps-*,…)`, including named and modern functional colours. The explicit engraved-colour allow-list contains only `.note-label`, `.count-label`, and `.chord-symbol`. `transparent`, `currentColor` and CSS-wide keywords are semantic exceptions. Browser colour candidates are normalised through canvas/relative RGB, covering `color(srgb …)` and alpha-bearing mixes. Icon-only button colours are checked. All three chrome presets, desktop, 390px with More open, hover, keyboard focus, drawer, open dialog, mixer and instrument picker are audited. Negative tests prove bare modern/named/hex literals and icon-only modern-colour leaks fail. Static coverage catches unreached disabled/error/loading/popover states.
4. **Reusable validation (low):** the stylesheet SHA-256 pins were removed from persistent validation. A one-off comparison against `320bd6f` succeeded by stripping theme wrappers and removing only the added native/derived-variable rules. Future legitimate layout rules are therefore allowed, while new hard-coded interface colours still fail the static guard.
5. **Alpha and role separation (low):** shadows retain their per-use alpha even under an opaque `shadow` token, using private derived variables and `color-mix`. When a base token is absent, its derived variables are invalid and each use falls back to its original full colour literal. Playback line/background/halo/glow use `playback`, not neutral surfaces or general shadows; focus halos derive from `focusRing`. Tests distinguish shadow alpha bytes 22 (selected ambient shadow), 36 and 64, and playback halo/glow alpha bytes 153 and 128.
6. **Playing notes (low, lead scope decision):** `.reader-note.is-playing` fill, stroke and drop-shadow all use `playback`, with the original amber literals as fallbacks. Tests use a rendered reader note and verify original colours, themed colours and glow. The existing `--ps-cursor` override still wins over the playback fallback on cursor marks. Engraved annotation fills remain unchanged.
7. **Complete palette guarantee (low):** `mergeSkins` validates the accumulated palette before returning it. Incomplete results throw `TypeError`; partial overrides work over a complete palette, and a complete palette can be introduced on an empty base. The unsafe `as PitchPalette` cast is gone. Five unit tests cover this contract, merge copies/replacement, stable keys, exact CRF values, theme-only styles and invalid-colour diagnostics.

AC6 remains covered by SVG identity and unchanged render counts across host variable changes, skin replacement/removal and equivalent inline objects. AC8d is covered by the reader's tsc fixture with expected errors for bad token/bar names plus JS imports of the built package root. No skin was added to engraving dependencies.

## Verify with
```bash
npm run check && npm run build && npm run test:css && npm run test:skin && npm run test:reader
npm run check && npm run build && npm run test:manifest && npm run test:validation
```
The full validation chain includes the CSS, skin and reader checks.

## Known gotchas / decisions made
- `THEME_TOKENS` now has 19 public roles, including `accentWashStrong`. T5 must document the final list. The `--ps-*-aXX` alpha variables are internal derived values, not additional public tokens.
- Theme variables live on the player root. CSS resolves host references without React work. `skinKey` sorts maps and preserves bar order; equal inline data does not trigger engraving.
- Library-time `import.meta.env.DEV` erases diagnostics before a consuming dev build can use them. T2's unknown-bar warning should use the tested consumer-time environment approach.
- Private alpha variables deliberately omit a base-token fallback. Otherwise mixing a translucent fallback would multiply its original alpha a second time.
- Browser-owned form/control focus colours use `revert` with low specificity where needed. Existing author-level focus rules retain priority. The keyboard audit exposed the native icon-button focus outline; the new low-specificity rule themes it while preserving default outline colour/style/width in the independent native-rule removal comparison.
- `revert` bypasses earlier author declarations; do not apply it to an already-authored checkbox accent (that redundant override was removed in the original implementation).
- `bar` and `pitchColours` remain data only in T1. `skinStyle` emits theme variables only.
- The browser audit disables transitions to measure settled colours and closes the drawer with Escape before header dialogs. SVG music is excluded from the interface audit; playing-note/cursor marks have dedicated assertions.

## Open questions
None. The playing-note scope question was resolved by the lead's explicit instruction above.

---
## Receiver ack
Lead to acknowledge through the ledger on main.

---
## Return
- **Outcome:** done; all seven review findings addressed
- **Commits:** original reviewed head `462eb0e`; fixes `13eaf29`; forced fresh development-consumer dependency build `922b726c28787d701785d833b466317235f28b3b`; selected segment wash/ambient-shadow refinement `b36e937`. The return-document update is committed separately after verification.
- **What changed:** all seven findings addressed within T1 ownership and the explicitly authorised playback-mark scope.
- **Verification output:** a fresh full command chain passed (exit 0) on implementation head `b36e9374ad75aa604965d251e3981c6d2bb87312` after the final selected-state refinement. Only this handoff changes afterward. This includes `check`, `build`, `test:manifest`, `test:css`, `test:skin`, `test:reader` and every other `test:validation` suite. Check: 0 errors/warnings/hints. Skin: 5 unit tests; library: 76 tests; editor: 273 tests. Ownership audit from the merge base and `git diff --check` passed. Main's later lead-owned ledger update is outside this branch's changes.

```text
Skin: JS exports, typed fixture, static colour guard, desktop/mobile/all-chrome/icon and modern-colour audit, consumer dev/prod diagnostics, live host variables and no re-engrave passed
packages/pepperscore/src/styles.css: one-off default fallback comparison to 320bd6f passed
packages/pepperscore/src/components/open-score-dialog.css: one-off default fallback comparison to 320bd6f passed
```

Full-suite tail:
```text
Instrument switch: reader settings switch both piano staves (clef, written pitch, ps-transposed / ps-out-of-range, host highlights), no double transposition, concert-basis rule passed
Instrument switch: playback plays alto sax program 66 at the fitted sounding pitch; unswitched transposing parts unchanged in both views passed
Instrument switch: full reader picker (Instrument and Sound sections, trumpet, harp sound, level and fit, as written, hidden by the host, drum kit) passed
Instrument switch: saved switch vs host settings (same host: the reader's flute; changed host: alto sax) passed
Instrument switch: octave tool (select, Shift/second-click passage, phrase, 8va/8vb, out of range, auto-fit kept as written, reset, Escape, focus, saved, hidden, embed menu and compact entry) passed
Instrument switch: chunked reader render moves tied notes across chunk boundaries; caches keyed by the spec passed
```
- **Out-of-scope issues found:** none requiring changes.
- **Follow-ups:** other-family re-review and lead merge, then T2. T5 owns final documentation; no release/version bump performed. CI/review status is not polled.
- **For GBrain (lead to promote):** preserve consumer-time environment checks in distributed libraries; test the built package in both host modes. Use invalid derived custom properties to retain exact per-use colour fallbacks while applying alpha to a shared override. Pair static colour-literal coverage with real desktop/mobile/state checks, including icon-only controls and modern CSS colour serialisations.
