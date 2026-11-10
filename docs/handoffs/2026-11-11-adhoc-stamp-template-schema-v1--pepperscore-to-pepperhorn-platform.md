# Handoff: adhoc — PepperHorn stamp template schema v1 (pepperscore lead → pepperhorn-platform lead)

- **Date:** 2026-11-11
- **Type:** dispatch (a proposal for the pepperhorn-platform lead to spec, plan and ledger)
- **Ledger:** none yet in pepperhorn-platform; PepperScore item **0015** (PDF overlay templates) depends on it.
- **Status:** open

## Goal
Turn the stamp-pdf template ("StampUI" manifest overlays) into a **typesafe, versioned, published schema** — "PepperHorn stamp template v1" — that stamp-pdf, StampUI and PepperScore's browser PDF export all use. One template must stamp the same way in both systems.

## Context you need
- Review of the current format (read-only, 2026-11-11): `apps/stamp-pdf/lib/overlays.js` (`applyOverlays`, `resolvePages`, `rotatedFrame`, `parseColor`; `:301` "stamp_manifest.overlays is an unvalidated JSON column"), `lib/fonts.js`, `lib/liquid.js`, `STAMPING.md` (`:97-115` stamp_data keys, `:169-179` payload, `:589-766` zone types and margin marks), `sandbox/public/sandbox.js` (StampUI; Export JSON `:1786-1798`, save `:1410-1416`), `sandbox/api/directus-proxy.js:60-93`, live examples `apps/connect/scripts/lib/plan-ismn-overlay.test.js:7,41-50`. Directus collection `stamp_manifest` (`id, name, description, status, paper_size, merge_all, overlays`), referenced by `print_part.stamp_manifest`.
- The consumer's spec with the full current-zone table and improvement list: `ph-vexflow-view/docs/specs/0015-pdf-overlay-templates.md` (repo pepperhorn/ph-scoreview).

## Human decisions (2026-11-11)
- **Sequence:** shared schema v1 first; stamp-pdf/StampUI adopt it; PepperScore consumes the same package.
- **Typesafe:** yes.
- **Paper fit:** zones anchor to their nearest edge(s)/corner on a different paper size; per-zone `anchor` overrides.
- **v1 zone types:** text, rotated_text, logo, qr (centre logo), **watermark (new)**, dmre, micropdf417, datamatrix, whitespace.

## Recommended shape (pepperscore lead's recommendation; yours to settle)
- **Source of truth: Zod 4** in TypeScript → TS types (`z.infer`), runtime validation (`safeParse`) and the published **JSON Schema** (`z.toJSONSchema`) from one definition. PepperScore's editor already uses Zod 4. stamp-pdf (JS) validates with the built package at runtime; StampUI validates on save.
- **Package:** a standalone `packages/stamp-schema` with its own package.json and lockfile (this repo is a loose monorepo — no root workspace file), published to npm as e.g. `@pepperhorn/stamp-schema` (ESM + types + `schema.json`). Publishing: the human runs `npm login` first as its own step, then the publish command separately.
- **Envelope:** `{ schemaVersion: 1, name, paper, units: "pt", origin: "bottom-left", overlays: Zone[] }`. Keep pt + bottom-left so existing manifests stay valid; `paper` replaces the unused `paper_size` (any size, not just letter/a4).
- **Zone (back-compatible):** today's fields, plus `background: "white" | "none"` (default `"white"` = current white box), `opacity` (0–1), `anchor` (`top-left … bottom-right`, edge pairs, or `auto` = nearest), free `rotation` for `watermark`, `logo` as URL / asset id / data URI instead of a server path (keep server path as a deprecated fallback), `fontFamily` as an enum of the curated list or `{ url }`.
- **Data contract:** a second schema for `stamp_data` (`license_id`, `license_date`, `licensee_name`, `license_text`, `verification_url`, `composer_lines`, `copyright_lines`, `copyright_year`, `publisher`, `ismn`, `ismn_digits`, `ismn_line`, …) so Liquid variables are typed; missing keys still render empty but are reported (StampUI preview + a diagnostics array from the stamper).
- **Constraints in the schema:** unique zone ids, positive sizes, `page` syntax (`first|last|all|N|ranges`), type-specific fields (`aspect`/`payloadForm` only on marks) via a discriminated union on `type`.
- **Deprecations:** `merge_all`, `terms.stamp_manifest`.
- **Migration:** existing `stamp_manifest.overlays` must validate as v1 with no edits (add `schemaVersion` on next save); add a script that validates every live manifest.
- **Golden tests:** stamp-pdf renders a fixed manifest + data to a reference PDF; PepperScore will compare its browser output against the same fixture (positions, sizes, fonts, colours).

## Acceptance criteria (proposed)
- [ ] `@pepperhorn/stamp-schema` exports Zod schemas, TS types and `schema.json` for the template and `stamp_data`; every live `stamp_manifest` validates.
- [ ] stamp-pdf validates its payload and honours `background`, `opacity`, `anchor`, `watermark`, logo URL; existing manifests render byte-for-byte the same.
- [ ] StampUI validates on save and can edit the new fields.
- [ ] A shared golden fixture (manifest + data + reference PDF) is published with the package for consumers.

## Open questions (for the pepperhorn-platform lead / human)
1. Package name and npm scope; public or private registry (PepperScore is a public npm package, so it needs to install it).
2. Whether StampUI gains a "paper preview" for A3/Legal to show anchoring.

---
## Receiver ack
