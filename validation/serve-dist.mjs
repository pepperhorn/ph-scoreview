// Static server for the built demo (apps/reader/dist) with Astro's directory pages (/embed-test → embed-test/index.html).
// `mounts` serves extra URL prefixes from other directories (e.g. a host's own Verovio copy); `requests` lists every
// path asked for, worker module imports included (browsers do not all report those to Playwright).
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const dist = resolve(root, 'apps/reader/dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.mp3': 'audio/mpeg', '.mjs': 'text/javascript', '.txt': 'text/plain; charset=utf-8' };

export async function serveDist({ mounts = {} } = {}) {
  const requests = [];
  if (!existsSync(resolve(dist, 'index.html'))) throw new Error('apps/reader/dist/index.html is missing: run `npm run build` first');
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    requests.push(pathname);
    const mount = Object.keys(mounts).find(prefix => pathname.startsWith(prefix));
    const base = mount ? resolve(mounts[mount]) : dist;
    let path = resolve(base, `.${mount ? pathname.slice(mount.length - 1) : pathname === '/' ? '/index.html' : pathname}`);
    if (path !== base && !path.startsWith(`${base}${sep}`)) { response.writeHead(403).end(); return; }
    if (!extname(path)) path = resolve(path, 'index.html');
    let body;
    try { body = await readFile(path); } catch { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' }).end(body);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise(done => server.close(done)) };
}
