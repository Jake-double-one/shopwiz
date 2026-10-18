// D-ID: the public name of a device for the administration ("D-ID" in every language).
// Derived from the hash of the device's secret, so it never reveals the secret itself:
// D-ID = first 50 bits of SHA-256("did:" + SHA-256(token) as base64url), Crockford base32.

import { ALPHABET } from './ids.js';

/** 32 digest bytes → "K7M2Q-9XH4T" */
export function didFromDigest(bytes) {
  let bits = '';
  for (let i = 0; i < 7; i++) bits += bytes[i].toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < 10; i++) out += ALPHABET[Number.parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** Typed or pasted D-ID → canonical form, or null. Forgiving like the IDs: I/L → 1, O → 0, any separators. */
export function parseDid(input) {
  const s = String(input ?? '')
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/[^0-9A-Z]/g, '');
  if (s.length !== 10 || [...s].some((c) => !ALPHABET.includes(c))) return null;
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** In the browser: the D-ID of this device's token (WebCrypto). */
export async function didOfToken(token) {
  const enc = new TextEncoder();
  const tokenHash = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(token)))));
  return didFromDigest(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`did:${tokenHash}`))));
}
