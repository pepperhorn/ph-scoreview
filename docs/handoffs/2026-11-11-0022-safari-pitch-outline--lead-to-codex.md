# Handoff: 0022 — [quick] Safari draws pitch-colour outlines solid black (S31) (lead → codex)

- **Date:** 2026-11-11
- **Type:** quick
- **Ledger:** 0022 (suggestion S31) — for 0.5.1
- **Branch:** orch/0022-safari-pitch-outline · **Worktree:** created by T3
- **Base commit:** 15135bd
- **Status:** open

## Goal
In Safari/WebKit the on-screen reader draws pitch-colour notehead outlines solid black and ignores `--ps-pitch-outline` (default `rgba(0,0,0,.65)`); Chromium and Firefox are right, and the PDF is right (PR #87 review, `gh pr view 87 --comments`). The rules are in `packages/pepperscore/src/styles.css` ~476–487: `stroke:var(--ps-pitch-outline,rgba(0,0,0,.65)); stroke-width:18; paint-order:stroke fill` on `.notehead[data-pitch=…]`. Find why WebKit loses the colour/opacity (e.g. Verovio's `<use>`-referenced glyphs not inheriting a custom-property stroke in WebKit, or stroke-opacity handling) and fix it so all three browsers match. `BROWSER=webkit node validation/pdf.mjs` fails at `validation/pdf.mjs:511` on main because of this.

## Files you own
`packages/pepperscore/src/styles.css` (pitch-colour rules only), `packages/pepperscore/src/lib/render.ts` (only if the fix must set an attribute on the notehead/use element), `validation/pdf.mjs` (only to make the webkit parity check pass, not to weaken it), `validation/skin.mjs` is NOT yours (0001-T5). Your own 0022 handoff files.

## Acceptance criteria
- [ ] Rasterised notehead outline colour/thickness match across chromium, firefox and webkit (screen), and `BROWSER=webkit node validation/pdf.mjs` passes; chromium/firefox unchanged.
- [ ] Host-set `--ps-pitch-outline` honoured in all three.

## Verify with
```bash
npm ci && npx playwright-core install chromium firefox webkit   # webkit deps are installed on this machine
npm run check && npm run build && npm run test:pdf && BROWSER=firefox node validation/pdf.mjs && BROWSER=webkit node validation/pdf.mjs && npm run test:skin && npm run test:css
```
Run everything locally; push once when green (CI minutes cost money).

---
## Receiver ack

Acknowledged 2026-11-11: fix WebKit's on-screen pitch-colour outline so default and host-set `--ps-pitch-outline` rasterise consistently with Chromium/Firefox, retaining PDF parity and thickness. I own only the pitch-colour CSS, narrowly necessary render attributes, PDF validation, and these 0022 handoffs. I will run all requested browser checks locally and push once with a draft PR. No open scope questions. GBrain searched: `projects/scoreflow-music-reader` (general project background; no Safari-specific fix found).
