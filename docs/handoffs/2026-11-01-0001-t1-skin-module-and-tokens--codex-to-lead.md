# Handoff: 0001-t1 — Skin module and theme tokens (codex → lead)

- **Date:** 2026-11-01
- **Type:** return
- **Ledger:** 0001 · **Spec:** [0001-composable-player-skins](../specs/0001-composable-player-skins.md) · **Plan:** [0001-composable-player-skins](../plans/0001-composable-player-skins.md), T1
- **Dispatch:** [lead-to-codex](2026-11-01-0001-t1-skin-module-and-tokens--lead-to-codex.md)
- **Branch:** orch/0001-t1-skin-tokens
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-66013276
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/59 (draft; CI/reviews not polled)
- **Base commit:** 3396bbf (dispatch), pinned task base 320bd6f9913854ddf88d06cf3b863ba168c5096c
- **Port:** 5211 (no dev server used; validation uses the built-dist test server)
- **Status:** closed

## Goal
Provide the plain-data public skin API and live theme overrides while preserving default appearance and engraving behaviour. This delivers T1; later tasks implement bar composition, drawer additions, pitch colouring, and release documentation.

## Context you need
The spec and plan above are authoritative. GBrain consulted: `default:projects/scoreflow-music-reader` (historical project context; no theming-specific requirement was found). Implementer has made no GBrain writes; the lead owns promotion.

## Scope
- **In:** all T1 skin interfaces, public exports, theme-only prop/root styles, colour audit, typed fixture and JS/browser/unit validation.
- **Out:** bar rendering, toggles, drawer changes, pitch colouring, package version/release and README/changelog work.
- **Files owned:** `packages/pepperscore/src/lib/skin.ts`, `packages/pepperscore/src/lib/skin.test.ts`, `packages/pepperscore/src/styles.css`, `packages/pepperscore/src/components/open-score-dialog.css`, `packages/pepperscore/src/index.ts`, `packages/pepperscore/src/components/PepperScore.tsx` (prop/root style integration only), `apps/reader/src/embed/SkinTest.tsx`, `apps/reader/src/pages/embed-skin.astro`, `validation/skin.mjs`, root `package.json` (skin script and validation registration), and this task's two handoff files.
- **Do not touch:** other files, particularly `render.ts`, `chrome.ts`, and the ledger. Those remain unchanged.

## Acceptance criteria
- AC1: original stylesheet bytes are reproduced by stripping only new token wrappers and the explicit native-control rules; native defaults are independently compared in Chromium. Existing default reader/embedding suites cover behaviour.
- AC5: sentinel overrides audited over non-SVG UI elements and applicable pseudo-elements, header, drawer, open-score dialog, mixer and instrument picker. Invisible border/outline paint is excluded; transparent colours remain transparent.
- AC6: host variable changes update computed colours with identical score SVG nodes and unchanged render count. Live skin replacement, removal and equivalent inline objects also avoid re-engraving. All three chrome presets receive the theme.
- AC8d: reader tsc fixture contains expected errors for mistyped token/bar names; plain JS imports the built package exports. Four skin unit tests cover merge semantics, stable keys, data-only future fields, exact CRF palette and invalid-colour diagnostics.

## Verify with
```bash
npm run check && npm run build && npm run test:css && npm run test:skin && npm run test:reader
npm run check && npm run build && npm run test:manifest && npm run test:validation
```

