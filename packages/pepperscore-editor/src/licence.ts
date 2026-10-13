import { z } from 'zod';

/** A verified licence: who it is for, when it expires (Unix seconds), and how many staves it may edit. */
export type Licence = { sub: string; exp: number; maxStaves: number };

/** Staves an editor may edit without a licence saying otherwise. */
export const DEFAULT_MAX_STAVES = 4;

/** The public half of the pepperscore licence signing key (Ed25519). The private half is kept outside this repository. */
export const DEFAULT_LICENCE_PUBLIC_KEY_JWK: JsonWebKey = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'SW69kCwqmTS8iTtg4a7oHUAC-9iG3uZCu49htY4msjU',
};

const LicenceSchema = z.object({ sub: z.string(), exp: z.number(), maxStaves: z.number().int().min(1) });

/** Base64url without padding; works in browsers and Node (no `Buffer`). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes base64url (padding optional); throws on characters outside the alphabet. */
export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Not base64url');
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '='));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

const isDevBuild = (): boolean => typeof import.meta.env !== 'undefined' && Boolean(import.meta.env.DEV);

/**
 * Checks a licence key: `base64url(payload JSON) + '.' + base64url(Ed25519 signature of those JSON bytes)`,
 * where the payload is `{ sub, exp, maxStaves }` with `exp` in Unix seconds. Returns the licence, or null when
 * the key is malformed, the signature does not verify against `publicKeyJwk`, or it has expired.
 * `'dev'` is accepted in development builds only (`import.meta.env.DEV`).
 */
export async function verifyLicence(key: string, publicKeyJwk: JsonWebKey = DEFAULT_LICENCE_PUBLIC_KEY_JWK): Promise<Licence | null> {
  if (key === 'dev') return isDevBuild() ? { sub: 'dev', exp: Infinity, maxStaves: DEFAULT_MAX_STAVES } : null;
  const parts = key.split('.');
  if (parts.length !== 2) return null;
  try {
    const payload = base64UrlDecode(parts[0]);
    const signature = base64UrlDecode(parts[1]);
    const subtle = globalThis.crypto.subtle;
    const publicKey = await subtle.importKey('jwk', publicKeyJwk, { name: 'Ed25519' }, false, ['verify']);
    if (!(await subtle.verify({ name: 'Ed25519' }, publicKey, signature, payload))) return null;
    const parsed = LicenceSchema.safeParse(JSON.parse(new TextDecoder().decode(payload)));
    if (!parsed.success || parsed.data.exp <= Date.now() / 1000) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
