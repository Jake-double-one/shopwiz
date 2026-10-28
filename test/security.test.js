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

  it('the page of an ID tells nothing about it – not its name, not its ID, not whether it exists', async () => {
    app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: dir, publicUrl: 'https://shop.example' });
    const res = await app.inject({ method: 'POST', url: '/api/spaces', payload: { name: 'Secret household', token: T1, deviceName: 'A' } });
    const { id } = res.json();
    const html = (await app.inject({ method: 'GET', url: `/${id}` })).body;
    expect(html).toContain('<title>ShopWiz</title>');
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).not.toContain('Secret');
    expect(html).not.toContain(id);
    expect(html).toContain('content="https://shop.example/"');
    // an unknown ID gets the very same page
    expect((await app.inject({ method: 'GET', url: '/ABCDEFGH23' })).body).toBe(html);
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
  it('a hostile "ID" in the address costs no time – the parser is linear (was: one request stalled the server for a minute)', async () => {
    const app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist' });
    const t = performance.now();
    for (const id of ['a'.repeat(45) + '!', 'a'.repeat(99) + '!', 'a-'.repeat(49) + '!']) {
      const r = await app.inject({ method: 'GET', url: `/api/spaces/${id}/lists`, headers: { 'x-shopwiz-token': T1 } });
      expect(r.statusCode).toBe(404);
    }
    expect(performance.now() - t).toBeLessThan(500);
    await app.close();
  });
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

  it('imports from one address are limited to 60 per hour – new IDs do not multiply the budget', async () => {
    const app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist' });
    const doc = { lists: [{ name: 'L', items: [{ name: 'Milk' }] }] };
    const mk = async () => (await app.inject({ method: 'POST', url: '/api/spaces', payload: { name: 'I', token: T1 } })).json().id;
    const imp = async (sid) => (await app.inject({ method: 'POST', url: `/api/spaces/${sid}/import`, headers: { 'x-shopwiz-token': T1 }, payload: { doc } })).statusCode;
    for (let i = 0; i < 3; i++) {
      const sid = await mk();
      for (let j = 0; j < 20; j++) expect(await imp(sid)).toBe(200);
    }
    expect(await imp(await mk())).toBe(429);
    // a new ID from a backup counts as an import as well
    expect((await app.inject({ method: 'POST', url: '/api/spaces', payload: { name: 'I', token: T1, doc } })).statusCode).toBe(429);
    // another address has its own budget
    expect((await app.inject({ method: 'POST', url: '/api/spaces', payload: { name: 'I', token: T1, doc }, remoteAddress: '10.9.9.9' })).statusCode).toBe(200);
    await app.close();
  });
});

describe('transfer only into IDs one is in', () => {
  it('a known but not joined ID is no target; after joining it is', async () => {
    const app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist' });
    const mk = (name, token) => app.inject({ method: 'POST', url: '/api/spaces', payload: { name, token, deviceName: 'X' } }).then((r) => r.json().id);
    const src = await mk('Src', T1);
    const dst = await mk('Dst', 'token-otherotherotherother1');
    const itemId = 'itemitemitem';
    await app.inject({ method: 'POST', url: `/api/spaces/${src}/import`, headers: { 'x-shopwiz-token': T1 }, payload: { doc: { lists: [{ name: 'Src', items: [{ name: 'Soap' }] }] } } });
    const soap = app.store.snapshot(app.store.resolve(src, null).space.uid).items[0];
    const lists = await app.inject({ method: 'GET', url: `/api/spaces/${dst}/lists`, headers: { 'x-shopwiz-token': T1 } });
    expect(lists.statusCode).toBe(403);
    const dstList = app.store.snapshot(app.store.resolve(dst, null).space.uid).lists[0].id;
    const t1 = await app.inject({ method: 'POST', url: `/api/spaces/${src}/transfer`, headers: { 'x-shopwiz-token': T1 }, payload: { to: dst, listId: dstList, itemIds: [soap.id], mode: 'copy' } });
    expect(t1.json()).toEqual({ error: 'not_member' });
    // join → fine
    app.store.joinDevice(app.store.resolve(dst, null).space.uid, hashToken(T1), 'X');
    expect((await app.inject({ method: 'GET', url: `/api/spaces/${dst}/lists`, headers: { 'x-shopwiz-token': T1 } })).statusCode).toBe(200);
    const t2 = await app.inject({ method: 'POST', url: `/api/spaces/${src}/transfer`, headers: { 'x-shopwiz-token': T1 }, payload: { to: dst, listId: dstList, itemIds: [soap.id], mode: 'copy' } });
    expect(t2.json()).toEqual({ count: 1 });
    expect(itemId).toBeTruthy();
    await app.close();
  });
});

