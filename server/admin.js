// Optional administration (docs/ADMIN.md, plan section 12). Off unless ADMIN=on – then every
// /api/admin address is simply not there.
//
// Setting up: the server writes a one-time code into its log; whoever can read the log enters it at
// /admin together with the main admin's user name and password (stored as a scrypt hash only).
// ADMIN=reset does the same again. (ADMIN_USER + ADMIN_PASSWORD_HASH still work instead.)
//
// Who is admin: the main admin (user + password, passkeys optional) and devices
// the main admin promoted by their D-ID – those always need their D-ID *and* their passkey.
// Sessions live only in memory, on the server and in the browser tab: nothing a stealer could copy.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { verifyPassword, parseHash, hashPassword } from './password.js';
import { Limiter } from './limiter.js';
import { hashToken } from './core.js';
import { didFromDigest, parseDid } from '../shared/did.js';
import { parseSpaceId, formatSpaceId, ALPHABET } from '../shared/ids.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const IDLE_MS = 15 * MIN; // a session ends after this long without anything done
const MAX_MS = 8 * 60 * MIN; // … and after this long in any case
const FRESH_MS = 5 * MIN; // promoting, revoking and deleting want a login this recent
const PROMOTION_MS = DAY; // time a promoted device has to set up its passkey
const CHALLENGE_MS = 5 * MIN;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;
// shown to the main admin at the next login
const ALERTS = new Set(['passkey_registered', 'register_refused', 'login_failed', 'space_delete', 'login']);

const sha = (s) => createHash('sha256').update(String(s)).digest('base64url');
/** D-ID of a device token's hash (see shared/did.js) */
export const didOfHash = (tokenHash) => didFromDigest(createHash('sha256').update(`did:${tokenHash}`).digest());

