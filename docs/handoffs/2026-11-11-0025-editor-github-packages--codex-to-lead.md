# Handoff: 0025 — Editor GitHub Packages and licence tooling (codex → lead)

- **Date:** 2026-11-11
- **Type:** return
- **Ledger:** 0025
- **Spec:** [0003 teaching layer](../specs/0003-teaching-layer.md)
- **Plan:** [0003 P1/P3](../plans/0003-teaching-layer.md)
- **Dispatch / committed acknowledgement:** [lead-to-codex](2026-11-11-0025-editor-github-packages--lead-to-codex.md), ack commit 011e2f5
- **Branch:** orch/0025-editor-github-packages
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-87b2cfd2-2d4523cb2011dbf8
- **Base commit:** 9602bd55a53997ffcf6c845f6c99a4e962ce54f0

## Goal and outcome
**Outcome:** implementation complete; full baseline validation is not green. Draft PR for review, not ready to merge.

Prepare @pepperhorn/pepperscore-editor for restricted GitHub Packages distribution, with a working external consumer and repository-only licence tools. Publishing and owner key rotation remain separate actions.

## Scope and files owned
- **In / changed:** editor package manifest, Vite library/declaration build configs, source entry CSS import, README, licence scripts and CLI regression test, Vitest include for that test; reader package/imports/CSS import/dev aliases/type paths; root build/check/test scripts and workspace-name lockfile changes; scripts/pack-editor.mjs; own 0025 handoffs.
- **Out:** publishing, key rotation and demo re-signing, pepperscore-pt, BeCreative, ledger, CI, viewer sources/styles/TAB, pepperscore README and CHANGELOG.
- Only owned paths changed. No dependency version changes.

## Acceptance criteria
- [x] Root build emits editor ESM, declarations and stylesheet under dist.
- [x] Fresh tarball consumer installs React, React DOM and the local pepperscore tarball, imports the editor in Node, type-checks with strict declarations, and builds both stylesheets with Vite.
- [x] Pack whitelist permits only dist, README and package.json (85 files).
- [x] Keygen/sign scripts and throwaway CLI round-trip test; README documents installation and signing.
- Browser/full-suite results below.

## Decisions made
- Match the existing Vite library + tsc declaration approach; externalize peer and runtime dependencies and their subpaths. Build declarations against pepperscore dist, avoiding leaked monorepo source paths.
- Reader dev keeps source aliases; root production build orders viewer → editor → reader.
- Keep the new pack consumer check as sibling npm run test:pack:editor to avoid expanding the existing three-host viewer pack check.
- Import CSS in the library entry so Vite extracts dist/style.css; consumers explicitly import the CSS export.
- Keep CLI tests as native JavaScript (Vitest includes .test.mjs), avoiding a new Node-types dependency. Tests create only temporary disposable pairs, remove them in finally, and never print/assert the private JWK value.
- Keygen uses exclusive create with mode 0600 and outputs only public fields; signing rejects invalid/past dates, invalid caps and non-Ed25519 keys. Errors omit key contents.
- No real signing key was generated, printed or committed. No registry publish was attempted.

## Known gotchas / open questions
GBrain consulted: projects/scoreflow-music-reader (project context; no packaging-specific guidance returned). Implementer did not write GBrain.

No implementation questions remain. Validation failures below remain for lead/reviewer assessment; none is established as pre-existing. **Owner rotation TODO:** README explicitly marks replacement of DEFAULT_LICENCE_PUBLIC_KEY_JWK and re-signing the demo after the owner supplies public material. Neither was changed. Registry access: restricted does not prove live private visibility or access grants: the publisher must confirm those in GitHub Packages. CLI tools intentionally stay in the checkout and are excluded from the tarball.

## Verify with
    npm ci && npx playwright-core install chromium
    npm run check && npm run build && npm run test:manifest && npm run test:validation
    npm run test:editor && npm run test:editor-browser && npm run test:editor-phone
    npm run test:pack:editor
    npm pack --dry-run -w @pepperhorn/pepperscore-editor

## Follow-ups / for GBrain (lead to promote)
Owner supplies rotated public JWK and demo licence, then issues BeCreative's licence. Human logs in and publishes separately, confirms private package visibility/access, and can begin 0003 T4 in pepperscore-pt after release. Source dev accepts dev; the built tarball rejects it (pack consumer assertion).

## Verification output

```text
npm ci && npx playwright-core install chromium: exit 0
npm run check: exit 0 (Astro: 23 files, 0 errors/warnings/hints)
npm run build: exit 0
Demo build uses the library dist (worker chunks and Verovio files match) and ships its notices
GM manifest: 128 local packs, 16 icons and playable voices verified.
Sound packs: complete pack.json, generated core (19 FluidR3 sounds) and versions passed
npm run test:editor: exit 0
Test Files 28 passed (28); Tests 295 passed (295)
npm run test:pack:editor: exit 0
Editor pack: 85 allowed files; fresh consumer ESM import, declarations, CSS and Vite build passed; production dev licence rejected.
npm pack --dry-run -w @pepperhorn/pepperscore-editor: exit 0
npm notice total files: 85
npm run test:validation: exit 1 at viewer tests (5-second timeout)
Earlier components passed: api, audio, clock, css, skin, assets, sounds, spelling, transpose, document, parser-diff, score-db, performance, clock-contract.
Viewer default-worker attempt 1: 699 passed, 1 timed out (document-keysig, 6056 ms vs 5000 ms).
Viewer default-worker attempt 2: 699 passed, 1 timed out (verovio-warmup); document-keysig passed.
Remaining components run individually, without changing code, budgets or assertions:
RESULT npm run test:editor-browser: 1
RESULT npm run test:editor-phone: 0
RESULT npm run test:reader: 1
RESULT npm run test:chunks: 0
RESULT npm run test:large: 1
RESULT npm run test:guardrails: 0
RESULT npm run test:embed: 0
RESULT npm run test:clock-embed: 0
RESULT npm run test:layout: 0
RESULT npm run test:tab: 0
RESULT npm run test:tab-bake: 0
RESULT npm run test:instrument-switch: 0
RESULT npm run test:pdf: 0
RESULT viewer tests with one worker: 0
npm run test -w pepperscore -- --maxWorkers=1: 18 files passed, 700 tests passed
```

The single full chain did not pass. Its remaining components were run separately so no later check was skipped. All runs used default timing budgets. Failures:

- First desktop editor run: momentum-scroll cursor assertion (1 follow scroll, expected 0). Retry passed that assertion but failed redraw timing (991 ms, limit 800 ms).
- Reader: Ensemble playback sampled 117 frames, below the assertion at validation/reader.mjs:1025.
- Large score: highlight latency 1037 ms, limit 500 ms (validation/large-score.mjs:169).
- Viewer default-worker unit timeouts disappear with one worker. This is evidence of sensitivity to concurrency, not proof of baseline behaviour.

No validation scripts, thresholds, viewer sources or tests were altered to bypass these failures.

Final desktop editor retry also exited 1 with unchanged default budget:

    AssertionError [ERR_ASSERTION]: every change-to-redraw time is under 800 ms (got 1032, 442, 299, 67, 49, 312, 686, 496, 451) Loaded host? Re-run with VALIDATION_BUDGET_SCALE greater than 1 (current 1); CI budgets remain the baseline.
