// The optional administration: login, passkeys (with a software authenticator), D-IDs,
// promotion, the admin inside an ID, and SPACES_PER_DEVICE.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { hashPassword, verifyPassword, parseHash } from '../server/password.js';
import { didOfHash } from '../server/admin.js';
import { hashToken } from '../server/core.js';
import { didOfToken, parseDid } from '../shared/did.js';

const PASSWORD = 'correct horse battery staple';
const T1 = 'token-adminadminadminadmin1'; // a member, later promoted
const T2 = 'token-adminadminadminadmin2'; // another member
const T3 = 'token-adminadminadminadmin3'; // a stranger

// ---------- a tiny software passkey (what a phone's secure chip does) ----------
const b64 = (b) => Buffer.from(b).toString('base64url');
function cbor(v) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  };
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  const entries = v instanceof Map ? [...v] : Object.entries(v);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}
function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = randomBytes(16);
  let count = 0;
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  const rpHash = (rpId) => createHash('sha256').update(rpId).digest();
  const counter = () => Buffer.from([0, 0, 0, ++count]);
  return {
    id: b64(credId),
    create(options, origin) {
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
      const len = Buffer.from([credId.length >> 8, credId.length & 255]);
      const authData = Buffer.concat([rpHash(options.rp.id), Buffer.from([0x45]), counter(), Buffer.alloc(16), len, credId, cose]);
      const attestationObject = cbor({ fmt: 'none', attStmt: {}, authData });
      return {
        id: b64(credId),
        rawId: b64(credId),
        type: 'public-key',
        response: { clientDataJSON: b64(clientData), attestationObject: b64(attestationObject), transports: ['internal'] },
        clientExtensionResults: {},
      };
    },
    get(options, origin) {
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
      const authData = Buffer.concat([rpHash(options.rpId), Buffer.from([0x05]), counter()]);
      const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(clientData).digest()]), privateKey);
      return {
        id: b64(credId),
        rawId: b64(credId),
        type: 'public-key',
        response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(signature) },
        clientExtensionResults: {},
      };
    },
  };
}

// ---------- server ----------
let app;
let base;
async function start(extra = {}) {
  const a = await buildApp({
    ...loadConfig({}), registrations: 'open',
    dataDir: ':memory:',
    staticDir: './does-not-exist',
    adminUser: 'boss',
    adminPasswordHash: await hashPassword(PASSWORD, { N: 1024, r: 8, p: 1 }),
    ...extra,
  });
  await a.listen({ port: 0, host: '127.0.0.1' });
  return a;
}
beforeAll(async () => {
  app = await start({ spacesPerDevice: 2 });
  base = `127.0.0.1:${app.server.address().port}`;
});
afterAll(() => app.close());

const origin = () => `http://${base}`;
async function req(method, path, { body, token, session } = {}) {
  const res = await fetch(`http://${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { 'x-shopwiz-token': token }), ...(session && { 'x-shopwiz-admin': session }) },
    body: body ? JSON.stringify(body) : method === 'POST' ? '{}' : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const login = async () => (await req('POST', '/api/admin/login', { body: { user: 'boss', password: PASSWORD } })).body.session;

function client() {
  const ws = new WebSocket(`ws://${base}/ws`);
  const inbox = [];
  const waiters = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    inbox.push(msg);
    for (const w of [...waiters]) if (w.pred(msg)) waiters.splice(waiters.indexOf(w), 1), w.resolve(msg);
  });
  const open = new Promise((r) => ws.addEventListener('open', r));
  return {
    inbox,
    send: async (m) => (await open, ws.send(JSON.stringify(m))),
    wait: (pred) =>
      new Promise((resolve, reject) => {
        const found = inbox.find(pred);
        if (found) return resolve(found);
        waiters.push({ pred, resolve });
        setTimeout(() => reject(new Error('timeout')), 2000);
      }),
    close: () => ws.close(),
  };
}

let spaceId;
beforeAll(async () => {
  spaceId = (await req('POST', '/api/spaces', { body: { name: 'Home', token: T1, deviceName: 'Phone', listName: 'Weekly' } })).body.id;
});

