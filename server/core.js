import { createHash, webcrypto } from 'node:crypto';
import { randomSpaceId, randomEntityId, ENTITY_ID_RE } from '../shared/ids.js';
import { normalizeName, addAmounts } from '../shared/parse.js';
import { MAX_SPACE_TTL_DAYS } from './config.js';

const DAY = 86_400_000;
const MIN_SPACE_TTL_DAYS = 7;
const SUGGESTION_LIMIT = 1500;

export const LIMITS = {
  spaceName: 80,
  listName: 80,
  groupName: 60,
  address: 300,
  itemName: 120,
  note: 500,
  deviceName: 40,
  unit: 16,
  qty: 12,
  listsPerSpace: 50,
  groupsPerSpace: 500,
  itemsPerList: 2000,
  batch: 300,
};

const rnd = (b) => webcrypto.getRandomValues(b);
export const newEntityId = () => randomEntityId(rnd);
export const hashToken = (token) => createHash('sha256').update(String(token)).digest('base64url');

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

export const mapList = (r) => ({ id: r.id, name: r.name, pos: r.pos, groupMode: r.group_mode, address: r.address ?? '', createdAt: r.created_at });
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
  checkedBy: r.checked_by,
  addedBy: r.added_by,
  pos: r.pos,
  meta: JSON.parse(r.meta),
  createdAt: r.created_at,
});
export const mapMemory = (r) => ({ scope: r.scope, norm: r.norm, group: r.group_name, subgroup: r.subgroup_name });
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
});

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
        .q('INSERT INTO spaces (public_id, name, ttl_days, last_active_at, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(publicId, spaceName, this.config.spaceTtlDays, now, now);
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
    const devName = str(name, LIMITS.deviceName) || 'Device';
    const existing = db.q('SELECT * FROM devices WHERE space_uid = ? AND token_hash = ?').get(uid, tokenHash);
    if (existing) {
      db.q('UPDATE devices SET last_seen_at = ?, name = ? WHERE space_uid = ? AND token_hash = ?').run(now, devName, uid, tokenHash);
      return { ...existing, last_seen_at: now, name: devName, isNew: false };
    }
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
      groups: db.q('SELECT * FROM groups WHERE space_uid = ? AND deleted_at IS NULL ORDER BY pos').all(uid).map(mapGroup),
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
        .all(uid, SUGGESTION_LIMIT)
        .map(mapSuggestion),
      conflicts: db.q('SELECT * FROM conflicts WHERE space_uid = ? ORDER BY created_at').all(uid).map(mapConflict),
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
      return newId;
    });
  }

  deleteSpace(uid, byName) {
    this.db.q('UPDATE spaces SET deleted_at = ?, deleted_by = ? WHERE uid = ? AND deleted_at IS NULL').run(Date.now(), byName, uid);
  }

  /** Copy a deleted space into a fresh one. All members continuing end up in the same new space. */
  continueSpace(oldUid, tokenHash, deviceName) {
    const { db } = this;
    return db.tx(() => {
      const old = this.spaceByUid(oldUid);
      const marker = db.q("SELECT space_uid FROM retired_ids WHERE public_id = ? AND reason = 'continued'").get(`c:${oldUid}`);
      if (marker) {
        const target = this.spaceByUid(marker.space_uid);
        if (target && !target.deleted_at) {
          this.joinDevice(target.uid, tokenHash, deviceName);
          return target.public_id;
        }
      }
      const now = Date.now();
      const publicId = this.generatePublicId();
      const { lastInsertRowid } = db
        .q('INSERT INTO spaces (public_id, name, ttl_days, last_active_at, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(publicId, old.name, old.ttl_days, now, now);
      const uid = Number(lastInsertRowid);
      const copy = (table, cols) => {
        db.q(
          `INSERT INTO ${table} (space_uid, ${cols}) SELECT ?, ${cols} FROM ${table} WHERE space_uid = ?${
            ['lists', 'groups', 'items'].includes(table) ? ' AND deleted_at IS NULL' : ''
          }`,
        ).run(uid, oldUid);
      };
      copy('lists', 'id, name, pos, group_mode, address, created_at');
      copy('groups', 'id, list_id, parent_id, name, pos, created_at');
      copy('items', 'id, list_id, group_id, name, norm, qty, unit, note, checked, checked_by, added_by, pos, meta, created_at');
      copy('memory', 'scope, norm, group_name, subgroup_name, updated_at');
      copy('suggestions', 'norm, name, uses, last_used_at');
      db.q('INSERT OR REPLACE INTO retired_ids (public_id, space_uid, reason, created_at) VALUES (?, ?, ?, ?)').run(`c:${oldUid}`, uid, 'continued', now);
      this.joinDevice(uid, tokenHash, deviceName);
      return publicId;
    });
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
      db.q('DELETE FROM lists WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff);
      db.q('DELETE FROM conflicts WHERE created_at < ?').run(cutoff);
      db.q('DELETE FROM applied_ops WHERE created_at < ?').run(cutoff);
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
    if (done) return { result: JSON.parse(done.result), changes: [], duplicate: true };

    const now = Date.now();
    // Client time is corrected by the client; never trust it beyond "now".
    const madeAt = typeof at === 'number' && Number.isFinite(at) ? Math.min(at, now) : now;
    return db.tx(() => {
      const rev = db.q('UPDATE spaces SET rev = rev + 1, last_active_at = ? WHERE uid = ? RETURNING rev').get(now, uid).rev;
      const ctx = { uid, dev: device, rev, at: madeAt, now, changes: [] };
      const handler = OPS[op.k];
      if (!handler) throw new OpError('invalid', `unknown op ${op.k}`);
      const result = handler.call(this, ctx, op) ?? {};
      db.q('INSERT INTO applied_ops (space_uid, op_id, result, created_at) VALUES (?, ?, ?, ?)').run(uid, opId, JSON.stringify(result), now);
      return { result, changes: ctx.changes, rev, kickedHash: ctx.kicked, allDone: ctx.allDone };
    });
  }

  // helpers used by ops
  _list(uid, id) {
    const l = this.db.q('SELECT * FROM lists WHERE space_uid = ? AND id = ?').get(uid, id);
    if (!l || l.deleted_at) throw new OpError('notfound', 'list not found');
    return l;
  }
  _item(uid, id, { allowDeleted = false } = {}) {
    const it = this.db.q('SELECT * FROM items WHERE space_uid = ? AND id = ?').get(uid, id);
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
    this.db
      .q('INSERT INTO activity (space_uid, list_id, dev_name, action, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ctx.uid, listId, ctx.dev.name, action, JSON.stringify(payload), ctx.now);
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

  _insertItem(ctx, list, { id, groupId, name, qty, unit, note: n, pos, checked = false, parked = false }) {
    const norm = normalizeName(name);
    const metaEntry = { v: ctx.rev, at: ctx.at, by: ctx.dev.dev_id };
    const meta = { name: metaEntry, amount: metaEntry, note: metaEntry, checked: metaEntry, parked: metaEntry, groupId: metaEntry };
    const isChecked = checked && !parked;
    this.db
      .q(
        `INSERT INTO items (space_uid, id, list_id, group_id, name, norm, qty, unit, note, checked, parked, checked_by, added_by, pos, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(ctx.uid, id, list.id, groupId, name, norm, qty, unit, n, isChecked ? 1 : 0, parked ? 1 : 0, isChecked ? ctx.dev.name : null, ctx.dev.name, pos, JSON.stringify(meta), ctx.now);
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
    if (!subgroupName) return top.id;
    const sub = find(top.id, subgroupName) || create(top.id, subgroupName);
    return sub.id;
  }
}

// ---------- operation handlers (this = Store) ----------

const OPS = {
  'space.update'(ctx, op) {
    const sets = [];
    const args = [];
    if (op.name !== undefined) {
      sets.push('name = ?');
      args.push(str(op.name, LIMITS.spaceName, { required: true, field: 'name' }));
    }
    if (op.ttlDays !== undefined) {
      const d = Number(op.ttlDays);
      if (!Number.isInteger(d) || d < MIN_SPACE_TTL_DAYS || d > MAX_SPACE_TTL_DAYS) throw new OpError('invalid', 'ttlDays out of range');
      sets.push('ttl_days = ?');
      args.push(d);
    }
    if (!sets.length) return {};
    this.db.q(`UPDATE spaces SET ${sets.join(', ')} WHERE uid = ?`).run(...args, ctx.uid);
    ctx.changes.push({ e: 'space', row: mapSpace(this.spaceByUid(ctx.uid)) });
    this._act(ctx, null, 'space.update', { name: op.name, ttlDays: op.ttlDays });
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
    if (op.groupMode !== undefined && op.groupMode !== list.group_mode) {
      if (!['own', 'shared'].includes(op.groupMode)) throw new OpError('invalid', 'groupMode');
      switchGroupMode.call(this, ctx, list, op.groupMode);
    }
    this._pushList(ctx, list.id);
  },

  'list.delete'(ctx, op) {
    const list = this._list(ctx.uid, eid(op.id));
    const count = this.db.q('SELECT COUNT(*) AS c FROM lists WHERE space_uid = ? AND deleted_at IS NULL').get(ctx.uid).c;
    if (count <= 1) throw new OpError('invalid', 'the last list cannot be deleted');
    this.db.q('UPDATE lists SET deleted_at = ? WHERE space_uid = ? AND id = ?').run(ctx.now, ctx.uid, list.id);
    this._pushList(ctx, list.id);
    this._act(ctx, null, 'list.delete', { name: list.name, listId: list.id });
  },

  'list.restore'(ctx, op) {
    const id = eid(op.id);
    const list = this.db.q('SELECT * FROM lists WHERE space_uid = ? AND id = ?').get(ctx.uid, id);
    if (!list) throw new OpError('notfound', 'list not found');
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
    const rows = this.db.q('SELECT * FROM items WHERE space_uid = ? AND list_id = ? AND checked = 1 AND parked = 0 AND deleted_at IS NULL').all(ctx.uid, list.id);
    const entry = { v: ctx.rev, at: ctx.at, by: ctx.dev.dev_id };
    for (const r of rows) {
      const meta = { ...JSON.parse(r.meta), checked: entry, parked: entry };
      this.db.q('UPDATE items SET checked = 0, checked_by = NULL, parked = 1, meta = ? WHERE space_uid = ? AND id = ?').run(JSON.stringify(meta), ctx.uid, r.id);
      this._pushItem(ctx, r.id);
    }
    if (rows.length) this._act(ctx, list.id, 'list.clearChecked', { count: rows.length, names: rows.slice(0, 20).map((r) => r.name) });
    return { ids: rows.map((r) => r.id) };
  },

  /** Delete all inactive items of a list (restorable from the history for a while). */
  'list.clearParked'(ctx, op) {
    const list = this._list(ctx.uid, eid(op.listId));
    const rows = this.db
      .q('UPDATE items SET deleted_at = ? WHERE space_uid = ? AND list_id = ? AND parked = 1 AND deleted_at IS NULL RETURNING id, name')
      .all(ctx.now, ctx.uid, list.id);
    for (const r of rows) {
      ctx.changes.push({ e: 'item', del: r.id });
      this._dropConflicts(ctx, r.id);
    }
    if (rows.length) this._act(ctx, list.id, 'item.delete', { names: rows.slice(0, 20).map((r) => r.name), count: rows.length, ids: rows.map((r) => r.id) });
    return { ids: rows.map((r) => r.id) };
  },

  /** Set checked/parked for several items at once (used to undo "clear checked"). */
  'item.setState'(ctx, op) {
    const ids = idList(op.ids);
    const checked = !!op.checked;
    const parked = !!op.parked && !checked;
    const entry = { v: ctx.rev, at: ctx.at, by: ctx.dev.dev_id };
    for (const id of ids) {
      const r = this.db.q('SELECT * FROM items WHERE space_uid = ? AND id = ? AND deleted_at IS NULL').get(ctx.uid, id);
      if (!r) continue;
      const meta = { ...JSON.parse(r.meta), checked: entry, parked: entry };
      this.db
        .q('UPDATE items SET checked = ?, checked_by = ?, parked = ?, meta = ? WHERE space_uid = ? AND id = ?')
        .run(checked ? 1 : 0, checked ? (r.checked_by ?? ctx.dev.name) : null, parked ? 1 : 0, JSON.stringify(meta), ctx.uid, id);
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
      const r = this.db
        .q('UPDATE items SET group_id = ? WHERE space_uid = ? AND id = ? AND group_id IS NULL RETURNING id')
        .get(eid(m.groupId), ctx.uid, eid(m.id));
      if (r) this._pushItem(ctx, r.id);
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
      const dup = this.db
        .q('SELECT * FROM items WHERE space_uid = ? AND list_id = ? AND norm = ? AND checked = 0 AND parked = 0 AND deleted_at IS NULL')
        .get(ctx.uid, list.id, norm);
      if (dup) {
        const sum = addAmounts({ qty: dup.qty, unit: dup.unit }, { qty, unit }) ?? { qty: dup.qty, unit: dup.unit };
        const meta = JSON.parse(dup.meta);
        meta.amount = { v: ctx.rev, at: ctx.at, by: ctx.dev.dev_id };
        this.db.q('UPDATE items SET qty = ?, unit = ?, meta = ? WHERE space_uid = ? AND id = ?').run(sum.qty, sum.unit, JSON.stringify(meta), ctx.uid, dup.id);
        this._pushItem(ctx, dup.id);
        this._suggest(ctx, name, norm);
        this._act(ctx, list.id, 'item.merge', { name: dup.name, qty: sum.qty, unit: sum.unit });
        ctx.changes.push({ e: 'item', del: id }); // drop the optimistic copy everywhere
        return { merged: dup.id };
      }
    }
    const count = this.db.q('SELECT COUNT(*) AS c FROM items WHERE space_uid = ? AND list_id = ? AND deleted_at IS NULL').get(ctx.uid, list.id).c;
    if (count >= LIMITS.itemsPerList) throw new OpError('limit', 'too many items');
    const groupId = this._validGroup(ctx.uid, list, op.groupId);
    this._insertItem(ctx, list, { id, groupId, name, qty, unit, note: n, pos: num(op.pos ?? ctx.now), checked: !!op.checked, parked: !!op.parked });
    this._pushItem(ctx, id);
    if (op.learn !== false) this._learn(ctx, list, norm, groupId);
    this._suggest(ctx, name, norm);
    this._act(ctx, list.id, 'item.add', { name, qty, unit });
  },

  'item.set'(ctx, op) {
    const id = eid(op.id);
    const item = this._item(ctx.uid, id, { allowDeleted: true });
    if (item.deleted_at) {
      // Delete wins. Keep the lost edit in the history so it can be restored from there.
      this._act(ctx, item.list_id, 'item.editDeleted', { id, name: item.name, fields: op.fields });
      return { rejected: 'deleted', name: item.name };
    }
    const list = this._list(ctx.uid, item.list_id);
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
    if ('groupId' in fields) incoming.groupId = fields.groupId ? this._validGroup(ctx.uid, list, eid(fields.groupId, 'groupId')) : null;
    if ('pos' in fields) incoming.pos = num(fields.pos);

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

    if (!Object.keys(updates).length && !conflicts.length) return {};
    const cols = [];
    const args = [];
    const set = (col, val) => {
      cols.push(`${col} = ?`);
      args.push(val);
    };
    if ('name' in updates) set('name', updates.name), set('norm', normalizeName(updates.name));
    if ('amount' in updates) set('qty', updates.amount.qty), set('unit', updates.amount.unit);
    if ('note' in updates) set('note', updates.note);
    if ('checked' in updates) set('checked', updates.checked ? 1 : 0), set('checked_by', updates.checked ? ctx.dev.name : null);
    if ('parked' in updates) set('parked', updates.parked ? 1 : 0);
    if (updates.parked && !('checked' in updates) && item.checked) set('checked', 0), set('checked_by', null);
    if ('groupId' in updates) set('group_id', updates.groupId);
    if ('pos' in updates) set('pos', updates.pos);
    set('meta', JSON.stringify(meta));
    this.db.q(`UPDATE items SET ${cols.join(', ')} WHERE space_uid = ? AND id = ?`).run(...args, ctx.uid, id);

    const name = updates.name ?? item.name;
    if ('name' in updates) this._suggest(ctx, name, normalizeName(name));
    if ('groupId' in updates && op.learn !== false) this._learn(ctx, list, normalizeName(name), updates.groupId);
    if ('checked' in updates) this._act(ctx, list.id, updates.checked ? 'item.check' : 'item.uncheck', { name });
    if (updates.checked) {
      // remember where this device is in the shop (only while checked in)
      const groupId = 'groupId' in updates ? updates.groupId : item.group_id;
      const spot = pathLabel(this._groupPath(ctx.uid, groupId));
      const r = this.db
        .q('UPDATE devices SET spot_group = ?, spot_item = ?, spot_at = ? WHERE space_uid = ? AND dev_id = ? AND shopping_until > ? RETURNING *')
        .get(spot, name, ctx.now, ctx.uid, ctx.dev.dev_id, ctx.now);
      if (r) ctx.changes.push({ e: 'device', row: mapDevice(r) });
      // everything on the list is in the cart → tell everybody in the shop
      const open = this.db.q('SELECT COUNT(*) AS c FROM items WHERE space_uid = ? AND list_id = ? AND deleted_at IS NULL AND parked = 0 AND checked = 0').get(ctx.uid, list.id).c;
      if (open === 0) ctx.allDone = { listId: list.id, listName: list.name };
    }
    if ('parked' in updates) this._act(ctx, list.id, updates.parked ? 'item.park' : 'item.unpark', { name });
    if ('name' in updates || 'amount' in updates || 'note' in updates) {
      this._act(ctx, list.id, 'item.edit', { name, from: item.name, amount: updates.amount, note: 'note' in updates });
    }
    if ('groupId' in updates) this._act(ctx, list.id, 'item.move', { name, to: this._groupPath(ctx.uid, updates.groupId) });

    for (const c of conflicts) recordConflict.call(this, ctx, item, c);
    this._pushItem(ctx, id);
    return conflicts.length ? { conflicts: conflicts.length } : {};
  },

  'item.delete'(ctx, op) {
    const ids = idList(op.ids);
    const done = [];
    for (const id of ids) {
      const r = this.db.q('UPDATE items SET deleted_at = ? WHERE space_uid = ? AND id = ? AND deleted_at IS NULL RETURNING id, name, list_id').get(ctx.now, ctx.uid, id);
      if (!r) continue;
      done.push(r);
      ctx.changes.push({ e: 'item', del: id });
      this._dropConflicts(ctx, id);
    }
    if (done.length) this._act(ctx, done[0].list_id, 'item.delete', { names: done.slice(0, 20).map((r) => r.name), count: done.length, ids: done.map((r) => r.id) });
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
      case 'checked':
        this.db.q('UPDATE items SET checked = ?, checked_by = ?, meta = ? WHERE space_uid = ? AND id = ?').run(v ? 1 : 0, v ? choice.byName : null, JSON.stringify(meta), ctx.uid, item.id);
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
    const name = str(op.name, LIMITS.deviceName, { required: true, field: 'name' });
    this.db.q('UPDATE devices SET name = ? WHERE space_uid = ? AND dev_id = ?').run(name, ctx.uid, ctx.dev.dev_id);
    ctx.dev.name = name;
    ctx.changes.push({ e: 'device', row: mapDevice(this.db.q('SELECT * FROM devices WHERE space_uid = ? AND dev_id = ?').get(ctx.uid, ctx.dev.dev_id)) });
  },

  'device.kick'(ctx, op) {
    const devId = String(op.devId ?? '');
    const r = this.db.q('DELETE FROM devices WHERE space_uid = ? AND dev_id = ? RETURNING dev_id, name, token_hash').get(ctx.uid, devId);
    if (!r) return {};
    ctx.changes.push({ e: 'device', del: r.dev_id });
    ctx.kicked = r.token_hash;
    this._act(ctx, null, 'device.kick', { name: r.name });
    return { kicked: r.dev_id };
  },

  'device.shopping'(ctx, op) {
    const until = op.on ? ctx.now + this.shoppingMs : null;
    // a new shopping trip starts without a known spot
    this.db
      .q('UPDATE devices SET shopping_until = ?, spot_group = NULL, spot_item = NULL, spot_at = NULL WHERE space_uid = ? AND dev_id = ?')
      .run(until, ctx.uid, ctx.dev.dev_id);
    ctx.changes.push({ e: 'device', row: mapDevice(this.db.q('SELECT * FROM devices WHERE space_uid = ? AND dev_id = ?').get(ctx.uid, ctx.dev.dev_id)) });
  },
};

function recordConflict(ctx, item, c) {
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
    .run(ctx.uid, id, item.list_id, item.id, c.field, JSON.stringify(options), ctx.now);
  ctx.changes.push({ e: 'conflict', row: mapConflict(this.db.q('SELECT * FROM conflicts WHERE space_uid = ? AND id = ?').get(ctx.uid, id)) });
  this._act(ctx, item.list_id, 'conflict', { name: item.name, field: c.field });
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
Store.prototype.transfer = function transfer(srcUid, device, { targetUid, targetListId, itemIds, groupId, mode }) {
  const { db } = this;
  const now = Date.now();
  if (!['copy', 'move'].includes(mode)) throw new OpError('invalid', 'mode');
  return db.tx(() => {
    let items;
    let groupIds = [];
    if (groupId) {
      const g = this._group(srcUid, eid(groupId, 'groupId'));
      if (!g) throw new OpError('notfound', 'group not found');
      groupIds = [g.id, ...db.q('SELECT id FROM groups WHERE space_uid = ? AND parent_id = ? AND deleted_at IS NULL').all(srcUid, g.id).map((r) => r.id)];
      items = groupIds.flatMap((gid) => db.q('SELECT * FROM items WHERE space_uid = ? AND group_id = ? AND deleted_at IS NULL ORDER BY pos').all(srcUid, gid));
    } else {
      items = idList(itemIds).map((id) => this._item(srcUid, id));
    }
    const tRev = db.q('UPDATE spaces SET rev = rev + 1, last_active_at = ? WHERE uid = ? RETURNING rev').get(now, targetUid).rev;
    const tctx = { uid: targetUid, dev: device, rev: tRev, at: now, now, changes: [] };
    const tList = this._list(targetUid, eid(targetListId, 'listId'));
    const count = db.q('SELECT COUNT(*) AS c FROM items WHERE space_uid = ? AND list_id = ? AND deleted_at IS NULL').get(targetUid, tList.id).c;
    if (count + items.length > LIMITS.itemsPerList) throw new OpError('limit', 'too many items');
    const maxPos = db.q('SELECT COALESCE(MAX(pos), 0) AS m FROM items WHERE space_uid = ? AND list_id = ?').get(targetUid, tList.id).m;
    let i = 0;
    for (const it of items) {
      const path = this._groupPath(srcUid, it.group_id);
      const gid = this._ensurePath(tctx, tList, path.group, path.subgroup);
      const id = newEntityId();
      const norm = this._insertItem(tctx, tList, { id, groupId: gid, name: it.name, qty: it.qty, unit: it.unit, note: it.note, pos: maxPos + ++i, checked: !!it.checked });
      this._pushItem(tctx, id);
      if (gid) this._learn(tctx, tList, norm, gid);
      this._suggest(tctx, it.name, norm);
    }
    this._act(tctx, tList.id, 'transfer.in', { count: items.length, names: items.slice(0, 20).map((r) => r.name) });

    const sRev = db.q('UPDATE spaces SET rev = rev + 1, last_active_at = ? WHERE uid = ? RETURNING rev').get(now, srcUid).rev;
    const sctx = { uid: srcUid, dev: device, rev: sRev, at: now, now, changes: [] };
    if (mode === 'move') {
      for (const it of items) {
        db.q('UPDATE items SET deleted_at = ? WHERE space_uid = ? AND id = ?').run(now, srcUid, it.id);
        sctx.changes.push({ e: 'item', del: it.id });
        this._dropConflicts(sctx, it.id);
      }
      for (const gid of groupIds) {
        db.q('UPDATE groups SET deleted_at = ? WHERE space_uid = ? AND id = ?').run(now, srcUid, gid);
        sctx.changes.push({ e: 'group', del: gid });
      }
    }
    if (items.length) {
      this._act(sctx, items[0].list_id, mode === 'move' ? 'transfer.move' : 'transfer.copy', { count: items.length, names: items.slice(0, 20).map((r) => r.name), ids: items.map((r) => r.id) });
    }
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
    const rev = db.q('UPDATE spaces SET rev = rev + 1, last_active_at = ? WHERE uid = ? RETURNING rev').get(now, uid).rev;
    const ctx = { uid, dev: device, rev, at: now, now, changes: [] };
    const stats = { lists: 0, added: 0, skipped: 0, reactivated: 0 };
    const live = () => db.q('SELECT * FROM lists WHERE space_uid = ? AND deleted_at IS NULL ORDER BY pos').all(uid);

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
      let pos = db.q('SELECT COALESCE(MAX(pos), 0) AS m FROM items WHERE space_uid = ? AND list_id = ?').get(uid, list.id).m;
      for (const raw of Array.isArray(l.items) ? l.items : []) {
        const name = str(raw?.name, LIMITS.itemName);
        if (!name) continue;
        const state = ['open', 'checked', 'parked'].includes(raw.state) ? raw.state : 'open';
        const norm = normalizeName(name);
        const existing = db.q('SELECT * FROM items WHERE space_uid = ? AND list_id = ? AND norm = ? AND deleted_at IS NULL ORDER BY parked, checked').get(uid, list.id, norm);
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
        });
        this._pushItem(ctx, id);
        if (groupId) this._learn(ctx, list, norm, groupId);
        this._suggest(ctx, name, norm);
        stats.added++;
      }
    }
    this._act(ctx, null, 'import', stats);
    return { changes: ctx.changes, rev, stats };
  });
};
