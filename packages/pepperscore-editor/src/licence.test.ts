import { base64UrlEncode, DEFAULT_LICENCE_PUBLIC_KEY_JWK, verifyLicence } from './licence';

const subtle = globalThis.crypto.subtle;
const now = () => Math.floor(Date.now() / 1000);

async function keyPair() {
  const pair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicJwk: await subtle.exportKey('jwk', pair.publicKey) };
}

async function sign(payload: unknown, privateKey: CryptoKey): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const signature = new Uint8Array(await subtle.sign({ name: 'Ed25519' }, privateKey, bytes));
  return `${base64UrlEncode(bytes)}.${base64UrlEncode(signature)}`;
}

describe('verifyLicence', () => {
  it('accepts a key signed by the matching private key', async () => {
    const { privateKey, publicJwk } = await keyPair();
    const payload = { sub: 'acme', exp: now() + 3600, maxStaves: 8 };
    expect(await verifyLicence(await sign(payload, privateKey), publicJwk)).toEqual(payload);
  });

  it('rejects a tampered payload', async () => {
    const { privateKey, publicJwk } = await keyPair();
    const key = await sign({ sub: 'acme', exp: now() + 3600, maxStaves: 4 }, privateKey);
    const forged = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ sub: 'acme', exp: now() + 3600, maxStaves: 99 })));
    expect(await verifyLicence(`${forged}.${key.split('.')[1]}`, publicJwk)).toBeNull();
  });

  it('rejects an expired key', async () => {
    const { privateKey, publicJwk } = await keyPair();
    expect(await verifyLicence(await sign({ sub: 'acme', exp: now() - 60, maxStaves: 4 }, privateKey), publicJwk)).toBeNull();
  });

  it('rejects a key signed by another private key, and the default public key rejects test keys', async () => {
    const { privateKey } = await keyPair();
    const other = await keyPair();
    const key = await sign({ sub: 'acme', exp: now() + 3600, maxStaves: 4 }, privateKey);
    expect(await verifyLicence(key, other.publicJwk)).toBeNull();
    expect(await verifyLicence(key)).toBeNull();
    expect(DEFAULT_LICENCE_PUBLIC_KEY_JWK).toMatchObject({ kty: 'OKP', crv: 'Ed25519' });
    expect(DEFAULT_LICENCE_PUBLIC_KEY_JWK).not.toHaveProperty('d');
  });

  it('rejects malformed keys and payloads of the wrong shape', async () => {
    const { privateKey, publicJwk } = await keyPair();
    for (const key of ['', 'nonsense', 'a.b.c', '!!!.???', JSON.stringify({ exp: now() + 60 })]) expect(await verifyLicence(key, publicJwk)).toBeNull();
    expect(await verifyLicence(await sign({ sub: 'acme', exp: now() + 60 }, privateKey), publicJwk)).toBeNull();
    expect(await verifyLicence(await sign('not an object', privateKey), publicJwk)).toBeNull();
  });

  it('verifies the reader demo key (signed by the owner) against the default public key', async () => {
    const demo = 'eyJzdWIiOiJwZXBwZXJzY29yZS1kZW1vIiwiZXhwIjoxODMwMjk3NjAwLCJtYXhTdGF2ZXMiOjR9.htvTu3iKMVooELSmmTmArtBQpsDE9tcvtuebGyZZ3BGbvuxBAZ1ip25IGtfNJCuE0_OlRTvGM6v1NcLsaL04Bg';
    expect(await verifyLicence(demo)).toEqual({ sub: 'pepperscore-demo', exp: 1830297600, maxStaves: 4 });
  });

  it("accepts 'dev' in development builds (vitest runs with import.meta.env.DEV)", async () => {
    expect(import.meta.env.DEV).toBe(true);
    expect(await verifyLicence('dev')).toEqual({ sub: 'dev', exp: Infinity, maxStaves: 4 });
  });
});
