import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyLicence } from './licence';

const script = (name) => fileURLToPath(new URL(`../scripts/licence-${name}.mjs`, import.meta.url));

it('CLI throwaway keys sign licences that verify, refuse overwrite, and keep private material off stdout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'editor-test-key-'));
  try {
    const path = join(dir, 'throwaway.jwk');
    const output = execFileSync(process.execPath, [script('keygen'), path], { encoding: 'utf8' });
    const publicJwk = JSON.parse(output);
    expect(Object.keys(publicJwk).sort()).toEqual(['crv', 'kty', 'x']);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    const original = readFileSync(path, 'utf8');
    expect(spawnSync(process.execPath, [script('keygen'), path]).status).toBe(1);
    expect(readFileSync(path, 'utf8') === original).toBe(true);
    const date = new Date(Date.now() + 86400 * 30 * 1000).toISOString().slice(0, 10);
    const key = execFileSync(process.execPath, [script('sign'), path, 'test-only', date, '8'], { encoding: 'utf8' }).trim();
    expect(await verifyLicence(key, publicJwk)).toEqual({ sub: 'test-only', exp: Date.parse(`${date}T00:00:00Z`) / 1000, maxStaves: 8 });
    for (const args of [['2027-02-30', '4'], ['2000-01-01', '4'], [date, '0'], [date, '1.5']]) {
      const result = spawnSync(process.execPath, [script('sign'), path, 'test', ...args], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
    }
    writeFileSync(path, 'invalid test key');
    const invalid = spawnSync(process.execPath, [script('sign'), path, 'test', date, '4'], { encoding: 'utf8' });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).not.toContain('invalid test key');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
