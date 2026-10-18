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
    ...loadConfig({}),
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
    const off = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist' });
    const res = await off.inject({ method: 'GET', url: '/api/admin/status' });
    expect(res.statusCode).toBe(404);
    // a user without a valid hash: still off
    const broken = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist', adminUser: 'boss', adminPasswordHash: 'plain-password' });
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
    expect(r.body.until - Date.now()).toBeGreaterThan(23 * 3600_000);
    expect((await ws.wait((m) => m.t === 'admin')).role).toBe('pending');
    expect((await req('GET', '/api/admin/status', { token: T1 })).body.role).toBe('pending');
    ws.close();
  });

  it('the promoted device sets up exactly one passkey – a second one (a thief) is refused', async () => {
    const opt = await req('POST', '/api/admin/passkey/options', { token: T1, body: { purpose: 'register' } });
    expect(opt.status).toBe(200);
    expect(opt.body.options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
    const done = await req('POST', '/api/admin/passkey/verify', { token: T1, body: { ticket: opt.body.ticket, response: key.create(opt.body.options, origin()) } });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ role: 'device', did });
    // a copy of the device's key can't add its own passkey now
    const again = await req('POST', '/api/admin/passkey/options', { token: T1, body: { purpose: 'register' } });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already');
    const session = await login();
    const ov = (await req('GET', '/api/admin/overview', { session })).body;
    expect(ov.admins).toEqual([expect.objectContaining({ did, state: 'active', names: ['Phone'], keys: [expect.objectContaining({ synced: false })] })]);
    expect(ov.alerts.map((e) => e.action)).toEqual(expect.arrayContaining(['passkey_registered', 'register_refused']));
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
    await admin.send({ t: 'op', id: 'a1', op: { k: 'item.add', id: 'admitem00001', listId, name: 'Milk', pos: 1 }, at: Date.now() });
    expect((await admin.wait((m) => m.t === 'ack' && m.id === 'a1')).ok).toBe(true);
    const patch = await member.wait((m) => m.t === 'patch' && m.changes.some((c) => c.row?.name === 'Milk'));
    expect(patch.changes.find((c) => c.e === 'item').row.addedBy).toBe('Admin');
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
    const a = await buildApp({ ...loadConfig({}), dataDir: dir, staticDir: './does-not-exist', admin, announce: (m) => (said = m) });
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
