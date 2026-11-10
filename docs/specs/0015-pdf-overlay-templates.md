# 0015 — PDF overlay templates (stamping)

- **Status:** draft — blocked on the shared schema (pepperhorn-platform)
- **Ledger:** 0015 · **Plan:** (after approval)
- **Author:** lead · **Date:** 2026-11-11

## Problem
PDF export (0002) produces a clean score. Hosts need to stamp their own content on it — licensee name, copyright/ISMN lines, a verification QR, a logo, a "Preview" watermark — without code changes, the way PepperHorn's stamp-pdf service stamps licensed parts.

## Prior art: PepperHorn stamp-pdf ("StampUI")
Researched 2026-11-11 in `~/pepperhorn-platform/apps/stamp-pdf` (read-only):
- Server-side, Node, **pdf-lib**; templates are Directus `stamp_manifest` rows whose `overlays` is an **untyped JSON array of zones**. No JSON Schema, no types, no version field ("an unvalidated JSON column", `lib/overlays.js:301`). StampUI (`stampui.pepperhorn.com`) is the drag-and-drop editor; "Export JSON" gives `{ name, paper_size, overlays }`.
- **Zone:** `{ id, type, page, x, y, width, height, source?, template?, fontSize?, fontStyle?, fontFamily?, align?, vAlign?, color?, rotation?, logo?, logoScale?, aspect?, payloadForm? }`
  - `type`: `text | rotated_text | qr | logo | dmre | micropdf417 | datamatrix | whitespace`
  - `page`: `"first"` (default) `| "last" | "all" | "2" | "1,3-5"`
  - Units **pt**, origin **bottom-left**, absolute (no page-relative positioning; `paper_size` letter/a4 only, unused at render).
  - `template` is **Liquid** (`{{ licensee_name }}`), takes priority over `source` (a key into the data); missing keys render empty.
  - Every non-empty zone first paints a **white rectangle**, then draws. No opacity, no diagonal watermark.
  - Fonts: Helvetica standard + 15 curated Google fonts, subset-embedded.
  - Example (live): `{ id: 'copyright_lines', type: 'text', page: 'first', x: 153, y: 23, width: 290, height: 39, fontSize: 8, align: 'center', vAlign: 'middle', color: '#000000', source: 'copyright_lines', fontFamily: 'Inter', rotation: 0 }`

## Goals
- A host can pass an overlay template (JSON) and data to the PDF export; every exported page is stamped accordingly, in the browser.
- **PepperHorn compatibility:** a StampUI export (`{ name, paper_size, overlays }`) or a bare `overlays` array is accepted and renders the same as stamp-pdf for the supported zone types, so one template can serve both.
- A published, versioned **JSON Schema** for PepperScore's template format (which is a superset of the PepperHorn zone), so hosts and StampUI can validate.

## Proposed format (to confirm)
```jsonc
{
  "schemaVersion": 1,
  "name": "Licensed part",
  "units": "pt",            // pt (default, PepperHorn) | mm | percent
  "origin": "bottom-left",  // bottom-left (default, PepperHorn) | top-left
  "basePaper": "letter",    // the page size the coordinates were drawn on (PepperHorn paper_size)
  "fit": "scale",           // how to place zones on a different paper size: scale | anchor | none
  "overlays": [ /* PepperHorn zones, plus optional PepperScore extensions: */
    { "id": "wm", "type": "watermark", "page": "all", "template": "PREVIEW",
      "opacity": 0.12, "rotation": 45, "fontSize": 96, "color": "#000000", "background": "none" }
  ]
}
```
- **Extensions** (all optional; PepperHorn ignores unknown fields): `opacity` (0–1), `background: "white" | "none"` (default `"white"` to match stamp-pdf; `"none"` for watermarks), `type: "watermark"` (centred, any rotation), `anchor` (`top-left … bottom-right`) for `fit: "anchor"`.
- **Built-in variables** (always available to Liquid): `title`, `subtitle`, `composer`, `page`, `pages`, `paper`, `date`, `export_url`. Host data (e.g. PepperHorn `stamp_data`: `licensee_name`, `license_text`, `verification_url`, `copyright_lines`, `ismn_line`, …) is merged on top.
- **Layout:** the score's 12 mm margins stay; zones draw over the composed page. A template can reserve space (`margins` override) so the music never sits under a zone.

