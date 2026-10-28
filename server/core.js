import { createHash, webcrypto } from 'node:crypto';
import { randomSpaceId, randomEntityId, ENTITY_ID_RE } from '../shared/ids.js';
import { normalizeName, addAmounts } from '../shared/parse.js';
import { linkName } from '../shared/backup.js';
import { MAX_SPACE_TTL_DAYS } from './config.js';
import { COUNTRY_LANGS, LANG_RE } from '../shared/countries.js';
import { PROVIDERS } from './translate.js';

const DAY = 86_400_000;
const MIN_SPACE_TTL_DAYS = 7;

export const LIMITS = {
  spaceName: 80,
  listName: 80,
  groupName: 60,
  address: 300,
  translation: 120,
  itemName: 120,
  note: 500,
  deviceName: 40,
  unit: 16,
  qty: 12,
  listsPerSpace: 10,
  groupsPerSpace: 500,
  devicesPerSpace: 100,
  idsPerDevice: 10, // IDs a device is in at once – deleted ones don't count
  itemsPerList: 2000,
  inactivePerList: 250, // the inactive part keeps the most recent ones, older ones are deleted
  // what an ID learns: names it knows, groups it remembers, translations – the oldest go first
  memoryPerSpace: 3000,
  suggestionsPerSpace: 1000,
  translationsPerSpace: 3000,
  batch: 300,
  linkedItems: 4000, // shared items a list group may hold – list.link works through all of them at once
};
/** How large one history entry may get (the largest legitimate one, 300 deleted ids, is ~8 KB). */
export const ACTIVITY_PAYLOAD_MAX = 32 * 1024;
/** What "list.linkUndo" puts back – all that "list.link" remembers per item. */
const UNDO_COLS = ['id', 'list_id', 'group_id', 'qty', 'unit', 'note', 'prio', 'shared', 'places', 'checked', 'checked_by', 'checked_in', 'parked', 'pos', 'deleted_at'];

const rnd = (b) => webcrypto.getRandomValues(b);
export const newEntityId = () => randomEntityId(rnd);
export const hashToken = (token) => createHash('sha256').update(String(token)).digest('base64url');

/** Who an admin is inside an ID: no device row, the same name for every admin. */
export const adminDevice = () => ({ dev_id: 'admin', name: 'Admin', kind: 'admin', token_hash: null });

export class OpError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

// ---------- validation helpers ----------

function str(v, max, { required = false, field = 'value' } = {}) {
  if (v === undefined || v === null) {
    if (required) throw new OpError('invalid', `${field} required`);
    return '';
  }
  if (typeof v !== 'string') throw new OpError('invalid', `${field} must be a string`);
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !s) throw new OpError('invalid', `${field} required`);
  return s.slice(0, max);
}

/** "Admin" is what the administration is called inside an ID – no device may call itself that */
const checkedDeviceName = (v, opts) => {
  const s = str(v, LIMITS.deviceName, opts);
  // also "Admin" dressed up with invisible characters, accents, full-width letters or spaces
  if (s.normalize('NFKD').replace(/[\p{Cf}\p{M}\s]/gu, '').toLowerCase() === 'admin') throw new OpError('invalid', 'name reserved');
  return s;
};

function note(v) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new OpError('invalid', 'note must be a string');
  return v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, LIMITS.note);
}

function eid(v, field = 'id') {
  if (typeof v !== 'string' || !ENTITY_ID_RE.test(v)) throw new OpError('invalid', `${field} invalid`);
  return v;
}

function num(v, field = 'pos') {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new OpError('invalid', `${field} must be a number`);
  return v;
}

function qtyStr(v) {
  if (v === undefined || v === null || v === '') return '';
  const s = String(v).replace(',', '.').trim().slice(0, LIMITS.qty);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new OpError('invalid', 'qty must be numeric');
  return s;
}

function idList(v) {
  if (!Array.isArray(v) || v.length === 0 || v.length > LIMITS.batch) throw new OpError('invalid', 'ids invalid');
  return [...new Set(v.map((x) => eid(x)))];
}

// ---------- row mappers ----------

export const mapList = (r) => ({
  id: r.id,
  name: r.name,
  pos: r.pos,
  groupMode: r.group_mode,
  address: r.address ?? '',
  travel: r.travel_country && r.travel_lang ? { country: r.travel_country, lang: r.travel_lang } : null,
  prioShortcuts: !!r.prio_shortcuts,
  linkId: r.link_id ?? null,
  createdAt: r.created_at,
});
export const mapGroup = (r) => ({ id: r.id, listId: r.list_id, parentId: r.parent_id, name: r.name, pos: r.pos });
export const mapItem = (r) => ({
  id: r.id,
  listId: r.list_id,
  groupId: r.group_id,
  name: r.name,
  qty: r.qty,
  unit: r.unit,
  note: r.note,
  checked: !!r.checked,
  parked: !!r.parked,
  prio: r.prio ?? 0,
  shared: !!r.shared,
  checkedIn: r.checked_in ?? null,
  bought: r.bought ?? 0,
  places: JSON.parse(r.places || '{}'),
  checkedBy: r.checked_by,
  addedBy: r.added_by,
  pos: r.pos,
  meta: JSON.parse(r.meta),
  createdAt: r.created_at,
});
export const mapMemory = (r) => ({ scope: r.scope, norm: r.norm, group: r.group_name, subgroup: r.subgroup_name });
export const mapTranslation = (r) => ({ norm: r.norm, lang: r.lang, text: r.text, auto: !!r.auto, by: r.auto ? (r.provider ?? null) : null, at: r.updated_at });
export const mapSuggestion = (r) => ({ norm: r.norm, name: r.name, uses: r.uses, lastUsedAt: r.last_used_at });
export const mapConflict = (r) => ({
  id: r.id,
  listId: r.list_id,
  itemId: r.item_id,
  field: r.field,
  options: JSON.parse(r.options),
  createdAt: r.created_at,
});
export const mapDevice = (r) => {
  const shopping = r.shopping_until && r.shopping_until > Date.now();
  return {
    devId: r.dev_id,
    name: r.name,
    ...(r.kind === 'ai' && { ai: true }),
    lastSeenAt: r.last_seen_at,
    shoppingUntil: shopping ? r.shopping_until : null,
    // "where am I in the shop": only shared while checked in
    spot: shopping && r.spot_at ? { group: r.spot_group ?? '', item: r.spot_item ?? '', at: r.spot_at } : null,
  };
};

/** Label of a group path for spots and signals, e.g. "Fridge › Dairy". */
export const pathLabel = (p) => [p.group, p.subgroup].filter(Boolean).join(' › ');
export const mapSpace = (r) => ({
  id: r.public_id,
  name: r.name,
  ttlDays: r.ttl_days,
  createdAt: r.created_at,
  lastActiveAt: r.last_active_at,
  aiWrite: !!r.ai_write,
  translate: mapTranslate(r),
});
/** The ID's translation setting as members see it – the key itself never leaves the server. */
export const mapTranslate = (r) => {
  const extra = parseJson(r.tr_extra) ?? {};
  return { mode: r.tr_mode ?? null, provider: r.tr_provider ?? null, hasKey: !!r.tr_key, keyHint: extra.hint ?? '', region: extra.region ?? '', email: extra.email ?? '' };
};
const parseJson = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

/** 1 = important, -1 = not important, 0 = normal */
const prioOf = (v) => (Number(v) > 0 ? 1 : Number(v) < 0 ? -1 : 0);

