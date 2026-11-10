# Handoff: 0011 — Validation harness reliability (codex → lead)

- **Date:** 2026-11-10
- **Type:** return
- **Ledger:** 0011 (quick; no spec/plan)
- **Dispatch:** [lead → codex](2026-11-10-0011-validation-harness-reliability--lead-to-codex.md)
- **Branch:** orch/0011-validation-harness
- **Worktree:** /home/shaun/.t3/worktrees/ph-vexflow-view/t3-c5df7858
- **Base:** fa09b52 (contains pinned 31b29b5)
- **Implementation commits:** 731e665, 8c52cb1; receiver ack 8b6d8ec
- **PR:** draft against main, opened after committing this return; linked in the delivery message.
- **Status:** closed · **Outcome:** done

## Goal and scope
Isolate validation servers across worktrees, provide explicit load scaling for timing gates, and fix the custom-layout click race in the harness. No app/library changes or ABC import behavior changes.

**Owned files changed:** validation/{clock-contract,document,editor,instrument-switch,large-score,parser-diff,performance,score-db,tab,transpose}.mjs; new validation/lib/{ports,budgets}.mjs; the two 0011 handoffs. No changes to skin.mjs, pdf.mjs, CI, dependencies, ledger, or other docs.

## What changed / decisions made
- Eight Vite harnesses use one checked ephemeral-port helper with `--strictPort`. Existing node:http servers already use `listen(0)` and remain unchanged. The helper waits for its own child's listening announcement before HTTP readiness probes, rejects early exit/startup timeout, drains output, and kills failed startup children. This prevents a failed child being mistaken for another worktree's server.
- Removed document.mjs's DOCUMENT_URL fallback: this private-server test must use its own server to prove isolation.
- Shared `VALIDATION_BUDGET_SCALE` defaults to 1 in CI and locally; rejects nonfinite/nonpositive values. Local timing failures name the variable and current multiplier. No median sampling: every editor redraw remains gated. PS_EDITOR_RENDER_MS remains supported.
- Preserved the existing large-score 2x CI baseline, multiplied by the shared scale: default CI first-paint 30s, long-task 400ms, highlight-lag 1000ms; local 15s/200ms/500ms. Editor's default failure threshold remains 800ms everywhere. Replaced LARGE_SCORE_BUDGET_SCALE with the shared variable. CI workflow unchanged.
- clickNote now waits for a nonzero notehead rectangle and reads its center atomically, then uses the original coordinate click. A locator.click experiment was rejected because stave-line SVG paths intercept its actionability check; no app behavior was changed.

## Acceptance criteria / verification
- [x] Owned fixed ports removed; all eight Vite spawns use checked ephemeral ports and --strictPort.
- [x] Two independent shell processes running `npm run test:document` concurrently both exited 0 (logs /tmp/0011-document-{a,b}.log). Two simultaneous helper servers also returned distinct ports (34771 and 46537), both answered HTTP 200, and both had --strictPort.
- [x] Deterministic bind-race probe: occupied the probed port immediately after probe.close; startVite rejected with "Port ... is already in use". No attachment or auto-increment.
- [x] Shared scale/default/invalid-value/hint probes passed, including CI default 1 without local hints. A real parallel editor run reproduced 881ms >800ms and printed the VALIDATION_BUDGET_SCALE hint; `VALIDATION_BUDGET_SCALE=2 npm run test:editor-browser` passed. The final full-suite editor run also passed at scale 1 (worst 469ms).
- [x] `npm ci && npx playwright-core install chromium` exited 0.
- [x] `npm run check && npm run build && npm run test:manifest && npm run test:validation` all exited 0 (check/build/manifest were chained; full validation invoked next at default scale 1). All 28 validation scripts passed, including 162 library and 277 editor unit tests.
- [x] Syntax checks for every changed .mjs, ownership audit, and `git diff --check` passed.

Verification output (logs /tmp/0011-{check,build,manifest,validation}.log):
```text
Result (22 files):
- 0 errors
- 0 warnings
- 0 hints
[build] 10 page(s) built in 3.33s
[build] Complete!
Demo build uses the library dist (worker chunks and Verovio files match) and ships its notices
GM manifest: 128 local packs, 16 icons and playable voices verified.
Sound packs: complete pack.json, generated core (19 FluidR3 sounds) and versions passed
Test Files  10 passed (10)
     Tests  162 passed (162)
Test Files  25 passed (25)
     Tests  277 passed (277)
chromium: 5.0 MB, 150 measures x 30 parts: first paint 2273 ms, 150 systems, drawn [0], heap 38 MB
chromium: import shown after 1624 ms; main-thread long tasks during import: [88,88,63]
chromium: playback highlight in the next, undrawn system 139 ms after its bar began
Instrument switch: chunked reader render moves tied notes across chunk boundaries; caches keyed by the spec passed
```

Exact required commands for reviewer reproduction:
```bash
npm ci && npx playwright-core install chromium
npm run check && npm run build && npm run test:manifest && npm run test:validation
# Optional local host-load allowance:
VALIDATION_BUDGET_SCALE=2 npm run test:validation
```


## Port audit
```bash
rg -n '(listen\(|--port|\bport\s*[:=]\s*[0-9]{2,})' scripts validation --glob '!skin.mjs' --glob '!pdf.mjs'
rg -n '(https?://(localhost|127\.0\.0\.1):[0-9]{4,5}|\bport\s*[:=]\s*[0-9]{2,})' validation scripts --glob '*.mjs' --glob '!skin.mjs' --glob '!pdf.mjs'
```
First command lists only existing listen(0) servers, the shared helper's strict dynamic Vite port, and scripts/pack-smoke.mjs's existing ephemeral probe. Second command has no matches (exit 1). Protected skin.mjs still contains a fixed 5212 warning-host URL; left for PR #72's owner. No other fixed ports found in validation/scripts.

## Known gotchas / out-of-scope issues
GBrain read: `projects/scoreflow-music-reader` (project context; repo dispatch is authoritative). No implementer GBrain writes. Large-score's pre-existing CI allowance is deliberately retained to meet "timing gates unchanged in CI".

## Open questions / follow-ups
None blocking. Lead: review the draft PR and reconcile the protected skin.mjs port independently. For the ABC guide: no update required; this changes validation harness behavior only.

## For GBrain (lead to promote)
Parallel validation must prove its own Vite child actually bound before probing HTTP; strictPort alone plus an HTTP readiness loop can otherwise accept a different server. Local explicit timing scaling retains baseline defaults and makes host-load failures actionable.
