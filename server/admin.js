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
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { verifyPassword, parseHash, hashPassword } from './password.js';
import { Limiter } from './limiter.js';
import { hashToken } from './core.js';
import { didFromDigest, parseDid } from '../shared/did.js';
import { parseSpaceId, formatSpaceId, parseInviteCode, formatInviteCode, ALPHABET } from '../shared/ids.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const IDLE_MS = 15 * MIN; // a session ends after this long without anything done
const MAX_MS = 8 * 60 * MIN; // … and after this long in any case
const FRESH_MS = 5 * MIN; // promoting, revoking and deleting want a login this recent
const PROMOTION_MS = DAY; // time a promoted device has to set up its passkey
const CHALLENGE_MS = 5 * MIN;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;
// shown to the main admin at the next login
const ALERTS = new Set(['passkey_registered', 'register_refused', 'login_failed', 'space_delete', 'login', 'invite_redeemed']);

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

/** Codes easy to read and type: 12 characters for the setup ("K7QM-2XPA-9FHT"), 8 for a promotion */
function newCode(length = 12) {
  const raw = [...randomBytes(length)].map((b) => ALPHABET[b & 31]).join('');
  return raw.match(/.{1,4}/g).join('-');
}
/** Typed code = stored code? (constant time, forgiving about case, separators, O/0 and I/L/1) */
function sameCode(typed, real) {
  const a = Buffer.from(plainCode(typed));
  const b = Buffer.from(plainCode(real));
  return a.length === b.length && b.length > 0 && timingSafeEqual(a, b);
}
const plainCode = (s) => String(s ?? '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');

