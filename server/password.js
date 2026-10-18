// The main admin's password is only ever stored as a scrypt hash (ADMIN_PASSWORD_HASH).
// Format: scrypt:N:r:p:salt:hash (base64url) – no "$", so docker-compose files need no escaping.
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const DEFAULTS = { N: 16384, r: 8, p: 1 };

const run = (password, salt, len, { N, r, p }) =>
  new Promise((resolve, reject) =>
    scrypt(String(password).normalize('NFC'), salt, len, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 }, (e, key) => (e ? reject(e) : resolve(key))),
  );

export async function hashPassword(password, params = DEFAULTS) {
  const salt = randomBytes(16);
  const key = await run(password, salt, 32, params);
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64url'), key.toString('base64url')].join(':');
}

/** "scrypt:…" → its parts, or null when it isn't a hash this server can check. */
export function parseHash(stored) {
  const m = /^scrypt:(\d+):(\d+):(\d+):([A-Za-z0-9_-]{16,}):([A-Za-z0-9_-]{32,})$/.exec(String(stored ?? '').trim());
  if (!m) return null;
  const [N, r, p] = [m[1], m[2], m[3]].map(Number);
  // a power of two, and no parameters that would eat the server's memory or time
  if (N < 1024 || N > 1 << 20 || (N & (N - 1)) !== 0 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  return { N, r, p, salt: Buffer.from(m[4], 'base64url'), key: Buffer.from(m[5], 'base64url') };
}

export async function verifyPassword(password, stored) {
  const h = typeof stored === 'string' ? parseHash(stored) : stored;
  if (!h || typeof password !== 'string' || !password || password.length > 1024) return false;
  const key = await run(password, h.salt, h.key.length, h);
  return timingSafeEqual(key, h.key);
}
