/**
 * Files pepperscore loads at runtime instead of bundling them: Verovio (LGPL-3.0-or-later, kept as upstream's own
 * separately replaceable files) and the third-party notices. The build (vite.config.ts) writes them to dist/verovio/
 * and dist/THIRD_PARTY_NOTICES.txt.
 *
 * Keep this file at the root of src/: its code lands in dist/index.js, so `./` is dist/. The library build must not
 * resolve these URLs (`@vite-ignore`; lib mode would inline the files as data URLs); its runtime-files plugin then
 * turns them back into plain `new URL('./…', import.meta.url)` in dist/index.js, the pattern host bundlers (Vite,
 * Astro) recognise to copy the files as assets. scripts/finalize-dist.mjs fails the build if they do not survive.
 */
import type { VerovioFiles } from './lib/verovio-protocol';

/** The Verovio files shipped with pepperscore. */
export const bundledVerovioFiles = (): VerovioFiles => ({
  module: new URL(/* @vite-ignore */ './verovio/verovio-module.mjs', import.meta.url).href,
  toolkit: new URL(/* @vite-ignore */ './verovio/verovio.mjs', import.meta.url).href,
});

/** The third-party notices shipped with pepperscore (linked from the drawer's Licences entry). */
export const thirdPartyNoticesUrl = (): string => new URL(/* @vite-ignore */ './THIRD_PARTY_NOTICES.txt', import.meta.url).href;