describe('password hash', () => {
  it('checks the right password only, and rejects broken hashes', async () => {
    const h = await hashPassword('hunter2hunter2', { N: 1024, r: 8, p: 1 });
    expect(h).toMatch(/^scrypt:1024:8:1:/);
    expect(await verifyPassword('hunter2hunter2', h)).toBe(true);
    expect(await verifyPassword('hunter2hunter3', h)).toBe(false);
    expect(parseHash('scrypt:1000:8:1:aaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).toBe(null);
    expect(parseHash('$2b$10$bcrypt')).toBe(null);
  });
});

describe('D-ID', () => {
  it('is the same on server and client, and readable', async () => {
    const did = didOfHash(hashToken(T1));
    expect(did).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect(await didOfToken(T1)).toBe(did);
    expect(parseDid(did.toLowerCase().replace('-', ' '))).toBe(did);
    expect(parseDid('abc')).toBe(null);
    expect(didOfHash(hashToken(T2))).not.toBe(did);
  });
});

describe('administration switched off', () => {
  it('has no admin addresses and says so in the welcome', async () => {
    const off = await buildApp({ ...loadConfig({}), registrations: 'open', dataDir: ':memory:', staticDir: './does-not-exist' });
    const res = await off.inject({ method: 'GET', url: '/api/admin/status' });
    expect(res.statusCode).toBe(404);
    // a user without a valid hash: still off
    const broken = await buildApp({ ...loadConfig({}), registrations: 'open', dataDir: ':memory:', staticDir: './does-not-exist', adminUser: 'boss', adminPasswordHash: 'plain-password' });
    expect((await broken.inject({ method: 'POST', url: '/api/admin/login', payload: { user: 'boss', password: 'plain-password' } })).statusCode).toBe(404);
    await off.close();
    await broken.close();
  });
});

describe('main admin', () => {
  it('logs in with user + password only, and the session is needed for everything', async () => {
    expect((await req('GET', '/api/admin/overview')).status).toBe(401);
    expect((await req('POST', '/api/admin/login', { body: { user: 'boss', password: 'wrong' } })).status).toBe(401);
    expect((await req('POST', '/api/admin/login', { body: { user: 'Boss', password: PASSWORD } })).status).toBe(401);
    const session = await login();
    expect(session).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const ov = await req('GET', '/api/admin/overview', { session });
    expect(ov.status).toBe(200);
    expect(ov.body.me).toEqual({ role: 'main', did: null });
    const home = ov.body.spaces.find((s) => s.id === spaceId);
    expect(home).toMatchObject({ name: 'Home', lists: 1, items: 0, devices: 1 });
    expect(home.kb).toBeGreaterThan(0);
    // devices by D-ID, with the IDs they are in – never their secret
    const dev = ov.body.devices.find((d) => d.did === didOfHash(hashToken(T1)));
    expect(dev).toMatchObject({ names: ['Phone'], spaces: [{ id: spaceId, name: 'Home' }], admin: null });
    expect(JSON.stringify(ov.body)).not.toContain(hashToken(T1));
    // the failed attempts are in the log, without addresses
    expect(ov.body.log.some((e) => e.action === 'login_failed' && e.detail.count === 2)).toBe(true);
    expect(JSON.stringify(ov.body.log)).not.toContain('127.0.0.1');
    // logout ends it
    await req('POST', '/api/admin/logout', { session });
    expect((await req('GET', '/api/admin/overview', { session })).status).toBe(401);
  });

  it('stops guessing after 10 failed logins per address', async () => {
    const a = await start();
    const url = `http://127.0.0.1:${a.server.address().port}/api/admin/login`;
    const tryIt = (password) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'boss', password }) });
    for (let i = 0; i < 10; i++) expect((await tryIt('nope')).status).toBe(401);
    expect((await tryIt(PASSWORD)).status).toBe(429);
    await a.close();
  });
});