class AdminError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** One-time setup code: 12 characters, easy to read and type ("K7QM-2XPA-9FHT") */
function newCode() {
  const raw = [...randomBytes(12)].map((b) => ALPHABET[b & 31]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}
const plainCode = (s) => String(s ?? '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');

export function createAdmin({ store, hub, config, log }) {
  // the main admin from the settings (v0.5.0 way, without the browser) – otherwise from the database
  const envHash = config.adminUser && config.adminPasswordHash ? parseHash(config.adminPasswordHash) : null;
  if (config.adminUser && config.adminPasswordHash && !envHash) log.error('ADMIN_PASSWORD_HASH is not a valid hash – it is ignored');
  if (config.admin === 'off' && !envHash) return { enabled: false, routes() {}, stop() {} };
  if (config.publicUrl.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(config.publicUrl)) {
    log.warn('the administration needs HTTPS: passkeys don\'t work and the password would travel unencrypted over plain http');
  }

  const { db } = store;
  /** sha(session token) → { key, role: 'main'|'device', did, createdAt, seenAt, authAt, opened } */
  const sessions = new Map();
  /** ticket → a passkey challenge waiting for its answer */
  const challenges = new Map();
  const fails = new Limiter({ limit: 10, windowMs: 15 * MIN });
  // scrypt is slow on purpose – one check at a time, and only a few waiting
  let queue = Promise.resolve();
  let waiting = 0;

  // ----- small helpers -----

  const now = () => Date.now();
  const meta = (key) => db.q('SELECT value FROM admin_meta WHERE key = ?').get(key)?.value ?? null;
  const setMeta = (key, value) => db.q('INSERT OR REPLACE INTO admin_meta (key, value) VALUES (?, ?)').run(key, String(value));

  function audit(actor, action, detail = {}) {
    db.q('INSERT INTO admin_log (actor, action, detail, created_at) VALUES (?, ?, ?, ?)').run(actor, action, JSON.stringify(detail), now());
  }
  // failed logins: one entry per 10 minutes with a count, so guessing can't flood the log
  let failEntry = null;
  // refused passkey setups: once per D-ID and 10 minutes, for the same reason
  const refused = new Map();
  function loginFailed(method) {
    const t = now();
    if (failEntry && t - failEntry.at < 10 * MIN) {
      failEntry.count++;
      db.q('UPDATE admin_log SET detail = ? WHERE id = ?').run(JSON.stringify({ count: failEntry.count, method }), failEntry.id);
      return;
    }
    const r = db.q('INSERT INTO admin_log (actor, action, detail, created_at) VALUES (?, ?, ?, ?) RETURNING id').get('system', 'login_failed', JSON.stringify({ count: 1, method }), t);
    failEntry = { id: r.id, at: t, count: 1 };
  }

  const tokenHashOf = (req) => {
    const t = req.headers['x-shopwiz-token'];
    return typeof t === 'string' && TOKEN_RE.test(t) ? hashToken(t) : null;
  };
  const didOfReq = (req) => {
    const h = tokenHashOf(req);
    return h ? didOfHash(h) : null;
  };
  /** The promotion of a D-ID – null when there is none or a pending one ran out. */
  function adminRow(did) {
    const r = did ? db.q('SELECT * FROM admins WHERE did = ?').get(did) : null;
    return r && !(r.state === 'pending' && r.expires_at <= now()) ? r : null;
  }
  /** What a device is: { role: 'pending'|'active'|null, since, until } */
  function stateOf(did) {
    const r = adminRow(did);
    return r ? { role: r.state, since: r.created_at, until: r.state === 'pending' ? r.expires_at : null } : { role: null, since: null, until: null };
  }
  const mainHasKey = () => !!db.q('SELECT 1 FROM admin_keys WHERE did IS NULL').get();
  // switched off in the administration – only possible (and only kept) while the main admin has a passkey
  const passwordAllowed = () => meta('password_login') !== 'off' || !mainHasKey();
  /** The main admin's user name and password hash – null until set up */
  function creds() {
    if (envHash) return { user: config.adminUser, hash: envHash };
    const user = meta('main_user');
    const hash = parseHash(meta('main_hash'));
    return user && hash ? { user, hash } : null;
  }

  // ----- setting up the main admin: a code in the log, entered at /admin -----
  // (the log is what Portainer & co. show with one click – only who runs the server sees it)
  let setupCode = null;
  if (!envHash && (config.admin === 'reset' || !creds())) {
    setupCode = newCode();
    const where = `${config.publicUrl || 'https://<your-address>'}/admin`;
    const lines = [
      '',
      '=================================================================',
      `  ShopWiz administration – setup code:  ${setupCode}`,
      `  Open ${where} and enter it there.`,
      ...(config.admin === 'reset' ? ['  ADMIN=reset: set ADMIN=on again once you are done.'] : []),
      '=================================================================',
      '',
    ];
    (config.announce ?? console.log)(lines.join('\n'));
  } else if (envHash && config.admin === 'reset') {
    log.warn('ADMIN=reset does nothing while ADMIN_USER and ADMIN_PASSWORD_HASH are set – change those instead');
  }

  // ----- sessions -----

  function newSession(role, did) {
    const token = randomBytes(32).toString('base64url');
    const t = now();
    const key = sha(token);
    sessions.set(key, { key, role, did, createdAt: t, seenAt: t, authAt: t, opened: new Set() });
    return token;
  }

  /** The session behind an admin token – null when missing, ended, or not with this device. */
  function sessionFor(token, tokenHash, { touch = true } = {}) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const s = sessions.get(sha(token));
    if (!s) return null;
    const t = now();
    if (t - s.seenAt > IDLE_MS || t - s.createdAt > MAX_MS) {
      endSession(s.key);
      return null;
    }
    // a device admin's session only works together with that device's own key – and while it is admin
    if (s.role === 'device' && (!tokenHash || didOfHash(tokenHash) !== s.did || adminRow(s.did)?.state !== 'active')) return null;
    if (touch) s.seenAt = t;
    return s;
  }
  const sessionOf = (req, opts) => sessionFor(req.headers['x-shopwiz-admin'], tokenHashOf(req), opts);

  /** Log in (again): a fresh login of the same admin only refreshes the session it has. */
  function startSession(req, role, did) {
    const cur = sessionOf(req);
    if (cur && cur.role === role && cur.did === did) {
      cur.authAt = now();
      return req.headers['x-shopwiz-admin'];
    }
    return newSession(role, did);
  }

  /** Everybody connected through this session leaves the IDs they had open. */
  function endSession(key) {
    sessions.delete(key);
    for (const c of hub.all()) {
      if (c.adminKey === key) {
        c.send(JSON.stringify({ t: 'adminEnded' }));
        c.close();
      }
    }
  }

  /** Tell a device that is online right now what it is (promoted, active, revoked). */
  function notify(did) {
    const data = JSON.stringify({ t: 'admin', ...stateOf(did) });
    for (const c of hub.all()) if (c.did === did && !c.adminKey) c.send(data);
  }

  const sweep = setInterval(() => {
    const t = now();
    for (const s of sessions.values()) if (t - s.seenAt > IDLE_MS || t - s.createdAt > MAX_MS) endSession(s.key);
    for (const [k, c] of challenges) if (c.expires < t) challenges.delete(k);
    for (const r of db.q("DELETE FROM admins WHERE state = 'pending' AND expires_at <= ? RETURNING did").all(t)) audit('system', 'promote_expired', { did: r.did });
    db.q('DELETE FROM admin_log WHERE created_at < ?').run(t - 180 * DAY);
    db.q('DELETE FROM admin_log WHERE id <= (SELECT id FROM admin_log ORDER BY id DESC LIMIT 1 OFFSET 5000)').run();
  }, MIN);
  sweep.unref();

  // ----- passkeys -----

  /** Where passkeys belong: the public address, or the address the browser used. */
  function rp(req) {
    if (config.publicUrl) {
      const u = new URL(config.publicUrl);
      return { rpID: u.hostname, origins: [u.origin] };
    }
    const host = String(req.headers.host ?? '').toLowerCase();
    if (!/^[a-z0-9.-]+(:\d{1,5})?$|^\[[0-9a-f:]+\](:\d{1,5})?$/.test(host)) throw new AdminError(400, 'host');
    const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const local = ['localhost', '127.0.0.1', '::1'].includes(hostname);
    return { rpID: hostname, origins: [`https://${host}`, ...(local ? [`http://${host}`] : [])] };
  }

  function remember(c) {
    const ticket = randomBytes(18).toString('base64url');
    challenges.set(ticket, { ...c, expires: now() + CHALLENGE_MS });
    // keep the waiting room small – the oldest go first
    while (challenges.size > 500) challenges.delete(challenges.keys().next().value);
    return ticket;
  }

  async function passkeyOptions(req) {
    const purpose = req.body?.purpose;
    const { rpID, origins } = rp(req);
    if (purpose === 'login') {
      // no list of keys: the browser offers the passkeys it has for this site
      const options = await generateAuthenticationOptions({ rpID, userVerification: 'required', timeout: 120_000 });
      return { ticket: remember({ purpose, challenge: options.challenge, rpID, origins }), options };
    }
    if (purpose !== 'register') throw new AdminError(400, 'invalid');
    const s = sessionOf(req);
    let target;
    if (s?.role === 'main') {
      if (now() - s.authAt > FRESH_MS) throw new AdminError(401, 'reauth');
      target = { role: 'main', did: null };
    } else {
      const did = didOfReq(req);
      if (!did) throw new AdminError(400, 'invalid');
      const row = db.q('SELECT * FROM admins WHERE did = ?').get(did);
      if (!row) throw new AdminError(403, 'not_admin');
      if (row.state === 'active') {
        // somebody already set up the passkey of this promotion – maybe not this device
        if (!(refused.get(did) > now() - 10 * MIN)) {
          refused.set(did, now());
          if (refused.size > 1000) refused.clear();
          audit(did, 'register_refused', { did });
        }
        throw new AdminError(409, 'already');
      }
      if (row.expires_at <= now()) throw new AdminError(410, 'expired');
      target = { role: 'device', did };
    }
    const exclude = db.q('SELECT id, transports FROM admin_keys WHERE did IS ?').all(target.did);
    const options = await generateRegistrationOptions({
      rpName: 'ShopWiz',
      rpID,
      userName: target.role === 'main' ? (creds()?.user ?? 'admin') : `D-ID ${target.did}`,
      userDisplayName: target.role === 'main' ? 'ShopWiz Admin' : `ShopWiz Admin · ${target.did}`,
      attestationType: 'none',
      excludeCredentials: exclude.map((k) => ({ id: k.id, transports: JSON.parse(k.transports) })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: 120_000,
    });
    return { ticket: remember({ purpose, challenge: options.challenge, rpID, origins, ...target }), options };
  }

  async function register(req, c) {
    const s = sessionOf(req);
    if (c.role === 'main' && s?.role !== 'main') throw new AdminError(401, 'login');
    if (c.role === 'device' && didOfReq(req) !== c.did) throw new AdminError(403, 'not_admin');
    let v;
    try {
      v = await verifyRegistrationResponse({
        response: req.body?.response,
        expectedChallenge: c.challenge,
        expectedOrigin: c.origins,
        expectedRPID: c.rpID,
        requireUserVerification: true,
      });
    } catch {
      throw new AdminError(400, 'passkey');
    }
    if (!v.verified) throw new AdminError(400, 'passkey');
    const { credential, credentialDeviceType } = v.registrationInfo;
    const synced = credentialDeviceType === 'multiDevice' ? 1 : 0;
    db.tx(() => {
      if (c.role === 'device') {
        // exactly one passkey per promotion – whoever comes second is told so
        const ok = db.q("UPDATE admins SET state = 'active', expires_at = NULL WHERE did = ? AND state = 'pending' AND expires_at > ?").run(c.did, now()).changes;
        if (!ok) {
          const row = db.q('SELECT state FROM admins WHERE did = ?').get(c.did);
          throw new AdminError(row?.state === 'active' ? 409 : 410, row?.state === 'active' ? 'already' : 'expired');
        }
      }
      db.q('INSERT INTO admin_keys (id, did, public_key, counter, transports, synced, rp_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        credential.id,
        c.did,
        credential.publicKey,
        credential.counter,
        JSON.stringify(credential.transports ?? []),
        synced,
        c.rpID,
        now(),
      );
    });
    audit(c.role === 'main' ? 'main' : c.did, 'passkey_registered', { did: c.did, synced: !!synced });
    if (c.role === 'device') notify(c.did);
    return { session: startSession(req, c.role, c.did), role: c.role, did: c.did };
  }

  async function authenticate(req, c) {
    const response = req.body?.response;
    const key = typeof response?.id === 'string' ? db.q('SELECT * FROM admin_keys WHERE id = ?').get(response.id) : null;
    if (!key || key.rp_id !== c.rpID) throw new AdminError(401, 'wrong');
    // a device's passkey only works on that device (its D-ID), a synced copy elsewhere does not
    if (key.did && (key.did !== didOfReq(req) || adminRow(key.did)?.state !== 'active')) throw new AdminError(403, 'other_device');
    let v;
    try {
      v = await verifyAuthenticationResponse({
        response,
        expectedChallenge: c.challenge,
        expectedOrigin: c.origins,
        expectedRPID: c.rpID,
        credential: { id: key.id, publicKey: new Uint8Array(key.public_key), counter: key.counter, transports: JSON.parse(key.transports) },
        requireUserVerification: true,
      });
    } catch {
      throw new AdminError(401, 'wrong');
    }
    if (!v.verified) throw new AdminError(401, 'wrong');
    db.q('UPDATE admin_keys SET counter = ?, last_used_at = ? WHERE id = ?').run(v.authenticationInfo.newCounter, now(), key.id);
    const role = key.did ? 'device' : 'main';
    audit(role === 'main' ? 'main' : key.did, 'login', { method: 'passkey' });
    return { session: startSession(req, role, key.did), role, did: key.did };
  }

  // ----- what the administration shows -----

  function overview(s) {
    const spaces = db.q('SELECT uid, public_id, name, ttl_days, created_at, last_active_at, deleted_at FROM spaces ORDER BY last_active_at DESC').all();
    const per = (sql) => new Map(db.q(sql).all().map((r) => [r.uid, r]));
    // counts of what is there, and roughly what all stored rows take (text + per-row overhead)
    const items = per(
      `SELECT space_uid AS uid, SUM(deleted_at IS NULL) AS n,
       SUM(length(name) + length(norm) + length(qty) + length(unit) + length(note) + length(meta) + length(places) + 120) AS b FROM items GROUP BY space_uid`,
    );
    const lists = per('SELECT space_uid AS uid, SUM(deleted_at IS NULL) AS n, SUM(length(name) + length(address) + 100) AS b FROM lists GROUP BY space_uid');
    const groups = per('SELECT space_uid AS uid, SUM(deleted_at IS NULL) AS n, SUM(length(name) + 80) AS b FROM groups GROUP BY space_uid');
    const devices = per("SELECT space_uid AS uid, SUM(kind IS NULL) AS n, SUM(kind = 'ai') AS ai, SUM(length(name) + 120) AS b FROM devices GROUP BY space_uid");
    const other = [
      'SELECT space_uid AS uid, SUM(length(payload) + length(action) + length(dev_name) + 60) AS b FROM activity GROUP BY space_uid',
      'SELECT space_uid AS uid, SUM(length(norm) + length(name) + 40) AS b FROM suggestions GROUP BY space_uid',
      'SELECT space_uid AS uid, SUM(length(norm) + length(text) + 50) AS b FROM translations GROUP BY space_uid',
      'SELECT space_uid AS uid, SUM(length(norm) + length(group_name) + length(subgroup_name) + 40) AS b FROM memory GROUP BY space_uid',
      'SELECT space_uid AS uid, SUM(length(options) + 80) AS b FROM conflicts GROUP BY space_uid',
      'SELECT space_uid AS uid, SUM(length(result) + 60) AS b FROM applied_ops GROUP BY space_uid',
    ].map(per);

    // devices by D-ID: the same device is one row per ID it is in
    const byDid = new Map();
    const nameOf = new Map(spaces.map((sp) => [sp.uid, sp]));
    for (const d of db.q('SELECT token_hash, space_uid, name, last_seen_at FROM devices WHERE kind IS NULL').all()) {
      const did = didOfHash(d.token_hash);
      let e = byDid.get(did);
      if (!e) byDid.set(did, (e = { did, names: new Set(), spaces: [], lastSeenAt: 0 }));
      e.names.add(d.name);
      const sp = nameOf.get(d.space_uid);
      if (sp && !sp.deleted_at) e.spaces.push({ id: sp.public_id, name: sp.name });
      e.lastSeenAt = Math.max(e.lastSeenAt, d.last_seen_at);
    }
    const keyRow = (k) => ({ id: k.id, synced: !!k.synced, createdAt: k.created_at, lastUsedAt: k.last_used_at });
    const keys = db.q('SELECT * FROM admin_keys ORDER BY created_at').all();
    const admins = db
      .q('SELECT * FROM admins ORDER BY created_at')
      .all()
      .filter((r) => adminRow(r.did))
      .map((r) => ({
        did: r.did,
        state: r.state,
        since: r.created_at,
        until: r.state === 'pending' ? r.expires_at : null,
        names: [...(byDid.get(r.did)?.names ?? [])],
        keys: keys.filter((k) => k.did === r.did).map(keyRow),
      }));
    const seen = Number(meta('main_seen') ?? 0);
    const log = db.q('SELECT * FROM admin_log ORDER BY id DESC LIMIT 300').all().map((r) => ({ id: r.id, at: r.created_at, actor: r.actor, action: r.action, detail: JSON.parse(r.detail) }));
    return {
      me: { role: s.role, did: s.did },
      passwordLogin: meta('password_login') !== 'off',
      mainHasKey: mainHasKey(),
      spaces: spaces.map((sp) => {
        const bytes = [items, lists, groups, devices, ...other].reduce((sum, m) => sum + (m.get(sp.uid)?.b ?? 0), 200);
        return {
          id: sp.public_id,
          name: sp.name,
          createdAt: sp.created_at,
          lastActiveAt: sp.last_active_at,
          deletedAt: sp.deleted_at,
          ttlDays: sp.ttl_days,
          lists: lists.get(sp.uid)?.n ?? 0,
          items: items.get(sp.uid)?.n ?? 0,
          groups: groups.get(sp.uid)?.n ?? 0,
          devices: devices.get(sp.uid)?.n ?? 0,
          ai: devices.get(sp.uid)?.ai ?? 0,
          kb: Math.max(1, Math.round(bytes / 1024)),
        };
      }),
      devices: [...byDid.values()]
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
        .map((e) => ({ ...e, names: [...e.names], admin: adminRow(e.did)?.state ?? null })),
      admins,
      mainKeys: s.role === 'main' ? keys.filter((k) => !k.did).map(keyRow) : [],
      log,
      // since the main admin looked last: what others did, and failed logins
      alerts: s.role === 'main' ? log.filter((e) => e.at > seen && e.actor !== 'main' && ALERTS.has(e.action)) : [],
    };
  }

  // ----- routes -----

  function routes(app, clientKey) {
    const handle = (fn, guard = null) => async (req, reply) => {
      try {
        let s = null;
        if (guard) {
          s = sessionOf(req);
          if (!s) throw new AdminError(401, 'login');
          if (guard.main && s.role !== 'main') throw new AdminError(403, 'main_only');
          if (guard.fresh && now() - s.authAt > FRESH_MS) throw new AdminError(401, 'reauth');
        }
        return await fn(req, s, reply);
      } catch (e) {
        if (e instanceof AdminError) return reply.code(e.status).send({ error: e.code });
        throw e;
      }
    };
    const actorOf = (s) => (s.role === 'main' ? 'main' : s.did);

    // what this device is – the app asks to show the D-ID's promotion and the admin button
    app.get(
      '/api/admin/status',
      handle(async (req) => {
        const did = didOfReq(req);
        return { did, ...stateOf(did), passwordLogin: passwordAllowed(), setup: !!setupCode };
      }),
    );

    // the first visit: setup code from the log + user name + password of the main admin
    app.post(
      '/api/admin/setup',
      handle(async (req) => {
        const ip = clientKey(req);
        if (!setupCode) throw new AdminError(409, 'set_up');
        if (fails.blocked(ip)) throw new AdminError(429, 'rate_limited');
        const { code, user, password } = req.body ?? {};
        const typed = Buffer.from(plainCode(code));
        const real = Buffer.from(plainCode(setupCode));
        if (typed.length !== real.length || !timingSafeEqual(typed, real)) {
          fails.fail(ip);
          loginFailed('setup');
          throw new AdminError(401, 'wrong_code');
        }
        const name = typeof user === 'string' ? user.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
        if (!name || name.length > 60) throw new AdminError(400, 'invalid_user');
        if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new AdminError(400, 'weak_password');
        const hash = await hashPassword(password);
        if (!setupCode) throw new AdminError(409, 'set_up'); // somebody else was faster while hashing
        setupCode = null;
        const again = !!creds();
        db.tx(() => {
          setMeta('main_user', name);
          setMeta('main_hash', hash);
          if (again) {
            // starting over: the main admin's passkeys go (one may be lost or in the wrong hands)
            db.q('DELETE FROM admin_keys WHERE did IS NULL').run();
            db.q("DELETE FROM admin_meta WHERE key = 'password_login'").run();
          }
        });
        if (again) for (const s of sessions.values()) if (s.role === 'main') endSession(s.key);
        audit('main', again ? 'reset' : 'setup');
        return { session: newSession('main', null), role: 'main', did: null };
      }),
    );

    app.post(
      '/api/admin/login',
      handle(async (req) => {
        const ip = clientKey(req);
        if (fails.blocked(ip)) throw new AdminError(429, 'rate_limited');
        if (!passwordAllowed()) throw new AdminError(403, 'password_off');
        const c = creds();
        if (!c) throw new AdminError(409, 'setup');
        const { user, password } = req.body ?? {};
        if (typeof user !== 'string' || typeof password !== 'string' || user.length > 200 || password.length > 1024) throw new AdminError(400, 'invalid');
        if (waiting >= 8) throw new AdminError(429, 'busy');
        waiting++;
        // the user name compared in constant time, the password always checked – no hint which one was wrong
        const job = queue.then(async () => {
          const passOk = await verifyPassword(password, c.hash);
          return timingSafeEqual(Buffer.from(sha(user)), Buffer.from(sha(c.user))) && passOk;
        });
        queue = job.catch(() => {});
        let ok = false;
        try {
          ok = await job;
        } finally {
          waiting--;
        }
        if (!ok) {
          fails.fail(ip);
          loginFailed('password');
          throw new AdminError(401, 'wrong');
        }
        audit('main', 'login', { method: 'password' });
        return { session: startSession(req, 'main', null), role: 'main', did: null };
      }),
    );

    app.post(
      '/api/admin/passkey/options',
      handle(async (req) => {
        if (req.body?.purpose === 'login' && fails.blocked(clientKey(req))) throw new AdminError(429, 'rate_limited');
        return passkeyOptions(req);
      }),
    );

    app.post(
      '/api/admin/passkey/verify',
      handle(async (req) => {
        const ticket = req.body?.ticket;
        const c = typeof ticket === 'string' ? challenges.get(ticket) : null;
        if (c) challenges.delete(ticket);
        if (!c || c.expires < now()) throw new AdminError(400, 'expired_challenge');
        if (c.purpose === 'register') return register(req, c);
        const ip = clientKey(req);
        if (fails.blocked(ip)) throw new AdminError(429, 'rate_limited');
        try {
          return await authenticate(req, c);
        } catch (e) {
          fails.fail(ip);
          loginFailed('passkey');
          throw e;
        }
      }),
    );

    app.post(
      '/api/admin/logout',
      handle(async (req) => {
        const s = sessionOf(req, { touch: false });
        if (s) endSession(s.key);
        return { ok: true };
      }),
    );

    app.get(
      '/api/admin/overview',
      handle(async (req, s) => overview(s), {}),
    );

    app.post(
      '/api/admin/alerts/seen',
      handle(async () => (setMeta('main_seen', now()), { ok: true }), { main: true }),
    );

    app.post(
      '/api/admin/promote',
      handle(
        async (req) => {
          const did = parseDid(req.body?.did);
          if (!did) throw new AdminError(400, 'invalid_did');
          if (adminRow(did)?.state === 'active') throw new AdminError(409, 'already');
          db.q('INSERT OR REPLACE INTO admins (did, state, expires_at, created_at) VALUES (?, ?, ?, ?)').run(did, 'pending', now() + PROMOTION_MS, now());
          audit('main', 'promote', { did });
          notify(did);
          return { did, ...stateOf(did) };
        },
        { main: true, fresh: true },
      ),
    );

    app.post(
      '/api/admin/revoke',
      handle(
        async (req) => {
          const did = parseDid(req.body?.did);
          if (!did) throw new AdminError(400, 'invalid_did');
          const n = db.q('DELETE FROM admins WHERE did = ?').run(did).changes;
          db.q('DELETE FROM admin_keys WHERE did = ?').run(did);
          for (const s of sessions.values()) if (s.did === did) endSession(s.key);
          if (n) audit('main', 'revoke', { did });
          notify(did);
          return { ok: true };
        },
        { main: true, fresh: true },
      ),
    );

    // the password as the emergency key only: off once the main admin has a passkey (ADMIN=reset brings it back)
    app.post(
      '/api/admin/password-login',
      handle(
        async (req) => {
          const on = req.body?.on !== false;
          if (!on && !mainHasKey()) throw new AdminError(409, 'no_key');
          setMeta('password_login', on ? 'on' : 'off');
          audit('main', on ? 'password_on' : 'password_off');
          return { ok: true };
        },
        { main: true, fresh: true },
      ),
    );

    app.post(
      '/api/admin/keys/delete',
      handle(
        async (req) => {
          const id = req.body?.id;
          const n = typeof id === 'string' ? db.q('DELETE FROM admin_keys WHERE id = ? AND did IS NULL').run(id).changes : 0;
          if (!n) throw new AdminError(404, 'notfound');
          audit('main', 'key_deleted');
          return { ok: true };
        },
        { main: true, fresh: true },
      ),
    );

    // delete an ID for good – the devices in it see "deleted by Admin" right away
    app.post(
      '/api/admin/spaces/:id/delete',
      handle(
        async (req, s) => {
          const id = parseSpaceId(req.params.id);
          const space = id ? db.q('SELECT * FROM spaces WHERE public_id = ?').get(id) : null;
          if (!space) throw new AdminError(404, 'notfound');
          hub.broadcast(space.uid, { t: 'deleted', by: 'Admin', at: now(), final: true });
          for (const c of hub.conns(space.uid)) c.close();
          store.purgeSpace(space.uid);
          audit(actorOf(s), 'space_delete', { name: space.name, id: formatSpaceId(space.public_id) });
          return { ok: true };
        },
        { fresh: true },
      ),
    );
  }

  return {
    enabled: true,
    routes,
    sessionOf,
    sessionFor,
    stateOf,
    /** Active admins create as many IDs as they like (SPACES_PER_DEVICE). */
    isAdmin: (tokenHash) => !!tokenHash && adminRow(didOfHash(tokenHash))?.state === 'active',
    /** An admin opened an ID: once per session in the admin log and in the ID's history. */
    opened(s, space) {
      if (s.opened.has(space.uid)) return;
      s.opened.add(space.uid);
      audit(s.role === 'main' ? 'main' : s.did, 'space_open', { name: space.name, id: formatSpaceId(space.public_id) });
      db.q("INSERT INTO activity (space_uid, list_id, dev_name, action, payload, created_at) VALUES (?, NULL, 'Admin', 'admin.open', '{}', ?)").run(space.uid, now());
    },
    stop() {
      clearInterval(sweep);
      fails.stop();
    },
  };
}
