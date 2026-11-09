import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

/** Release a checked ephemeral loopback port; strict Vite startup guards the bind race. */
export async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

/** Wait for THIS child's listening announcement before any HTTP readiness probe. */
export async function startVite() {
  const port = await freePort();
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: new URL('../../', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
  });
  let output = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Vite startup timed out')), 30000);
      const onError = error => finish(error);
      const onExit = (code, signal) => finish(new Error(`Vite exited before listening (code ${code}, signal ${signal})`));
      const onData = data => {
        output = (output + data).slice(-16000);
        if (output.includes(`http://127.0.0.1:${port}/`)) finish();
      };
      function finish(error) {
        clearTimeout(timer);
        server.off('error', onError);
        server.off('exit', onExit);
        server.stdout.off('data', onData);
        server.stderr.off('data', onData);
        error ? reject(error) : resolve();
      }
      server.once('error', onError);
      server.once('exit', onExit);
      server.stdout.on('data', onData);
      server.stderr.on('data', onData);
    });
  } catch (error) {
    server.kill();
    throw new Error(`${error.message}\n${output}`, { cause: error });
  }
  // Drain logs for the rest of the suite so a full pipe cannot stall Vite.
  server.stdout.resume();
  server.stderr.resume();
  return { port, server };
}
