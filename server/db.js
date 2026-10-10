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
  deleted_by     TEXT
);
CREATE TABLE IF NOT EXISTS retired_ids (
  public_id  TEXT PRIMARY KEY,
  space_uid  INTEGER,
  reason     TEXT NOT NULL,
  created_at INTEGER NOT NULL
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
  checked_by TEXT,
  added_by   TEXT,
  pos        REAL NOT NULL,
  meta       TEXT NOT NULL DEFAULT '{}',   -- per field: {v: rev, at: madeAt, by: devId}
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (space_uid, id)
);
CREATE INDEX IF NOT EXISTS items_list ON items(space_uid, list_id);
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

/** Additive migrations for databases created by older versions. */
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
  if (!cols.includes('parked')) db.exec('ALTER TABLE items ADD COLUMN parked INTEGER NOT NULL DEFAULT 0');
  const listCols = db.prepare('PRAGMA table_info(lists)').all().map((c) => c.name);
  const devCols = db.prepare('PRAGMA table_info(devices)').all().map((c) => c.name);
  for (const [col, type] of [['spot_group', 'TEXT'], ['spot_item', 'TEXT'], ['spot_at', 'INTEGER']]) {
    if (!devCols.includes(col)) db.exec(`ALTER TABLE devices ADD COLUMN ${col} ${type}`);
  }
  if (!listCols.includes('address')) db.exec("ALTER TABLE lists ADD COLUMN address TEXT NOT NULL DEFAULT ''");
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