describe('audit run-1 fixes', () => {
  const A = 'token-auditauditauditaudit1';
  const B = 'token-auditauditauditaudit2';
  const mk = () => new Store(openDb(':memory:'), loadConfig({}));
  const now = () => Date.now();

  it('a kicked device cannot come back through "continue" on the deleted ID the space was continued from', () => {
    const store = mk();
    const S = store.createSpace({ name: 'S', token: A, deviceName: 'Alice' });
    const sUid = store.resolve(S, null).space.uid;
    store.joinDevice(sUid, hashToken(B), 'Bob');
    store.deleteSpace(sUid, 'Alice');
    const C = store.continueSpace(sUid, hashToken(A), 'Alice');
    expect(store.continueSpace(sUid, hashToken(B), 'Bob')).toBe(C);
    // a device continues once: afterwards only the new ID decides whether it is in
    expect(store.resolve(S, hashToken(B)).status).toBe('notfound');
    const cUid = store.resolve(C, null).space.uid;
    // Bob rejoins the old ID (as a stale client would) and gets kicked and locked out
    store.joinDevice(sUid, hashToken(B), 'Bob');
    expect(store.resolve(S, hashToken(B)).status).toBe('deleted');
    const alice = store.device(cUid, hashToken(A));
    const bob = store.device(cUid, hashToken(B));
    store.applyOp(cUid, alice, 'kick1', { k: 'device.kick', devId: bob.dev_id }, now());
    const C2 = store.renew(cUid);
    expect(store.isMember(cUid, hashToken(B))).toBe(false);
    // the way back is closed: no row in the predecessor, so no "continue" into C2
    expect(store.resolve(S, hashToken(B)).status).toBe('notfound');
    expect(store.isMember(cUid, hashToken(A))).toBe(true);
    expect(store.resolve(C2, hashToken(A)).status).toBe('ok');
  });

  it('the history keeps validated values only – a huge name or edit field takes no room', () => {
    const store = mk();
    const id = store.createSpace({ name: 'H', token: A, deviceName: 'A' });
    const uid = store.resolve(id, null).space.uid;
    const dev = store.device(uid, hashToken(A));
    const listId = store.snapshot(uid).lists[0].id;
    store.applyOp(uid, dev, 'o1', { k: 'space.update', name: 'N'.repeat(400_000), ttlDays: '30' + ' '.repeat(400_000) }, now());
    store.applyOp(uid, dev, 'o2', { k: 'item.add', id: 'itemaudit001', listId, name: 'Milk' }, now());
    store.applyOp(uid, dev, 'o3', { k: 'item.delete', ids: ['itemaudit001'] }, now());
    const r = store.applyOp(uid, dev, 'o4', { k: 'item.set', id: 'itemaudit001', fields: { junk: 'J'.repeat(400_000), name: 'x'.repeat(5000), checked: 1 } }, now());
    expect(r.result.rejected).toBe('deleted');
    const rows = store.db.q('SELECT action, payload FROM activity WHERE space_uid = ?').all(uid);
    for (const row of rows) expect(row.payload.length).toBeLessThan(1000);
    const upd = JSON.parse(rows.find((x) => x.action === 'space.update').payload);
    expect(upd).toEqual({ name: 'N'.repeat(80), ttlDays: 30 });
    const lost = JSON.parse(rows.find((x) => x.action === 'item.editDeleted').payload).fields;
    expect(lost).toEqual({ name: 'x'.repeat(120), checked: true });
  });

  it('linking lists works through a bounded group at once and remembers only what the undo needs', () => {
    const store = mk();
    const id = store.createSpace({ name: 'L', token: A, deviceName: 'A' });
    const uid = store.resolve(id, null).space.uid;
    const dev = store.device(uid, hashToken(A));
    const lists = [1, 2, 3].map((l) => ({ name: `L${l}`, items: Array.from({ length: 1400 }, (_, i) => ({ name: `L${l} item ${i}`, state: 'open' })) }));
    store.importDoc(uid, dev, { lists });
    const [l1, l2, l3] = store.snapshot(uid).lists.filter((l) => /^L\d$/.test(l.name)).map((l) => l.id);
    const res = store.applyOp(uid, dev, 'link1', { k: 'list.link', id: l1, other: l2 }, now());
    expect(res.result.linked).toBe(2);
    const undo = JSON.parse(store.db.q('SELECT result FROM applied_ops WHERE space_uid = ? AND op_id = ?').get(uid, 'link1').result)._undo;
    expect(undo.items).toHaveLength(2800);
    expect(Object.keys(undo.items[0]).sort()).toEqual(['checked', 'checked_by', 'checked_in', 'deleted_at', 'group_id', 'id', 'list_id', 'note', 'parked', 'places', 'pos', 'prio', 'qty', 'shared', 'unit']);
    // 2800 + 1400 shared items would be too much for one op
    expect(() => store.applyOp(uid, dev, 'link2', { k: 'list.link', id: l1, other: l3 }, now())).toThrow(/too many shared items/);
    expect(store.snapshot(uid).lists.find((l) => l.id === l3).linkId).toBeNull(); // rolled back, L3 stays on its own
    // the undo still works with the compact rows
    store.applyOp(uid, dev, 'undo1', { k: 'list.linkUndo', opId: 'link1' }, now());
    expect(store.snapshot(uid).items.filter((i) => i.shared).length).toBe(0);
  });
});

