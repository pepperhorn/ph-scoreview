# Handoff: 0001-t1 — Skin module and theme tokens (codex → lead)

- **Date:** 2026-11-01
- **Type:** return
- **Ledger:** 0001 · **Spec:** [0001-composable-player-skins](../specs/0001-composable-player-skins.md) · **Plan:** [0001-composable-player-skins](../plans/0001-composable-player-skins.md), T1
- **Dispatch:** [lead-to-codex](2026-11-01-0001-t1-skin-module-and-tokens--lead-to-codex.md)
- **Branch:** orch/0001-t1-skin-tokens
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-66013276
- **PR:** https://github.com/pepperhorn/ph-scoreview/pull/59 (draft; no watching or polling)
- **Latest review:** [5725696819](https://github.com/pepperhorn/ph-scoreview/pull/59#pullrequestreview-5725696819), reviewed head `a0e55f223f8ac2448759673f4d6a7b6782f98549`
- **Earlier review:** [5725514359](https://github.com/pepperhorn/ph-scoreview/pull/59#pullrequestreview-5725514359); its four fixes remain covered.
- **Prior review:** [5725393241](https://github.com/pepperhorn/ph-scoreview/pull/59#pullrequestreview-5725393241); its seven fixes remain covered.
- **Base commit:** 3396bbf (dispatch), pinned task base 320bd6f9913854ddf88d06cf3b863ba168c5096c
- **Port:** 5211 on 0.0.0.0 only during the temporary development-consumer validation; closed in finally. Other checks use the built-dist test server.
- **Status:** closed

## Goal
Deliver T1's plain-data skin API and live theme overrides without changing default rendering or requiring a Node global in browser hosts. Apply only the approved inline-try development-warning fix and retain the accepted T1 changes. Later tasks implement bar composition, drawer additions, pitch colouring and release documentation.

## Context you need
The linked spec and plan are authoritative. The lead explicitly decided that `playback` also recolours `.reader-note.is-playing`: these are interface marks, with today's colours retained as fallbacks. Ownership otherwise remains T1's list. GBrain consulted: `default:projects/scoreflow-music-reader` (historical context). Implementers do not write to GBrain; the lead promotes the notes below.

## Scope
- **In:** T1 skin interfaces/public exports, theme-only prop/root styles, colour audit, typed host fixture and JS/browser/unit validation, plus playback interface marks in `styles.css` per the lead decision.
- **Out:** bar rendering, new toggles, drawer changes, pitch colouring, version/release and README/changelog work.
- **Files owned:** `packages/pepperscore/src/lib/skin.ts`, `packages/pepperscore/src/lib/skin.test.ts`, `packages/pepperscore/src/styles.css`, `packages/pepperscore/src/components/open-score-dialog.css`, `packages/pepperscore/src/index.ts`, `packages/pepperscore/src/components/PepperScore.tsx` (prop/root theme integration only), `apps/reader/src/embed/SkinTest.tsx`, `apps/reader/src/pages/embed-skin.astro`, `validation/skin.mjs`, root `package.json` (skin scripts), and the two task handoffs.
- **Do not touch:** other files, particularly `render.ts`, `chrome.ts`, and the ledger. Those remain unchanged on this branch.

## Approved latest fix (review 5725696819)
The warning check is inside an inline `try` in the theme effect, exactly as tested by the reviewer:
```ts
try {
  if (process.env.NODE_ENV !== 'production' && rootRef.current) warnInvalidTheme(rootRef.current, skin);
} catch {
  // No process global: not a known development host, so skip the diagnostic.
}
```
Vite/Astro can replace the environment expression in development and remove the warning in production, while a native host without `process` skips it without throwing. The plain Vite development fixture now has neither a runtime process shim nor forced environment defines; it explicitly asserts `typeof process === 'undefined'` and still expects the warning. It runs before the native fixture's dependency-only build so build-mode initialisation cannot contaminate the dev check. The process-read audit also accepts an enclosing `try` block with a catch. The native-host helper and production assertions are unchanged.

**T2:** use this inline `try` for unknown-bar-id development diagnostics. Do not copy the earlier `typeof process` gate: it silences warnings in ordinary Vite/Astro browsers. Do not hide the environment test in a helper: the reviewer demonstrated that doing so retained the warning string in production bundles.

## Accepted prior findings (r2)
1. **High — missing `process` global:** the earlier short-circuit guard stopped native-host crashes; the latest inline-try fix above supersedes it to restore ordinary dev-host diagnostics. The type-only declaration is not treated as a runtime shim. The new native ESM regression serves the built `dist/index.js` byte-for-byte, with an import map and only its dependencies prebundled. It first reproduced `process is not defined` against the reviewed build. It now proves both the player and a host sibling stay mounted after effects with no global `process`, with and without a skin. Separate explicit development/production shims verify runtime diagnostics. Production host bundles still remove the diagnostic. A TypeScript AST audit checks every free package-source `process` read for a short-circuit guard or enclosing try/catch; the only runtime access is the guarded effect.
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
- Unknown environments must skip diagnostics safely. Consumer-time `NODE_ENV` reads must remain safe without a runtime `process`. T2 must use the inline-try form above so normal development hosts still warn and production bundles can remove the diagnostic.
- The native-host fixture prebuilds dependencies only; a response-byte comparison protects against silently transforming the library under test. Its unshimmed cases assert `typeof process === 'undefined'` after loading. Shimmed cases are explicitly labelled.
- Vite's dependency-only build can initialise the validation process's environment. The development-consumer fixture now runs first as a plain unshimmed Vite host, without forced defines. Only the separate native-host matrix keeps its explicitly labelled development/production shims.
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
- **Outcome:** done; the one approved warning fix is verified
- **Commits:** this round starts from reviewed head `a0e55f2`; only the warning effect, its validation and this return handoff change. Earlier accepted code remains unchanged.
- **What changed:** the one approved inline-try warning fix, an unshimmed dev test, try/catch audit support, and corrected T2 advice. No styles, other features or native-host helper changes.
- **Verification output:** `npm run check && npm run build && npm run test:skin && npm run test:reader` passed (exit 0) on code head `c007b2c6e0ac433d50aa2edeed94d6e8d4310464`. Only the handoff changes afterward. Check: 0 errors/warnings/hints; skin unit tests: 5 passed. The plain Vite dev test warns with `typeof process === 'undefined'`, the production host contains no diagnostic string, and the unchanged native ESM no-process matrix passes. Scope against reviewed head a0e55f2 is exactly the component effect, validation file and return handoff; no style or other feature changes. `git diff --check` passed.

```text
Skin native ESM: unchanged dist mounts with/without skin and no process global; explicit development/production shims gate diagnostics
Skin focus: Tab reaches every focusable control including select, both ranges, checkbox, textarea and link; no-skin and accent-only outlines match original defaults
Skin: JS exports, typed fixture, static colour guard, desktop/mobile/all-chrome/icon and modern-colour audit, consumer dev/prod diagnostics, live host variables and no re-engrave passed
chromium: TimGM6mb fallback shares one soundfont download passed
chromium: ID-less MusicXML with a multi-measure rest intro passed
chromium: open dialog passed
chromium: score link passed
chromium: stave focus passed
chromium: options drawer layout and annotation sizes passed
chromium: endless with scrollbars passed
```
The broader manifest/full-validation command was not rerun in this explicitly limited round; its earlier successful r2 run remains historical evidence.
- **Out-of-scope issues found:** none requiring changes.
- **Follow-ups:** lead's other-family re-review/merge, then T2. T5 owns final documentation. No release/version bump; no CI/review watching or polling.
- **For GBrain (lead to promote):** use inline try/catch for environment-gated diagnostics so ordinary dev hosts warn, production removes the code and native hosts remain safe; test distributed libraries untransformed in native ESM hosts as well as bundled hosts; a bundler can hide Node-global requirements. Exercise every native control's keyboard state and compare defaults with the override rules removed. Validate variable names, including nested and scale references, before masking fallback literals.
