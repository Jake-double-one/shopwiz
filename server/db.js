import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS spaces (
  uid            INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id      TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  ttl_days       INTEGER NOT NULL,
  rev            INTEGER NOT NULL DEFAULT 0,
  last_active_at INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  deleted_by     TEXT,
  ai_write       INTEGER NOT NULL DEFAULT 0   -- connected AI assistants may change lists
);
CREATE TABLE IF NOT EXISTS retired_ids (
  public_id  TEXT PRIMARY KEY,
  space_uid  INTEGER,
  reason     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admins (
  did        TEXT PRIMARY KEY,      -- D-ID of a device the main admin made an admin
  state      TEXT NOT NULL,         -- 'pending' (no passkey yet) | 'active'
  expires_at INTEGER,               -- pending: the promotion runs out
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_keys (
  id           TEXT PRIMARY KEY,    -- passkey credential id
  did          TEXT,                -- NULL = a passkey of the main admin
  public_key   BLOB NOT NULL,
  counter      INTEGER NOT NULL DEFAULT 0,
  transports   TEXT NOT NULL DEFAULT '[]',
  synced       INTEGER NOT NULL DEFAULT 0, -- synced passkey (iCloud, Google, password manager)
  rp_id        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS admin_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT NOT NULL,         -- 'main', a D-ID or 'system' – never an address
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  space_uid      INTEGER NOT NULL REFERENCES spaces(uid) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL,
  dev_id         TEXT NOT NULL,
  name           TEXT NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  shopping_until INTEGER,
  spot_group     TEXT,      -- while shopping: group of the last item this device checked
  spot_item      TEXT,
  spot_at        INTEGER,
  kind           TEXT,      -- 'ai' = an AI assistant connected with its own key
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (space_uid, token_hash)
);
CREATE INDEX IF NOT EXISTS devices_dev ON devices(space_uid, dev_id);
CREATE TABLE IF NOT EXISTS lists (
  space_uid  INTEGER NOT NULL REFERENCES spaces(uid) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  name       TEXT NOT NULL,
  pos        REAL NOT NULL,
  group_mode TEXT NOT NULL DEFAULT 'own',
  address    TEXT NOT NULL DEFAULT '',     -- optional shop address for navigation
  travel_country TEXT,                     -- travel mode: ISO country (flag), NULL = off
  travel_lang    TEXT,                     -- travel mode: language items are translated to
  prio_shortcuts INTEGER NOT NULL DEFAULT 0, -- "!milk" / "?basil" mark items when adding
  link_id    TEXT,                         -- list group (Listenverbund) the list belongs to, NULL = none
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (space_uid, id)
);
CREATE TABLE IF NOT EXISTS groups (
  space_uid  INTEGER NOT NULL REFERENCES spaces(uid) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  list_id    TEXT,            -- NULL = shared set of the space
  parent_id  TEXT,            -- NULL = top level
  name       TEXT NOT NULL,
  pos        REAL NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (space_uid, id)
);
CREATE TABLE IF NOT EXISTS items (
  space_uid  INTEGER NOT NULL REFERENCES spaces(uid) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  list_id    TEXT NOT NULL,
  group_id   TEXT,
  name       TEXT NOT NULL,
  norm       TEXT NOT NULL,
  qty        TEXT NOT NULL DEFAULT '',
  unit       TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  checked    INTEGER NOT NULL DEFAULT 0,
  parked     INTEGER NOT NULL DEFAULT 0,   -- 1 = in the 'inactive items' shadow list
  shared     INTEGER NOT NULL DEFAULT 0,   -- 1 = on every list of the home list's list group
  checked_in TEXT,                         -- list the item was checked off in ("bought at Lidl")
  places     TEXT NOT NULL DEFAULT '{}',   -- shared items: {listId: {groupId, pos}} in the other lists
  bought     INTEGER NOT NULL DEFAULT 0,   -- how often it was checked off (inactive items sort by it)
  prio       INTEGER NOT NULL DEFAULT 0,   -- 1 = important, -1 = not important
  checked_by TEXT,
  added_by   TEXT,
  pos        REAL NOT NULL,
  meta       TEXT NOT NULL DEFAULT '{}',   -- per field: {v: rev, at: madeAt, by: devId}
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (space_uid, id)
);
CREATE INDEX IF NOT EXISTS items_list ON items(space_uid, list_id);
CREATE TABLE IF NOT EXISTS merged_items (   -- an item added twice (offline) became another one
  space_uid  INTEGER NOT NULL REFERENCES spaces(uid) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  target     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (space_uid, id)
);
CREATE TABLE IF NOT EXISTS memory (
  space_uid     INTEGER NOT NULL REFERENCES spaces(uid) ON DELETE CASCADE,
  scope         TEXT NOT NULL,     -- list id, or '' for the shared group set
  norm          TEXT NOT NULL,
  group_name    TEXT NOT NULL,
  subgroup_name TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (space_uid, scope, norm)
);
CREATE TABLE IF NOT EXISTS suggestions (
  space_uid    INTEGER NOT NULL REFERENCES spaces(uid) ON DELETE CASCADE,
  norm         TEXT NOT NULL,
  name         TEXT NOT NULL,
  uses         INTEGER NOT NULL DEFAULT 1,
  last_used_at INTEGER NOT NULL,
  PRIMARY KEY (space_uid, norm)
);
CREATE TABLE IF NOT EXISTS translations (
  space_uid  INTEGER NOT NULL REFERENCES spaces(uid) ON DELETE CASCADE,
  norm       TEXT NOT NULL,     -- normalized item name
  lang       TEXT NOT NULL,
  text       TEXT NOT NULL,
  auto       INTEGER NOT NULL DEFAULT 0,   -- 1 = machine translation, not checked by a person
  provider   TEXT,                         -- the service that translated it (auto only)
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (space_uid, norm, lang)
);
CREATE TABLE IF NOT EXISTS conflicts (
  space_uid  INTEGER NOT NULL REFERENCES spaces(uid) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  list_id    TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  field      TEXT NOT NULL,
  options    TEXT NOT NULL,   -- JSON [{value, by, byName, at}]
  created_at INTEGER NOT NULL,
  PRIMARY KEY (space_uid, id)
);
CREATE TABLE IF NOT EXISTS activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  space_uid  INTEGER NOT NULL REFERENCES spaces(uid) ON DELETE CASCADE,
  list_id    TEXT,
  dev_name   TEXT NOT NULL,
  action     TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_list ON activity(space_uid, list_id, id);
CREATE TABLE IF NOT EXISTS applied_ops (
  space_uid  INTEGER NOT NULL REFERENCES spaces(uid) ON DELETE CASCADE,
  op_id      TEXT NOT NULL,
  result     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (space_uid, op_id)
);
`;

/**
 * Subgroups were removed (v0.1.5): turn every subgroup into a normal group right after its
 * former parent. A same-named group in the same list wins – the items move there.
 */
function flattenSubgroups(db) {
  const subs = db.prepare('SELECT * FROM groups WHERE parent_id IS NOT NULL ORDER BY space_uid, parent_id, pos').all();
  if (!subs.length) return;
  const now = Date.now();
  db.exec('BEGIN');
  try {
    const counter = new Map();
    for (const sub of subs) {
      const parent = db.prepare('SELECT * FROM groups WHERE space_uid = ? AND id = ?').get(sub.space_uid, sub.parent_id);
      const same = sub.deleted_at
        ? null
        : db
            .prepare('SELECT * FROM groups WHERE space_uid = ? AND list_id IS ? AND parent_id IS NULL AND deleted_at IS NULL AND lower(name) = lower(?) AND id != ?')
            .get(sub.space_uid, sub.list_id, sub.name, sub.id);
      if (same) {
        db.prepare('UPDATE items SET group_id = ? WHERE space_uid = ? AND group_id = ?').run(same.id, sub.space_uid, sub.id);
        db.prepare('UPDATE groups SET parent_id = NULL, deleted_at = COALESCE(deleted_at, ?) WHERE space_uid = ? AND id = ?').run(now, sub.space_uid, sub.id);
        continue;
      }
      const key = `${sub.space_uid}|${sub.parent_id}`;
      const n = (counter.get(key) ?? 0) + 1;
      counter.set(key, n);
      const pos = (parent?.pos ?? sub.pos) + n / 1000;
      db.prepare('UPDATE groups SET parent_id = NULL, pos = ? WHERE space_uid = ? AND id = ?').run(pos, sub.space_uid, sub.id);
    }
    // learned placements pointed at "group › subgroup" – now the subgroup is the group
    db.exec("UPDATE memory SET group_name = subgroup_name, subgroup_name = '' WHERE subgroup_name != ''");
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Additive migrations for databases created by older versions. */
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
  if (!cols.includes('parked')) db.exec('ALTER TABLE items ADD COLUMN parked INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('prio')) db.exec('ALTER TABLE items ADD COLUMN prio INTEGER NOT NULL DEFAULT 0');
  const listCols = db.prepare('PRAGMA table_info(lists)').all().map((c) => c.name);
  const devCols = db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name);
  for (const [col, type] of [['spot_group', 'TEXT'], ['spot_item', 'TEXT'], ['spot_at', 'INTEGER'], ['kind', 'TEXT']]) {
    if (!devCols.includes(col)) db.exec(`ALTER TABLE devices ADD COLUMN ${col} ${type}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS devices_token ON devices(token_hash)');
  const spaceCols = db.prepare('PRAGMA table_info(spaces)').all().map((c) => c.name);
  if (!spaceCols.includes('ai_write')) db.exec('ALTER TABLE spaces ADD COLUMN ai_write INTEGER NOT NULL DEFAULT 0');
  // hash of the token of the device that created the space (IDs per device, SPACES_PER_DEVICE)
  if (!spaceCols.includes('created_by')) db.exec('ALTER TABLE spaces ADD COLUMN created_by TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS spaces_creator ON spaces(created_by)');
  flattenSubgroups(db);
  if (!listCols.includes('address')) db.exec("ALTER TABLE lists ADD COLUMN address TEXT NOT NULL DEFAULT ''");
  if (!listCols.includes('travel_country')) db.exec('ALTER TABLE lists ADD COLUMN travel_country TEXT');
  if (!listCols.includes('travel_lang')) db.exec('ALTER TABLE lists ADD COLUMN travel_lang TEXT');
  if (!listCols.includes('link_id')) db.exec('ALTER TABLE lists ADD COLUMN link_id TEXT');
  if (!cols.includes('shared')) db.exec('ALTER TABLE items ADD COLUMN shared INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('checked_in')) db.exec('ALTER TABLE items ADD COLUMN checked_in TEXT');
  if (!cols.includes('bought')) db.exec('ALTER TABLE items ADD COLUMN bought INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('places')) db.exec("ALTER TABLE items ADD COLUMN places TEXT NOT NULL DEFAULT '{}'");
  if (!listCols.includes('prio_shortcuts')) db.exec('ALTER TABLE lists ADD COLUMN prio_shortcuts INTEGER NOT NULL DEFAULT 0');
  const trCols = db.prepare('PRAGMA table_info(translations)').all().map((c) => c.name);
  if (!trCols.includes('provider')) db.exec('ALTER TABLE translations ADD COLUMN provider TEXT');
}

export function openDb(dataDir) {
  let file = ':memory:';
  if (dataDir !== ':memory:') {
    mkdirSync(dataDir, { recursive: true });
    file = join(dataDir, 'shopwiz.db');
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);

  const cache = new Map();
  /** Cached prepared statement. */
  db.q = (sql) => {
    let st = cache.get(sql);
    if (!st) {
      st = db.prepare(sql);
      cache.set(sql, st);
    }
    return st;
  };
  db.tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  return db;
}