const fieldValue = (item, f) => {
  switch (f) {
    case 'amount':
      return { qty: item.qty, unit: item.unit };
    case 'checked':
      return !!item.checked;
    case 'parked':
      return !!item.parked;
    case 'groupId':
      return item.group_id;
    case 'prio':
      return item.prio ?? 0;
    default:
      return item[f];
  }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- store ----------

export class Store {
  constructor(db, config) {
    this.db = db;
    this.config = config;
    this.shoppingMs = (config.shoppingIdleMin ?? 60) * 60_000;
  }

  // ----- spaces -----

  generatePublicId() {
    const { db } = this;
    for (let i = 0; i < 20; i++) {
      const id = randomSpaceId(rnd);
      if (!db.q('SELECT 1 FROM spaces WHERE public_id = ?').get(id) && !db.q('SELECT 1 FROM retired_ids WHERE public_id = ?').get(id)) {
        return id;
      }
    }
    throw new Error('could not generate unique id');
  }

  createSpace({ name, token, deviceName, listName }) {
    const { db } = this;
    const now = Date.now();
    const spaceName = str(name, LIMITS.spaceName, { required: true, field: 'name' });
    return db.tx(() => {
      const publicId = this.generatePublicId();
      const { lastInsertRowid } = db
        .q('INSERT INTO spaces (public_id, name, ttl_days, created_by, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(publicId, spaceName, this.config.spaceTtlDays, token ? hashToken(token) : null, now, now);
      const uid = Number(lastInsertRowid);
      db.q('INSERT INTO lists (space_uid, id, name, pos, group_mode, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        uid,
        newEntityId(),
        str(listName, LIMITS.listName) || spaceName,
        1,
        'own',
        now,
      );
      if (token) this.joinDevice(uid, hashToken(token), deviceName);
      return publicId;
    });
  }

  /** IDs this device created that still exist (SPACES_PER_DEVICE). */
  spacesCreatedBy(tokenHash) {
    return this.db.q('SELECT COUNT(*) AS c FROM spaces WHERE created_by = ? AND deleted_at IS NULL').get(tokenHash).c;
  }

  spaceByUid(uid) {
    return this.db.q('SELECT * FROM spaces WHERE uid = ?').get(uid);
  }

  isMember(uid, tokenHash) {
    return !!this.db.q('SELECT 1 FROM devices WHERE space_uid = ? AND token_hash = ?').get(uid, tokenHash);
  }

  /**
   * Resolve a public id. tokenHash decides whether a renewed/deleted id reveals anything.
   * → {status:'ok', space} | {status:'moved', id} | {status:'deleted', by, at} | {status:'notfound'}
   */
  resolve(publicId, tokenHash) {
    const { db } = this;
    const space = db.q('SELECT * FROM spaces WHERE public_id = ?').get(publicId);
    if (space) {
      if (space.deleted_at) {
        if (tokenHash && this.isMember(space.uid, tokenHash)) {
          return { status: 'deleted', by: space.deleted_by, at: space.deleted_at, space };
        }
        return { status: 'notfound' };
      }
      return { status: 'ok', space };
    }
    const retired = db.q('SELECT * FROM retired_ids WHERE public_id = ?').get(publicId);
    if (retired && retired.reason === 'renewed' && retired.space_uid && tokenHash) {
      const current = this.spaceByUid(retired.space_uid);
      if (current && this.isMember(current.uid, tokenHash)) {
        if (current.deleted_at) return { status: 'deleted', by: current.deleted_by, at: current.deleted_at, space: current };
        return { status: 'moved', id: current.public_id };
      }
    }
    return { status: 'notfound' };
  }

  joinDevice(uid, tokenHash, name) {
    const { db } = this;
    const now = Date.now();
    let devName;
    try {
      devName = checkedDeviceName(name) || 'Device';
    } catch {
      devName = 'Device';
    }
    const existing = db.q('SELECT * FROM devices WHERE space_uid = ? AND token_hash = ?').get(uid, tokenHash);
    if (existing) {
      db.q('UPDATE devices SET last_seen_at = ?, name = ? WHERE space_uid = ? AND token_hash = ?').run(now, devName, uid, tokenHash);
      return { ...existing, last_seen_at: now, name: devName, isNew: false };
    }
    // every new token is a new device row – an ID cannot be filled up endlessly
    if (db.q('SELECT COUNT(*) AS c FROM devices WHERE space_uid = ?').get(uid).c >= LIMITS.devicesPerSpace) throw new OpError('limit', 'too many devices');
    // and a device is in a handful of IDs, not in hundreds (deleted IDs don't count – they can be continued)
    if (this.idsOf(tokenHash) >= LIMITS.idsPerDevice) throw new OpError('id_limit', 'this device is in too many IDs');
    const devId = newEntityId().slice(0, 12);
    db.q('INSERT INTO devices (space_uid, token_hash, dev_id, name, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      uid,
      tokenHash,
      devId,
      devName,
      now,
      now,
    );
    return { space_uid: uid, token_hash: tokenHash, dev_id: devId, name: devName, last_seen_at: now, shopping_until: null, isNew: true };
  }

  device(uid, tokenHash) {
    return this.db.q('SELECT * FROM devices WHERE space_uid = ? AND token_hash = ?').get(uid, tokenHash);
  }

  /** How many (not deleted) IDs this device is in. */
  idsOf(tokenHash) {
    return this.db.q('SELECT COUNT(*) AS c FROM devices d JOIN spaces s ON s.uid = d.space_uid WHERE d.token_hash = ? AND d.kind IS NULL AND s.deleted_at IS NULL').get(tokenHash).c;
  }

  /** The device leaves the ID ("forget ID on this device") → the row removed, or null. */
  leaveSpace(uid, tokenHash) {
    return this.db.q('DELETE FROM devices WHERE space_uid = ? AND token_hash = ? RETURNING dev_id, name').get(uid, tokenHash) ?? null;
  }

  /**
   * Next revision of a space. A member's edit also counts as activity (the ID is deleted TTL days
   * after its last activity) – an admin's visit or edit does not: looking after an ID must not
   * keep it alive.
   */
  _bump(uid, device, now) {
    const sql = device?.kind === 'admin'
      ? 'UPDATE spaces SET rev = rev + 1 WHERE uid = ? RETURNING rev'
      : 'UPDATE spaces SET rev = rev + 1, last_active_at = ? WHERE uid = ? RETURNING rev';
    return this.db.q(sql).get(...(device?.kind === 'admin' ? [uid] : [now, uid])).rev;
  }

  touch(uid, tokenHash) {
    const now = Date.now();
    this.db.q('UPDATE spaces SET last_active_at = ? WHERE uid = ? AND last_active_at < ?').run(now, uid, now - 60_000);
    this.db.q('UPDATE devices SET last_seen_at = ? WHERE space_uid = ? AND token_hash = ? AND last_seen_at < ?').run(now, uid, tokenHash, now - 60_000);
  }

  /**
   * Activity while checked in at the shop keeps the check-in alive (sliding window).
   * Written at most every few minutes; returns the device row when it changed.
   */
  keepShopping(uid, tokenHash, now = Date.now()) {
    const until = now + this.shoppingMs;
    const step = Math.min(5 * 60_000, this.shoppingMs / 4);
    const r = this.db
      .q('UPDATE devices SET shopping_until = ? WHERE space_uid = ? AND token_hash = ? AND shopping_until > ? AND shopping_until < ? RETURNING *')
      .get(until, uid, tokenHash, now, until - step);
    return r ? mapDevice(r) : null;
  }

  snapshot(uid) {
    const { db } = this;
    const space = this.spaceByUid(uid);
    return {
      space: mapSpace(space),
      rev: space.rev,
      lists: db.q('SELECT * FROM lists WHERE space_uid = ? AND deleted_at IS NULL ORDER BY pos').all(uid).map(mapList),
      groups: db
        .q(
          `SELECT g.* FROM groups g WHERE g.space_uid = ? AND g.deleted_at IS NULL
           AND (g.list_id IS NULL OR EXISTS (SELECT 1 FROM lists l WHERE l.space_uid = g.space_uid AND l.id = g.list_id AND l.deleted_at IS NULL)) ORDER BY g.pos`,
        )
        .all(uid)
        .map(mapGroup),
      items: db
        .q(
          `SELECT i.* FROM items i JOIN lists l ON l.space_uid = i.space_uid AND l.id = i.list_id
           WHERE i.space_uid = ? AND i.deleted_at IS NULL AND l.deleted_at IS NULL ORDER BY i.pos`,
        )
        .all(uid)
        .map(mapItem),
      memory: db.q('SELECT * FROM memory WHERE space_uid = ?').all(uid).map(mapMemory),
      suggestions: db
        .q('SELECT * FROM suggestions WHERE space_uid = ? ORDER BY last_used_at DESC LIMIT ?')
        .all(uid, LIMITS.suggestionsPerSpace)
        .map(mapSuggestion),
      conflicts: db.q('SELECT * FROM conflicts WHERE space_uid = ? ORDER BY created_at').all(uid).map(mapConflict),
      translations: db.q('SELECT * FROM translations WHERE space_uid = ?').all(uid).map(mapTranslation),
      devices: this.devices(uid),
    };
  }

  devices(uid) {
    return this.db.q('SELECT * FROM devices WHERE space_uid = ? ORDER BY created_at, rowid').all(uid).map(mapDevice);
  }

  renew(uid) {
    const { db } = this;
    return db.tx(() => {
      const space = this.spaceByUid(uid);
      const newId = this.generatePublicId();
      db.q('INSERT INTO retired_ids (public_id, space_uid, reason, created_at) VALUES (?, ?, ?, ?)').run(space.public_id, uid, 'renewed', Date.now());
      db.q('UPDATE spaces SET public_id = ? WHERE uid = ?').run(newId, uid);
      // a new ID cuts every AI connection – they have to be connected again
      db.q("DELETE FROM devices WHERE space_uid = ? AND kind = 'ai'").run(uid);
      return newId;
    });
  }

  // ----- AI assistants: devices that connect with their own key (MCP / REST) -----

  /** The key is hashed with a prefix, so it never works as a normal device token. */
  static aiKeyHash(key) {
    return hashToken(`ai:${key}`);
  }

  /** New assistant connection → { key, device }. The key is shown once and only its hash is kept. */
  createAiDevice(uid, name) {
    const devName = checkedDeviceName(name, { required: true, field: 'name' });
    const count = this.db.q("SELECT COUNT(*) AS c FROM devices WHERE space_uid = ? AND kind = 'ai'").get(uid).c;
    if (count >= 20) throw new OpError('limit', 'too many assistants');
    const key = `swk_${Buffer.from(webcrypto.getRandomValues(new Uint8Array(24))).toString('base64url')}`;
    const now = Date.now();
    const devId = newEntityId().slice(0, 12);
    this.db
      .q("INSERT INTO devices (space_uid, token_hash, dev_id, name, kind, last_seen_at, created_at) VALUES (?, ?, ?, ?, 'ai', ?, ?)")
      .run(uid, Store.aiKeyHash(key), devId, devName, now, now);
    return { key, device: this.db.q('SELECT * FROM devices WHERE space_uid = ? AND dev_id = ?').get(uid, devId) };
  }

  /** Assistant key → { space, dev } of a live ID, or null. */
  resolveAiKey(key) {
    if (typeof key !== 'string' || !/^swk_[A-Za-z0-9_-]{20,64}$/.test(key)) return null;
    const dev = this.db.q("SELECT * FROM devices WHERE token_hash = ? AND kind = 'ai'").get(Store.aiKeyHash(key));
    if (!dev) return null;
    const space = this.spaceByUid(dev.space_uid);
    if (!space || space.deleted_at) return null;
    return { space, dev };
  }

  deleteSpace(uid, byName) {
    this.db.q('UPDATE spaces SET deleted_at = ?, deleted_by = ? WHERE uid = ? AND deleted_at IS NULL').run(Date.now(), byName, uid);
  }

  /** Delete a space for good (administration): its id is never handed out again. */
  purgeSpace(uid) {
    const { db } = this;
    db.tx(() => {
      // deleted spaces this one was continued from go too – "continue" must not bring it back
      const todo = [uid];
      while (todo.length) {
        const u = todo.pop();
        const space = this.spaceByUid(u);
        if (!space) continue;
        for (const r of db.q("SELECT public_id FROM retired_ids WHERE reason = 'continued' AND space_uid = ?").all(u)) {
          const from = Number(r.public_id.slice(2));
          if (from && this.spaceByUid(from)?.deleted_at) todo.push(from);
        }
        db.q('INSERT OR REPLACE INTO retired_ids (public_id, space_uid, reason, created_at) VALUES (?, NULL, ?, ?)').run(space.public_id, 'admin', Date.now());
        db.q('UPDATE retired_ids SET space_uid = NULL WHERE space_uid = ?').run(u);
        db.q('DELETE FROM spaces WHERE uid = ?').run(u);
      }
    });
  }

  /** The stored translation setting of a space: { mode, provider, keyEnc, extra } (keyEnc still sealed). */
  translateConfig(uid) {
    const r = this.spaceByUid(uid);
    return r ? { mode: r.tr_mode ?? null, provider: r.tr_provider ?? null, keyEnc: r.tr_key ?? null, extra: parseJson(r.tr_extra) ?? {} } : null;
  }

  /** Store the translation setting (the key already sealed by the caller) → the space's patch row. */
  setTranslateConfig(uid, dev, { mode, provider, keyEnc, extra }) {
    const now = Date.now();
    this.db
      .q('UPDATE spaces SET tr_mode = ?, tr_provider = ?, tr_key = ?, tr_extra = ? WHERE uid = ?')
      .run(mode, provider, keyEnc, extra && Object.keys(extra).length ? JSON.stringify(extra) : null, uid);
    this._act({ uid, dev, now }, null, 'translate.config', { mode, provider, hasKey: !!keyEnc });
    return mapSpace(this.spaceByUid(uid));
  }

  /** Copy a deleted space into a fresh one. All members continuing end up in the same new space. */
  /** allowNew: asked before a new space is made (only the first member continuing makes one) */
  continueSpace(oldUid, tokenHash, deviceName, allowNew = () => {}) {
    const { db } = this;
    return db.tx(() => {
      const old = this.spaceByUid(oldUid);
      const marker = db.q("SELECT space_uid FROM retired_ids WHERE public_id = ? AND reason = 'continued'").get(`c:${oldUid}`);
      // a device continues once – from then on only the new ID decides whether it is in (kick, renew)
      const leaveOld = () => db.q('DELETE FROM devices WHERE space_uid = ? AND token_hash = ?').run(oldUid, tokenHash);
      if (marker) {
        const target = this.spaceByUid(marker.space_uid);
        if (target && !target.deleted_at) {
          this.joinDevice(target.uid, tokenHash, deviceName);
          leaveOld();
          return target.public_id;
        }
      }
      allowNew();
      const now = Date.now();
      const publicId = this.generatePublicId();
      const { lastInsertRowid } = db
        .q('INSERT INTO spaces (public_id, name, ttl_days, rev, ai_write, created_by, last_active_at, created_at, tr_mode, tr_provider, tr_key, tr_extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(publicId, old.name, old.ttl_days, old.rev, old.ai_write ?? 0, tokenHash, now, now, old.tr_mode ?? null, old.tr_provider ?? null, old.tr_key ?? null, old.tr_extra ?? null);
      const uid = Number(lastInsertRowid);
      // only what was still there: rows of deleted lists stay behind
      const live = {
        lists: ' AND deleted_at IS NULL',
        groups: ` AND deleted_at IS NULL AND (list_id IS NULL OR list_id IN (SELECT id FROM lists WHERE space_uid = ${Number(oldUid)} AND deleted_at IS NULL))`,
        items: ` AND deleted_at IS NULL AND list_id IN (SELECT id FROM lists WHERE space_uid = ${Number(oldUid)} AND deleted_at IS NULL)`,
      };
      const copy = (table, cols) => {
        db.q(`INSERT INTO ${table} (space_uid, ${cols}) SELECT ?, ${cols} FROM ${table} WHERE space_uid = ?${live[table] ?? ''}`).run(uid, oldUid);
      };
      copy('lists', 'id, name, pos, group_mode, address, travel_country, travel_lang, prio_shortcuts, link_id, created_at');
      copy('groups', 'id, list_id, parent_id, name, pos, created_at');
      copy('items', 'id, list_id, group_id, name, norm, qty, unit, note, checked, parked, prio, shared, checked_in, places, bought, checked_by, added_by, pos, meta, created_at');
      copy('memory', 'scope, norm, group_name, subgroup_name, updated_at');
      copy('suggestions', 'norm, name, uses, last_used_at');
      copy('translations', 'norm, lang, text, auto, provider, updated_at');
      db.q('INSERT OR REPLACE INTO retired_ids (public_id, space_uid, reason, created_at) VALUES (?, ?, ?, ?)').run(`c:${oldUid}`, uid, 'continued', now);
      this.joinDevice(uid, tokenHash, deviceName);
      leaveOld();
      return publicId;
    });
  }

  /** Remembered translations for these names → Map(norm → text). */
  knownTranslations(uid, lang, norms) {
    const out = new Map();
    const q = this.db.q('SELECT text FROM translations WHERE space_uid = ? AND norm = ? AND lang = ?');
    for (const n of norms) {
      const r = q.get(uid, n, lang);
      if (r) out.set(n, r.text);
    }
    return out;
  }

  /** Store machine translations [norm, text, provider] (never over one a person wrote) → patch changes. */
  saveAutoTranslations(uid, lang, pairs) {
    const changes = [];
    const now = Date.now();
    const q = this.db.q(`INSERT INTO translations (space_uid, norm, lang, text, auto, provider, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(space_uid, norm, lang) DO UPDATE SET text = excluded.text, provider = excluded.provider, updated_at = excluded.updated_at WHERE auto = 1 RETURNING *`);
    this.db.tx(() => {
      for (const [norm, text, provider = null] of pairs) {
        if (!text) continue;
        const r = q.get(uid, norm, lang, text.slice(0, LIMITS.translation), provider, now);
        if (r) changes.push({ e: 'translation', row: mapTranslation(r) });
      }
    });
    return changes;
  }

  activity(uid, listId, limit = 200) {
    return this.db
      .q('SELECT * FROM activity WHERE space_uid = ? AND (list_id = ? OR list_id IS NULL) ORDER BY id DESC LIMIT ?')
      .all(uid, listId, limit)
      .map((r) => ({ id: r.id, listId: r.list_id, by: r.dev_name, action: r.action, payload: JSON.parse(r.payload), at: r.created_at }));
  }

  listsOf(uid) {
    return this.db.q('SELECT id, name FROM lists WHERE space_uid = ? AND deleted_at IS NULL ORDER BY pos').all(uid).map((r) => ({ id: r.id, name: r.name }));
  }

  cleanup(now = Date.now()) {
    const { db, config } = this;
    const out = { devices: 0, spaces: 0 };
    db.tx(() => {
      out.devices = Number(db.q('DELETE FROM devices WHERE last_seen_at < ?').run(now - config.deviceTtlDays * DAY).changes);
      const expired = db
        .q(
          `SELECT uid, public_id FROM spaces
           WHERE (deleted_at IS NULL AND last_active_at + ttl_days * ${DAY} < ?)
              OR (deleted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.space_uid = spaces.uid))`,
        )
        .all(now);
      for (const s of expired) {
        db.q('INSERT OR REPLACE INTO retired_ids (public_id, space_uid, reason, created_at) VALUES (?, NULL, ?, ?)').run(s.public_id, 'expired', now);
        db.q('UPDATE retired_ids SET space_uid = NULL WHERE space_uid = ?').run(s.uid);
        db.q('DELETE FROM spaces WHERE uid = ?').run(s.uid);
      }
      out.spaces = expired.length;
      const cutoff = now - config.activityTtlDays * DAY;
      db.q('DELETE FROM activity WHERE created_at < ?').run(cutoff);
      db.q('DELETE FROM items WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff);
      db.q('DELETE FROM groups WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff);
      db.q('DELETE FROM items WHERE EXISTS (SELECT 1 FROM lists l WHERE l.space_uid = items.space_uid AND l.id = items.list_id AND l.deleted_at < ?)').run(cutoff);
      db.q('DELETE FROM groups WHERE list_id IS NOT NULL AND EXISTS (SELECT 1 FROM lists l WHERE l.space_uid = groups.space_uid AND l.id = groups.list_id AND l.deleted_at < ?)').run(cutoff);
      db.q('DELETE FROM lists WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff);
      db.q('DELETE FROM conflicts WHERE created_at < ?').run(cutoff);
      db.q('DELETE FROM applied_ops WHERE created_at < ?').run(cutoff);
      db.q('DELETE FROM merged_items WHERE created_at < ?').run(cutoff);
      // what an ID has learned stays bounded – the oldest entries go first
      const cap = (table, order, limit) =>
        db.q(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM (SELECT rowid, row_number() OVER (PARTITION BY space_uid ORDER BY ${order} DESC) AS rn FROM ${table}) WHERE rn > ?)`).run(limit);
      cap('memory', 'updated_at', LIMITS.memoryPerSpace);
      cap('suggestions', 'last_used_at', LIMITS.suggestionsPerSpace);
      cap('translations', 'updated_at', LIMITS.translationsPerSpace);
    });
    return out;
  }

  // ----- ops -----

  /**
   * Apply one client operation. Returns { result, changes } where changes are entity patches
   * to broadcast to every device of the space. Idempotent per opId.
   */
  applyOp(uid, device, opId, op, at) {
    const { db } = this;
    if (typeof opId !== 'string' || opId.length > 40) throw new OpError('invalid', 'op id');
    if (!op || typeof op.k !== 'string') throw new OpError('invalid', 'op');
    const done = db.q('SELECT result FROM applied_ops WHERE space_uid = ? AND op_id = ?').get(uid, opId);
    // keys starting with _ are kept for later ops (e.g. undo data) but not sent back
    const visible = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')));
    if (done) return { result: visible(JSON.parse(done.result)), changes: [], duplicate: true };

    const now = Date.now();
    // Client time is corrected by the client; never trust it beyond "now".
    const madeAt = typeof at === 'number' && Number.isFinite(at) ? Math.min(at, now) : now;
    return db.tx(() => {
      const rev = this._bump(uid, device, now);
      const ctx = { uid, dev: device, rev, at: madeAt, now, changes: [] };
      // own handlers only – never something every object has (valueOf, constructor, …)
      const handler = Object.hasOwn(OPS, op.k) ? OPS[op.k] : null;
      if (typeof handler !== 'function') throw new OpError('invalid', 'unknown op');
      const result = handler.call(this, ctx, op) ?? {};
      this._pruneInactive(ctx);
      db.q('INSERT INTO applied_ops (space_uid, op_id, result, created_at) VALUES (?, ?, ?, ?)').run(uid, opId, JSON.stringify(result), now);
      return { result: visible(result), changes: ctx.changes, rev, kickedHash: ctx.kicked, allDone: ctx.allDone };
    });
  }

  // helpers used by ops
  _list(uid, id) {
    const l = this.db.q('SELECT * FROM lists WHERE space_uid = ? AND id = ?').get(uid, id);
    if (!l || l.deleted_at) throw new OpError('notfound', 'list not found');
    return l;
  }
  /** An id that was merged into another item (added twice while offline) → that item's id. */
  _realId(uid, id) {
    return this.db.q('SELECT target FROM merged_items WHERE space_uid = ? AND id = ?').get(uid, id)?.target ?? id;
  }
  _item(uid, id, { allowDeleted = false } = {}) {
    const it = this.db.q('SELECT * FROM items WHERE space_uid = ? AND id = ?').get(uid, this._realId(uid, id));
    if (!it || (it.deleted_at && !allowDeleted)) throw new OpError(it ? 'deleted' : 'notfound', 'item not found');
    return it;
  }
  _group(uid, id) {
    return this.db.q('SELECT * FROM groups WHERE space_uid = ? AND id = ? AND deleted_at IS NULL').get(uid, id);
  }
  /** groupId valid for the list's current group set? Otherwise null. */
  _validGroup(uid, list, groupId) {
    if (!groupId) return null;
    const g = this._group(uid, groupId);
    if (!g) return null;
    const scopeList = list.group_mode === 'shared' ? null : list.id;
    return g.list_id === scopeList ? g.id : null;
  }
  _scope(list) {
    return list.group_mode === 'shared' ? '' : list.id;
  }
  _groupPath(uid, groupId) {
    if (!groupId) return { group: '', subgroup: '' };
    const g = this.db.q('SELECT * FROM groups WHERE space_uid = ? AND id = ?').get(uid, groupId);
    if (!g) return { group: '', subgroup: '' };
    if (g.parent_id) {
      const p = this.db.q('SELECT * FROM groups WHERE space_uid = ? AND id = ?').get(uid, g.parent_id);
      return { group: p ? p.name : '', subgroup: g.name };
    }
    return { group: g.name, subgroup: '' };
  }
  /**
   * The inactive part of a list keeps its most recent LIMITS.inactivePerList items; older ones are
   * deleted (and stay in the history for a while). Runs after every op that parked something.
   */
  _pruneInactive(ctx) {
    const lists = new Set(ctx.changes.filter((c) => c.e === 'item' && c.row?.parked).map((c) => c.row.listId));
    for (const id of lists) {
      const list = this.db.q('SELECT * FROM lists WHERE space_uid = ? AND id = ? AND deleted_at IS NULL').get(ctx.uid, id);
      if (!list) continue;
      const old = this._visibleItems(ctx.uid, list, 'i.parked = 1', [], "COALESCE(json_extract(i.meta, '$.parked.at'), i.created_at) DESC, i.rowid DESC").slice(LIMITS.inactivePerList);
      for (const r of old) {
        this.db.q('UPDATE items SET deleted_at = ? WHERE space_uid = ? AND id = ?').run(ctx.now, ctx.uid, r.id);
        ctx.changes.push({ e: 'item', del: r.id });
        this._dropConflicts(ctx, r.id);
      }
      if (old.length) this._act(ctx, list.id, 'item.delete', { names: old.slice(0, 20).map((r) => r.name), count: old.length, ids: old.map((r) => r.id), inactiveLimit: true });
    }
  }
  _learn(ctx, list, norm, groupId) {
    const path = this._groupPath(ctx.uid, groupId);
    const scope = this._scope(list);
    this.db
      .q(
        `INSERT INTO memory (space_uid, scope, norm, group_name, subgroup_name, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(space_uid, scope, norm) DO UPDATE SET group_name = excluded.group_name, subgroup_name = excluded.subgroup_name, updated_at = excluded.updated_at`,
      )
      .run(ctx.uid, scope, norm, path.group, path.subgroup, ctx.now);
    ctx.changes.push({ e: 'memory', row: { scope, norm, group: path.group, subgroup: path.subgroup } });
  }
  _suggest(ctx, name, norm) {
    const row = this.db
      .q(
        `INSERT INTO suggestions (space_uid, norm, name, uses, last_used_at) VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(space_uid, norm) DO UPDATE SET name = excluded.name, uses = uses + 1, last_used_at = excluded.last_used_at
         RETURNING *`,
      )
      .get(ctx.uid, norm, name, ctx.now);
    ctx.changes.push({ e: 'suggestion', row: mapSuggestion(row) });
  }
  _act(ctx, listId, action, payload) {
    // every payload holds validated, truncated values – this is the backstop so no new call site can
    // make the history a place to park megabytes (the largest legitimate one, 300 deleted ids, is ~8 KB)
    let json = JSON.stringify(ctx.dev.kind === 'admin' ? { ...payload, admin: true } : payload);
    if (json.length > ACTIVITY_PAYLOAD_MAX) json = JSON.stringify({ truncated: true });
    this.db
      .q('INSERT INTO activity (space_uid, list_id, dev_name, action, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ctx.uid, listId, ctx.dev.name, action, json, ctx.now);
  }
  _pushItem(ctx, id) {
    const r = this.db.q('SELECT * FROM items WHERE space_uid = ? AND id = ?').get(ctx.uid, id);
    ctx.changes.push(r.deleted_at ? { e: 'item', del: id } : { e: 'item', row: mapItem(r) });
  }
  _pushGroup(ctx, id) {
    const r = this.db.q('SELECT * FROM groups WHERE space_uid = ? AND id = ?').get(ctx.uid, id);
    ctx.changes.push(r.deleted_at ? { e: 'group', del: id } : { e: 'group', row: mapGroup(r) });
  }
  _pushList(ctx, id) {
    const r = this.db.q('SELECT * FROM lists WHERE space_uid = ? AND id = ?').get(ctx.uid, id);
    ctx.changes.push(r.deleted_at ? { e: 'list', del: id } : { e: 'list', row: mapList(r) });
  }
  _dropConflicts(ctx, itemId) {
    const rows = this.db.q('DELETE FROM conflicts WHERE space_uid = ? AND item_id = ? RETURNING id').all(ctx.uid, itemId);
    for (const r of rows) ctx.changes.push({ e: 'conflict', del: r.id });
  }

  // ----- list groups (Listenverbund) -----

  /** Ids of the lists in the same list group (the list itself first), or just the list. */
  _linked(uid, list) {
    if (!list.link_id) return [list.id];
    const others = this.db
      .q('SELECT id FROM lists WHERE space_uid = ? AND link_id = ? AND id != ? AND deleted_at IS NULL ORDER BY pos')
      .all(uid, list.link_id, list.id)
      .map((r) => r.id);
    return [list.id, ...others];
  }
  /** SQL condition (alias i) + args: the items a list shows – its own and the shared ones of its list group. */
  _visibleSql(uid, list) {
    const ids = this._linked(uid, list);
    if (ids.length === 1) return { sql: 'i.list_id = ?', args: [list.id] };
    return { sql: `(i.list_id = ? OR (i.shared = 1 AND i.list_id IN (${ids.map(() => '?').join(', ')})))`, args: [list.id, ...ids] };
  }
  /** Items a list shows (not deleted), optionally with an extra condition. */
  _visibleItems(uid, list, extra = '', extraArgs = [], order = 'i.pos') {
    const v = this._visibleSql(uid, list);
    return this.db
      .q(`SELECT i.* FROM items i WHERE i.space_uid = ? AND i.deleted_at IS NULL AND ${v.sql}${extra ? ` AND ${extra}` : ''} ORDER BY ${order}`)
      .all(uid, ...v.args, ...extraArgs);
  }
  /** Can this list show the item? */
  _shows(uid, list, item) {
    if (item.list_id === list.id) return true;
    return !!item.shared && this._linked(uid, list).includes(item.list_id);
  }
  /**
   * A shared item gets a place (group, position) in every other list of its list group:
   * what that shop has learned for the name, otherwise none. Existing places stay.
   * Returns true when something changed (the row is updated, not pushed).
   */
  _fillPlaces(ctx, item) {
    if (!item.shared) return false;
    const home = this.db.q('SELECT * FROM lists WHERE space_uid = ? AND id = ?').get(ctx.uid, item.list_id);
    if (!home?.link_id) return false;
    const places = JSON.parse(item.places || '{}');
    let changed = false;
    const memory = this.db.q('SELECT * FROM memory WHERE space_uid = ? AND scope = ? AND norm = ?');
    for (const id of this._linked(ctx.uid, home).slice(1)) {
      if (places[id]) continue;
      const list = this._list(ctx.uid, id);
      const m = memory.get(ctx.uid, this._scope(list), item.norm);
      const groupId = m?.group_name || m?.subgroup_name ? this._ensurePath(ctx, list, m.group_name, m.subgroup_name) : null;
      places[id] = { groupId, pos: item.pos };
      changed = true;
    }
    if (changed) this.db.q('UPDATE items SET places = ? WHERE space_uid = ? AND id = ?').run(JSON.stringify(places), ctx.uid, item.id);
    return changed;
  }

  _insertItem(ctx, list, { id, groupId, name, qty, unit, note: n, pos, checked = false, parked = false, prio = 0, shared = false }) {
    const norm = normalizeName(name);
    const metaEntry = { v: ctx.rev, at: ctx.at, by: ctx.dev.dev_id };
    const meta = { name: metaEntry, amount: metaEntry, note: metaEntry, checked: metaEntry, parked: metaEntry, groupId: metaEntry, prio: metaEntry };
    const isChecked = checked && !parked;
    this.db
      .q(
        `INSERT INTO items (space_uid, id, list_id, group_id, name, norm, qty, unit, note, checked, parked, prio, shared, checked_in, checked_by, added_by, pos, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(ctx.uid, id, list.id, groupId, name, norm, qty, unit, n, isChecked ? 1 : 0, parked ? 1 : 0, prioOf(prio), shared && list.link_id ? 1 : 0, isChecked ? list.id : null, isChecked ? ctx.dev.name : null, ctx.dev.name, pos, JSON.stringify(meta), ctx.now);
    return norm;
  }

  /** Find or create a group path (by name, case-insensitive) in a list's group set. */
  _ensurePath(ctx, list, groupName, subgroupName) {
    // there is only one level of groups: a former "group › subgroup" becomes the subgroup's name
    if (subgroupName) {
      groupName = subgroupName;
      subgroupName = '';
    }
    if (!groupName) return null;
    const scopeList = list.group_mode === 'shared' ? null : list.id;
    const find = (parentId, name) =>
      this.db
        .q(
          `SELECT * FROM groups WHERE space_uid = ? AND deleted_at IS NULL AND list_id IS ? AND parent_id IS ? AND lower(name) = lower(?)`,
        )
        .get(ctx.uid, scopeList, parentId, name);
    const create = (parentId, name) => {
      // the same limit as for groups added by hand; past it the item simply has no group
      if (this.db.q('SELECT COUNT(*) AS c FROM groups WHERE space_uid = ? AND deleted_at IS NULL').get(ctx.uid).c >= LIMITS.groupsPerSpace) return null;
      const maxPos = this.db
        .q('SELECT COALESCE(MAX(pos), 0) AS m FROM groups WHERE space_uid = ? AND list_id IS ? AND parent_id IS ? AND deleted_at IS NULL')
        .get(ctx.uid, scopeList, parentId).m;
      const id = newEntityId();
      this.db
        .q('INSERT INTO groups (space_uid, id, list_id, parent_id, name, pos, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(ctx.uid, id, scopeList, parentId, name, maxPos + 1, ctx.now);
      this._pushGroup(ctx, id);
      return { id };
    };
    const top = find(null, groupName) || create(null, groupName);
    if (!top) return null;
    if (!subgroupName) return top.id;
    const sub = find(top.id, subgroupName) || create(top.id, subgroupName);
    return sub?.id ?? top.id;
  }
}

// ---------- operation handlers (this = Store) ----------

const OPS = {
  'space.update'(ctx, op) {
    const sets = [];
    const args = [];
    const logged = {}; // the history gets the validated values, never the raw op
    if (op.name !== undefined) {
      logged.name = str(op.name, LIMITS.spaceName, { required: true, field: 'name' });
      sets.push('name = ?');
      args.push(logged.name);
    }
    if (op.ttlDays !== undefined) {
      const d = Number(op.ttlDays);
      if (!Number.isInteger(d) || d < MIN_SPACE_TTL_DAYS || d > MAX_SPACE_TTL_DAYS) throw new OpError('invalid', 'ttlDays out of range');
      logged.ttlDays = d;
      sets.push('ttl_days = ?');
      args.push(d);
    }
    if (op.aiWrite !== undefined) {
      if (ctx.dev.kind === 'ai') throw new OpError('forbidden', 'assistants cannot change this');
      logged.aiWrite = !!op.aiWrite;
      sets.push('ai_write = ?');
      args.push(op.aiWrite ? 1 : 0);
    }
    if (!sets.length) return {};
    this.db.q(`UPDATE spaces SET ${sets.join(', ')} WHERE uid = ?`).run(...args, ctx.uid);
    ctx.changes.push({ e: 'space', row: mapSpace(this.spaceByUid(ctx.uid)) });
    this._act(ctx, null, 'space.update', logged);
  },

  'list.add'(ctx, op) {
    const id = eid(op.id);
    const count = this.db.q('SELECT COUNT(*) AS c FROM lists WHERE space_uid = ? AND deleted_at IS NULL').get(ctx.uid).c;
    if (count >= LIMITS.listsPerSpace) throw new OpError('limit', 'too many lists');
    if (this.db.q('SELECT 1 FROM lists WHERE space_uid = ? AND id = ?').get(ctx.uid, id)) return {};
    const name = str(op.name, LIMITS.listName, { required: true, field: 'name' });
    const mode = op.groupMode === 'shared' ? 'shared' : 'own';
    this.db
      .q('INSERT INTO lists (space_uid, id, name, pos, group_mode, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ctx.uid, id, name, num(op.pos ?? ctx.now), mode, ctx.now);
    this._pushList(ctx, id);
    this._act(ctx, id, 'list.add', { name });
  },

  'list.update'(ctx, op) {
    const list = this._list(ctx.uid, eid(op.id));
    if (op.name !== undefined) {
      const name = str(op.name, LIMITS.listName, { required: true, field: 'name' });
      this.db.q('UPDATE lists SET name = ? WHERE space_uid = ? AND id = ?').run(name, ctx.uid, list.id);
      this._act(ctx, list.id, 'list.rename', { from: list.name, to: name });
    }
    if (op.pos !== undefined) this.db.q('UPDATE lists SET pos = ? WHERE space_uid = ? AND id = ?').run(num(op.pos), ctx.uid, list.id);
    if (op.address !== undefined) {
      const address = str(op.address, LIMITS.address);
      this.db.q('UPDATE lists SET address = ? WHERE space_uid = ? AND id = ?').run(address, ctx.uid, list.id);
      this._act(ctx, list.id, 'list.address', { address });
    }
    if (op.prioShortcuts !== undefined) {
      this.db.q('UPDATE lists SET prio_shortcuts = ? WHERE space_uid = ? AND id = ?').run(op.prioShortcuts ? 1 : 0, ctx.uid, list.id);
    }
    if (op.travel !== undefined) {
      const t = op.travel;
      const on = t && COUNTRY_LANGS[t.country] && LANG_RE.test(t.lang ?? '');
      if (t && !on) throw new OpError('invalid', 'travel');
      this.db
        .q('UPDATE lists SET travel_country = ?, travel_lang = ? WHERE space_uid = ? AND id = ?')
        .run(on ? t.country : null, on ? t.lang : null, ctx.uid, list.id);
    }
    if (op.groupMode !== undefined && op.groupMode !== list.group_mode) {
      if (!['own', 'shared'].includes(op.groupMode)) throw new OpError('invalid', 'groupMode');
      switchGroupMode.call(this, ctx, list, op.groupMode);
    }
    this._pushList(ctx, list.id);
  },

  /**
   * Link two lists into a list group (Listenverbund) – both join with everything they are
   * already linked to. share: existing items of lists that were not linked before become
   * shared. Shared items with the same name are merged into one: the larger amount, notes
   * joined, open beats checked beats inactive, important beats normal.
   * → { linked, mergedItems } – "list.linkUndo" with this op's id takes it all back.
   */
  'list.link'(ctx, op) {
    const a = this._list(ctx.uid, eid(op.id));
    const b = this._list(ctx.uid, eid(op.other, 'other'));
    if (a.id === b.id) throw new OpError('invalid', 'a list cannot be linked to itself');
    if (a.link_id && a.link_id === b.link_id) return {};
    const { db } = this;
    const linkId = a.link_id ?? b.link_id ?? newEntityId();
    const members = db
      .q('SELECT * FROM lists WHERE space_uid = ? AND deleted_at IS NULL AND (id IN (?, ?) OR link_id IN (?, ?)) ORDER BY pos')
      .all(ctx.uid, a.id, b.id, a.link_id ?? '', b.link_id ?? '');
    const undo = { lists: members.map((l) => ({ id: l.id, linkId: l.link_id ?? null })), items: [], removed: [] };
    const before = new Map();
    const keep = (row) => {
      if (!before.has(row.id)) before.set(row.id, row);
    };
    for (const l of members) {
      db.q('UPDATE lists SET link_id = ? WHERE space_uid = ? AND id = ?').run(linkId, ctx.uid, l.id);
      this._pushList(ctx, l.id);
    }
    const ids = members.map((l) => l.id);
    const inLists = `list_id IN (${ids.map(() => '?').join(', ')})`;
    if (op.share !== false) {
      const fresh = members.filter((l) => !l.link_id).map((l) => l.id);
      for (const id of fresh) {
        for (const r of db.q('SELECT * FROM items WHERE space_uid = ? AND list_id = ? AND shared = 0 AND deleted_at IS NULL').all(ctx.uid, id)) {
          keep(r);
          db.q('UPDATE items SET shared = 1 WHERE space_uid = ? AND id = ?').run(ctx.uid, r.id);
        }
      }
    }
    // one shared need per name
    const shared = db.q(`SELECT * FROM items WHERE space_uid = ? AND shared = 1 AND deleted_at IS NULL AND ${inLists} ORDER BY created_at, pos`).all(ctx.uid, ...ids);
    // the whole group is worked through in one go – and remembered for the undo
    if (shared.length > LIMITS.linkedItems) throw new OpError('limit', 'too many shared items in these lists');
    const byNorm = new Map();
    for (const r of shared) byNorm.set(r.norm, [...(byNorm.get(r.norm) ?? []), r]);
    let mergedItems = 0;
    const state = (r) => (r.parked ? 2 : r.checked ? 1 : 0);
    for (const rows of byNorm.values()) {
      if (rows.length < 2) continue;
      const sorted = [...rows].sort((x, y) => state(x) - state(y) || y.prio - x.prio || x.created_at - y.created_at);
      const [win, ...rest] = sorted;
      for (const r of rows) keep(r);
      let { qty, unit } = win;
      for (const r of rest) {
        if (!r.qty) continue;
        if (!qty) ({ qty, unit } = r);
        else if ((r.unit || '') === (unit || '') && Number(r.qty) > Number(qty)) qty = r.qty;
      }
      const notes = [...new Set(rows.map((r) => r.note.trim()).filter(Boolean))];
      const prio = Math.max(...rows.map((r) => r.prio));
      const places = JSON.parse(win.places || '{}');
      for (const r of rest) {
        if (r.list_id !== win.list_id && !places[r.list_id]) places[r.list_id] = { groupId: r.group_id, pos: r.pos };
        for (const [lid, p] of Object.entries(JSON.parse(r.places || '{}'))) places[lid] ??= p;
        db.q('UPDATE items SET deleted_at = ? WHERE space_uid = ? AND id = ?').run(ctx.now, ctx.uid, r.id);
        ctx.changes.push({ e: 'item', del: r.id });
        this._dropConflicts(ctx, r.id);
        undo.removed.push(r.id);
      }
      delete places[win.list_id];
      db.q('UPDATE items SET qty = ?, unit = ?, note = ?, prio = ?, places = ? WHERE space_uid = ? AND id = ?').run(
        qty,
        unit,
        notes.join('\n').slice(0, LIMITS.note),
        prio,
        JSON.stringify(places),
        ctx.uid,
        win.id,
      );
      mergedItems += rest.length;
    }
    for (const r of db.q(`SELECT * FROM items WHERE space_uid = ? AND shared = 1 AND deleted_at IS NULL AND ${inLists}`).all(ctx.uid, ...ids)) {
      const cur = before.get(r.id) ?? r;
      if (this._fillPlaces(ctx, r)) keep(cur);
    }
    for (const [id, row] of before) {
      undo.items.push(Object.fromEntries(UNDO_COLS.map((c) => [c, row[c]]))); // only what linkUndo puts back
      if (!undo.removed.includes(id)) this._pushItem(ctx, id);
    }
    this._act(ctx, a.id, 'list.link', { names: members.map((l) => l.name), merged: mergedItems });
    return { linked: members.length, mergedItems, _undo: undo };
  },

  /** Take back a "list.link" (by its op id): links, merged and shared items as before. */
  'list.linkUndo'(ctx, op) {
    // only right after linking (the undo button) – not as a way back to some old state later
    const done = this.db.q('SELECT result FROM applied_ops WHERE space_uid = ? AND op_id = ? AND created_at > ?').get(ctx.uid, String(op.opId ?? ''), ctx.now - 15 * 60_000);
    const undo = done && JSON.parse(done.result)._undo;
    if (!undo) return {};
    for (const l of undo.lists) {
      this.db.q('UPDATE lists SET link_id = ? WHERE space_uid = ? AND id = ?').run(l.linkId, ctx.uid, l.id);
      this._pushList(ctx, l.id);
    }
    const cols = UNDO_COLS.filter((c) => c !== 'id');
    for (const r of undo.items) {
      this.db.q(`UPDATE items SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE space_uid = ? AND id = ?`).run(...cols.map((c) => r[c] ?? null), ctx.uid, r.id);
      this._pushItem(ctx, r.id);
    }
    const name = (id) => this.db.q('SELECT name FROM lists WHERE space_uid = ? AND id = ?').get(ctx.uid, id)?.name ?? '';
    this._act(ctx, null, 'list.unlink', { names: undo.lists.map((l) => name(l.id)) });
    return {};
  },

  /**
   * A list leaves its list group: it gets its own copy of every shared item (state, amount,
   * note, importance and its place there); the others keep the shared items.
   * With only one list left the group ends.
   */
  'list.unlink'(ctx, op) {
    const list = this._list(ctx.uid, eid(op.id));
    if (!list.link_id) return {};
    const { db } = this;
    const others = this._linked(ctx.uid, list).slice(1).map((id) => this._list(ctx.uid, id));
    if (!others.length) {
      db.q('UPDATE lists SET link_id = NULL WHERE space_uid = ? AND id = ?').run(ctx.uid, list.id);
      this._pushList(ctx, list.id);
      for (const r of db.q("UPDATE items SET shared = 0, places = '{}' WHERE space_uid = ? AND list_id = ? AND shared = 1 AND deleted_at IS NULL RETURNING id").all(ctx.uid, list.id)) this._pushItem(ctx, r.id);
      return { copies: 0 };
    }
    const ids = [list.id, ...others.map((l) => l.id)];
    const rows = db.q(`SELECT * FROM items WHERE space_uid = ? AND shared = 1 AND deleted_at IS NULL AND list_id IN (${ids.map(() => '?').join(', ')})`).all(ctx.uid, ...ids);
    let copies = 0;
    for (const r of rows) {
      const places = JSON.parse(r.places || '{}');
      const mine = r.list_id === list.id ? { groupId: r.group_id, pos: r.pos } : (places[list.id] ?? { groupId: null, pos: r.pos });
      const copyId = newEntityId();
      this._insertItem(ctx, list, {
        id: copyId,
        groupId: this._validGroup(ctx.uid, list, mine.groupId),
        name: r.name,
        qty: r.qty,
        unit: r.unit,
        note: r.note,
        pos: mine.pos,
        checked: !!r.checked,
        parked: !!r.parked,
        prio: r.prio,
      });
      // the copy keeps who checked it and how often it was bought
      db.q('UPDATE items SET checked_by = ?, bought = ? WHERE space_uid = ? AND id = ?').run(r.checked ? r.checked_by : null, r.bought ?? 0, ctx.uid, copyId);
      this._pushItem(ctx, copyId);
      copies++;
      delete places[list.id];
      if (r.list_id === list.id) {
        // the others keep it: it moves over to the next list of the group
        const home = others[0];
        const p = places[home.id] ?? { groupId: null, pos: r.pos };
        delete places[home.id];
        db.q('UPDATE items SET list_id = ?, group_id = ?, pos = ?, places = ? WHERE space_uid = ? AND id = ?').run(
          home.id,
          this._validGroup(ctx.uid, home, p.groupId),
          p.pos,
          JSON.stringify(places),
          ctx.uid,
          r.id,
        );
      } else db.q('UPDATE items SET places = ? WHERE space_uid = ? AND id = ?').run(JSON.stringify(places), ctx.uid, r.id);
      this._pushItem(ctx, r.id);
    }
    db.q('UPDATE lists SET link_id = NULL WHERE space_uid = ? AND id = ?').run(ctx.uid, list.id);
    this._pushList(ctx, list.id);
    if (others.length === 1) {
      // a group of one is no group
      const last = others[0];
      db.q('UPDATE lists SET link_id = NULL WHERE space_uid = ? AND id = ?').run(ctx.uid, last.id);
      this._pushList(ctx, last.id);
      for (const r of db.q("UPDATE items SET shared = 0, places = '{}' WHERE space_uid = ? AND list_id = ? AND shared = 1 RETURNING id, deleted_at").all(ctx.uid, last.id)) {
        if (!r.deleted_at) this._pushItem(ctx, r.id);
      }
    }
    this._act(ctx, list.id, 'list.unlink', { names: [list.name] });
    return { copies };
  },

  'list.delete'(ctx, op) {
    const list = this._list(ctx.uid, eid(op.id));
    const count = this.db.q('SELECT COUNT(*) AS c FROM lists WHERE space_uid = ? AND deleted_at IS NULL').get(ctx.uid).c;
    if (count <= 1) throw new OpError('invalid', 'the last list cannot be deleted');
    // the rest of a list group keeps the shared items
    if (list.link_id) OPS['list.unlink'].call(this, ctx, { id: list.id });
    this.db.q('UPDATE lists SET deleted_at = ? WHERE space_uid = ? AND id = ?').run(ctx.now, ctx.uid, list.id);
    this._pushList(ctx, list.id);
    this._act(ctx, null, 'list.delete', { name: list.name, listId: list.id });
  },

  'list.restore'(ctx, op) {
    const id = eid(op.id);
    const list = this.db.q('SELECT * FROM lists WHERE space_uid = ? AND id = ?').get(ctx.uid, id);
    if (!list) throw new OpError('notfound', 'list not found');
    if (list.deleted_at && this.db.q('SELECT COUNT(*) AS c FROM lists WHERE space_uid = ? AND deleted_at IS NULL').get(ctx.uid).c >= LIMITS.listsPerSpace) {
      throw new OpError('limit', 'too many lists');
    }
    this.db.q('UPDATE lists SET deleted_at = NULL WHERE space_uid = ? AND id = ?').run(ctx.uid, id);
    this._pushList(ctx, id);
    // the client never saw items/groups of a deleted list after reload – resend them
    for (const g of this.db.q('SELECT id FROM groups WHERE space_uid = ? AND list_id = ? AND deleted_at IS NULL').all(ctx.uid, id)) this._pushGroup(ctx, g.id);
    for (const it of this.db.q('SELECT id FROM items WHERE space_uid = ? AND list_id = ? AND deleted_at IS NULL').all(ctx.uid, id)) this._pushItem(ctx, it.id);
    this._act(ctx, id, 'list.restore', { name: list.name });
  },

  // Checked items leave the list and go to the inactive items (shadow list) – nothing is lost.
  'list.clearChecked'(ctx, op) {
    const list = this._list(ctx.uid, eid(op.listId));
    // in a list group this includes shared items checked off in another shop – they are bought
    const rows = this._visibleItems(ctx.uid, list, 'i.checked = 1 AND i.parked = 0');
    const entry = { v: ctx.rev, at: ctx.at, by: ctx.dev.dev_id };
    for (const r of rows) {
      const meta = { ...JSON.parse(r.meta), checked: entry, parked: entry };
      // checked_by / checked_in stay: undo puts back who bought it where
      this.db.q('UPDATE items SET checked = 0, parked = 1, meta = ? WHERE space_uid = ? AND id = ?').run(JSON.stringify(meta), ctx.uid, r.id);
      this._pushItem(ctx, r.id);
    }
    if (rows.length) this._act(ctx, list.id, 'list.clearChecked', { count: rows.length, names: rows.slice(0, 20).map((r) => r.name) });
    return { ids: rows.map((r) => r.id) };
  },

  /** Delete all inactive items of a list (restorable from the history for a while). */
  'list.clearParked'(ctx, op) {
    const list = this._list(ctx.uid, eid(op.listId));
    const rows = this._visibleItems(ctx.uid, list, 'i.parked = 1');
    for (const r of rows) {
      this.db.q('UPDATE items SET deleted_at = ? WHERE space_uid = ? AND id = ?').run(ctx.now, ctx.uid, r.id);
      ctx.changes.push({ e: 'item', del: r.id });
      this._dropConflicts(ctx, r.id);
    }
    if (rows.length) this._act(ctx, list.id, 'item.delete', { names: rows.slice(0, 20).map((r) => r.name), count: rows.length, ids: rows.map((r) => r.id) });
    return { ids: rows.map((r) => r.id) };
  },

  /** Set checked/parked for several items at once (used to undo "clear checked"). */
  'item.setState'(ctx, op) {
    const ids = idList(op.ids).map((id) => this._realId(ctx.uid, id));
    const checked = !!op.checked;
    const parked = !!op.parked && !checked;
    const entry = { v: ctx.rev, at: ctx.at, by: ctx.dev.dev_id };
    for (const id of ids) {
      const r = this.db.q('SELECT * FROM items WHERE space_uid = ? AND id = ? AND deleted_at IS NULL').get(ctx.uid, id);
      if (!r) continue;
      const meta = { ...JSON.parse(r.meta), checked: entry, parked: entry };
      this.db
        .q('UPDATE items SET checked = ?, checked_by = ?, checked_in = ?, parked = ?, meta = ? WHERE space_uid = ? AND id = ?')
        .run(checked ? 1 : 0, checked ? (r.checked_by ?? ctx.dev.name) : null, checked ? (r.checked_in ?? r.list_id) : null, parked ? 1 : 0, JSON.stringify(meta), ctx.uid, id);
      this._pushItem(ctx, id);
    }
  },

  'group.add'(ctx, op) {
    const id = eid(op.id);
    if (this.db.q('SELECT 1 FROM groups WHERE space_uid = ? AND id = ?').get(ctx.uid, id)) return {};
    const count = this.db.q('SELECT COUNT(*) AS c FROM groups WHERE space_uid = ? AND deleted_at IS NULL').get(ctx.uid).c;
    if (count >= LIMITS.groupsPerSpace) throw new OpError('limit', 'too many groups');
    let listId = null;
    if (op.listId) listId = this._list(ctx.uid, eid(op.listId, 'listId')).id;
    // subgroups no longer exist; an older client asking for one gets a normal group
    const parentId = null;
    const name = str(op.name, LIMITS.groupName, { required: true, field: 'name' });
    this.db
      .q('INSERT INTO groups (space_uid, id, list_id, parent_id, name, pos, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.uid, id, listId, parentId, name, num(op.pos ?? ctx.now), ctx.now);
    this._pushGroup(ctx, id);
  },

  'group.update'(ctx, op) {
    const g = this._group(ctx.uid, eid(op.id));
    if (!g) throw new OpError('notfound', 'group not found');
    if (op.name !== undefined) {
      const name = str(op.name, LIMITS.groupName, { required: true, field: 'name' });
      this.db.q('UPDATE groups SET name = ? WHERE space_uid = ? AND id = ?').run(name, ctx.uid, g.id);
      // learned placements follow the rename
      const parentName = g.parent_id ? this._group(ctx.uid, g.parent_id)?.name : null;
      const scope = g.list_id ?? '';
      const upd = g.parent_id
        ? this.db.q('UPDATE memory SET subgroup_name = ? WHERE space_uid = ? AND scope = ? AND group_name = ? AND subgroup_name = ? RETURNING *').all(name, ctx.uid, scope, parentName ?? '', g.name)
        : this.db.q('UPDATE memory SET group_name = ? WHERE space_uid = ? AND scope = ? AND group_name = ? RETURNING *').all(name, ctx.uid, scope, g.name);
      for (const m of upd) ctx.changes.push({ e: 'memory', row: mapMemory(m) });
    }
    if (op.pos !== undefined) this.db.q('UPDATE groups SET pos = ? WHERE space_uid = ? AND id = ?').run(num(op.pos), ctx.uid, g.id);
    this._pushGroup(ctx, g.id);
  },

  'group.delete'(ctx, op) {
    const g = this._group(ctx.uid, eid(op.id));
    if (!g) throw new OpError('notfound', 'group not found');
    const children = this.db.q('SELECT id FROM groups WHERE space_uid = ? AND parent_id = ? AND deleted_at IS NULL').all(ctx.uid, g.id).map((r) => r.id);
    const groupIds = [g.id, ...children];
    const moves = [];
    for (const gid of groupIds) {
      const items = this.db
        .q('UPDATE items SET group_id = NULL WHERE space_uid = ? AND group_id = ? AND deleted_at IS NULL RETURNING id')
        .all(ctx.uid, gid);
      for (const it of items) {
        moves.push({ id: it.id, groupId: gid });
        this._pushItem(ctx, it.id);
      }
      // shared items placed in this group in another shop of a list group
      const placed = this.db.q("SELECT id, places FROM items WHERE space_uid = ? AND shared = 1 AND deleted_at IS NULL AND places LIKE ?").all(ctx.uid, `%${gid}%`);
      for (const it of placed) {
        const places = JSON.parse(it.places);
        for (const [listId, p] of Object.entries(places)) {
          if (p.groupId !== gid) continue;
          p.groupId = null;
          moves.push({ id: it.id, groupId: gid, listId });
        }
        this.db.q('UPDATE items SET places = ? WHERE space_uid = ? AND id = ?').run(JSON.stringify(places), ctx.uid, it.id);
        this._pushItem(ctx, it.id);
      }
      this.db.q('UPDATE groups SET deleted_at = ? WHERE space_uid = ? AND id = ?').run(ctx.now, ctx.uid, gid);
      ctx.changes.push({ e: 'group', del: gid });
    }
    this._act(ctx, g.list_id, 'group.delete', { name: g.name });
    return { groupIds, moves };
  },

  'group.restore'(ctx, op) {
    const ids = idList(op.ids);
    for (const id of ids) {
      if (this.db.q('UPDATE groups SET deleted_at = NULL WHERE space_uid = ? AND id = ? RETURNING id').get(ctx.uid, id)) this._pushGroup(ctx, id);
    }
    for (const m of Array.isArray(op.moves) ? op.moves.slice(0, LIMITS.itemsPerList) : []) {
      if (m?.listId) {
        // the place of a shared item in another shop of the list group
        const it = this.db.q('SELECT places FROM items WHERE space_uid = ? AND id = ? AND deleted_at IS NULL').get(ctx.uid, eid(m.id));
        const places = it ? JSON.parse(it.places || '{}') : {};
        const l = it && places[m.listId] && this.db.q('SELECT * FROM lists WHERE space_uid = ? AND id = ?').get(ctx.uid, eid(m.listId, 'listId'));
        const gid = l && !places[m.listId].groupId ? this._validGroup(ctx.uid, l, eid(m.groupId)) : null;
        if (!gid) continue;
        places[m.listId] = { ...places[m.listId], groupId: gid };
        this.db.q('UPDATE items SET places = ? WHERE space_uid = ? AND id = ?').run(JSON.stringify(places), ctx.uid, m.id);
        this._pushItem(ctx, m.id);
        continue;
      }
      const it = this.db.q('SELECT list_id FROM items WHERE space_uid = ? AND id = ? AND group_id IS NULL AND deleted_at IS NULL').get(ctx.uid, eid(m.id));
      const list = it && this.db.q('SELECT * FROM lists WHERE space_uid = ? AND id = ?').get(ctx.uid, it.list_id);
      // only back into a group of the item's own list
      const gid = list ? this._validGroup(ctx.uid, list, eid(m.groupId)) : null;
      if (!gid) continue;
      this.db.q('UPDATE items SET group_id = ? WHERE space_uid = ? AND id = ?').run(gid, ctx.uid, m.id);
      this._pushItem(ctx, m.id);
    }
  },

  'item.add'(ctx, op) {
    const list = this._list(ctx.uid, eid(op.listId, 'listId'));
    const id = eid(op.id);
    if (this.db.q('SELECT 1 FROM items WHERE space_uid = ? AND id = ?').get(ctx.uid, id)) return {};
    const name = str(op.name, LIMITS.itemName, { required: true, field: 'name' });
    const qty = qtyStr(op.qty);
    const unit = str(op.unit, LIMITS.unit);
    const n = note(op.note);
    const norm = normalizeName(name);
    // Same unchecked item already on the list (e.g. added on two devices while offline) → merge
    if (!op.force && !op.parked) {
      const dup = this._visibleItems(ctx.uid, list, 'i.norm = ? AND i.checked = 0 AND i.parked = 0', [norm])[0];
      if (dup) {
        const sum = addAmounts({ qty: dup.qty, unit: dup.unit }, { qty, unit }) ?? { qty: dup.qty, unit: dup.unit };
        const meta = JSON.parse(dup.meta);
        meta.amount = { v: ctx.rev, at: ctx.at, by: ctx.dev.dev_id };
        this.db.q('UPDATE items SET qty = ?, unit = ?, meta = ? WHERE space_uid = ? AND id = ?').run(sum.qty, sum.unit, JSON.stringify(meta), ctx.uid, dup.id);
        this._pushItem(ctx, dup.id);
        this._suggest(ctx, name, norm);
        this._act(ctx, list.id, 'item.merge', { name: dup.name, qty: sum.qty, unit: sum.unit });
        ctx.changes.push({ e: 'item', del: id }); // drop the optimistic copy everywhere
        // later ops of the device for its copy (e.g. checked off while still offline) reach this one
        this.db.q('INSERT OR REPLACE INTO merged_items (space_uid, id, target, created_at) VALUES (?, ?, ?, ?)').run(ctx.uid, id, dup.id, ctx.now);
        return { merged: dup.id };
      }
    }
    const count = this.db.q('SELECT COUNT(*) AS c FROM items WHERE space_uid = ? AND list_id = ? AND deleted_at IS NULL').get(ctx.uid, list.id).c;
    if (count >= LIMITS.itemsPerList) throw new OpError('limit', 'too many items');
    const groupId = this._validGroup(ctx.uid, list, op.groupId);
    this._insertItem(ctx, list, { id, groupId, name, qty, unit, note: n, pos: num(op.pos ?? ctx.now), checked: !!op.checked, parked: !!op.parked, prio: op.prio, shared: !!op.shared });
    this._fillPlaces(ctx, this.db.q('SELECT * FROM items WHERE space_uid = ? AND id = ?').get(ctx.uid, id));
    this._pushItem(ctx, id);
    if (op.learn !== false) this._learn(ctx, list, norm, groupId);
    this._suggest(ctx, name, norm);
    this._act(ctx, list.id, 'item.add', { name, qty, unit });
  },

  /**
   * Several items at once, as the app's add bar does it (used by AI assistants):
   * an open item with the same name gets the amount added, a checked or inactive one comes
   * back, new ones land in the given or the learned group.
   * items: [{ name, qty, unit, note, prio, group, shared }] → { added, merged, reactivated } (names)
   * In a list group new items go to every list of it unless shared is false.
   */
  'item.addMany'(ctx, op) {
    const list = this._list(ctx.uid, eid(op.listId, 'listId'));
    const entries = Array.isArray(op.items) ? op.items.slice(0, LIMITS.batch) : [];
    const out = { added: [], merged: [], reactivated: [] };
    const memory = this.db.q('SELECT * FROM memory WHERE space_uid = ? AND scope = ? AND norm = ?');
    for (const e of entries) {
      const name = str(e?.name, LIMITS.itemName);
      if (!name) continue;
      const norm = normalizeName(name);
      const prio = prioOf(e.prio);
      let qty = '';
      try {
        qty = qtyStr(e.qty);
      } catch {
        qty = '';
      }
      const unit = qty ? str(e.unit, LIMITS.unit) : '';
      const same = this._visibleItems(ctx.uid, list, 'i.norm = ?', [norm], '(i.checked = 0 AND i.parked = 0) DESC, i.pos');
      const done = !same.some((i) => !i.checked && !i.parked) && same[0];
      if (done) {
        const entry = { v: ctx.rev, at: ctx.at, by: ctx.dev.dev_id };
        const meta = { ...JSON.parse(done.meta), checked: entry, parked: entry, ...(qty && { amount: entry }), ...(prio && { prio: entry }) };
        this.db
          .q('UPDATE items SET checked = 0, checked_by = NULL, checked_in = NULL, parked = 0, qty = ?, unit = ?, prio = ?, meta = ? WHERE space_uid = ? AND id = ?')
          .run(qty || done.qty, qty ? unit : done.unit, prio || done.prio, JSON.stringify(meta), ctx.uid, done.id);
        this._pushItem(ctx, done.id);
        this._act(ctx, list.id, 'item.uncheck', { name: done.name });
        out.reactivated.push(done.name);
        continue;
      }
      let groupId = null;
      const groupName = str(e.group, LIMITS.groupName);
      if (groupName) groupId = this._ensurePath(ctx, list, groupName, '');
      else {
        const m = memory.get(ctx.uid, this._scope(list), norm);
        if (m?.group_name || m?.subgroup_name) groupId = this._ensurePath(ctx, list, m.group_name, m.subgroup_name);
      }
      const pos = this.db.q('SELECT COALESCE(MAX(pos), 0) AS m FROM items WHERE space_uid = ? AND list_id = ? AND group_id IS ?').get(ctx.uid, list.id, groupId).m + 1;
      const shared = !!list.link_id && e.shared !== false && op.shared !== false;
      const r = OPS['item.add'].call(this, ctx, { id: newEntityId(), listId: list.id, name, qty, unit, note: e.note, prio, groupId, pos, learn: !!groupName, shared });
      if (r?.merged) {
        if (prio) this.db.q('UPDATE items SET prio = ? WHERE space_uid = ? AND id = ?').run(prio, ctx.uid, r.merged), this._pushItem(ctx, r.merged);
        out.merged.push(name);
      } else out.added.push(name);
    }
    return out;
  },

  'item.set'(ctx, op) {
    const id = this._realId(ctx.uid, eid(op.id));
    const item = this._item(ctx.uid, id, { allowDeleted: true });
    if (item.deleted_at) {
      // Delete wins. Keep the lost edit in the history so it can be restored from there –
      // only the known fields, cut to their limits (the raw op is whatever the client sent)
      const f = op.fields && typeof op.fields === 'object' ? op.fields : {};
      const lost = {};
      if (typeof f.name === 'string') lost.name = f.name.slice(0, LIMITS.itemName);
      if (typeof f.note === 'string') lost.note = f.note.slice(0, LIMITS.note);
      if (f.amount && typeof f.amount === 'object') lost.amount = { qty: String(f.amount.qty ?? '').slice(0, LIMITS.qty), unit: String(f.amount.unit ?? '').slice(0, LIMITS.unit) };
      for (const k of ['checked', 'parked']) if (k in f) lost[k] = !!f[k];
      if ('prio' in f) lost.prio = prioOf(f.prio);
      this._act(ctx, item.list_id, 'item.editDeleted', { id, name: item.name, fields: lost });
      return { rejected: 'deleted', name: item.name };
    }
    const list = this._list(ctx.uid, item.list_id);
    // listId: the list the change was made in – a shared item of a list group has its own
    // group and position in every shop, and "bought at …" names that shop
    let view = list;
    if (op.listId && op.listId !== item.list_id) {
      const l = this.db.q('SELECT * FROM lists WHERE space_uid = ? AND id = ? AND deleted_at IS NULL').get(ctx.uid, String(op.listId));
      if (l && this._shows(ctx.uid, l, item)) view = l;
    }
    const foreign = view.id !== list.id;
    const fields = op.fields && typeof op.fields === 'object' ? op.fields : {};
    const base = op.base && typeof op.base === 'object' ? op.base : {};
    const meta = JSON.parse(item.meta);
    const updates = {};
    const conflicts = [];

    const incoming = {};
    if ('name' in fields) incoming.name = str(fields.name, LIMITS.itemName, { required: true, field: 'name' });
    if ('amount' in fields) incoming.amount = { qty: qtyStr(fields.amount?.qty), unit: str(fields.amount?.unit, LIMITS.unit) };
    if ('note' in fields) incoming.note = note(fields.note);
    if ('checked' in fields) incoming.checked = !!fields.checked;
    if ('parked' in fields) incoming.parked = !!fields.parked;
    if ('groupId' in fields) incoming.groupId = fields.groupId ? this._validGroup(ctx.uid, view, eid(fields.groupId, 'groupId')) : null;
    if ('pos' in fields) incoming.pos = num(fields.pos);
    if ('prio' in fields) incoming.prio = prioOf(fields.prio);

    // place in another shop of the list group: no conflicts, the last move counts
    let places = null;
    let placeGroup;
    if (foreign && ('groupId' in incoming || 'pos' in incoming)) {
      places = JSON.parse(item.places || '{}');
      const cur = places[view.id] ?? { groupId: null, pos: item.pos };
      if ('groupId' in incoming && incoming.groupId !== (cur.groupId ?? null)) placeGroup = incoming.groupId;
      places[view.id] = { groupId: 'groupId' in incoming ? incoming.groupId : (cur.groupId ?? null), pos: 'pos' in incoming ? incoming.pos : cur.pos };
      delete incoming.groupId;
      delete incoming.pos;
    }
    // shared: on every list of the list group, or only here (the list it was changed in)
    let share;
    if ('shared' in fields) {
      const want = !!fields.shared && !!list.link_id;
      if (want !== !!item.shared) share = want;
    }

    for (const [f, value] of Object.entries(incoming)) {
      if (f === 'pos') {
        const cur = meta.pos || { v: 0, at: 0 };
        if (ctx.at >= (cur.at || 0)) {
          updates.pos = value;
          meta.pos = { v: ctx.rev, at: ctx.at, by: ctx.dev.dev_id };
        }
        continue;
      }
      const curVal = fieldValue(item, f);
      if (same(curVal, value)) continue;
      const cur = meta[f] || { v: 0, at: 0, by: null };
      const b = base[f];
      const stale = typeof b === 'number' && b !== cur.v && cur.by !== ctx.dev.dev_id;
      const opWins = !stale || ctx.at >= (cur.at || 0);
      if (stale) {
        const byName = cur.by ? this.db.q('SELECT name FROM devices WHERE space_uid = ? AND dev_id = ?').get(ctx.uid, cur.by)?.name : null;
        conflicts.push({
          field: f,
          options: [
            { value: curVal, by: cur.by, byName: byName ?? '?', at: cur.at || item.created_at },
            { value, by: ctx.dev.dev_id, byName: ctx.dev.name, at: ctx.at },
          ],
        });
      }
      if (opWins) {
        updates[f] = value;
        meta[f] = { v: ctx.rev, at: ctx.at, by: ctx.dev.dev_id };
      }
    }

    if (!Object.keys(updates).length && !conflicts.length && !places && share === undefined) return {};
    const cols = [];
    const args = [];
    const set = (col, val) => {
      cols.push(`${col} = ?`);
      args.push(val);
    };
    if ('name' in updates) set('name', updates.name), set('norm', normalizeName(updates.name));
    if ('amount' in updates) set('qty', updates.amount.qty), set('unit', updates.amount.unit);
    if ('note' in updates) set('note', updates.note);
    if ('checked' in updates) set('checked', updates.checked ? 1 : 0), set('checked_by', updates.checked ? ctx.dev.name : null), set('checked_in', updates.checked ? view.id : null);
    if (updates.checked) set('bought', (item.bought ?? 0) + 1);
    if ('parked' in updates) set('parked', updates.parked ? 1 : 0);
    if (updates.parked && !('checked' in updates) && item.checked) set('checked', 0), set('checked_by', null), set('checked_in', null);
    // checked off means it is on the list again (someone else may have moved it to "inactive" meanwhile)
    if (updates.checked && !('parked' in updates) && item.parked) set('parked', 0);
    if (share === true) set('shared', 1);
    else if (share === false) {
      set('shared', 0);
      // "only here" in another shop: the item moves over to that list, with its place there
      if (foreign) {
        const p = (places ?? JSON.parse(item.places || '{}'))[view.id] ?? {};
        set('list_id', view.id);
        set('group_id', this._validGroup(ctx.uid, view, p.groupId ?? null));
        set('pos', typeof p.pos === 'number' ? p.pos : item.pos);
      }
      places = {};
    }
    if (places) set('places', JSON.stringify(places));
    if ('groupId' in updates) set('group_id', updates.groupId);
    if ('pos' in updates) set('pos', updates.pos);
    if ('prio' in updates) set('prio', updates.prio);
    set('meta', JSON.stringify(meta));
    this.db.q(`UPDATE items SET ${cols.join(', ')} WHERE space_uid = ? AND id = ?`).run(...args, ctx.uid, id);

    const name = updates.name ?? item.name;
    if (share === true) this._fillPlaces(ctx, this.db.q('SELECT * FROM items WHERE space_uid = ? AND id = ?').get(ctx.uid, id));
    if (share !== undefined) this._act(ctx, view.id, share ? 'item.share' : 'item.unshare', { name });
    if ('name' in updates) this._suggest(ctx, name, normalizeName(name));
    if ('groupId' in updates && op.learn !== false) this._learn(ctx, list, normalizeName(name), updates.groupId);
    if (placeGroup !== undefined && op.learn !== false) this._learn(ctx, view, normalizeName(name), placeGroup);
    if ('checked' in updates) this._act(ctx, view.id, updates.checked ? 'item.check' : 'item.uncheck', { name });
    if (updates.checked) {
      // remember where this device is in the shop (only while checked in)
      const groupId = foreign ? (JSON.parse(item.places || '{}')[view.id]?.groupId ?? null) : 'groupId' in updates ? updates.groupId : item.group_id;
      const spot = pathLabel(this._groupPath(ctx.uid, groupId));
      const r = this.db
        .q('UPDATE devices SET spot_group = ?, spot_item = ?, spot_at = ? WHERE space_uid = ? AND dev_id = ? AND shopping_until > ? RETURNING *')
        .get(spot, name, ctx.now, ctx.uid, ctx.dev.dev_id, ctx.now);
      if (r) ctx.changes.push({ e: 'device', row: mapDevice(r) });
      // everything on the list is in the cart → tell everybody in the shop
      const open = this._visibleItems(ctx.uid, view, 'i.parked = 0 AND i.checked = 0').length;
      if (open === 0) ctx.allDone = { listId: view.id, listName: view.name };
    }
    if ('parked' in updates) this._act(ctx, view.id, updates.parked ? 'item.park' : 'item.unpark', { name });
    if ('name' in updates || 'amount' in updates || 'note' in updates) {
      this._act(ctx, view.id, 'item.edit', { name, from: item.name, amount: updates.amount, note: 'note' in updates });
    }
    if ('groupId' in updates) this._act(ctx, list.id, 'item.move', { name, to: this._groupPath(ctx.uid, updates.groupId) });
    if (placeGroup !== undefined) this._act(ctx, view.id, 'item.move', { name, to: this._groupPath(ctx.uid, placeGroup) });

    for (const c of conflicts) recordConflict.call(this, ctx, item, c, view.id);
    this._pushItem(ctx, id);
    return conflicts.length ? { conflicts: conflicts.length } : {};
  },

  'item.delete'(ctx, op) {
    const ids = idList(op.ids).map((id) => this._realId(ctx.uid, id));
    const done = [];
    for (const id of ids) {
      const r = this.db.q('UPDATE items SET deleted_at = ? WHERE space_uid = ? AND id = ? AND deleted_at IS NULL RETURNING id, name, list_id').get(ctx.now, ctx.uid, id);
      if (!r) continue;
      done.push(r);
      ctx.changes.push({ e: 'item', del: id });
      this._dropConflicts(ctx, id);
    }
    // the history of the list it was deleted in (a shared item of a list group may live elsewhere)
    const where = op.listId && this.db.q('SELECT id FROM lists WHERE space_uid = ? AND id = ?').get(ctx.uid, String(op.listId)) ? String(op.listId) : done[0]?.list_id;
    if (done.length) this._act(ctx, where, 'item.delete', { names: done.slice(0, 20).map((r) => r.name), count: done.length, ids: done.map((r) => r.id) });
    return { ids: done.map((r) => r.id) };
  },

  'item.restore'(ctx, op) {
    const ids = idList(op.ids);
    const restored = [];
    for (const id of ids) {
      const r = this.db.q('UPDATE items SET deleted_at = NULL WHERE space_uid = ? AND id = ? AND deleted_at IS NOT NULL RETURNING id, name, list_id').get(ctx.uid, id);
      if (!r) continue;
      restored.push(r);
      this._pushItem(ctx, id);
    }
    if (restored.length) this._act(ctx, restored[0].list_id, 'item.restore', { names: restored.slice(0, 20).map((r) => r.name), count: restored.length });
    return { ids: restored.map((r) => r.id) };
  },

  /** A person sets (or clears, text '') the translation of an item name. */
  'translation.set'(ctx, op) {
    const norm = normalizeName(str(op.name, LIMITS.itemName, { required: true, field: 'name' }));
    const lang = String(op.lang ?? '');
    if (!LANG_RE.test(lang)) throw new OpError('invalid', 'lang');
    const text = str(op.text, LIMITS.translation);
    if (!text) {
      this.db.q('DELETE FROM translations WHERE space_uid = ? AND norm = ? AND lang = ?').run(ctx.uid, norm, lang);
      ctx.changes.push({ e: 'translation', del: `${norm}|${lang}` });
      return;
    }
    const provider = op.auto && PROVIDERS.includes(op.provider) ? op.provider : null;
    const row = this.db
      .q(`INSERT INTO translations (space_uid, norm, lang, text, auto, provider, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(space_uid, norm, lang) DO UPDATE SET text = excluded.text, auto = excluded.auto, provider = excluded.provider, updated_at = excluded.updated_at RETURNING *`)
      .get(ctx.uid, norm, lang, text, op.auto ? 1 : 0, provider, ctx.now);
    ctx.changes.push({ e: 'translation', row: mapTranslation(row) });
  },

  /** Forget the translations of these names (e.g. everything on a list) – they can be fetched again. */
  'translation.clear'(ctx, op) {
    const lang = String(op.lang ?? '');
    if (!LANG_RE.test(lang)) throw new OpError('invalid', 'lang');
    const names = Array.isArray(op.names) ? op.names.slice(0, LIMITS.itemsPerList) : [];
    const del = this.db.q('DELETE FROM translations WHERE space_uid = ? AND norm = ? AND lang = ? RETURNING norm');
    for (const n of names) {
      if (typeof n !== 'string' || !n.trim()) continue;
      const r = del.get(ctx.uid, normalizeName(n.slice(0, LIMITS.itemName)), lang);
      if (r) ctx.changes.push({ e: 'translation', del: `${r.norm}|${lang}` });
    }
  },

  'suggestion.delete'(ctx, op) {
    const norm = normalizeName(str(op.norm, LIMITS.itemName, { required: true }));
    this.db.q('DELETE FROM suggestions WHERE space_uid = ? AND norm = ?').run(ctx.uid, norm);
    ctx.changes.push({ e: 'suggestion', del: norm });
  },

  'conflict.resolve'(ctx, op) {
    const c = this.db.q('SELECT * FROM conflicts WHERE space_uid = ? AND id = ?').get(ctx.uid, eid(op.id));
    if (!c) return {};
    const options = JSON.parse(c.options);
    const choice = options[Number(op.index)];
    if (!choice) throw new OpError('invalid', 'index');
    this.db.q('DELETE FROM conflicts WHERE space_uid = ? AND id = ?').run(ctx.uid, c.id);
    ctx.changes.push({ e: 'conflict', del: c.id });
    let item;
    try {
      item = this._item(ctx.uid, c.item_id);
    } catch {
      return {};
    }
    const meta = JSON.parse(item.meta);
    meta[c.field] = { v: ctx.rev, at: ctx.now, by: ctx.dev.dev_id };
    const v = choice.value;
    const list = this._list(ctx.uid, item.list_id);
    switch (c.field) {
      case 'name': {
        const name = str(v, LIMITS.itemName, { required: true });
        this.db.q('UPDATE items SET name = ?, norm = ?, meta = ? WHERE space_uid = ? AND id = ?').run(name, normalizeName(name), JSON.stringify(meta), ctx.uid, item.id);
        this._suggest(ctx, name, normalizeName(name));
        break;
      }
      case 'amount':
        this.db.q('UPDATE items SET qty = ?, unit = ?, meta = ? WHERE space_uid = ? AND id = ?').run(qtyStr(v?.qty), str(v?.unit, LIMITS.unit), JSON.stringify(meta), ctx.uid, item.id);
        break;
      case 'note':
        this.db.q('UPDATE items SET note = ?, meta = ? WHERE space_uid = ? AND id = ?').run(note(v), JSON.stringify(meta), ctx.uid, item.id);
        break;
      case 'prio':
        this.db.q('UPDATE items SET prio = ?, meta = ? WHERE space_uid = ? AND id = ?').run(prioOf(v), JSON.stringify(meta), ctx.uid, item.id);
        break;
      case 'checked':
        this.db.q('UPDATE items SET checked = ?, checked_by = ?, checked_in = ?, parked = CASE WHEN ? THEN 0 ELSE parked END, meta = ? WHERE space_uid = ? AND id = ?').run(v ? 1 : 0, v ? choice.byName : null, v ? item.list_id : null, v ? 1 : 0, JSON.stringify(meta), ctx.uid, item.id);
        break;
      case 'parked':
        this.db.q('UPDATE items SET parked = ?, checked = CASE WHEN ? THEN 0 ELSE checked END, meta = ? WHERE space_uid = ? AND id = ?').run(v ? 1 : 0, v ? 1 : 0, JSON.stringify(meta), ctx.uid, item.id);
        break;
      case 'groupId': {
        const gid = v ? this._validGroup(ctx.uid, list, v) : null;
        this.db.q('UPDATE items SET group_id = ?, meta = ? WHERE space_uid = ? AND id = ?').run(gid, JSON.stringify(meta), ctx.uid, item.id);
        this._learn(ctx, list, item.norm, gid);
        break;
      }
      default:
        break;
    }
    this._act(ctx, list.id, 'conflict.resolve', { name: item.name, field: c.field, value: v });
    this._pushItem(ctx, item.id);
  },

  'conflict.dismiss'(ctx, op) {
    const r = this.db.q('DELETE FROM conflicts WHERE space_uid = ? AND id = ? RETURNING id').get(ctx.uid, eid(op.id));
    if (r) ctx.changes.push({ e: 'conflict', del: r.id });
  },

  'device.rename'(ctx, op) {
    if (ctx.dev.kind === 'admin') throw new OpError('forbidden', 'admins have no device here');
    const name = checkedDeviceName(op.name, { required: true, field: 'name' });
    this.db.q('UPDATE devices SET name = ? WHERE space_uid = ? AND dev_id = ?').run(name, ctx.uid, ctx.dev.dev_id);
    ctx.dev.name = name;
    ctx.changes.push({ e: 'device', row: mapDevice(this.db.q('SELECT * FROM devices WHERE space_uid = ? AND dev_id = ?').get(ctx.uid, ctx.dev.dev_id)) });
  },

  'device.kick'(ctx, op) {
    const devId = String(op.devId ?? '');
    const r = this.db.q('DELETE FROM devices WHERE space_uid = ? AND dev_id = ? RETURNING dev_id, name, token_hash').get(ctx.uid, devId);
    if (!r) return {};
    // a kick is final on every path in: the device also leaves the deleted IDs this one was continued
    // from – "continue" on one of them led straight back (and told the renewed ID)
    this.db
      .q("DELETE FROM devices WHERE token_hash = ? AND space_uid IN (SELECT CAST(substr(public_id, 3) AS INTEGER) FROM retired_ids WHERE reason = 'continued' AND space_uid = ?)")
      .run(r.token_hash, ctx.uid);
    ctx.changes.push({ e: 'device', del: r.dev_id });
    ctx.kicked = r.token_hash;
    this._act(ctx, null, 'device.kick', { name: r.name });
    return { kicked: r.dev_id };
  },

  'device.shopping'(ctx, op) {
    if (ctx.dev.kind === 'admin') throw new OpError('forbidden', 'admins have no device here');
    const until = op.on ? ctx.now + this.shoppingMs : null;
    // a new shopping trip starts without a known spot
    this.db
      .q('UPDATE devices SET shopping_until = ?, spot_group = NULL, spot_item = NULL, spot_at = NULL WHERE space_uid = ? AND dev_id = ?')
      .run(until, ctx.uid, ctx.dev.dev_id);
    ctx.changes.push({ e: 'device', row: mapDevice(this.db.q('SELECT * FROM devices WHERE space_uid = ? AND dev_id = ?').get(ctx.uid, ctx.dev.dev_id)) });
  },
};

function recordConflict(ctx, item, c, listId = item.list_id) {
  const existing = this.db.q('SELECT * FROM conflicts WHERE space_uid = ? AND item_id = ? AND field = ?').get(ctx.uid, item.id, c.field);
  let options = c.options;
  let id = newEntityId();
  if (existing) {
    id = existing.id;
    options = [...JSON.parse(existing.options), ...c.options];
  }
  // dedupe by value, keep the most recent three
  const seen = new Map();
  for (const o of options) seen.set(JSON.stringify(o.value), o);
  options = [...seen.values()].sort((a, b) => a.at - b.at).slice(-3);
  if (options.length < 2) {
    if (existing) {
      this.db.q('DELETE FROM conflicts WHERE space_uid = ? AND id = ?').run(ctx.uid, id);
      ctx.changes.push({ e: 'conflict', del: id });
    }
    return;
  }
  this.db
    .q(
      `INSERT INTO conflicts (space_uid, id, list_id, item_id, field, options, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(space_uid, id) DO UPDATE SET options = excluded.options`,
    )
    .run(ctx.uid, id, listId, item.id, c.field, JSON.stringify(options), ctx.now);
  ctx.changes.push({ e: 'conflict', row: mapConflict(this.db.q('SELECT * FROM conflicts WHERE space_uid = ? AND id = ?').get(ctx.uid, id)) });
  this._act(ctx, listId, 'conflict', { name: item.name, field: c.field });
}

/** Move a list between its own group set and the space's shared set, matching groups by name. */
function switchGroupMode(ctx, list, mode) {
  const { db } = this;
  const fromList = list.group_mode === 'shared' ? null : list.id;
  const target = { ...list, group_mode: mode };
  const groups = db.q('SELECT * FROM groups WHERE space_uid = ? AND list_id IS ? AND deleted_at IS NULL ORDER BY parent_id IS NOT NULL, pos').all(ctx.uid, fromList);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const map = new Map();
  for (const g of groups) {
    const parent = g.parent_id ? byId.get(g.parent_id) : null;
    map.set(g.id, this._ensurePath(ctx, target, parent ? parent.name : g.name, parent ? g.name : ''));
  }
  const items = db.q('SELECT id, group_id FROM items WHERE space_uid = ? AND list_id = ? AND deleted_at IS NULL AND group_id IS NOT NULL').all(ctx.uid, list.id);
  for (const it of items) {
    db.q('UPDATE items SET group_id = ? WHERE space_uid = ? AND id = ?').run(map.get(it.group_id) ?? null, ctx.uid, it.id);
    this._pushItem(ctx, it.id);
  }
  // shared items of a list group placed in this list
  for (const it of db.q("SELECT id, places FROM items WHERE space_uid = ? AND shared = 1 AND deleted_at IS NULL AND list_id != ? AND places LIKE ?").all(ctx.uid, list.id, `%${list.id}%`)) {
    const places = JSON.parse(it.places);
    const p = places[list.id];
    if (!p?.groupId) continue;
    places[list.id] = { ...p, groupId: map.get(p.groupId) ?? null };
    db.q('UPDATE items SET places = ? WHERE space_uid = ? AND id = ?').run(JSON.stringify(places), ctx.uid, it.id);
    this._pushItem(ctx, it.id);
  }
  if (mode === 'shared') {
    // own groups are no longer used
    for (const g of groups) {
      db.q('UPDATE groups SET deleted_at = ? WHERE space_uid = ? AND id = ?').run(ctx.now, ctx.uid, g.id);
      ctx.changes.push({ e: 'group', del: g.id });
    }
  }
  // carry learned placements over without overwriting existing ones
  const fromScope = list.group_mode === 'shared' ? '' : list.id;
  const toScope = mode === 'shared' ? '' : list.id;
  const rows = db
    .q(
      `INSERT OR IGNORE INTO memory (space_uid, scope, norm, group_name, subgroup_name, updated_at)
       SELECT space_uid, ?, norm, group_name, subgroup_name, updated_at FROM memory WHERE space_uid = ? AND scope = ? RETURNING *`,
    )
    .all(toScope, ctx.uid, fromScope);
  for (const m of rows) ctx.changes.push({ e: 'memory', row: mapMemory(m) });
  db.q('UPDATE lists SET group_mode = ? WHERE space_uid = ? AND id = ?').run(mode, ctx.uid, list.id);
  this._act(ctx, list.id, 'list.groupMode', { mode });
}

/**
 * Copy or move items (or a whole group) into a list of another space.
 * Returns { source: {changes, rev}, target: {uid, changes, rev}, count }.
 */
Store.prototype.transfer = function transfer(srcUid, device, { targetUid, targetListId, itemIds, groupId, fromListId, mode }) {
  const { db } = this;
  const now = Date.now();
  if (!['copy', 'move'].includes(mode)) throw new OpError('invalid', 'mode');
  return db.tx(() => {
    let items;
    let groupIds = [];
    let ownGroup = false; // a group of the list itself (not the space's shared set) – moved along
    // where an item sits in the list it is sent from (a shared item of a list group: its place there)
    let fromList = null;
    const groupIn = (it) => (!fromList || it.list_id === fromList.id ? it.group_id : (JSON.parse(it.places || '{}')[fromList.id]?.groupId ?? null));
    if (groupId) {
      const g = this._group(srcUid, eid(groupId, 'groupId'));
      if (!g) throw new OpError('notfound', 'group not found');
      groupIds = [g.id, ...db.q('SELECT id FROM groups WHERE space_uid = ? AND parent_id = ? AND deleted_at IS NULL').all(srcUid, g.id).map((r) => r.id)];
      ownGroup = g.list_id !== null;
      // only the items of one list – a group of the shared set is used by other lists, too
      fromList = fromListId ? this._list(srcUid, eid(fromListId, 'fromListId')) : g.list_id ? this._list(srcUid, g.list_id) : null;
      if (!fromList) throw new OpError('invalid', 'fromListId required');
      const ids = new Set(groupIds);
      items = this._visibleItems(srcUid, fromList).filter((it) => ids.has(groupIn(it)));
    } else {
      items = idList(itemIds).map((id) => this._item(srcUid, id));
    }
    const tRev = this._bump(targetUid, device, now);
    const tctx = { uid: targetUid, dev: device, rev: tRev, at: now, now, changes: [] };
    const tList = this._list(targetUid, eid(targetListId, 'listId'));
    const count = db.q('SELECT COUNT(*) AS c FROM items WHERE space_uid = ? AND list_id = ? AND deleted_at IS NULL').get(targetUid, tList.id).c;
    if (count + items.length > LIMITS.itemsPerList) throw new OpError('limit', 'too many items');
    const maxPos = db.q('SELECT COALESCE(MAX(pos), 0) AS m FROM items WHERE space_uid = ? AND list_id = ?').get(targetUid, tList.id).m;
    let i = 0;
    for (const it of items) {
      const path = this._groupPath(srcUid, groupIn(it));
      const gid = this._ensurePath(tctx, tList, path.group, path.subgroup);
      const id = newEntityId();
      const norm = this._insertItem(tctx, tList, { id, groupId: gid, name: it.name, qty: it.qty, unit: it.unit, note: it.note, pos: maxPos + ++i, checked: !!it.checked, parked: !!it.parked, prio: it.prio });
      this._pushItem(tctx, id);
      if (gid) this._learn(tctx, tList, norm, gid);
      this._suggest(tctx, it.name, norm);
    }
    this._act(tctx, tList.id, 'transfer.in', { count: items.length, names: items.slice(0, 20).map((r) => r.name) });

    const sRev = this._bump(srcUid, device, now);
    const sctx = { uid: srcUid, dev: device, rev: sRev, at: now, now, changes: [] };
    if (mode === 'move') {
      for (const it of items) {
        db.q('UPDATE items SET deleted_at = ? WHERE space_uid = ? AND id = ?').run(now, srcUid, it.id);
        sctx.changes.push({ e: 'item', del: it.id });
        this._dropConflicts(sctx, it.id);
      }
      for (const gid of ownGroup ? groupIds : []) {
        db.q('UPDATE groups SET deleted_at = ? WHERE space_uid = ? AND id = ?').run(now, srcUid, gid);
        sctx.changes.push({ e: 'group', del: gid });
      }
    }
    if (items.length) {
      this._act(sctx, items[0].list_id, mode === 'move' ? 'transfer.move' : 'transfer.copy', { count: items.length, names: items.slice(0, 20).map((r) => r.name), ids: items.map((r) => r.id) });
    }
    this._pruneInactive(tctx);
    return { source: { changes: sctx.changes, rev: sRev }, target: { changes: tctx.changes, rev: tRev }, count: items.length };
  });
};

export const IMPORT_LIMITS = { lists: 50, items: 5000 };

/**
 * Import a parsed backup document (see shared/backup.js) into a space.
 * Lists are matched by name, groups by name; an item whose name is already on the target
 * list is not added again – if the file says it is needed, an inactive/checked copy is re-activated.
 * defaultListId receives items that are not below any "## list" heading.
 */
Store.prototype.importDoc = function importDoc(uid, device, doc, { defaultListId = null } = {}) {
  const { db } = this;
  if (!doc || !Array.isArray(doc.lists)) throw new OpError('invalid', 'document');
  if (doc.lists.length > IMPORT_LIMITS.lists) throw new OpError('limit', 'too many lists');
  const total = doc.lists.reduce((n, l) => n + (Array.isArray(l.items) ? l.items.length : 0), 0);
  if (total > IMPORT_LIMITS.items) throw new OpError('limit', 'too many items');
  const now = Date.now();
  return db.tx(() => {
    const rev = this._bump(uid, device, now);
    const ctx = { uid, dev: device, rev, at: now, now, changes: [] };
    const stats = { lists: 0, added: 0, skipped: 0, reactivated: 0 };
    const live = () => db.q('SELECT * FROM lists WHERE space_uid = ? AND deleted_at IS NULL ORDER BY pos').all(uid);
    const links = []; // [list id, names of the lists of its list group]
    const toShare = []; // new items meant for the whole list group

    for (const l of doc.lists) {
      const listName = str(l.name, LIMITS.listName);
      let list = null;
      if (listName) list = live().find((x) => x.name.toLowerCase() === listName.toLowerCase()) ?? null;
      else if (defaultListId) list = live().find((x) => x.id === defaultListId) ?? null;
      if (!list) list = live()[0] && !listName ? live()[0] : null;
      if (!list) {
        if (live().length >= LIMITS.listsPerSpace) throw new OpError('limit', 'too many lists');
        const id = newEntityId();
        const pos = live().reduce((m, x) => Math.max(m, x.pos), 0) + 1;
        db.q('INSERT INTO lists (space_uid, id, name, pos, group_mode, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, id, listName || 'Import', pos, 'own', now);
        this._pushList(ctx, id);
        list = db.q('SELECT * FROM lists WHERE space_uid = ? AND id = ?').get(uid, id);
        stats.lists++;
      }
      const address = str(l.address, LIMITS.address);
      if (address && !list.address) {
        db.q('UPDATE lists SET address = ? WHERE space_uid = ? AND id = ?').run(address, uid, list.id);
        this._pushList(ctx, list.id);
      }
      const travel = l.travel && COUNTRY_LANGS[l.travel.country] && LANG_RE.test(l.travel.lang ?? '') ? l.travel : null;
      if (travel && !list.travel_lang) {
        db.q('UPDATE lists SET travel_country = ?, travel_lang = ? WHERE space_uid = ? AND id = ?').run(travel.country, travel.lang, uid, list.id);
        this._pushList(ctx, list.id);
        list = { ...list, travel_country: travel.country, travel_lang: travel.lang };
      }
      // translations from the file never replace ones the space already has – and only count
      // for the language the file was written for
      const fileLang = travel?.lang ?? null;
      const keepTranslation = (norm, raw) => {
        const text = str(raw?.translation, LIMITS.translation);
        if (!text || !fileLang || list.travel_lang !== fileLang) return;
        const row = db
          .q('INSERT INTO translations (space_uid, norm, lang, text, auto, provider, updated_at) VALUES (?, ?, ?, ?, 0, NULL, ?) ON CONFLICT(space_uid, norm, lang) DO NOTHING RETURNING *')
          .get(uid, norm, list.travel_lang, text, now);
        if (row) ctx.changes.push({ e: 'translation', row: mapTranslation(row) });
      };
      if (Array.isArray(l.link) && l.link.length) links.push([list.id, l.link.slice(0, IMPORT_LIMITS.lists).map((n) => str(n, LIMITS.listName)).filter(Boolean)]);
      let pos = db.q('SELECT COALESCE(MAX(pos), 0) AS m FROM items WHERE space_uid = ? AND list_id = ?').get(uid, list.id).m;
      for (const raw of Array.isArray(l.items) ? l.items : []) {
        const name = str(raw?.name, LIMITS.itemName);
        if (!name) continue;
        keepTranslation(normalizeName(name), raw);
        const state = ['open', 'checked', 'parked'].includes(raw.state) ? raw.state : 'open';
        const norm = normalizeName(name);
        const existing = this._visibleItems(uid, list, 'i.norm = ?', [norm], 'i.parked, i.checked')[0];
        if (existing) {
          if (state === 'open' && (existing.checked || existing.parked)) {
            const entry = { v: rev, at: now, by: device.dev_id };
            const meta = { ...JSON.parse(existing.meta), checked: entry, parked: entry };
            db.q('UPDATE items SET checked = 0, checked_by = NULL, parked = 0, meta = ? WHERE space_uid = ? AND id = ?').run(JSON.stringify(meta), uid, existing.id);
            this._pushItem(ctx, existing.id);
            stats.reactivated++;
          } else stats.skipped++;
          continue;
        }
        const count = db.q('SELECT COUNT(*) AS c FROM items WHERE space_uid = ? AND list_id = ? AND deleted_at IS NULL').get(uid, list.id).c;
        if (count >= LIMITS.itemsPerList) throw new OpError('limit', 'too many items');
        const groupId = this._ensurePath(ctx, list, str(raw.group, LIMITS.groupName), str(raw.subgroup, LIMITS.groupName));
        const id = newEntityId();
        let qty = '';
        try {
          qty = qtyStr(raw.qty);
        } catch {
          qty = '';
        }
        this._insertItem(ctx, list, {
          id,
          groupId,
          name,
          qty,
          unit: str(raw.unit, LIMITS.unit),
          note: note(raw.note),
          pos: ++pos,
          checked: state === 'checked',
          parked: state === 'parked',
          prio: raw.prio,
          shared: !raw.local,
        });
        if (!raw.local) toShare.push(id);
        this._pushItem(ctx, id);
        if (groupId) this._learn(ctx, list, norm, groupId);
        this._suggest(ctx, name, norm);
        stats.added++;
      }
    }
    // list groups from the file: link the lists named there (existing items are not merged)
    for (const [id, names] of links) {
      for (const n of names) {
        const want = linkName(n).toLowerCase();
        const other = live().find((x) => x.name.toLowerCase() === n.toLowerCase() || linkName(x.name).toLowerCase() === want);
        if (other && other.id !== id) OPS['list.link'].call(this, ctx, { id, other: other.id, share: false });
      }
    }
    for (const id of toShare) {
      const r = db.q('SELECT i.* FROM items i JOIN lists l ON l.space_uid = i.space_uid AND l.id = i.list_id WHERE i.space_uid = ? AND i.id = ? AND l.link_id IS NOT NULL').get(uid, id);
      if (!r) continue;
      if (!r.shared) db.q('UPDATE items SET shared = 1 WHERE space_uid = ? AND id = ?').run(uid, id);
      this._fillPlaces(ctx, { ...r, shared: 1 });
      this._pushItem(ctx, id);
    }
    this._act(ctx, null, 'import', stats);
    this._pruneInactive(ctx);
    return { changes: ctx.changes, rev, stats };
  });
};
