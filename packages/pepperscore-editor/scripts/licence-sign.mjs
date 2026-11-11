import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

try {
  const [path, sub, date, cap, ...extra] = process.argv.slice(2);
  const exp = Date.parse(`${date}T00:00:00Z`) / 1000;
  const maxStaves = Number(cap);
  if (!path || !sub?.trim() || extra.length || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ||
      !Number.isFinite(exp) || new Date(exp * 1000).toISOString().slice(0, 10) !== date ||
      exp <= Date.now() / 1000 || !Number.isSafeInteger(maxStaves) || maxStaves < 1) throw new Error();
  const key = createPrivateKey({ key: JSON.parse(readFileSync(path, 'utf8')), format: 'jwk' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error();
  const payload = Buffer.from(JSON.stringify({ sub, exp, maxStaves }));
  console.log(`${payload.toString('base64url')}.${sign(null, payload, key).toString('base64url')}`);
} catch {
  console.error('Signing failed. Usage: node licence-sign.mjs <private-jwk-path> <subject> <future YYYY-MM-DD> <positive maxStaves>');
  process.exitCode = 1;
}
