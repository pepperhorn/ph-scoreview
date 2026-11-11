# Handoff: 0001-t5 — becreative fixture, docs and changelog (claude → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0001 · **Spec:** docs/specs/0001-composable-player-skins.md · **Plan:** docs/plans/0001-composable-player-skins.md (task T5)
- **Branch:** orch/0001-t5-skins-docs · **Dispatch handoff:** docs/handoffs/2026-11-11-0001-t5-skins-docs--lead-to-claude.md
- **Status:** ready for review

## Outcome
Spec AC8 and AC9 met. Docs and fixture only; no library source, `src/styles.css`, ledger or version changes.

- `apps/reader/src/embed/SkinTest.tsx`: `/embed-skin?becreative` renders becreative's three shapes: `bc-reader` (`chrome=full`), `bc-snippet` (`minimal`) with the spec's seven-item bar and `CRF_PITCH_COLOURS`, and `bc-static` (`none`, theme-only skin). Theme map: `accent`→`--accent-ink`, `accentWash`/`accentWashStrong`→`--accent-wash(-strong)`, `focusRing`→`--accent`.
- `apps/reader/src/embed/host.css`: becreative brand tokens and `.accent-blue/.accent-orange/.accent-pink` scopes copied from `becreative/src/styles/custom.css:785` and `global.css`.
- `validation/skin.mjs`: `assertBecreativeFixture` at 1280px and 390px: bar order (reader, snippet), no bar on static, no clipping or page scroll, play button colour and `--ps-accent`/wash/focus roles resolve for blue, orange and pink, and no re-engrave (same SVG nodes) on accent changes.
- `packages/pepperscore/README.md`: worked becreative example (TS skin, plain JS skin, usage across the three shapes). The three code blocks were extracted and type-checked with `tsc --strict --allowJs --checkJs`; a negative control (misspelt token and bar id with `@ts-expect-error`) also passed. Scratch files were deleted.
- `packages/pepperscore/CHANGELOG.md`: no change. Nothing user-visible changes in the library, so there is no Unreleased section.

## Verification
`npm ci && npx playwright-core install chromium`, then `npm run check && npm run build && npm run test:skin && npm run test:embed && npm run test:manifest && npm run test:validation`: **exit 0**, run on the final tree. `VALIDATION_BUDGET_SCALE=2 npm run test:skin` also passes (including the new becreative block). No timing gate failed at scale 1, so scale 2 was run only on `test:skin`.

## Decisions made
- **`focusRing` uses `--accent`, not `--accent-ring`.** becreative's `--accent-ring` is a box-shadow value (`0 0 0 3px rgb(...)`), not a colour, so it can't be a theme value. The spec's "focus: `--accent-ring`" line is not literally achievable. The spec's own example already uses `focusRing: 'var(--accent)'`. Suggest correcting the spec bullet.
- **`host.css` is injected with `?inline` only for the becreative fixture.** A plain import is hoisted by Astro into the page and its hostile reset (`body` colour, button resets) broke the existing `/embed-skin` assertions (`rgb(51,51,51)` vs `rgb(0,0,0)` at `validation/skin.mjs:342`). Baseline `main` passed, so this was my change; fixed.
- shapes map to chromes: reader=`full`, snippet=`minimal`, static=`none`. These shape names are becreative's; pepperscore has no such prop.

## For the ABC guide
None.

## Follow-ups
- Flake: one `node validation/skin.mjs` run timed out at `validation/skin.mjs:466` (`.ps-toast` wait, phone r1 block); the immediate rerun and the full run passed. Another session's validation was running on the same machine at the time. Not caused by this change (that block is unchanged).
- The becreative PR (stage 3 of the spec) can copy `becreativeSkin` from the README. It needs pepperscore ≥0.5.0, which is already published.

GBrain: unavailable (not used by implementers).
