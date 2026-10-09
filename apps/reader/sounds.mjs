import { createReadStream } from 'node:fs';
import { cp, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOUNDS = fileURLToPath(new URL('../../packages/pepperscore-sounds-complete/', import.meta.url));
const ENTRIES = ['fonts', 'instruments', 'soundfonts', 'pack.json'];
const MIME = { '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.sf2': 'application/octet-stream', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8' };

/** The demo self-hosts the complete sound pack at the site root: served in dev, copied into the build. */
export default function soundPack() {
  return {
    name: 'pepperscore-sounds',
    hooks: {
      'astro:server:setup': ({ server }) => {
        server.middlewares.use(async (request, response, next) => {
          const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
          if (!ENTRIES.some(entry => pathname === `/${entry}` || pathname.startsWith(`/${entry}/`))) return next();
          const file = resolve(SOUNDS, `.${pathname}`);
          if (!file.startsWith(SOUNDS)) return next();
          try { if (!(await stat(file)).isFile()) return next(); } catch { return next(); }
          response.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
          createReadStream(file).pipe(response);
        });
      },
      'astro:build:done': async ({ dir }) => {
        const out = fileURLToPath(dir);
        for (const entry of ENTRIES) {
          try { await cp(join(SOUNDS, entry), join(out, entry), { recursive: true }); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      },
    },
  };
}
