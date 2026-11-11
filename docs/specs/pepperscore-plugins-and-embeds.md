# pepperscore: pro plugins, paywall and hosted embeds

Status: draft 2026-10-14

## Goal

Sell PepperHorn features on top of the MIT viewer and editor without closing either, and let teachers embed scores (including licensed scores from ph-connect / pepperhorn.com) in Google Classroom and similar hosts. It follows the ph-apps internal architecture (`internal_architecture` singleton in ph-apps Directus): one account layer, `app_assets` / `app_products` / `app_licenses`, Stripe as source of truth, server-side entitlement checks.

## Decisions

- **Everything in this repo stays MIT.** That covers `pepperscore` (viewer) and `pepperscore-editor`. Paid capability ships only as proprietary plugins, built from a private repo and loaded remotely after a server entitlement check. The open code holds no paywall logic worth removing.
- **The plugin runtime lives in `@pepperhorn/app-sdk/plugins` (MIT).** pepperscore is its first consumer; drumlet, chordee2 and songtiles converge on it later.
- **The paywall is scoped to pepperscore for now.** Feature keys are namespaced (`pepperscore.export.audio`), so a later cross-app subscription can grant them without renaming.
- **Free:** viewing, transposition and instrument transposition, note names, chord symbols, and PDF export with a formatting overlay (bars per line etc., from the existing `barsPerLine` setting).
- **Pro plugins:** audio export, MIDI export, play-along, saving to the account library, licensed-content library, and later editor tools.
- **Entitlement follows ph-apps §3:** a stateful check against Directus on each payload or plugin request, with `Cache-Control: private, max-age=300`. No JWT capability tokens. Signed URLs are used only for short-lived file and plugin downloads.
- Soundfont licensing review is deferred (we may publish our own sound packs). TimGM6mb must be replaced before audio export is sold.

## Plugin runtime (`@pepperhorn/app-sdk/plugins`)

This merges drumlet's manifest fields with songtiles' remote loader (see `drumlet/src/plugins/runtime.ts` and `songtiles/docs/PLUGIN_*.md`).

```ts
type PluginManifest = {
  apiVersion: number;              // host refuses plugins outside its supported range
  id: string;                      // reverse-DNS, e.g. "com.pepperhorn.pepperscore.audio-export"
  name: string;
  version: string;
  app: string;                     // app_slug, "pepperscore"
  kind: string;                    // per-app vocabulary, see below
  capabilities: string[];          // feature keys it provides, e.g. ["pepperscore.export.audio"]
  commercial: boolean;
  licenseTier: 'core' | 'pro';
  register(api: HostApi): void | (() => void);   // returns cleanup
};

createPluginHost<HostApi>({ app, apiVersion, api, resolveEntitlements, loadPlugin });
```

- **Loading:** static plugins are imported by the host. Remote plugins are fetched with `import(url)`, where the URL is a short-lived signed URL returned by the server's plugin list. That list is already filtered by entitlement, so an unentitled user never receives the URL.
- **Gating:** `resolveEntitlements` asks the server. The client result only drives UI: locked buttons and upgrade prompts. Pro features that produce deliverables (audio and MIDI files) should eventually render server-side if hard enforcement matters. A loaded plugin's JS can be copied, so the signed URL limits distribution, not use.
- **No sandbox in v1:** first-party plugins only. Third-party plugins would need an iframe/worker boundary first.

### pepperscore extension points

| `kind` | Slot | Examples |
|---|---|---|
| `export` | Export menu entry; receives the current score, render settings and a sound renderer | audio (WAV/MP3), MIDI |
| `playback` | Transport add-on; receives the clock and highlights | play-along, practice loops |
| `library` | Open-score dialog source; lists and fetches scores | account library, licensed ph-connect catalogue |
| `editor-tool` | Editor toolbar/panel (pepperscore-editor) | pro editing tools |

The host API exposes only what the existing public surface already supports: the score source, settings, `PepperScoreHandle`, `clock`, `highlights`, and `onElementClick`. No internals are exposed, so plugins survive refactors. The `apiVersion` is bumped and logged on any breaking change.

### Editor licence key

`packages/pepperscore-editor/src/licence.ts` gates editing with an Ed25519 key (`maxStaves`). Inside MIT code it is advisory only. Either keep it as a soft limit, or replace it with an `editor-tool` entitlement (e.g. `pepperscore.editor.staves.unlimited`). This is an open question.

## Hosted embeds

```
B2 (private)            scores/<instanceId>/score.musicxml
                        scores/<instanceId>/prefs.json      (file-state v2 settings: names, chords, barsPerLine, semitones…)
ph-apps (Directus)      app_user_saves (app_slug=pepperscore, kind=score) or app_assets(kind=score) for catalogue content
                        score_embeds: instance, token_hash, scope, expires_at, revoked, owner
Cloudflare              /lib/<version>/…            immutable shared player builds
                        Worker /e/<instanceId>?t=…  page shell + JSON: score, prefs, owner capabilities, plugin URLs
```

- **The Worker** validates the token and the owner's entitlements against ph-apps (cached 5 minutes), reads B2 with private credentials (no egress cost under the Bandwidth Alliance), and sets `frame-ancestors` to allow Classroom, Sites and `*.googleusercontent.com`.
- **Capabilities come from the embed owner, not the viewer.** Third-party cookies are blocked inside iframes, so a teacher's plan unlocks features for that embed.
- **Tokens are capability links:** one per embed, revocable, read-only, scoped.
- **Classroom delivery:** link attachment (any edition) or Google Sites iframe now. A Classroom add-on (Education Plus / Teaching & Learning) comes later and reuses the same embed page.

## Licensed content (ph-connect)

- Catalogue scores are `app_assets` (`app_slug=pepperscore`, `kind=score`, `gate=purchase`) referencing `app_licenses`. Revoking the licence returns 410 on the next request.
- They are served only through the viewer surface. The editor cannot open `gate=purchase` assets, which is the line we draw for licensors.
- **Stated limit:** anything the browser renders can be captured. What we protect against is file download and redistribution, not screen capture.

## Prerequisites outside this repo

1. ph-apps: create `app_assets`, `app_products`, `app_licenses`, `app_subscriptions`, `app_purchases` and the asset-payload Flow. These are designed in `internal_architecture` but not yet created.
2. ph-apps: create `score_embeds`.
3. app-sdk: add the `plugins` entry.
4. A private repo for pepperscore pro plugins, with a build that publishes to the plugin store behind signed URLs.

## Phases

1. **Done (#38):** Verovio loaded as a separate replaceable file, plus third-party notices (LGPL compliance).
2. **Done (0002, #83 and the large-score/browser follow-up):** free PDF export with the formatting overlay, verified in Chromium, Firefox and WebKit.
3. **`@pepperhorn/app-sdk/plugins`** and pepperscore extension slots with a static first-party test plugin.
4. **ph-apps collections and Flows;** Worker + B2 embed page; Classroom link and Sites embeds.
5. **Pro plugins:** MIDI export, play-along, then audio export (after the soundfont replacement).
6. **Licensed ph-connect catalogue** via a `library` plugin.

## Open questions

- Editor licence key: soft limit or entitlement (see above)?
- Do audio and MIDI export render client-side (soft gate) or server-side (hard gate)?
- Is the plugin store a ph-apps collection (`app_assets kind=plugin`, file in Directus) or Cloudflare R2/B2 behind the Worker?
- Classroom add-on: when is the Marketplace listing worth doing?
