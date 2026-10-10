// Crockford Base32 without I, L, O, U – easy to read aloud, no 0/O or 1/I/l confusion.
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ID_LENGTH = 10;

/** Normalise user input: strip separators, uppercase, map look-alikes. Returns null if invalid. */
export function parseSpaceId(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  // Accept full links: take the last path segment.
  const m = s.match(/([0-9A-Za-z]{2,}[-\s]?){2,}[0-9A-Za-z]*\/?$/);
  if (s.includes('/') && m) s = m[0];
  s = s.toUpperCase().replace(/[\s\-_./]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== ID_LENGTH) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}

/** K7QM2XPA9F → K7QM-2XPA-9F */
export function formatSpaceId(id) {
  if (!id) return '';
  return `${id.slice(0, 4)}-${id.slice(4, 8)}-${id.slice(8)}`;
}

/** Random id from a byte source (crypto.getRandomValues compatible). */
export function randomSpaceId(getRandomValues) {
  const bytes = new Uint8Array(ID_LENGTH);
  getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31]; // 256 is a multiple of 32 → no bias
  return out;
}

/** Entity ids for lists, groups, items (generated on the client for offline creation). */
export function randomEntityId(getRandomValues) {
  const bytes = new Uint8Array(12);
  getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return out.toLowerCase();
}

export const ENTITY_ID_RE = /^[0-9a-z]{8,24}$/;