## Known gotchas / decisions made
- The 18 public tokens are listed in `THEME_TOKENS`. Tokens are roles; each use retains its own exact literal fallback, so different pre-existing shades can share an override without changing default colours.
- CSS variables are inline on the player root; CSS resolves host `var()` references. `skinKey` sorts maps and preserves array order; memoisation does not depend on object identity.
- Existing note-name/count/chord annotation fills remain literal: they are engraved SVG content, outside the interface-colour audit. Existing score-mark names are preserved. Playback is the fallback under `--ps-cursor`, so existing host cursor overrides continue to win.
- Native form control colours were previously supplied by the browser. Their new variables use `revert` fallbacks, and the validation removes these rules to compare default computed colours independently.
- The final parity comparison caught a redundant checkbox accent override: `revert` restores the browser origin, not an earlier author declaration. That override was removed; the existing checkbox accent already uses a token.
- `mergeSkins` copies maps/arrays, merges maps key by key, and replaces a supplied bar (including an empty bar). Palette patches are supported over an existing complete palette; callers constructing a palette must still supply all 12 entries.
- Invalid colour values cannot be repaired by `var()` fallbacks. In development, an effect checks resolved root variables (including host references) and warns. Production emits no theme diagnostics. Later host-variable changes still apply without React work; diagnostics run when the skin changes, not on every arbitrary host CSS edit.
- `pitchColours` and `bar` are public data only in T1. `skinStyle` deliberately emits only theme variables.
- The browser audit disables transitions to measure settled colours, and closes the drawer with Escape before opening header dialogs.

## Open questions
None.

---
## Receiver ack
Lead to acknowledge through the ledger on main.

---
## Return
- **Outcome:** done
- **Commits:** receiver ack `2285978`; implementation `b1cc309794870a0468c43854960d46238b4c5999`; checkbox fallback correction `b194161`; this return document is committed separately.
- **What changed:** new pure skin module/public API, live root theme overrides, colour-token CSS audit, typed host fixture, and integrated regression validation.
- **Verification output:** both requested command chains passed (exit 0). The full suite ran first; the focused check/build/CSS/skin/reader checks were rerun after the checkbox fallback correction. A final build/CSS/skin run passed after restoring the original SVG annotation fills (no default-value changes). The broad suite was not repeated after these CSS-only corrections.

Full-suite tail:
```text
Instrument switch: reader settings switch both piano staves (clef, written pitch, ps-transposed / ps-out-of-range, host highlights), no double transposition, concert-basis rule passed
Instrument switch: playback plays alto sax program 66 at the fitted sounding pitch; unswitched transposing parts unchanged in both views passed
Instrument switch: full reader picker (Instrument and Sound sections, trumpet, harp sound, level and fit, as written, hidden by the host, drum kit) passed
Instrument switch: saved switch vs host settings (same host: the reader's flute; changed host: alto sax) passed
Instrument switch: octave tool (select, Shift/second-click passage, phrase, 8va/8vb, out of range, auto-fit kept as written, reset, Escape, focus, saved, hidden, embed menu and compact entry) passed
Instrument switch: chunked reader render moves tied notes across chunk boundaries; caches keyed by the spec passed
```

Final reader rerun tail:
```text
chromium: TimGM6mb fallback shares one soundfont download passed
chromium: ID-less MusicXML with a multi-measure rest intro passed
chromium: open dialog passed
chromium: score link passed
chromium: stave focus passed
chromium: options drawer layout and annotation sizes passed
chromium: endless with scrollbars passed
```

Final build/CSS/skin tail:
```text
 ✓ src/lib/skin.test.ts (4 tests) 18ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  09:51:57
   Duration  746ms (transform 65ms, setup 0ms, collect 48ms, tests 18ms, environment 0ms, prepare 149ms)

Skin: JS exports, typed fixture, literal CSS fallbacks, sentinel UI/drawer/dialog/mixer colours, live host variables and no re-engrave passed
```

`npm run check`: 0 errors, 0 warnings, 0 hints. `npm run test:manifest`: 128 local packs, 16 icons, playable voices, generated core and versions passed. `git diff --check` passed. Ownership audit of `git diff --stat main...HEAD` plus this return document contains only the declared T1 files and task handoffs.
- **Out-of-scope issues found:** none requiring changes.
- **Follow-ups:** proceed to T2 after other-family review and lead merge; T5 owns user documentation. No release/version bump performed.
- **For GBrain (lead to promote):** retain literal fallbacks for colour parity; native controls need `revert` fallbacks, not invented platform colours. Use `revert` only for properties that were browser defaults; it bypasses earlier author declarations. Audit settled computed colours and prove host variable changes preserve SVG identity/render count.
