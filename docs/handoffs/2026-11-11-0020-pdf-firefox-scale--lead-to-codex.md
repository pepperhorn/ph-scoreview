# Handoff: 0020 — [quick] PDF export in Firefox: notation ~10× too large (S22) (lead → codex)

- **Date:** 2026-11-11
- **Type:** quick
- **Ledger:** 0020 (suggestion S22) — blocks the 0.5.0 release (human decision)
- **Branch:** orch/0020-pdf-firefox-scale · **Worktree:** created by T3
- **Base commit:** 10a018e
- **Status:** closed

## Goal
In Firefox, exported PDFs draw the notation ~10× too large and off the page; Chromium is correct. Diagnosis from PR #78's review (`gh pr view 78 --comments`, r3): the export lays pages out in an offscreen element with no width/height (`packages/pepperscore/src/lib/pdf/compose.ts:20`, `export.ts:24`); Firefox then returns an identity transform (CTM) where Chromium returns the viewBox scale, and both the nested-viewport flattening and the outline-scale code depend on it. Likely fix: give the offscreen root SVG/host explicit physical width/height (from the paper size) before measuring, or compute the scale from viewBox/width attributes instead of the CTM. Repro: `BROWSER=firefox node validation/pdf.mjs` fails at "PDF contains full-size horizontal staff paths".

## Files you own
`packages/pepperscore/src/lib/pdf/**`, `validation/pdf.mjs` (make the suite run under `BROWSER=firefox` and `BROWSER=webkit` too, and add npm scripts `test:pdf:firefox`/`test:pdf:webkit` in the root `package.json` — scripts only), your own 0020 handoff files. Don't touch `components/**` (PR #83 in flight) or CI.

## Acceptance criteria
- [ ] `npm run test:pdf` passes on chromium, firefox and webkit (rasterised staff size and outline checks included); report webkit honestly if its local build is unusable.
- [ ] Chromium output unchanged (compare a rasterised page before/after).

## Verify with
```bash
npm ci && npx playwright-core install chromium firefox webkit   # from the repo root
npm run check && npm run build && npm run test:pdf && BROWSER=firefox node validation/pdf.mjs && BROWSER=webkit node validation/pdf.mjs
```

---
## Receiver ack
Acknowledged by Codex, 2026-11-11: fix Firefox PDF notation sizing within pdf/**, validation/pdf.mjs, root package.json scripts, and my 0020 handoffs only. Preserve Chromium raster output, exercise staff geometry and pitch outlines on Chromium/Firefox/WebKit, and report any unusable WebKit runtime honestly. No components or CI changes; no ABC import changes. Verify the required commands, commit a return handoff, push only orch/0020-pdf-firefox-scale, and open a draft PR. No open scope questions. GBrain project lookup performed; relevant context will be recorded in the return handoff.
