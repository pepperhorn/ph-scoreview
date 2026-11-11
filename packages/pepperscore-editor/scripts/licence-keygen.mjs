import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';

try {
  const [path, ...extra] = process.argv.slice(2);
  if (!path || extra.length) throw new Error('Usage: node licence-keygen.mjs <private-jwk-path>');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(path, JSON.stringify(privateKey.export({ format: 'jwk' })) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify(publicKey.export({ format: 'jwk' })));
} catch {
  console.error('Key generation failed. Supply one new file path in a private directory; existing files are never overwritten.');
  process.exitCode = 1;
}