## Non-goals
Server-side stamping; editing templates inside PepperScore (StampUI stays the editor); fetching templates from Directus (the host fetches and passes JSON); DMRE/MicroPDF417/DataMatrix marks in v1 (see open question 3).

## API sketch
`<PepperScore pdf={{ template, data }} />` and `exportScore(request, { template, data })`; the PDF overlay shows the template name and a stamped preview. Unsupported zone types are skipped with a dev warning and listed in `onError`-free diagnostics.

## Acceptance criteria (draft)
- [ ] AC1 — A StampUI export JSON renders text, rotated text, QR (with centre logo) and logo zones at the same positions, sizes, fonts and colours as stamp-pdf on a Letter/A4 part (compare against a stamp-pdf output PDF).
- [ ] AC2 — The same template on A3/Legal places zones per `fit`.
- [ ] AC3 — Liquid variables resolve from built-ins + host data; missing keys render empty.
- [ ] AC4 — A JSON Schema validates PepperHorn exports and PepperScore extensions; invalid templates fail with a clear message before export.
- [ ] AC5 — Watermark zone with opacity renders behind/over notation as configured, vector, text selectable or not per setting.
- [ ] AC6 — No template → export identical to 0002 output; template code lazy-loaded with the PDF code.

## Decisions so far (human, 2026-11-11)
- **Paper fit:** anchor each zone to its nearest edge(s)/corner, keeping its size and distance from those edges; a per-zone `anchor` overrides.
- **v1 zone types:** text, rotated_text, logo, QR (with centre logo), watermark (new), and the licence marks (DMRE, MicroPDF417, DataMatrix; bwip-js lazy-loaded with the PDF code).
- **Format:** PepperHorn stamp template **v1** — a shared, typesafe schema (Zod 4 → TS types + runtime validation + published JSON Schema) defined in pepperhorn-platform, adopted by stamp-pdf/StampUI, and consumed by PepperScore. Handoff: `../handoffs/2026-11-11-adhoc-stamp-template-schema-v1--pepperscore-to-pepperhorn-platform.md`. PepperScore implementation waits for that package.

## Proposed PepperHorn schema improvements (from the stamp-pdf review)
1. **No schema, types or version** — `stamp_manifest.overlays` is an unvalidated JSON column (`lib/overlays.js:301`). Add a JSON Schema + `schemaVersion`, validate in StampUI on save and in the service on stamp.
2. **Absolute Letter/A4 coordinates; `paper_size` unused at render** — add `paper` (any size) and per-zone `anchor` so one template fits A4/A3/Letter/Legal.
3. **White box always painted** — make it an explicit `background: "white" | "none"` (default white, back-compatible).
4. **No opacity or watermark** — add `opacity` and a `watermark` zone type with free rotation (text rotation is limited to 0/90/180/270 today).
5. **`logo` is a server file path** — not portable to the browser; use a URL, asset id or data URI.
6. **Fonts fetched from Google at render, list only in code** — put the font list in the schema (enum) and allow a font URL.
7. **Missing Liquid variables render silently empty** — keep the behaviour but report missing keys in StampUI preview and in a diagnostics field.
8. **`stamp_data` keys aren't specified** — publish a schema for the data contract too (licensee, licence text, verification URL, copyright, ISMN, …).
9. **Dead fields** — `merge_all` and legacy `terms.stamp_manifest`: deprecate in the schema.
10. **No constraints** — zone `id` uniqueness, positive sizes, `page` syntax: express in the schema rather than silently skipping.

## Open questions
1. Compatibility level: accept PepperHorn zones as-is (pt, bottom-left, white box) as the native format, or a cleaner PepperScore-native format with an importer for StampUI JSON?
2. Different paper sizes: PepperHorn coordinates are absolute for Letter/A4. Scale proportionally, anchor to the nearest corner, or require one template per paper?
3. Scope of v1 zone types: text, rotated_text, qr, logo, whitespace (+ watermark) only, or also the DMRE/MicroPDF417/DataMatrix licence marks (needs bwip-js in the browser, ~+200 KB lazy)?
4. Should PepperHorn's stamp-pdf adopt the published JSON Schema (and `schemaVersion`) too? That's a change in another repo.
