// Secrets that ShopWiz has to keep in the database (today: an ID's own translation API key) are
// stored encrypted – whoever only gets the database file or a backup can't use them.
// The key comes from ENCRYPTION_KEY, or is made once and kept next to the database.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PREFIX = 'enc1';

/** Any text → a 32-byte key (so ENCRYPTION_KEY may be a passphrase or a base64 string). */
const keyOf = (text) => createHash('sha256').update(String(text), 'utf8').digest();

/**
 * createSealer({ encryptionKey, dataDir }, log) → { seal(text) → string, open(blob) → text | null, source }
 * source: 'env' | 'file' | 'memory' (:memory: database – the key lives as long as the process)
 */
export function createSealer({ encryptionKey = '', dataDir = ':memory:' } = {}, log = null) {
  let key;
  let source;
  if (encryptionKey) {
    if (encryptionKey.length < 16) log?.warn('ENCRYPTION_KEY is short – use at least 16 random characters');
    key = keyOf(encryptionKey);
    source = 'env';
  } else if (dataDir === ':memory:') {
    key = randomBytes(32);
    source = 'memory';
  } else {
    mkdirSync(dataDir, { recursive: true });
    const file = join(dataDir, 'encryption.key');
    if (!existsSync(file)) {
      writeFileSync(file, randomBytes(32).toString('base64url'), { mode: 0o600 });
      log?.info('ENCRYPTION_KEY is not set – a key was made and kept in the data folder (encryption.key). Back it up with the database.');
    }
    key = keyOf(readFileSync(file, 'utf8').trim());
    source = 'file';
  }

  return {
    source,
    seal(text) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
      return [PREFIX, iv.toString('base64url'), ct.toString('base64url'), c.getAuthTag().toString('base64url')].join('.');
    },
    open(blob) {
      const parts = String(blob ?? '').split('.');
      if (parts.length !== 4 || parts[0] !== PREFIX) return null;
      try {
        const d = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'));
        d.setAuthTag(Buffer.from(parts[3], 'base64url'));
        return Buffer.concat([d.update(Buffer.from(parts[2], 'base64url')), d.final()]).toString('utf8');
      } catch {
        return null; // another key, or tampered with
      }
    },
  };
}
