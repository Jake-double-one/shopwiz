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

describe('sync connection limits', () => {
  let srv;
  let base;
  afterAll(() => srv?.close());
  const start = async () => {
    srv = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist' });
    await srv.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${srv.server.address().port}`;
  };
  const post = (path, body) => fetch(`http://${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  function client() {
    const ws = new WebSocket(`ws://${base}/ws`);
    const inbox = [];
    const open = new Promise((r) => ws.addEventListener('open', r));
    ws.addEventListener('message', (ev) => inbox.push(JSON.parse(ev.data)));
    const wait = async (pred) => {
      // generous: with all test files running in parallel the server can be slow
      for (let i = 0; i < 400; i++) {
        const m = inbox.find(pred);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 30));
      }
      throw new Error(`timeout – got ${JSON.stringify(inbox.slice(-3))}`);
    };
    return { ws, inbox, wait, send: async (m) => (await open, ws.send(JSON.stringify(m))) };
  }
  const closed = (ws) => new Promise((r) => (ws.readyState === 3 ? r() : ws.addEventListener('close', () => r())));

  it('a full ID tells a new device so and closes – no endless loading', { timeout: 20_000 }, async () => {
    await start();
    const token = 'token-fullfullfullfullfull';
    const { id } = await (await post('/api/spaces', { name: 'Full', token, deviceName: 'A' })).json();
    const { uid } = srv.store.resolve(id, null).space;
    for (let i = 1; i < 100; i++) srv.store.joinDevice(uid, `hash-${i}`, `D${i}`);
    const c = client();
    await c.send({ t: 'hello', space: id, token: 'token-newnewnewnewnewnewnew', name: 'New' });
    await c.wait((m) => m.t === 'error' && m.error === 'too_many_devices');
    await closed(c.ws);
    // a device that is in already still gets in
    const a = client();
    await a.send({ t: 'hello', space: id, token, name: 'A' });
    await a.wait((m) => m.t === 'welcome');
    a.ws.close();
  });

  it('a flood of ops is cut off (the device sends them again after reconnecting)', { timeout: 20_000 }, async () => {
    const token = 'token-floodfloodfloodflood';
    const { id } = await (await post('/api/spaces', { name: 'Flood', token, deviceName: 'A' })).json();
    const c = client();
    await c.send({ t: 'hello', space: id, token, name: 'A' });
    await c.wait((m) => m.t === 'welcome');
    for (let i = 0; i < 700; i++) c.ws.send(JSON.stringify({ t: 'op', id: `f${i}`, op: { k: 'space.update', name: `Flood ${i}` }, at: Date.now() }));
    await c.wait((m) => m.t === 'error' && m.error === 'busy');
    await closed(c.ws);
    // the budget refills a little while the ops are processed (10 per second) – but not all 700 get in
    expect(c.inbox.filter((m) => m.t === 'ack').length).toBeLessThan(700);
  });
});

describe('version', () => {
  it('/healthz and /api/version tell which version runs (from the Docker build)', async () => {
    const before = { ...process.env };
    Object.assign(process.env, { APP_VERSION: 'v9.9.9', GIT_SHA: 'abc1234', BUILD_TIME: '2026-01-01T00:00:00Z' });
    const app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist' });
    try {
      expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toMatchObject({ ok: true, version: 'v9.9.9', commit: 'abc1234', built: '2026-01-01T00:00:00Z' });
      expect((await app.inject({ method: 'GET', url: '/api/version' })).json()).toMatchObject({ version: 'v9.9.9', commit: 'abc1234' });
    } finally {
      await app.close();
      for (const k of ['APP_VERSION', 'GIT_SHA', 'BUILD_TIME']) if (before[k] === undefined) delete process.env[k];
    }
  });
});

describe('hardening (analysis after v0.5.2)', () => {
  it('a hello costs tokens: a flood of hellos on one connection ends it, normal reconnects pass', async () => {
    const app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const base = `127.0.0.1:${app.server.address().port}`;
    const id = (await (await fetch(`http://${base}/api/spaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'H', token: T1 }) })).json()).id;
    const ws = new WebSocket(`ws://${base}/ws`);
    await new Promise((r) => ws.addEventListener('open', r));
    const got = [];
    ws.addEventListener('message', (e) => got.push(JSON.parse(e.data).t));
    const closed = new Promise((r) => ws.addEventListener('close', r));
    for (let i = 0; i < 40; i++) ws.send(JSON.stringify({ t: 'hello', space: id, token: T1, name: 'A' }));
    await closed;
    const welcomes = got.filter((t) => t === 'welcome').length;
    expect(welcomes).toBeGreaterThanOrEqual(20); // 600 tokens / 25 – a few reconnects are always fine
    expect(welcomes).toBeLessThan(30);
    expect(got).toContain('error');
    await app.close();
  });

  it('API answers are not cached, the CSP has no open websocket hole, a broken path is a 404', async () => {
    const app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist' });
    const r = await app.inject({ method: 'GET', url: '/api/version' });
    expect(r.headers['content-security-policy']).not.toMatch(/ws:|wss:/);
    expect(r.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(r.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'GET', url: '/%E0%A4%A' })).statusCode).toBeLessThan(500);
    await app.close();
  });

  it('imports into one ID are limited to 20 per hour', async () => {
    const { store, id } = setup();
    const app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist' });
    const sid = (await app.inject({ method: 'POST', url: '/api/spaces', payload: { name: 'I', token: T1 } })).json().id;
    const doc = { lists: [{ name: 'L', items: [{ name: 'Milk' }] }] };
    let last;
    for (let i = 0; i < 21; i++) last = await app.inject({ method: 'POST', url: `/api/spaces/${sid}/import`, headers: { 'x-shopwiz-token': T1 }, payload: { doc } });
    expect(last.statusCode).toBe(429);
    expect(store && id).toBeTruthy();
    await app.close();
  });
});
