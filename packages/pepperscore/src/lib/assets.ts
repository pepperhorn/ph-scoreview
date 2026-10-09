/**
 * Built-in assets (music fonts, instrument icons, sound packs) live at `assetBaseUrl` in the layout of a
 * pepperscore-sounds-<pack> package: fonts/, instruments/, soundfonts/ and pack.json
 * (docs/specs/pepperscore-embeddable-component.md, "Assets and sounds"). No runtime imports: validation/assets.mjs runs it in Node.
 */
export type SoundPackName = 'core' | 'complete';

/** Version of the pepperscore-sounds-* packages this build loads by default; validation/sound-packs.mjs keeps it in step. */
export const SOUNDS_VERSION = '0.1.0';

export const defaultAssetBaseUrl = (pack: SoundPackName): string => `https://cdn.jsdelivr.net/npm/pepperscore-sounds-${pack}@${SOUNDS_VERSION}/`;

const pageBase = (): string => (typeof document !== 'undefined' && document.baseURI) || 'http://localhost/';

/** The absolute asset base, always ending in `/`. A relative base resolves against the page; none means the CDN default. */
export function resolveAssetBase(base: string | undefined, pack: SoundPackName = 'core', page: string = pageBase()): string {
  const raw = base?.trim() || defaultAssetBaseUrl(pack);
  return new URL(raw.endsWith('/') ? raw : `${raw}/`, page).href;
}

/** A built-in asset under the base; a leading `/` (as in the GM manifest's `localPack`) is relative to the base too. */
export const assetUrl = (base: string, path: string): string => new URL(path.replace(/^\/+/, ''), base).href;

export type PackInfo = { pack: SoundPackName | 'unknown'; fluidr3: ReadonlySet<string> };
const packInfo = new Map<string, Promise<PackInfo>>();

/** The base's pack.json, cached per base. A missing or invalid one lists no FluidR3 sounds, so every program falls back to TimGM6mb. */
export function loadPackInfo(base: string): Promise<PackInfo> {
  let info = packInfo.get(base);
  if (!info) {
    info = fetch(assetUrl(base, 'pack.json'))
      .then(response => (response.ok ? response.json() : null) as Promise<{ pack?: unknown; fluidr3?: unknown } | null>)
      .then(json => ({
        pack: json?.pack === 'core' || json?.pack === 'complete' ? json.pack : 'unknown' as const,
        fluidr3: new Set(Array.isArray(json?.fluidr3) ? json.fluidr3.filter((name): name is string => typeof name === 'string') : []),
      }), () => ({ pack: 'unknown' as const, fluidr3: new Set<string>() }));
    packInfo.set(base, info);
  }
  return info;
}