describe('promoting a device (D-ID + passkey)', () => {
  const key = authenticator();
  const did = didOfHash(hashToken(T1));
  let code; // the promotion code the main admin passes on

  it('a device is nothing until the main admin promotes it', async () => {
    expect((await req('GET', '/api/admin/status', { token: T1 })).body).toMatchObject({ did, role: null });
    expect((await req('POST', '/api/admin/passkey/options', { token: T1, body: { purpose: 'register' } })).status).toBe(403);
  });

  it('only the main admin promotes – and the device hears about it right away', async () => {
    const ws = client();
    await ws.send({ t: 'hello', space: spaceId, token: T1, name: 'Phone' });
    const welcome = await ws.wait((m) => m.t === 'welcome');
    expect(welcome.features.admin).toBe(true);
    expect(welcome.admin).toEqual({ role: null, since: null, until: null });

    const session = await login();
    expect((await req('POST', '/api/admin/promote', { session, body: { did: 'nonsense' } })).status).toBe(400);
    const r = await req('POST', '/api/admin/promote', { session, body: { did: did.toLowerCase() } });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('pending');
    expect(r.body.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    code = r.body.code;
    // shown again in the overview while it waits – to the main admin only
    expect((await req('GET', '/api/admin/overview', { session })).body.admins[0].code).toBe(code);
    expect(r.body.until - Date.now()).toBeGreaterThan(23 * 3600_000);
    expect((await ws.wait((m) => m.t === 'admin')).role).toBe('pending');
    expect((await req('GET', '/api/admin/status', { token: T1 })).body.role).toBe('pending');
    ws.close();
  });

  it('the promoted device sets up exactly one passkey – only with the promotion code', async () => {
    // a copy of the device's key (infostealer) without the code gets nowhere
    const stolen = await req('POST', '/api/admin/passkey/options', { token: T1, body: { purpose: 'register' } });
    expect(stolen.status).toBe(401);
    expect(stolen.body.error).toBe('wrong_code');
    expect((await req('POST', '/api/admin/passkey/options', { token: T1, body: { purpose: 'register', code: 'AAAA-BBBB' } })).status).toBe(401);
    const opt = await req('POST', '/api/admin/passkey/options', { token: T1, body: { purpose: 'register', code: code.toLowerCase().replace('-', ' ') } });
    expect(opt.status).toBe(200);
    // a ticket that was changed is worthless
    const forged = opt.body.ticket.replace(/^./, (c) => (c === 'e' ? 'f' : 'e'));
    expect((await req('POST', '/api/admin/passkey/verify', { token: T1, body: { ticket: forged, response: key.create(opt.body.options, origin()) } })).status).toBe(400);
    expect(opt.body.options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
    const done = await req('POST', '/api/admin/passkey/verify', { token: T1, body: { ticket: opt.body.ticket, response: key.create(opt.body.options, origin()) } });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ role: 'device', did });
    // one passkey per promotion
    const again = await req('POST', '/api/admin/passkey/options', { token: T1, body: { purpose: 'register', code } });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('own_key');
    const session = await login();
    const ov = (await req('GET', '/api/admin/overview', { session })).body;
    expect(ov.admins).toEqual([expect.objectContaining({ did, state: 'active', names: ['Phone'], keys: [expect.objectContaining({ synced: false })] })]);
    expect(ov.admins[0].code).toBeUndefined();
    expect(ov.alerts.map((e) => e.action)).toEqual(expect.arrayContaining(['passkey_registered', 'login_failed']));
  });

  it('never only one factor: the passkey needs its device, the device needs its passkey', async () => {
    const opts = async () => (await req('POST', '/api/admin/passkey/options', { token: T1, body: { purpose: 'login' } })).body;
    // right device, right passkey
    let o = await opts();
    const ok = await req('POST', '/api/admin/passkey/verify', { token: T1, body: { ticket: o.ticket, response: key.get(o.options, origin()) } });
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe('device');
    const session = ok.body.session;
    expect((await req('GET', '/api/admin/overview', { session, token: T1 })).status).toBe(200);
    // the session alone (stolen from memory) is useless without the device's key …
    expect((await req('GET', '/api/admin/overview', { session })).status).toBe(401);
    expect((await req('GET', '/api/admin/overview', { session, token: T2 })).status).toBe(401);
    // … and the passkey on another device (a synced copy) doesn't log in
    o = await opts();
    const other = await req('POST', '/api/admin/passkey/verify', { token: T2, body: { ticket: o.ticket, response: key.get(o.options, origin()) } });
    expect(other.status).toBe(403);
    expect(other.body.error).toBe('other_device');
    // an unknown passkey doesn't either
    o = await opts();
    expect((await req('POST', '/api/admin/passkey/verify', { token: T1, body: { ticket: o.ticket, response: authenticator().get(o.options, origin()) } })).status).toBe(401);
    // a challenge is used once
    o = await opts();
    const resp = key.get(o.options, origin());
    expect((await req('POST', '/api/admin/passkey/verify', { token: T1, body: { ticket: o.ticket, response: resp } })).status).toBe(200);
    expect((await req('POST', '/api/admin/passkey/verify', { token: T1, body: { ticket: o.ticket, response: resp } })).status).toBe(400);
  });

  it('device admins see everything but cannot promote; revoking ends their session', async () => {
    let o = (await req('POST', '/api/admin/passkey/options', { token: T1, body: { purpose: 'login' } })).body;
    const session = (await req('POST', '/api/admin/passkey/verify', { token: T1, body: { ticket: o.ticket, response: key.get(o.options, origin()) } })).body.session;
    expect((await req('POST', '/api/admin/promote', { session, token: T1, body: { did: didOfHash(hashToken(T2)) } })).status).toBe(403);
    const main = await login();
    expect((await req('POST', '/api/admin/revoke', { session: main, body: { did } })).status).toBe(200);
    expect((await req('GET', '/api/admin/overview', { session, token: T1 })).status).toBe(401);
    o = (await req('POST', '/api/admin/passkey/options', { token: T1, body: { purpose: 'login' } })).body;
    expect((await req('POST', '/api/admin/passkey/verify', { token: T1, body: { ticket: o.ticket, response: key.get(o.options, origin()) } })).status).toBe(401);
    expect((await req('GET', '/api/admin/status', { token: T1 })).body.role).toBe(null);
    // promoted again: a new code – the old one is worthless
    const again = await req('POST', '/api/admin/promote', { session: main, body: { did } });
    expect(again.body.code).not.toBe(code);
    expect((await req('POST', '/api/admin/passkey/options', { token: T1, body: { purpose: 'register', code } })).status).toBe(401);
    await req('POST', '/api/admin/revoke', { session: main, body: { did } });
  });

  it('the main admin can have passkeys too – registering needs a recent login', async () => {
    const session = await login();
    const mk = authenticator();
    const opt = await req('POST', '/api/admin/passkey/options', { session, body: { purpose: 'register' } });
    expect(opt.status).toBe(200);
    expect((await req('POST', '/api/admin/passkey/verify', { session, body: { ticket: opt.body.ticket, response: mk.create(opt.body.options, origin()) } })).status).toBe(200);
    // with it, the main admin logs in on any device
    const o = (await req('POST', '/api/admin/passkey/options', { token: T3, body: { purpose: 'login' } })).body;
    const r = await req('POST', '/api/admin/passkey/verify', { token: T3, body: { ticket: o.ticket, response: mk.get(o.options, origin()) } });
    expect(r.body).toMatchObject({ role: 'main', did: null });
    const ov = (await req('GET', '/api/admin/overview', { session: r.body.session })).body;
    expect(ov.mainKeys).toHaveLength(1);
  });
});

