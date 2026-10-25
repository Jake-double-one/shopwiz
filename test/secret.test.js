import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSealer } from '../server/secret.js';

describe('sealed secrets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopwiz-secret-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('seals and opens, and a sealed value is not the secret', () => {
    const s = createSealer({ encryptionKey: 'a passphrase that is long enough' });
    const blob = s.seal('deepl-key-1234:fx');
    expect(blob.startsWith('enc1.')).toBe(true);
    expect(blob).not.toContain('1234');
    expect(s.open(blob)).toBe('deepl-key-1234:fx');
    expect(s.seal('x')).not.toBe(s.seal('x')); // a fresh nonce every time
  });

  it('refuses tampered values and values sealed with another key', () => {
    const a = createSealer({ encryptionKey: 'key-a-key-a-key-a' });
    const b = createSealer({ encryptionKey: 'key-b-key-b-key-b' });
    const blob = a.seal('secret');
    expect(b.open(blob)).toBeNull();
    expect(a.open(blob.slice(0, -3) + 'AAA')).toBeNull();
    expect(a.open('nonsense')).toBeNull();
    expect(a.open(null)).toBeNull();
  });

  it('without ENCRYPTION_KEY a key is made once next to the database and read again on the next start', () => {
    const first = createSealer({ dataDir: dir });
    expect(first.source).toBe('file');
    const file = join(dir, 'encryption.key');
    expect(readFileSync(file, 'utf8').length).toBeGreaterThanOrEqual(43);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const blob = first.seal('kept across restarts');
    expect(createSealer({ dataDir: dir }).open(blob)).toBe('kept across restarts');
    // ENCRYPTION_KEY set later: the file is not used – values sealed with it can't be opened any more
    expect(createSealer({ dataDir: dir, encryptionKey: 'now from the environment' }).open(blob)).toBeNull();
  });

  it('an in-memory database gets a key for the lifetime of the process', () => {
    const s = createSealer({ dataDir: ':memory:' });
    expect(s.source).toBe('memory');
    expect(s.open(s.seal('x'))).toBe('x');
  });
});
