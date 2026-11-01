# Handoff: 0001-t1 — Skin module and theme tokens (codex → lead)

- **Date:** 2026-11-01
- **Type:** return
- **Ledger:** 0001 · **Spec:** [0001-composable-player-skins](../specs/0001-composable-player-skins.md) · **Plan:** [0001-composable-player-skins](../plans/0001-composable-player-skins.md), T1
- **Dispatch:** [lead-to-codex](2026-11-01-0001-t1-skin-module-and-tokens--lead-to-codex.md)
- **Branch:** orch/0001-t1-skin-tokens
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-66013276
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/59 (draft; no watching or polling)
- **Latest review:** [5725514359](https://github.com/pepperhorn/ph-scoreview/pull/59#pullrequestreview-5725514359), reviewed head `61ef6b2cb2fe372a5a672670b2a68bad4a99d9b5`
- **Prior review:** [5725393241](https://github.com/pepperhorn/ph-scoreview/pull/59#pullrequestreview-5725393241); its seven fixes remain covered.
- **Base commit:** 3396bbf (dispatch), pinned task base 320bd6f9913854ddf88d06cf3b863ba168c5096c
- **Port:** 5211 on 0.0.0.0 only during the temporary development-consumer validation; closed in finally. Other checks use the built-dist test server.
- **Status:** closed

## Goal
Deliver T1's plain-data skin API and live theme overrides without changing default rendering or requiring a Node global in browser hosts. Address all four latest review findings and retain the earlier fixes. Later tasks implement bar composition, drawer additions, pitch colouring and release documentation.

## Context you need
The linked spec and plan are authoritative. The lead explicitly decided that `playback` also recolours `.reader-note.is-playing`: these are interface marks, with today's colours retained as fallbacks. Ownership otherwise remains T1's list. GBrain consulted: `default:projects/scoreflow-music-reader` (historical context). Implementers do not write to GBrain; the lead promotes the notes below.

## Scope
- **In:** T1 skin interfaces/public exports, theme-only prop/root styles, colour audit, typed host fixture and JS/browser/unit validation, plus playback interface marks in `styles.css` per the lead decision.
- **Out:** bar rendering, new toggles, drawer changes, pitch colouring, version/release and README/changelog work.
- **Files owned:** `packages/pepperscore/src/lib/skin.ts`, `packages/pepperscore/src/lib/skin.test.ts`, `packages/pepperscore/src/styles.css`, `packages/pepperscore/src/components/open-score-dialog.css`, `packages/pepperscore/src/index.ts`, `packages/pepperscore/src/components/PepperScore.tsx` (prop/root theme integration only), `apps/reader/src/embed/SkinTest.tsx`, `apps/reader/src/pages/embed-skin.astro`, `validation/skin.mjs`, root `package.json` (skin scripts), and the two task handoffs.
- **Do not touch:** other files, particularly `render.ts`, `chrome.ts`, and the ledger. Those remain unchanged on this branch.

## Latest review fixes
1. **High — missing `process` global:** the warning effect now uses `typeof process !== 'undefined' && process.env.NODE_ENV !== 'production'`. The type-only declaration is not treated as a runtime shim. The new native ESM regression serves the built `dist/index.js` byte-for-byte, with an import map and only its dependencies prebundled. It first reproduced `process is not defined` against the reviewed build. It now proves both the player and a host sibling stay mounted after effects with no global `process`, with and without a skin. Separate explicit development/production shims verify runtime diagnostics. Production host bundles still remove the diagnostic. A TypeScript AST audit checks every free package-source `process` read for a real short-circuit guard; the only runtime access is the guarded effect.
2. **Medium — native focus outlines:** the native focus selector now covers `button,input,select,textarea,a`. Its only property is `outline-color:var(--ps-focus-ring,revert)`, so an absent token preserves native colours. Authored, more specific focus rules retain priority. The audit uses actual Tab traversal through every focusable control with the drawer open and asserts each visible outline is the sentinel. It explicitly requires visits to select, header range, drawer range, checkbox, textarea, link and button controls. The old build reproduced a select outline of `rgb(16,16,16)` under the sentinel skin. Default proof now tabs through all of these before and after removing the new native rules, comparing focused paint plus outline colour/style/width/offset. It runs both with no skin and with an accent-only skin lacking `focusRing`.
3. **Low — remaining accent roles:** drag-over border/background use `accent`/`accentWash`; the visible drag overlay also uses the wash so it does not cover the themed background with green. A real drag-enter/drag-over event verifies both visible overlay and dropzone colours. The primary octave toolbar border uses `accent`; all four `accent-color` rules use `accent`. Static role assertions cover these rules, and browser checks verify native range/checkbox fills follow the blue host. Every original literal fallback remains unchanged.
4. **Low — unknown variable names:** the static guard now registers `THEME_TOKENS` through `tokenVariable`, the actual derived `-aXX` declarations on `.pepperscore` with registered bases, and the existing score-mark/scale variables. It validates declarations and every reference before colour masking or engraved-SVG exemptions. Tests reject `--ps-acent`, nested misspellings, undeclared alpha names and misspelled SVG scale names; they accept registered theme, mark, scale and derived names.

## Self-check against the spec
- **AC1:** native ESM no-process hosts remain mounted without a skin. Default CSS fallback comparison against 320bd6f still succeeds. All focused native/author styles match the original rules when `focusRing` is absent, including with another skin colour supplied. Default reader/embedding behaviour is covered by the full suite.
- **AC5:** the static guard checks both stylesheet colour literals and variable names. Browser audits cover all chrome presets, desktop, 390px/More, icons, hover, every keyboard-focusable control, drawer and dialogs. Named/modern CSS colours are normalised; negative tests prove icon-only modern-colour leaks are caught. Only note-name/count/chord annotation fills are exempt engraved colours; playing-note marks have dedicated assertions.
- **AC6:** host variable changes, skin replacement/removal and equal inline objects preserve score SVG identity and render counts. Viewport resize checks run afterward so legitimate resize engraving is separate from theme-only assertions. No engraving dependencies changed.
- **AC8d:** the reader's tsc fixture still enforces expected errors for invalid theme/bar names, plain JS imports the built root API, and all five skin unit tests remain active, including the complete-palette guarantee.

## Previous fixes retained
- Nineteen public theme roles, including `accentWashStrong`; hover/selected colours use accent roles and neutral panels retain neutral roles.
- Literal defaults remain per use. Internal `--ps-*-aXX` variables preserve shadow/glow alpha under opaque overrides; an unset base leaves each original full-colour fallback intact. Selected ambient shadows use `shadow`, selected rings use `accent`, and playback/focus glows have dedicated roles.
- `playback` colours cursor, line/glow and playing-note fill/stroke/glow. Existing cursor overrides retain their priority. Engraved annotation fills remain unchanged.
- `mergeSkins` validates the final accumulated palette and throws on incomplete results. Complete palettes can be introduced on an empty base; partial patches work over complete palettes. No unsafe complete-palette cast remains.
- Persistent stylesheet hash pins were removed. The reusable static guard accepts legitimate stylesheet additions while rejecting hard-coded interface colours.

## Verify with
```bash
npm run check && npm run build && npm run test:css && npm run test:skin && npm run test:reader
npm run check && npm run build && npm run test:manifest && npm run test:validation
```
The full chain includes CSS, skin and reader checks. Native/browser regressions and the process/variable audits are part of `test:skin`.

## Known gotchas / decisions made
- Unknown environments must skip diagnostics safely. Consumer-time `NODE_ENV` is not permission to read an absent runtime `process`. T2 must use the guarded form for development warnings.
- The native-host fixture prebuilds dependencies only; a response-byte comparison protects against silently transforming the library under test. Its unshimmed cases assert `typeof process === 'undefined'` after loading. Shimmed cases are explicitly labelled.
- Vite's dependency-only build can initialise the validation process's environment. The development-consumer fixture explicitly selects development defines for both Vite and its dependency optimiser, and explicitly supplies its runtime process shim. It does not represent an unshimmed host.
- `revert` bypasses earlier author declarations, so preserve selector specificity and compare focused states, not only idle controls. Do not override the already-authored checkbox accent with `revert`.
- New T2/T4 variables must be deliberately registered in the static guard. A `--ps-` prefix alone is insufficient. Derived alpha variables are private, not new public tokens.
- Theme variables stay on the player root, host references resolve through CSS, and `skinKey` normalises data identity. `bar` and `pitchColours` remain data only in T1; `skinStyle` emits theme variables only.

## Open questions
None.

---
## Receiver ack
Lead to acknowledge through the ledger on main.

---
## Return
- **Outcome:** done; all four latest review findings addressed
- **Commits:** reviewed head `61ef6b2`; runtime/focus/name/role fixes `f9c4988`; visible drag-overlay refinement `5fd2219`. The return-document update follows verification.
- **What changed:** guarded raw browser hosts, actual all-control keyboard/default-outline coverage, corrected remaining accent states and strict variable-name registration, within the original owned files.
- **Verification output:** fresh full `npm run check && npm run build && npm run test:manifest && npm run test:validation` passed (exit 0) on implementation head `5fd2219b43c45823019538c7c1f0fd58b659e577` after the final overlay correction. Only this handoff changes afterward. Check: 0 errors/warnings/hints. Skin: 5 tests; library: 76 tests; editor: 273 tests. Ownership from the merge base and `git diff --check` passed; no protected-file changes.

```text
Skin native ESM: unchanged dist mounts with/without skin and no process global; explicit development/production shims gate diagnostics
Skin focus: Tab reaches every focusable control including select, both ranges, checkbox, textarea and link; no-skin and accent-only outlines match original defaults
Skin: JS exports, typed fixture, static colour guard, desktop/mobile/all-chrome/icon and modern-colour audit, consumer dev/prod diagnostics, live host variables and no re-engrave passed
packages/pepperscore/src/styles.css: one-off default fallback comparison to 320bd6f passed
packages/pepperscore/src/components/open-score-dialog.css: one-off default fallback comparison to 320bd6f passed
```

Full command tail (also pasted in the PR reply):
```text
Instrument switch: MEI clef mapping (treble, bass, alto, tenor, treble 8vb) passed
Instrument switch: chunked spelling moves both tied notes and drops the source clef changes passed
Instrument switch: reader settings switch both piano staves (clef, written pitch, ps-transposed / ps-out-of-range, host highlights), no double transposition, concert-basis rule passed
Instrument switch: playback plays alto sax program 66 at the fitted sounding pitch; unswitched transposing parts unchanged in both views passed
Instrument switch: full reader picker (Instrument and Sound sections, trumpet, harp sound, level and fit, as written, hidden by the host, drum kit) passed
Instrument switch: saved switch vs host settings (same host: the reader's flute; changed host: alto sax) passed
Instrument switch: octave tool (select, Shift/second-click passage, phrase, 8va/8vb, out of range, auto-fit kept as written, reset, Escape, focus, saved, hidden, embed menu and compact entry) passed
Instrument switch: chunked reader render moves tied notes across chunk boundaries; caches keyed by the spec passed
```
- **Out-of-scope issues found:** none requiring changes.
- **Follow-ups:** lead's other-family re-review/merge, then T2. T5 owns final documentation. No release/version bump; no CI/review watching or polling.
- **For GBrain (lead to promote):** test distributed libraries untransformed in native ESM hosts as well as bundled hosts; a bundler can hide Node-global requirements. Exercise every native control's keyboard state and compare defaults with the override rules removed. Validate variable names, including nested and scale references, before masking fallback literals.
