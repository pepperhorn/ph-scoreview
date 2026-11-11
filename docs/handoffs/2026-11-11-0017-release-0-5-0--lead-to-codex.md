# Handoff: 0017 — Release pepperscore 0.5.0: CHANGELOG and version (lead → codex)

- **Date:** 2026-11-11
- **Type:** quick
- **Ledger:** 0017
- **Branch:** orch/0017-release-0-5-0 · **Worktree:** created by T3
- **Base commit:** 9d3c36e
- **Status:** open

## Goal
Prepare the `pepperscore` 0.5.0 release (human-approved): bump `packages/pepperscore/package.json` (and the matching entry in the root `package-lock.json`) from 0.4.1 to 0.5.0 and add a `## 0.5.0 - 2026-11-11` section to `packages/pepperscore/CHANGELOG.md`, in the existing style (Added / Changed / Fixed), covering everything merged into `packages/pepperscore` since 0.4.1. Publishing is NOT part of this task (the human runs `npm login` and the lead gives the publish command separately).

## Context you need
- `git log --merges --first-parent 0.4.1-ish..HEAD` — find the 0.4.1 publish point from the CHANGELOG/ tags (`git tag`, or the commit that set version 0.4.1) and list merged PRs. Relevant items (read their return handoffs in `docs/handoffs/` for user-facing wording): 0001 T1–T4 (skins, composable bar, drawer controls, pitch colours), 0004–0010 (ABC import parity, ABC README), 0011 (validation harness — internal, skip), 0012 (octave clefs), 0013 T1–T2 (string-instrument TAB, `settings.tabInstruments`; fretless chart module internal), 0016 + 0018 (instrument name rules), 0002 T1–T2 (PDF engine — **not yet reachable from the UI**; mention only as internal groundwork or omit; check that `jspdf`/`svg2pdf.js` are dependencies and are lazy-loaded so the note is accurate).
- Note **behaviour changes** for existing users: bare "Bass" → bass guitar with TAB; "Alto 1"-style names → voices; TAB only on string parts (no piano fallback); `tabTuning` applies only to parts with matching string count; octave-clef ABC now stored at sounding pitch.
- The ABC authoring guide (`docs/guides/abc-authoring.md`) change log has the ABC-facing summary.

## Files you own
`packages/pepperscore/package.json` (version only), root `package-lock.json` (the pepperscore version entries only), `packages/pepperscore/CHANGELOG.md`, your own 0017 handoff files.

## Acceptance criteria
- [ ] Version 0.5.0 in package.json and lock; `npm run test:pack` passes and the packed tarball reports 0.5.0.
- [ ] CHANGELOG 0.5.0 section accurate against the merged PRs (each bullet traceable), with a "Behaviour changes" note.

## Verify with
```bash
npm ci   # from the repo root
npm run check && npm run build && npm run test:pack
```

---
## Receiver ack

Acknowledged: prepare pepperscore 0.5.0 by changing only the package version, its workspace lock entry, CHANGELOG, and my 0017 handoffs. I will trace release notes to merged work since 0.4.1, call out the specified behaviour changes, verify the package and packed version, and open a draft PR. No npm publication, runtime edits, ledger edits, or GBrain writes. No open questions.

GBrain consulted: `default:projects/scoreflow-music-reader` and `default:projects/scoreflow-music-reader/gotchas-abc-import`; repo docs and current source are authoritative for release details.