describe('admin inside an ID', () => {
  it('shows as "Admin" while there, edits as "Admin", leaves no device row, and is in the history', async () => {
    const member = client();
    await member.send({ t: 'hello', space: spaceId, token: T2, name: 'Tablet' });
    await member.wait((m) => m.t === 'welcome');

    // a made-up session gets nowhere
    const fake = client();
    await fake.send({ t: 'hello', space: spaceId, token: T3, admin: 'x'.repeat(43) });
    expect((await fake.wait((m) => m.t === 'error')).error).toBe('admin_auth');
    fake.close();

    const session = await login();
    const admin = client();
    await admin.send({ t: 'hello', space: spaceId, token: T3, admin: session });
    const welcome = await admin.wait((m) => m.t === 'welcome');
    expect(welcome.me).toEqual({ devId: 'admin', name: 'Admin', admin: true });
    expect(welcome.snapshot.devices.map((d) => d.name).sort()).toEqual(['Phone', 'Tablet']);
    expect((await member.wait((m) => m.t === 'presence' && m.online.includes('admin'))).online).toContain('admin');

    // full access: add an item
    const listId = welcome.snapshot.lists[0].id;
    // ... but an admin's visit and edits are not activity of the ID: the "last used" time (and with
    // it the day the ID is deleted) stays where the members left it
    const lastActive = () => app.store.db.q('SELECT last_active_at FROM spaces WHERE public_id = ?').get(spaceId).last_active_at;
    const yesterday = Date.now() - 86_400_000;
    app.store.db.q('UPDATE spaces SET last_active_at = ? WHERE public_id = ?').run(yesterday, spaceId);
    await admin.send({ t: 'op', id: 'a1', op: { k: 'item.add', id: 'admitem00001', listId, name: 'Milk', pos: 1 }, at: Date.now() });
    expect((await admin.wait((m) => m.t === 'ack' && m.id === 'a1')).ok).toBe(true);
    const patch = await member.wait((m) => m.t === 'patch' && m.changes.some((c) => c.row?.name === 'Milk'));
    expect(patch.changes.find((c) => c.e === 'item').row.addedBy).toBe('Admin');
    expect(lastActive()).toBe(yesterday);
    await member.send({ t: 'op', id: 'm1', op: { k: 'item.add', id: 'memitem00001', listId, name: 'Eggs', pos: 2 }, at: Date.now() });
    expect((await member.wait((m) => m.t === 'ack' && m.id === 'm1')).ok).toBe(true);
    expect(lastActive()).toBeGreaterThan(yesterday); // a member's edit counts
    // nothing personal: no check-in, no renaming a device that isn't there
    await admin.send({ t: 'op', id: 'a2', op: { k: 'device.shopping', on: true }, at: Date.now() });
    expect((await admin.wait((m) => m.t === 'ack' && m.id === 'a2')).ok).toBe(false);

    // REST with the session (history) – and the history says an admin was here
    const act = await req('GET', `/api/spaces/${spaceId}/activity?list=${listId}`, { session, token: T3 });
    expect(act.status).toBe(200);
    expect(act.body.activity.map((e) => [e.by, e.action])).toEqual(expect.arrayContaining([['Admin', 'admin.open'], ['Admin', 'item.add']]));
    // the admin never became a device of the ID, and its own device isn't a member either
    const ov = (await req('GET', '/api/admin/overview', { session })).body;
    expect(ov.spaces.find((s) => s.id === spaceId).devices).toBe(2);
    expect((await req('GET', `/api/spaces/${spaceId}/activity?list=${listId}`, { token: T3 })).status).toBe(403);
    expect(ov.log.some((e) => e.action === 'space_open' && e.detail.name === 'Home')).toBe(true);

    // logging out takes the admin out of the ID
    await req('POST', '/api/admin/logout', { session });
    await admin.wait((m) => m.t === 'adminEnded');
    await member.wait((m) => m.t === 'presence' && !m.online.includes('admin'));
    member.close();
  });

  it('deletes an ID for good – members are told, the ID is never given out again', async () => {
    const id = (await req('POST', '/api/spaces', { body: { name: 'Spam', token: T3, deviceName: 'X' } })).body.id;
    const member = client();
    await member.send({ t: 'hello', space: id, token: T3, name: 'X' });
    await member.wait((m) => m.t === 'welcome');
    const session = await login();
    expect((await req('POST', `/api/admin/spaces/${id}/delete`, { session })).status).toBe(200);
    expect(await member.wait((m) => m.t === 'deleted')).toMatchObject({ by: 'Admin', final: true });
    expect((await req('GET', `/api/spaces/${id}/lists`)).status).toBe(404);
    const ov = (await req('GET', '/api/admin/overview', { session })).body;
    expect(ov.spaces.some((s) => s.id === id)).toBe(false);
    expect(ov.log[0]).toMatchObject({ action: 'space_delete', detail: { name: 'Spam' } });
  });
});