export function createAdmin({ store, hub, config, log, seclog = null }) {
  // the main admin from the settings (v0.5.0 way, without the browser) – otherwise from the database
  const envHash = config.adminUser && config.adminPasswordHash ? parseHash(config.adminPasswordHash) : null;
  if (config.adminUser && config.adminPasswordHash && !envHash) log.error('ADMIN_PASSWORD_HASH is not a valid hash – it is ignored');
  if (config.admin === 'off' && !envHash) {
    return {
      enabled: false,
      routes() {},
      stop() {},
      // invitations are logged even without an administration – switched on later, it shows them
      audit: (actor, action, detail = {}) => store.db.q('INSERT INTO admin_log (actor, action, detail, created_at) VALUES (?, ?, ?, ?)').run(actor, action, JSON.stringify(detail), Date.now()),
      isAdmin: () => false,
    };
  }
  if (config.publicUrl.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(config.publicUrl)) {
    log.warn('the administration needs HTTPS: passkeys don\'t work and the password would travel unencrypted over plain http');
  }

  const { db } = store;
  /** sha(session token) → { key, role: 'main'|'device', did, createdAt, seenAt, authAt, opened } */
  const sessions = new Map();
  // passkey challenges travel as signed tickets – nothing is kept per request, so asking for many
  // can't push out somebody else's; only answered ones are remembered (no second use)
  const ticketKey = randomBytes(32);
  const usedChallenges = new Map(); // challenge → when its ticket runs out
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
  function loginFailed(method, req = null) {
    seclog?.event('admin_login_failed', req?.ip, { method });
    const t = now();
    if (failEntry && t - failEntry.at < 10 * MIN) {
      failEntry.count++;
      // the time moves along, so the entry counts as new for the main admin's notices
      db.q('UPDATE admin_log SET detail = ?, created_at = ? WHERE id = ?').run(JSON.stringify({ count: failEntry.count, method }), t, failEntry.id);
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
  /**
   * Is this the promoted device? Once its passkey is set up, the promotion is bound to the device's
   * full key hash – the short D-ID alone (50 bits, could be searched for) is not enough any more.
   */
  const boundTo = (row, tokenHash) => !!tokenHash && (row.token_hash ? row.token_hash === tokenHash : didOfHash(tokenHash) === row.did);
  // switched off in the administration – only possible (and only kept) while the main admin has a passkey
  const passwordAllowed = () => meta('password_login') !== 'off' || !mainHasKey();
  /** The main admin's user name and password hash – null until set up */
  function creds() {
    if (envHash) return { user: config.adminUser, hash: envHash };
    const user = meta('main_user');
    const hash = parseHash(meta('main_hash'));
    return user && hash ? { user, hash } : null;
  }

  // The main admin's passkeys and the "password off" switch belong to the credential they were set up
  // under. A new credential (ADMIN_PASSWORD_HASH changed, or the env settings dropped for a setup
  // code) starts over – otherwise whoever held the old password kept main-admin access by passkey,
  // and the new password was refused while the password was switched off.
  const credentialMark = () => {
    const c = creds();
    return c ? sha(`${c.user}\n${envHash ? config.adminPasswordHash : meta('main_hash')}`) : null;
  };
  function dropMainFactors() {
    db.tx(() => {
      db.q('DELETE FROM admin_keys WHERE did IS NULL').run();
      db.q("DELETE FROM admin_meta WHERE key = 'password_login'").run();
    });
  }
  {
    const mark = credentialMark();
    const known = meta('main_credential');
    if (mark && known && known !== mark) {
      dropMainFactors();
      audit('system', 'reset', { reason: 'credential_changed' });
      log.warn('the main admin\'s credential changed – its passkeys and the password switch were reset');
    }
    if (mark) setMeta('main_credential', mark);
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

  const limited = (req) => (seclog?.event('admin_limited', req?.ip), new AdminError(429, 'rate_limited'));

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
    if (s.role === 'device') {
      const row = adminRow(s.did);
      if (row?.state !== 'active' || !boundTo(row, tokenHash)) return null;
    }
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
    const row = adminRow(did);
    for (const c of hub.all()) if (c.did === did && !c.adminKey && (!row?.token_hash || row.token_hash === c.tokenHash)) c.send(data);
  }

  const sweep = setInterval(() => {
    const t = now();
    for (const s of sessions.values()) if (t - s.seenAt > IDLE_MS || t - s.createdAt > MAX_MS) endSession(s.key);
    for (const [k, exp] of usedChallenges) if (exp < t) usedChallenges.delete(k);
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

  const mac = (body) => createHmac('sha256', ticketKey).update(body).digest('base64url');
  function remember(c) {
    const body = Buffer.from(JSON.stringify({ ...c, expires: now() + CHALLENGE_MS })).toString('base64url');
    return `${body}.${mac(body)}`;
  }
  /** A ticket this server signed, not run out, not answered before – or null */
  function ticketOf(ticket) {
    if (typeof ticket !== 'string' || ticket.length > 4000) return null;
    const [body, sig] = ticket.split('.');
    if (!body || !sig) return null;
    const a = Buffer.from(sig);
    const b = Buffer.from(mac(body));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    let c;
    try {
      c = JSON.parse(Buffer.from(body, 'base64url').toString());
    } catch {
      return null;
    }
    return c.expires > now() && !usedChallenges.has(c.challenge) ? c : null;
  }
  const answered = (c) => usedChallenges.set(c.challenge, c.expires);

  async function passkeyOptions(req, ip) {
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
      if (row.state === 'active' && boundTo(row, tokenHashOf(req))) throw new AdminError(409, 'own_key');
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
      // the promotion code from the main admin: a stolen device key alone can't take the promotion
      if (fails.blocked(ip)) throw limited(req);
      if (!sameCode(req.body?.code, row.code)) {
        fails.fail(ip);
        loginFailed('promotion', req);
        throw new AdminError(401, 'wrong_code');
      }
      // the ticket binds the registration to this device (without carrying its key hash around) and
      // to this very promotion: promoted again or revoked, the ticket is as worthless as the old code
      target = { role: 'device', did, bind: mac(`bind:${tokenHashOf(req)}`), promo: mac(`promo:${did}:${row.code}:${row.created_at}`) };
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
    const tokenHash = tokenHashOf(req);
    if (c.role === 'device' && (!tokenHash || c.bind !== mac(`bind:${tokenHash}`))) throw new AdminError(403, 'not_admin');
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
    answered(c);
    const { credential, credentialDeviceType } = v.registrationInfo;
    const synced = credentialDeviceType === 'multiDevice' ? 1 : 0;
    db.tx(() => {
      if (c.role === 'device') {
        // still the promotion the code was shown for? (a new code since: the ticket is void)
        const cur = db.q('SELECT state, code, created_at FROM admins WHERE did = ?').get(c.did);
        if (!cur || cur.state !== 'pending' || !cur.code || c.promo !== mac(`promo:${c.did}:${cur.code}:${cur.created_at}`)) {
          throw new AdminError(cur?.state === 'active' ? 409 : 410, cur?.state === 'active' ? 'already' : 'expired');
        }
        // exactly one passkey per promotion – whoever comes second is told so
        // … and from now on only for this device's full key, not just anything with the same D-ID
        const ok = db
          .q("UPDATE admins SET state = 'active', expires_at = NULL, token_hash = ?, code = NULL WHERE did = ? AND state = 'pending' AND expires_at > ?")
          .run(tokenHash, c.did, now()).changes;
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
    seclog?.event('admin_passkey', req.ip, { role: c.role });
    return { session: startSession(req, c.role, c.did), role: c.role, did: c.did };
  }

  async function authenticate(req, c) {
    const response = req.body?.response;
    const key = typeof response?.id === 'string' ? db.q('SELECT * FROM admin_keys WHERE id = ?').get(response.id) : null;
    if (!key || key.rp_id !== c.rpID) throw new AdminError(401, 'wrong');
    // a device's passkey only works on that device, a synced copy elsewhere does not
    const row = key.did ? adminRow(key.did) : null;
    if (key.did && (row?.state !== 'active' || !boundTo(row, tokenHashOf(req)))) throw new AdminError(403, 'other_device');
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
    answered(c);
    db.q('UPDATE admin_keys SET counter = ?, last_used_at = ? WHERE id = ?').run(v.authenticationInfo.newCounter, now(), key.id);
    // promoted before the binding existed (v0.5.0/0.5.1): bind it now
    if (row && !row.token_hash) db.q('UPDATE admins SET token_hash = ? WHERE did = ?').run(tokenHashOf(req), row.did);
    const role = key.did ? 'device' : 'main';
    audit(role === 'main' ? 'main' : key.did, 'login', { method: 'passkey' });
    seclog?.event('admin_login', req.ip, { method: 'passkey', role });
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
        // the promotion code, for the main admin to pass on (again)
        ...(s.role === 'main' && r.state === 'pending' && { code: r.code }),
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
      // open invitation codes and who issued them; admins may issue (and withdraw) them here, too
      registrations: config.registrations,
      invites: store.openInvites().map((i) => ({ code: formatInviteCode(i.code), did: i.did, createdAt: i.createdAt, expiresAt: i.expiresAt })),
      log,
      // since the main admin looked last: what others did, and failed logins
      alerts:
        s.role === 'main'
          ? db
              .q(`SELECT * FROM admin_log WHERE created_at > ? AND actor != 'main' AND action IN (${[...ALERTS].map(() => '?').join(',')}) ORDER BY id DESC LIMIT 100`)
              .all(seen, ...ALERTS)
              .map((r) => ({ id: r.id, at: r.created_at, actor: r.actor, action: r.action, detail: JSON.parse(r.detail) }))
          : [],
    };
  }

  // ----- routes -----

  function routes(app, clientKey, secure = () => true) {
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
        if (!secure(req)) throw new AdminError(403, 'https');
        if (!setupCode) throw new AdminError(409, 'set_up');
        if (fails.blocked(ip)) throw limited(req);
        const { code, user, password } = req.body ?? {};
        const typed = Buffer.from(plainCode(code));
        const real = Buffer.from(plainCode(setupCode));
        if (typed.length !== real.length || !timingSafeEqual(typed, real)) {
          fails.fail(ip);
          loginFailed('setup', req);
          throw new AdminError(401, 'wrong_code');
        }
        const name = typeof user === 'string' ? user.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
        if (!name || name.length > 60) throw new AdminError(400, 'invalid_user');
        if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new AdminError(400, 'weak_password');
        const hash = await hashPassword(password);
        if (!setupCode) throw new AdminError(409, 'set_up'); // somebody else was faster while hashing
        setupCode = null;
        const again = !!creds() || mainHasKey();
        db.tx(() => {
          setMeta('main_user', name);
          setMeta('main_hash', hash);
          // a setup always starts over: no passkey and no "password off" of an earlier main admin
          // survives (one may be lost or in the wrong hands – also from the v0.5.0 env settings)
          db.q('DELETE FROM admin_keys WHERE did IS NULL').run();
          db.q("DELETE FROM admin_meta WHERE key = 'password_login'").run();
          setMeta('main_credential', sha(`${name}\n${hash}`));
        });
        if (again) for (const s of sessions.values()) if (s.role === 'main') endSession(s.key);
        audit('main', again ? 'reset' : 'setup');
        seclog?.event('admin_setup', req.ip);
        return { session: newSession('main', null), role: 'main', did: null };
      }),
    );

    app.post(
      '/api/admin/login',
      handle(async (req) => {
        const ip = clientKey(req);
        if (!secure(req)) throw new AdminError(403, 'https');
        if (fails.blocked(ip)) throw limited(req);
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
          loginFailed('password', req);
          throw new AdminError(401, 'wrong');
        }
        audit('main', 'login', { method: 'password' });
        seclog?.event('admin_login', req.ip, { method: 'password', role: 'main' });
        return { session: startSession(req, 'main', null), role: 'main', did: null };
      }),
    );

    app.post(
      '/api/admin/passkey/options',
      handle(async (req) => {
        if (req.body?.purpose === 'login' && fails.blocked(clientKey(req))) throw new AdminError(429, 'rate_limited');
        return passkeyOptions(req, clientKey(req));
      }),
    );

    app.post(
      '/api/admin/passkey/verify',
      handle(async (req) => {
        const c = ticketOf(req.body?.ticket);
        if (!c) throw new AdminError(400, 'expired_challenge');
        if (c.purpose === 'register') return register(req, c);
        const ip = clientKey(req);
        if (fails.blocked(ip)) throw limited(req);
        try {
          return await authenticate(req, c);
        } catch (e) {
          fails.fail(ip);
          loginFailed('passkey', req);
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

    // ----- invitations by an admin: in REGISTRATIONS=off the only way in for a new device -----
    app.post(
      '/api/admin/invites',
      handle(
        async (req, s) => {
          if (config.registrations === 'open') throw new AdminError(409, 'open');
          const byHash = s.role === 'main' ? 'admin:main' : tokenHashOf(req);
          let inv;
          try {
            inv = store.createInvite(byHash, actorOf(s));
          } catch {
            throw new AdminError(429, 'invite_limit');
          }
          audit(actorOf(s), 'invite_created', { code: formatInviteCode(inv.code), admin: true });
          return { code: formatInviteCode(inv.code), createdAt: inv.createdAt, expiresAt: inv.expiresAt };
        },
        {},
      ),
    );
    app.post(
      '/api/admin/invites/revoke',
      handle(
        async (req, s) => {
          const code = parseInviteCode(String(req.body?.code ?? ''));
          const gone = code && store.revokeInvite(code);
          if (!gone) throw new AdminError(404, 'notfound');
          audit(actorOf(s), 'invite_revoked', { code: formatInviteCode(code), did: gone.did });
          return { ok: true };
        },
        {},
      ),
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
          // the device needs this code for its passkey – the main admin passes it on (chat, in person)
          const code = newCode(8);
          db.q('INSERT OR REPLACE INTO admins (did, state, expires_at, created_at, token_hash, code) VALUES (?, ?, ?, ?, NULL, ?)').run(did, 'pending', now() + PROMOTION_MS, now(), code);
          audit('main', 'promote', { did });
          notify(did);
          return { did, code, ...stateOf(did) };
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
    audit,
    /** Active admins create as many IDs as they like (SPACES_PER_DEVICE). */
    isAdmin: (tokenHash) => {
      const row = tokenHash ? adminRow(didOfHash(tokenHash)) : null;
      return row?.state === 'active' && boundTo(row, tokenHash);
    },
    /** An admin opened an ID: once per session in the admin log and in the ID's history. */
    opened(s, space) {
      if (s.opened.has(space.uid)) return;
      s.opened.add(space.uid);
      audit(s.role === 'main' ? 'main' : s.did, 'space_open', { name: space.name, id: formatSpaceId(space.public_id) });
      db.q(`INSERT INTO activity (space_uid, list_id, dev_name, action, payload, created_at) VALUES (?, NULL, 'Admin', 'admin.open', '{"admin":true}', ?)`).run(space.uid, now());
    },
    stop() {
      clearInterval(sweep);
      fails.stop();
    },
  };
}
