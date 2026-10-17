// Regression tests for the security review: each case was an exploitable path once.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { Store, hashToken } from '../server/core.js';
import { loadConfig } from '../server/config.js';
import { buildApp } from '../server/app.js';
import { createAi, splitSpoken } from '../server/ai.js';

const T1 = 'token-secsecsecsecsecsecsecs';
let n = 0;
function setup(extra = {}) {
  const store = new Store(openDb(':memory:'), { ...loadConfig({}), deeplApiKey: 'SECRET-KEY', ...extra });
  const id = store.createSpace({ name: 'Home', token: T1, deviceName: 'A', listName: 'Weekly' });
  const uid = store.resolve(id, null).space.uid;
  const dev = store.device(uid, hashToken(T1));
  const op = (o) => store.applyOp(uid, dev, `sec${++n}`, o, Date.now());
  return { store, id, uid, dev, op, listId: store.snapshot(uid).lists[0].id };
}

describe('security', () => {
  it('ops named like Object methods are unknown – they never reach the server config', () => {
    const { op } = setup();
    for (const k of ['valueOf', 'constructor', 'toString', 'hasOwnProperty', '__proto__', 'isPrototypeOf']) {
      expect(() => op({ k }), k).toThrow(/unknown op/);
    }
  });

  it('"constructor" is no country for the travel mode', () => {
    const { op, listId } = setup();
    expect(() => op({ k: 'list.update', id: listId, travel: { country: 'constructor', lang: 'en' } })).toThrow();
  });

  it('splitting dictated text stays fast on hostile input', () => {
    const t = performance.now();
    splitSpoken('a' + ' '.repeat(50_000) + 'b');
    splitSpoken(' und'.repeat(20_000));
    expect(performance.now() - t).toBeLessThan(200);
    expect(splitSpoken('2 Milch, Brot und 200g Hack')).toEqual(['2 Milch', 'Brot', '200g Hack']);
  });

  it('an assistant key never reveals the ID (which would make it a full member)', () => {
    const { store, uid, id } = setup();
    const ai = createAi({ store, hub: { broadcast() {} }, config: { mcpEnabled: true }, log: console });
    const { key } = store.createAiDevice(uid, 'Bot');
    expect(JSON.stringify(ai.listLists(ai.auth(key)))).not.toContain(id);
  });

  it('an ID takes at most 100 devices', () => {
    const { store, uid } = setup();
    for (let i = 1; i < 100; i++) store.joinDevice(uid, hashToken(`token-${String(i).padStart(22, 'x')}`), `D${i}`);
    expect(() => store.joinDevice(uid, hashToken('token-onetoomanyonetoomanyx'), 'X')).toThrow(/too many devices/);
    // a known device can always come back
    expect(store.joinDevice(uid, hashToken(T1), 'A').isNew).toBe(false);
  });

  it('undoing a link only works right after linking', () => {
    const { store, uid, op, listId } = setup();
    op({ k: 'list.add', id: 'other0001', name: 'Other', pos: 2 });
    store.applyOp(uid, store.device(uid, hashToken(T1)), 'link-old', { k: 'list.link', id: listId, other: 'other0001' }, Date.now());
    store.db.q("UPDATE applied_ops SET created_at = created_at - 3600000 WHERE op_id = 'link-old'").run();
    op({ k: 'list.linkUndo', opId: 'link-old' });
    expect(store.snapshot(uid).lists.every((l) => l.linkId)).toBe(true);
  });

  it('restoring a group cannot put an item into a group of another list', () => {
    const { store, uid, op, listId } = setup();
    op({ k: 'list.add', id: 'other0001', name: 'Other', pos: 2 });
    op({ k: 'group.add', id: 'gotherlst', listId: 'other0001', name: 'Theirs' });
    op({ k: 'item.add', id: 'itemmilk1', listId, name: 'Milk' });
    op({ k: 'group.restore', ids: ['gotherlst'], moves: [{ id: 'itemmilk1', groupId: 'gotherlst' }] });
    expect(store.snapshot(uid).items[0].groupId).toBeNull();
  });

  it('importing cannot create more groups than allowed', () => {
    const { store, uid, dev } = setup();
    const items = Array.from({ length: 700 }, (_, i) => ({ name: `Item ${i}`, group: `Group ${i}`, state: 'open' }));
    store.importDoc(uid, dev, { lists: [{ name: 'Weekly', items }] });
    expect(store.snapshot(uid).groups.length).toBe(500);
  });
});

describe('security over HTTP', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopwiz-sec-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head><title>ShopWiz</title><!--og--><!--skins--></head><body></body></html>');
  writeFileSync(join(dir, 'manifest.webmanifest'), JSON.stringify({ name: 'ShopWiz', shortcuts: [{ name: 'Add item', url: '/add' }] }));
  let app;
  afterAll(async () => {
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a list name with $-patterns stays text in the page', async () => {
    app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: dir, publicUrl: 'https://shop.example' });
    const res = await app.inject({ method: 'POST', url: '/api/spaces', payload: { name: 'A $& B $` C', token: T1, deviceName: 'A' } });
    const { id } = res.json();
    const html = (await app.inject({ method: 'GET', url: `/${id}` })).body;
    expect(html).toContain('<title>A $&amp; B $` C · ShopWiz</title>');
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain('content="A $&amp; B $` C · ShopWiz"');
  });

  it('the manifest names the shortcut in the asked language', async () => {
    const de = await app.inject({ method: 'GET', url: '/manifest.webmanifest', headers: { 'accept-language': 'de-DE,de' } });
    expect(de.headers['content-type']).toContain('application/manifest+json');
    expect(de.json().shortcuts[0].name).toBe('Artikel hinzufügen');
    expect((await app.inject({ method: 'GET', url: '/manifest.webmanifest' })).json().shortcuts[0].name).toBe('Add item');
  });
});