describe('SPACES_PER_DEVICE', () => {
  it('counts only the IDs a device created itself and that still exist', async () => {
    const T = 'token-limitlimitlimitlimit1';
    const make = () => req('POST', '/api/spaces', { body: { name: 'L', token: T } });
    const a = (await make()).body.id;
    expect((await make()).status).toBe(200);
    const third = await make();
    expect(third.status).toBe(403);
    expect(third.body).toEqual({ error: 'space_limit', limit: 2 });
    // joining another ID is fine
    const ws = client();
    await ws.send({ t: 'hello', space: spaceId, token: T, name: 'L' });
    await ws.wait((m) => m.t === 'welcome');
    ws.close();
    // deleting one frees a place; continuing a deleted one doesn't take a new place
    await req('POST', `/api/spaces/${a}/delete`, { token: T });
    expect((await make()).status).toBe(200);
  });
});

describe('setting up in the browser (ADMIN=on, code from the log)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopwiz-admin-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  async function boot(admin) {
    let said = null;
    const a = await buildApp({ ...loadConfig({}), registrations: 'open', dataDir: dir, staticDir: './does-not-exist', admin, announce: (m) => (said = m) });
    await a.listen({ port: 0, host: '127.0.0.1' });
    const url = `http://127.0.0.1:${a.server.address().port}`;
    const call = async (method, path, body, session) => {
      const res = await fetch(url + path, {
        method,
        headers: { 'content-type': 'application/json', 'x-shopwiz-token': T3, ...(session && { 'x-shopwiz-admin': session }) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    return { a, call, code: said?.match(/setup code:\s+([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4})/)?.[1] ?? null };
  }

  it('the first start writes a one-time code to the log; with it the main admin is created at /admin', async () => {
    const { a, call, code } = await boot('on');
    expect(code).toBeTruthy();
    expect((await call('GET', '/api/admin/status')).body.setup).toBe(true);
    expect((await call('POST', '/api/admin/login', { user: 'jake', password: 'whatever whatever' })).body.error).toBe('setup');
    // the code is needed, and a real password
    expect((await call('POST', '/api/admin/setup', { code: 'AAAA-AAAA-AAAA', user: 'jake', password: 'long enough pass' })).status).toBe(401);
    expect((await call('POST', '/api/admin/setup', { code, user: 'jake', password: 'short' })).body.error).toBe('weak_password');
    // typed loosely: lower case, spaces, an O for a 0
    const loose = code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o');
    const r = await call('POST', '/api/admin/setup', { code: loose, user: 'jake', password: 'my long admin password' });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('main');
    expect((await call('GET', '/api/admin/overview', null, r.body.session)).status).toBe(200);
    // used once
    expect((await call('GET', '/api/admin/status')).body.setup).toBe(false);
    expect((await call('POST', '/api/admin/setup', { code, user: 'evil', password: 'my long admin password' })).status).toBe(409);
    expect((await call('POST', '/api/admin/login', { user: 'jake', password: 'my long admin password' })).status).toBe(200);
    // the password login can only be switched off with a passkey
    expect((await call('POST', '/api/admin/password-login', { on: false }, r.body.session)).body.error).toBe('no_key');
    await a.close();
  });

  it('later starts write no code; ADMIN=reset sets the main admin up again', async () => {
    let b = await boot('on');
    expect(b.code).toBe(null);
    expect((await b.call('GET', '/api/admin/status')).body.setup).toBe(false);
    await b.a.close();

    b = await boot('reset');
    expect(b.code).toBeTruthy();
    // the old password still works until the new one is set
    expect((await b.call('POST', '/api/admin/login', { user: 'jake', password: 'my long admin password' })).status).toBe(200);
    const r = await b.call('POST', '/api/admin/setup', { code: b.code, user: 'jake2', password: 'a brand new password' });
    expect(r.status).toBe(200);
    expect((await b.call('POST', '/api/admin/login', { user: 'jake', password: 'my long admin password' })).status).toBe(401);
    expect((await b.call('POST', '/api/admin/login', { user: 'jake2', password: 'a brand new password' })).status).toBe(200);
    const log = (await b.call('GET', '/api/admin/overview', null, r.body.session)).body.log.map((e) => e.action);
    expect(log).toEqual(expect.arrayContaining(['setup', 'reset']));
    await b.a.close();
  });
});

describe('audit fixes', () => {
  it('API answers are never kept in the browser cache', async () => {
    const res = await fetch(`http://${base}/api/version`);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('no device may call itself "Admin"', async () => {
    const T = 'token-namednamednamedadmin1';
    const id = (await req('POST', '/api/spaces', { body: { name: 'N', token: T, deviceName: 'admin' } })).body.id;
    const ws = client();
    await ws.send({ t: 'hello', space: id, token: T, name: 'ADMIN' });
    const w = await ws.wait((m) => m.t === 'welcome');
    expect(w.me.name).toBe('Device');
    await ws.send({ t: 'op', id: 'rn1', op: { k: 'device.rename', name: 'Admin' }, at: Date.now() });
    expect((await ws.wait((m) => m.t === 'ack' && m.id === 'rn1')).ok).toBe(false);
    ws.close();
  });

  it('an admin over REST is recorded like one opening the ID, and connects no assistants', async () => {
    const T = 'token-restrestrestrestrest1';
    const id = (await req('POST', '/api/spaces', { body: { name: 'Quiet', token: T, deviceName: 'A' } })).body.id;
    const session = await login();
    const lists = await req('GET', `/api/spaces/${id}/lists`, { session, token: T3 });
    const act = await req('GET', `/api/spaces/${id}/activity?list=${lists.body.lists[0].id}`, { session, token: T3 });
    expect(act.body.activity.some((e) => e.action === 'admin.open' && e.payload.admin)).toBe(true);
    expect((await req('POST', `/api/spaces/${id}/ai`, { session, token: T3, body: { name: 'Bot' } })).status).toBe(403);
  });

  it('continuing a deleted ID counts for the device that continues, within its limit', async () => {
    const A = 'token-continuecontinuecon1';
    const B = 'token-continuecontinuecon2';
    const x = (await req('POST', '/api/spaces', { body: { name: 'X', token: A, deviceName: 'A' } })).body.id;
    const ws = client();
    await ws.send({ t: 'hello', space: x, token: B, name: 'B' });
    await ws.wait((m) => m.t === 'welcome');
    ws.close();
    await req('POST', `/api/spaces/${x}/delete`, { token: B });
    const y = await req('POST', `/api/spaces/${x}/continue`, { token: B, body: { deviceName: 'B' } });
    expect(y.status).toBe(200);
    // A's place is free again, B has one now
    expect((await req('POST', '/api/spaces', { body: { name: 'A2', token: A } })).status).toBe(200);
    expect((await req('POST', '/api/spaces', { body: { name: 'B2', token: B } })).status).toBe(200);
    // B is at its limit (2): deleting and continuing doesn't get it a third
    await req('POST', `/api/spaces/${y.body.id}/delete`, { token: B });
    expect((await req('POST', '/api/spaces', { body: { name: 'B3', token: B } })).status).toBe(200);
    const z = await req('POST', `/api/spaces/${y.body.id}/continue`, { token: B, body: { deviceName: 'B' } });
    expect(z.body).toEqual({ error: 'space_limit', limit: 2 });
  });

  it('deleting for good also takes the deleted ID it was continued from – "continue" can\'t bring it back', async () => {
    const T = 'token-purgepurgepurgepurge1';
    const x = (await req('POST', '/api/spaces', { body: { name: 'Old', token: T, deviceName: 'P' } })).body.id;
    await req('POST', `/api/spaces/${x}/delete`, { token: T });
    const y = (await req('POST', `/api/spaces/${x}/continue`, { token: T, body: { deviceName: 'P' } })).body.id;
    const session = await login();
    expect((await req('POST', `/api/admin/spaces/${y}/delete`, { session })).status).toBe(200);
    expect((await req('POST', `/api/spaces/${x}/continue`, { token: T, body: { deviceName: 'P' } })).status).toBe(404);
  });

  it('asking for many passkey challenges does not push out anybody else\'s', async () => {
    const mine = (await req('POST', '/api/admin/passkey/options', { body: { purpose: 'login' } })).body;
    await Promise.all(Array.from({ length: 600 }, () => req('POST', '/api/admin/passkey/options', { body: { purpose: 'login' } })));
    const r = await req('POST', '/api/admin/passkey/verify', { body: { ticket: mine.ticket, response: authenticator().get(mine.options, origin()) } });
    expect(r.body.error).toBe('wrong'); // the ticket is still good – only the (unknown) passkey is not
  });

  it('TRUST_PROXY: only the proxy in front is believed, not what a client writes into the header', async () => {
    const { trustProxy } = await import('../server/config.js');
    expect(trustProxy('true')).toBe('loopback, linklocal, uniquelocal');
    expect(trustProxy('2')('10.0.0.1', 1)).toBe(true);
    expect(trustProxy('2')('10.0.0.1', 2)).toBe(false);
    expect(trustProxy('false')).toBe(false);
    expect(trustProxy('')).toBe(false);
    const a = await buildApp({ ...loadConfig({ TRUST_PROXY: 'true' }), dataDir: ':memory:', staticDir: './does-not-exist', adminUser: 'boss', adminPasswordHash: await hashPassword(PASSWORD, { N: 1024, r: 8, p: 1 }) });
    const tryIt = (xff) => a.inject({ method: 'POST', url: '/api/admin/login', headers: { 'x-forwarded-for': xff }, payload: { user: 'boss', password: 'nope' } });
    // a client rotating the first address of the header still counts as the address the proxy saw
    for (let i = 0; i < 10; i++) expect((await tryIt(`10.0.0.${i}, 198.51.100.7`)).statusCode).toBe(401);
    expect((await tryIt('10.0.0.99, 198.51.100.7')).statusCode).toBe(429);
    // and IPv6 counts per /64
    for (let i = 0; i < 10; i++) expect((await tryIt(`2001:db8:1:2::${i + 1}`)).statusCode).toBe(401);
    expect((await tryIt('2001:db8:1:2:ffff::1')).statusCode).toBe(429);
    await a.close();
  });
});

describe('hardening (analysis after v0.5.2)', () => {
  it('password login and setup only over HTTPS (or from this machine)', async () => {
    const a = await start();
    const plain = await a.inject({ method: 'POST', url: '/api/admin/login', headers: { host: 'shop.example.com' }, payload: { user: 'boss', password: PASSWORD } });
    expect(plain.json()).toEqual({ error: 'https' });
    const viaProxy = await a.inject({ method: 'POST', url: '/api/admin/login', headers: { host: 'shop.example.com', 'x-forwarded-proto': 'https' }, payload: { user: 'boss', password: PASSWORD } });
    expect(viaProxy.statusCode).toBe(200);
    const local = await a.inject({ method: 'POST', url: '/api/admin/login', headers: { host: 'localhost:8080' }, payload: { user: 'boss', password: PASSWORD } });
    expect(local.statusCode).toBe(200);
    await a.close();
  });

  it('a registration ticket carries no key hash of the device', async () => {
    const session = await login();
    const did = didOfHash(hashToken(T2));
    const { code } = (await req('POST', '/api/admin/promote', { session, body: { did } })).body;
    const opt = await req('POST', '/api/admin/passkey/options', { token: T2, body: { purpose: 'register', code } });
    expect(opt.status).toBe(200);
    const body = Buffer.from(opt.body.ticket.split('.')[0], 'base64url').toString();
    expect(body).not.toContain(hashToken(T2));
    expect(JSON.parse(body).bind).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    // and it still only works for that device
    const other = await req('POST', '/api/admin/passkey/verify', { token: T3, body: { ticket: opt.body.ticket, response: authenticator().create(opt.body.options, origin()) } });
    expect(other.body.error).toBe('not_admin');
    await req('POST', '/api/admin/revoke', { session, body: { did } });
  });
});

describe('main admin credential changes (audit run-1)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopwiz-cred-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const OLD = 'old leaked password 1';
  const NEW = 'brand new rotated password 2';

  async function boot(extra) {
    let said = null;
    const a = await buildApp({ ...loadConfig({}), registrations: 'open', dataDir: dir, staticDir: './does-not-exist', announce: (m) => (said = m), ...extra });
    await a.listen({ port: 0, host: '127.0.0.1' });
    const url = `http://127.0.0.1:${a.server.address().port}`;
    const call = async (method, path, { body, session } = {}) => {
      const res = await fetch(url + path, {
        method,
        headers: { 'content-type': 'application/json', 'x-shopwiz-token': T3, ...(session && { 'x-shopwiz-admin': session }) },
        body: body ? JSON.stringify(body) : method === 'POST' ? '{}' : undefined,
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    return { a, call, url, code: said?.match(/setup code:\s+([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4})/)?.[1] ?? null };
  }
  /** the old holder registers a main passkey and switches the password off */
  async function plantKey(b, password) {
    const session = (await b.call('POST', '/api/admin/login', { body: { user: 'boss', password } })).body.session;
    const mk = authenticator();
    const opt = await b.call('POST', '/api/admin/passkey/options', { session, body: { purpose: 'register' } });
    expect((await b.call('POST', '/api/admin/passkey/verify', { session, body: { ticket: opt.body.ticket, response: mk.create(opt.body.options, b.url) } })).status).toBe(200);
    expect((await b.call('POST', '/api/admin/password-login', { session, body: { on: false } })).status).toBe(200);
    return mk;
  }
  const keyLogin = async (b, mk) => {
    const o = (await b.call('POST', '/api/admin/passkey/options', { body: { purpose: 'login' } })).body;
    return o.ticket ? (await b.call('POST', '/api/admin/passkey/verify', { body: { ticket: o.ticket, response: mk.get(o.options, b.url) } })).status : 401;
  };

  it('a changed ADMIN_PASSWORD_HASH drops the passkeys and the password switch of the old credential', async () => {
    const [hashA, hashB] = await Promise.all([OLD, NEW].map((p) => hashPassword(p, { N: 1024, r: 8, p: 1 })));
    let b = await boot({ adminUser: 'boss', adminPasswordHash: hashA });
    const mk = await plantKey(b, OLD);
    expect((await b.call('POST', '/api/admin/login', { body: { user: 'boss', password: OLD } })).body.error).toBe('password_off');
    await b.a.close();

    b = await boot({ adminUser: 'boss', adminPasswordHash: hashB });
    const r = await b.call('POST', '/api/admin/login', { body: { user: 'boss', password: NEW } });
    expect(r.status).toBe(200);
    expect(await keyLogin(b, mk)).not.toBe(200);
    const ov = (await b.call('GET', '/api/admin/overview', { session: r.body.session })).body;
    expect(ov.mainKeys).toHaveLength(0);
    expect(ov.log.map((e) => e.action)).toContain('reset');
    await b.a.close();
    // the same credential again: nothing is reset
    b = await boot({ adminUser: 'boss', adminPasswordHash: hashB });
    const again = await plantKey(b, NEW);
    await b.a.close();
    b = await boot({ adminUser: 'boss', adminPasswordHash: hashB });
    expect(await keyLogin(b, again)).toBe(200);
    await b.a.close();
  });

  it('admins issue invitations – in REGISTRATIONS=off the only way in for a new device', async () => {
    const hash = await hashPassword(NEW, { N: 1024, r: 8, p: 1 });
    const b = await boot({ adminUser: 'boss', adminPasswordHash: hash, registrations: 'off' });
    const session = (await b.call('POST', '/api/admin/login', { body: { user: 'boss', password: NEW } })).body.session;
    const inv = await b.call('POST', '/api/admin/invites', { session });
    expect(inv.status).toBe(200);
    expect(inv.body.code).toMatch(/^SWIV-[0-9A-Z]{3}-[0-9A-Z]{3}$/);
    const ov = (await b.call('GET', '/api/admin/overview', { session })).body;
    expect(ov.registrations).toBe('off');
    expect(ov.invites).toEqual([expect.objectContaining({ code: inv.body.code, did: 'main' })]);
    expect(ov.log[0]).toEqual(expect.objectContaining({ actor: 'main', action: 'invite_created' }));
    // a stranger gets in with it – and only with it (the very first ID of the server is free)
    const mk = (invite, token = 'token-strangerstrangerstr1') => fetch(`${b.url}/api/spaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'L', token, deviceName: 'S', invite }) });
    expect((await mk(undefined, 'token-firstfirstfirstfirst1')).status).toBe(200);
    expect((await mk(undefined)).status).toBe(403);
    expect((await mk(inv.body.code)).status).toBe(200);
    expect((await b.call('GET', '/api/admin/overview', { session })).body.invites).toEqual([]);
    // withdrawing
    const code2 = (await b.call('POST', '/api/admin/invites', { session })).body.code;
    expect((await b.call('POST', '/api/admin/invites/revoke', { session, body: { code: code2 } })).status).toBe(200);
    expect((await b.call('POST', '/api/admin/invites/revoke', { session, body: { code: code2 } })).status).toBe(404);
    await b.a.close();
  });

  it('moving from the env settings to the setup code drops them as well', async () => {
    const hashA = await hashPassword(OLD, { N: 1024, r: 8, p: 1 });
    let b = await boot({ adminUser: 'boss', adminPasswordHash: hashA });
    const mk = await plantKey(b, OLD);
    await b.a.close();

    b = await boot({ admin: 'reset' });
    expect(b.code).toBeTruthy();
    const r = await b.call('POST', '/api/admin/setup', { body: { code: b.code, user: 'operator', password: NEW } });
    expect(r.status).toBe(200);
    expect((await b.call('POST', '/api/admin/login', { body: { user: 'operator', password: NEW } })).status).toBe(200);
    expect(await keyLogin(b, mk)).not.toBe(200);
    expect((await b.call('GET', '/api/admin/overview', { session: r.body.session })).body.mainKeys).toHaveLength(0);
    await b.a.close();
  });
});

describe('promotion tickets (audit run-1)', () => {
  const T4 = 'token-adminadminadminadmin4';
  const options = async (code) => (await req('POST', '/api/admin/passkey/options', { token: T4, body: { purpose: 'register', code } })).body;
  const verify = (o, key) => req('POST', '/api/admin/passkey/verify', { token: T4, body: { ticket: o.ticket, response: key.create(o.options, origin()) } });

  it('a registration ticket belongs to its promotion: promoted again (or revoked and promoted), the old ticket is void', async () => {
    const session = await login();
    const did = await didOfToken(T4);
    const code1 = (await req('POST', '/api/admin/promote', { session, body: { did } })).body.code;
    const old = await options(code1);
    expect(old.ticket).toBeTruthy();
    // the main admin hands out a new code (the old one leaked; that it no longer opens anything is tested above)
    const code2 = (await req('POST', '/api/admin/promote', { session, body: { did } })).body.code;
    expect(code2).not.toBe(code1);
    const r = await verify(old, authenticator());
    expect(r.status).toBe(410);
    expect((await req('GET', '/api/admin/overview', { session })).body.admins.find((a) => a.did === did).state).toBe('pending');
    // revoked and promoted again: a ticket from before is void too
    const spare = await options(code2);
    expect((await req('POST', '/api/admin/revoke', { session, body: { did } })).status).toBe(200);
    const code3 = (await req('POST', '/api/admin/promote', { session, body: { did } })).body.code;
    expect((await verify(spare, authenticator())).status).toBe(410);
    // the current code still works as before
    const fresh = await options(code3);
    expect((await verify(fresh, authenticator())).status).toBe(200);
  });
});

describe('password hash strength', () => {
  it('new hashes use the OWASP scrypt level (32 MiB, three passes); old ones still verify', async () => {
    const h = await hashPassword('a fine long password');
    expect(parseHash(h)).toMatchObject({ N: 32768, r: 8, p: 3 });
    expect(await verifyPassword('a fine long password', h)).toBe(true);
    const old = await hashPassword('a fine long password', { N: 16384, r: 8, p: 1 });
    expect(await verifyPassword('a fine long password', old)).toBe(true);
  });
});
