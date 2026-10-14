// A Vite dev-server plugin for serving pepperscore from its sources: src/runtime-files.ts resolves the Verovio files and
// THIRD_PARTY_NOTICES.txt next to the code, which only exist in the built dist/. This serves them from the verovio
// package and the notices generator instead. Used by apps/reader (astro dev) and the repo-root vite.config.mjs (the
// validation suites that run a Vite dev server on the sources).
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { thirdPartyNotices, verovioDist } from './third-party-notices.mjs';

const RUNTIME_FILES = /\/packages\/pepperscore\/src\/(?:verovio\/(verovio-module\.mjs|verovio\.mjs)|THIRD_PARTY_NOTICES\.txt)$/;

export default function runtimeFilesDev() {
  let notices;
  return {
    name: 'pepperscore-runtime-files-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        let pathname;
        try { pathname = new URL(request.url ?? '/', 'http://localhost').pathname; } catch { return next(); }
        const match = RUNTIME_FILES.exec(pathname);
        if (!match) return next();
        if (match[1]) {
          createReadStream(join(verovioDist(), match[1]))
            .once('open', () => response.setHeader('content-type', 'text/javascript'))
            .once('error', () => { if (!response.headersSent) response.statusCode = 404; response.end(); })
            .pipe(response);
        } else {
          response.setHeader('content-type', 'text/plain; charset=utf-8');
          response.end(notices ??= thirdPartyNotices());
        }
      });
    },
  };
}