describe('hardening after audit run-1', () => {
  const A = 'token-hardhardhardhardhard1';
  const B = 'token-hardhardhardhardhard2';
  const fakeFetch = async (url) => {
    const q = new URL(url).searchParams.get('q');
    return { ok: true, status: 200, json: async () => ({ responseStatus: 200, responseData: { translatedText: `${q} (it)` } }) };
  };

  it('"Admin" stays reserved when dressed up with invisible characters, accents or spaces', () => {
    const store = new Store(openDb(':memory:'), loadConfig({}));
    const id = store.createSpace({ name: 'N', token: A, deviceName: 'Phone' });
    const uid = store.resolve(id, null).space.uid;
    for (const [i, name] of ['Admin​', 'A‌dmin', 'Ａdmin', 'A d m i n', 'Ádmin', 'ADMIN­'].entries()) {
      expect(store.joinDevice(uid, hashToken(`token-lookalike-${i}-xxxxxxxx`), name).name).toBe('Device');
    }
    expect(store.joinDevice(uid, hashToken(B), 'Admina').name).toBe('Admina');
  });

  it('a deleted ID shows nothing more, not even its history – continue it first', async () => {
    const app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist' });
    const id = (await app.inject({ method: 'POST', url: '/api/spaces', payload: { name: 'D', token: A, deviceName: 'A' } })).json().id;
    const get = (path) => app.inject({ method: 'GET', url: `/api/spaces/${id}/${path}`, headers: { 'x-shopwiz-token': A } });
    expect((await get('activity')).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/spaces/${id}/delete`, headers: { 'x-shopwiz-token': A }, payload: {} })).statusCode).toBe(200);
    expect((await get('activity')).json()).toEqual({ error: 'deleted' });
    expect((await get('translate/status')).statusCode).toBe(409);
    expect((await get('lists')).statusCode).toBe(404); // the lists were already gone
    await app.close();
  });

  it('the translate budget counts characters too, and the whole server has a daily cap', async () => {
    const app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist', fetch: fakeFetch, translateLimit: 300, translateDailyChars: 20_000 });
    const mk = async (token) => (await app.inject({ method: 'POST', url: '/api/spaces', payload: { name: 'T', token, deviceName: 'D' } })).json().id;
    const tr = (id, token, names, extra = {}) => app.inject({ method: 'POST', url: `/api/spaces/${id}/translate`, headers: { 'x-shopwiz-token': token }, payload: { lang: 'it', from: 'de', names, ...extra } });
    const long = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i}`.padEnd(120, 'x'));
    const id1 = await mk(A);
    // 300 names would be allowed by count, but 120 characters each is 36,000 – the character budget (12,000 per ID and hour) stops it
    expect((await tr(id1, A, long(50, 'a'))).statusCode).toBe(200); // 6,000 chars
    expect((await tr(id1, A, long(50, 'b'))).statusCode).toBe(200); // 12,000
    expect((await tr(id1, A, long(50, 'c'))).statusCode).toBe(429); // over the ID's character budget
    expect((await tr(id1, A, ['Milch'])).statusCode).toBe(429); // the budget is per hour – also for a short name now
    // another ID of the same client: its own ID budget, but the address budget (24,000) and the day (20,000) count on
    const id2 = await mk(B);
    expect((await tr(id2, B, long(50, 'd'))).statusCode).toBe(200); // 18,000 for the day
    expect((await tr(id2, B, long(50, 'e'))).statusCode).toBe(429); // 24,000 would pass the address, not the day
    // remembered names are free – unless force asks the provider again, which is charged
    expect((await tr(id2, B, long(50, 'd'))).statusCode).toBe(200);
    expect((await tr(id2, B, long(50, 'd'), { force: true })).statusCode).toBe(429);
    await app.close();
  });

  it('the op budget belongs to the device: reconnecting does not refill it', { timeout: 20_000 }, async () => {
    const app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const base = `127.0.0.1:${app.server.address().port}`;
    const id = (await (await fetch(`http://${base}/api/spaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'B', token: A, deviceName: 'A' }) })).json()).id;
    const connect = async (token) => {
      const ws = new WebSocket(`ws://${base}/ws`);
      const got = [];
      ws.addEventListener('message', (e) => got.push(JSON.parse(e.data)));
      await new Promise((r) => ws.addEventListener('open', r));
      ws.send(JSON.stringify({ t: 'hello', space: id, token, name: 'X' }));
      const until = (pred) => new Promise((resolve, reject) => { const t = setInterval(() => { const m = got.find(pred); if (m) (clearInterval(t), resolve(m)); }, 10); setTimeout(() => (clearInterval(t), reject(new Error('timeout'))), 5000); });
      await until((m) => m.t === 'welcome');
      return { ws, got, until };
    };
    const c1 = await connect(A);
    for (let i = 0; i < 700; i++) c1.ws.send(JSON.stringify({ t: 'op', id: `g${i}`, op: { k: 'space.update', name: `B ${i}` }, at: Date.now() }));
    await c1.until((m) => m.t === 'error' && m.error === 'busy');
    // the same device comes back: hello works, but its budget is still used up (it refills 10 a second,
    // so a handful of ops pass – a fresh bucket of 600 would take all of these)
    const c2 = await connect(A);
    for (let i = 0; i < 100; i++) c2.ws.send(JSON.stringify({ t: 'op', id: `h${i}`, op: { k: 'space.update', name: `after ${i}` }, at: Date.now() }));
    await c2.until((m) => m.t === 'error' && m.error === 'busy');
    expect(c2.got.filter((m) => m.t === 'ack').length).toBeLessThan(50);
    // another device in the same ID has its own budget
    const c3 = await connect(B);
    c3.ws.send(JSON.stringify({ t: 'op', id: 'other', op: { k: 'space.update', name: 'other' }, at: Date.now() }));
    await c3.until((m) => m.t === 'ack' && m.id === 'other' && m.ok);
    for (const c of [c1, c2, c3]) c.ws.close();
    await app.close();
  });
});
