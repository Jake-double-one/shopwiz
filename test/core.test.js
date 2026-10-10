import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../server/db.js';
import { Store, hashToken, OpError } from '../server/core.js';
import { loadConfig } from '../server/config.js';

const DAY = 86_400_000;
const T1 = 'token-aaaaaaaaaaaaaaaaaaaaaa';
const T2 = 'token-bbbbbbbbbbbbbbbbbbbbbb';
let n = 0;
const opId = () => `op${++n}`;

function setup() {
  const db = openDb(':memory:');
  const store = new Store(db, loadConfig({}));
  const id = store.createSpace({ name: 'Home', token: T1, deviceName: 'Phone A' });
  const { space } = store.resolve(id, null);
  const uid = space.uid;
  const devA = store.device(uid, hashToken(T1));
  const devB = store.joinDevice(uid, hashToken(T2), 'Phone B');
  const listId = store.snapshot(uid).lists[0].id;
  const op = (dev, o, at = Date.now()) => store.applyOp(uid, dev, opId(), o, at);
  const item = (itemId) => store.snapshot(uid).items.find((i) => i.id === itemId);
  return { db, store, id, uid, devA, devB, listId, op, item };
}

describe('spaces', () => {
  it('creates a space with one list and the creator as member', () => {
    const { store, uid } = setup();
    const snap = store.snapshot(uid);
    expect(snap.lists).toHaveLength(1);
    expect(snap.devices.map((d) => d.name)).toEqual(['Phone A', 'Phone B']);
    expect(snap.space.ttlDays).toBe(181);
  });

  it('renews ids and moves members only', () => {
    const { store, id, uid } = setup();
    const newId = store.renew(uid);
    expect(newId).not.toBe(id);
    expect(store.resolve(id, hashToken(T1))).toEqual({ status: 'moved', id: newId });
    expect(store.resolve(id, hashToken('stranger-xxxxxxxxxxxxxxx'))).toEqual({ status: 'notfound' });
    expect(store.resolve(id, null)).toEqual({ status: 'notfound' });
    expect(store.resolve(newId, null).status).toBe('ok');
  });

  it('deleted spaces can be continued by members into one shared new space', () => {
    const { store, id, uid, listId, op, devA } = setup();
    op(devA, { k: 'item.add', id: 'item00001', listId, name: 'Milk' });
    store.deleteSpace(uid, 'Phone A');
    expect(store.resolve(id, hashToken(T2)).status).toBe('deleted');
    expect(store.resolve(id, null).status).toBe('notfound');
    const c1 = store.continueSpace(uid, hashToken(T1), 'Phone A');
    const c2 = store.continueSpace(uid, hashToken(T2), 'Phone B');
    expect(c1).toBe(c2);
    const res = store.resolve(c1, null);
    const snap = store.snapshot(res.space.uid);
    expect(snap.items.map((i) => i.name)).toEqual(['Milk']);
    expect(snap.items[0].id).toBe('item00001'); // pending offline ops keep working
  });

  it('cleans up inactive devices and expired spaces', () => {
    const { store, db, uid, id } = setup();
    const now = Date.now();
    db.q('UPDATE devices SET last_seen_at = ?').run(now - 31 * DAY);
    expect(store.cleanup(now).devices).toBe(2);
    db.q('UPDATE spaces SET last_active_at = ? WHERE uid = ?').run(now - 182 * DAY, uid);
    expect(store.cleanup(now).spaces).toBe(1);
    expect(store.resolve(id, null).status).toBe('notfound');
  });

  it('hard-deletes a deleted space once no member device is left', () => {
    const { store, db, uid } = setup();
    store.deleteSpace(uid, 'x');
    expect(store.cleanup().spaces).toBe(0);
    db.q('DELETE FROM devices').run();
    expect(store.cleanup().spaces).toBe(1);
  });

  it('validates ttl range', () => {
    const { op, devA } = setup();
    expect(() => op(devA, { k: 'space.update', ttlDays: 368 })).toThrow(OpError);
    op(devA, { k: 'space.update', ttlDays: 367 });
  });
});

describe('items', () => {
  it('learns group placement and follows moves', () => {
    const { store, uid, listId, op, devA } = setup();
    op(devA, { k: 'group.add', id: 'grpcool01', listId, name: 'Kühlwaren' });
    // older clients may still ask for a subgroup – it becomes a normal group
    op(devA, { k: 'group.add', id: 'grpdairy1', listId, parentId: 'grpcool01', name: 'Milchprodukte' });
    expect(store.snapshot(uid).groups.every((g) => g.parentId === null)).toBe(true);
    op(devA, { k: 'item.add', id: 'item00001', listId, name: 'Milch', groupId: 'grpdairy1' });
    let mem = store.snapshot(uid).memory;
    expect(mem).toContainEqual({ scope: listId, norm: 'milch', group: 'Milchprodukte', subgroup: '' });
    op(devA, { k: 'group.add', id: 'grpdrink1', listId, name: 'Getränke' });
    op(devA, { k: 'item.set', id: 'item00001', fields: { groupId: 'grpdrink1' }, base: { groupId: 999 } });
    mem = store.snapshot(uid).memory;
    expect(mem).toContainEqual({ scope: listId, norm: 'milch', group: 'Getränke', subgroup: '' });
  });

  it('merges duplicate unchecked items unless forced', () => {
    const { store, uid, listId, op, devA, devB } = setup();
    op(devA, { k: 'item.add', id: 'item00001', listId, name: 'Eggs', qty: '6' });
    const r = op(devB, { k: 'item.add', id: 'item00002', listId, name: 'eggs', qty: '4' });
    expect(r.result).toEqual({ merged: 'item00001' });
    const items = store.snapshot(uid).items;
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe('10');
    op(devB, { k: 'item.add', id: 'item00003', listId, name: 'Eggs', force: true });
    expect(store.snapshot(uid).items).toHaveLength(2);
  });

  it('is idempotent per op id', () => {
    const { store, uid, listId, devA } = setup();
    const o = { k: 'item.add', id: 'item00001', listId, name: 'Bread' };
    store.applyOp(uid, devA, 'same-op', o, Date.now());
    const again = store.applyOp(uid, devA, 'same-op', o, Date.now());
    expect(again.duplicate).toBe(true);
  });

  it('suggestions count uses', () => {
    const { store, uid, listId, op, devA } = setup();
    op(devA, { k: 'item.add', id: 'item00001', listId, name: 'Bread' });
    op(devA, { k: 'item.delete', ids: ['item00001'] });
    op(devA, { k: 'item.add', id: 'item00002', listId, name: 'bread' });
    const s = store.snapshot(uid).suggestions;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ norm: 'bread', name: 'bread', uses: 2 });
  });

  it('renaming adds the new name to the suggestions', () => {
    const { store, uid, listId, op, devA } = setup();
    op(devA, { k: 'item.add', id: 'item00001', listId, name: 'Frischmilch' });
    op(devA, { k: 'item.set', id: 'item00001', fields: { name: 'Milch (Frischmilch)' }, base: {} });
    const names = store.snapshot(uid).suggestions.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['Frischmilch', 'Milch (Frischmilch)']));
  });

  it('clear checked moves to inactive + undo', () => {
    const { store, uid, listId, op, devA } = setup();
    op(devA, { k: 'item.add', id: 'item00001', listId, name: 'A' });
    op(devA, { k: 'item.add', id: 'item00002', listId, name: 'B' });
    op(devA, { k: 'item.set', id: 'item00001', fields: { checked: true }, base: {} });
    const r = op(devA, { k: 'list.clearChecked', listId });
    expect(r.result.ids).toEqual(['item00001']);
    // checked items move to the inactive items instead of being deleted
    expect(store.snapshot(uid).items.filter((i) => !i.parked).map((i) => i.name)).toEqual(['B']);
    op(devA, { k: 'item.setState', ids: r.result.ids, checked: true });
    expect(store.snapshot(uid).items.filter((i) => !i.parked)).toHaveLength(2);
  });

  it('deleting a group ungroups its items; restore puts them back', () => {
    const { listId, op, devA, item } = setup();
    op(devA, { k: 'group.add', id: 'grp000001', listId, name: 'G' });
    op(devA, { k: 'item.add', id: 'item00001', listId, name: 'A', groupId: 'grp000001' });
    const r = op(devA, { k: 'group.delete', id: 'grp000001' });
    expect(item('item00001').groupId).toBeNull();
    op(devA, { k: 'group.restore', ids: r.result.groupIds, moves: r.result.moves });
    expect(item('item00001').groupId).toBe('grp000001');
  });
});

describe('conflicts', () => {
  it('flags concurrent edits of the same field and lets anyone choose', () => {
    const { store, uid, listId, op, devA, devB, item } = setup();
    op(devA, { k: 'item.add', id: 'item00001', listId, name: 'Eggs', qty: '6' });
    const v = item('item00001').meta.amount.v;
    const t = Date.now();
    // B edits offline at t-1000 based on v, A edits online at t based on v
    op(devA, { k: 'item.set', id: 'item00001', fields: { amount: { qty: '10', unit: '' } }, base: { amount: v } }, t);
    const r = op(devB, { k: 'item.set', id: 'item00001', fields: { amount: { qty: '12', unit: '' } }, base: { amount: v } }, t - 1000);
    expect(r.result.conflicts).toBe(1);
    // A's change is newer → stays
    expect(item('item00001').qty).toBe('10');
    const [c] = store.snapshot(uid).conflicts;
    expect(c.field).toBe('amount');
    expect(c.options.map((o) => o.value.qty)).toEqual(['12', '10']);
    const pick = c.options.findIndex((o) => o.value.qty === '12');
    op(devA, { k: 'conflict.resolve', id: c.id, index: pick });
    expect(item('item00001').qty).toBe('12');
    expect(store.snapshot(uid).conflicts).toHaveLength(0);
  });

  it('later-made change wins even if it arrives first', () => {
    const { listId, op, devA, devB, item } = setup();
    op(devA, { k: 'item.add', id: 'item00001', listId, name: 'Eggs' });
    const v = item('item00001').meta.name.v;
    const t = Date.now();
    op(devA, { k: 'item.set', id: 'item00001', fields: { name: 'Brown eggs' }, base: { name: v } }, t - 5000);
    op(devB, { k: 'item.set', id: 'item00001', fields: { name: 'Free range eggs' }, base: { name: v } }, t);
    expect(item('item00001').name).toBe('Free range eggs');
  });

  it('no conflict for own consecutive edits or different fields', () => {
    const { store, uid, listId, op, devA, devB, item } = setup();
    op(devA, { k: 'item.add', id: 'item00001', listId, name: 'Eggs' });
    const m = item('item00001').meta;
    op(devA, { k: 'item.set', id: 'item00001', fields: { amount: { qty: '2', unit: '' } }, base: { amount: m.amount.v } });
    op(devA, { k: 'item.set', id: 'item00001', fields: { amount: { qty: '3', unit: '' } }, base: { amount: m.amount.v } });
    op(devB, { k: 'item.set', id: 'item00001', fields: { checked: true }, base: { checked: m.checked.v } });
    expect(store.snapshot(uid).conflicts).toHaveLength(0);
    expect(item('item00001')).toMatchObject({ qty: '3', checked: true, checkedBy: 'Phone B' });
  });

  it('edit of a deleted item is rejected and logged', () => {
    const { store, uid, listId, op, devA, devB } = setup();
    op(devA, { k: 'item.add', id: 'item00001', listId, name: 'Eggs' });
    op(devA, { k: 'item.delete', ids: ['item00001'] });
    const r = op(devB, { k: 'item.set', id: 'item00001', fields: { note: 'x' }, base: {} });
    expect(r.result).toEqual({ rejected: 'deleted', name: 'Eggs' });
    expect(store.activity(uid, listId).some((a) => a.action === 'item.editDeleted')).toBe(true);
  });
});

describe('group modes and transfer', () => {
  it('switching to shared groups merges by name and shares learning', () => {
    const { store, uid, listId, op, devA, item } = setup();
    op(devA, { k: 'list.add', id: 'list00002', name: 'Second', groupMode: 'shared' });
    op(devA, { k: 'group.add', id: 'grpshrd01', listId: null, name: 'Cooling' });
    op(devA, { k: 'group.add', id: 'grpown001', listId, name: 'cooling' });
    op(devA, { k: 'item.add', id: 'item00001', listId, name: 'Milk', groupId: 'grpown001' });
    op(devA, { k: 'list.update', id: listId, groupMode: 'shared' });
    expect(item('item00001').groupId).toBe('grpshrd01');
    const mem = store.snapshot(uid).memory;
    expect(mem.find((m) => m.scope === '' && m.norm === 'milk').group.toLowerCase()).toBe('cooling');
    // learning now applies across lists in shared mode
    op(devA, { k: 'item.add', id: 'item00002', listId: 'list00002', name: 'Butter', groupId: 'grpshrd01' });
    expect(store.snapshot(uid).memory).toContainEqual({ scope: '', norm: 'butter', group: 'Cooling', subgroup: '' });
  });

  it('copies and moves items into another space, creating groups', () => {
    const { store, uid, listId, op, devA } = setup();
    const otherId = store.createSpace({ name: 'Office', token: T2, deviceName: 'B' });
    const other = store.resolve(otherId, null).space;
    const otherList = store.snapshot(other.uid).lists[0].id;
    op(devA, { k: 'group.add', id: 'grp000001', listId, name: 'Snacks' });
    op(devA, { k: 'item.add', id: 'item00001', listId, name: 'Chips', groupId: 'grp000001' });
    op(devA, { k: 'item.add', id: 'item00002', listId, name: 'Nuts', groupId: 'grp000001' });
    store.transfer(uid, devA, { targetUid: other.uid, targetListId: otherList, itemIds: ['item00001'], mode: 'copy' });
    expect(store.snapshot(uid).items).toHaveLength(2);
    store.transfer(uid, devA, { targetUid: other.uid, targetListId: otherList, groupId: 'grp000001', mode: 'move' });
    expect(store.snapshot(uid).items).toHaveLength(0);
    const target = store.snapshot(other.uid);
    expect(target.items.map((i) => i.name).sort()).toEqual(['Chips', 'Chips', 'Nuts']);
    expect(target.groups.map((g) => g.name)).toEqual(['Snacks']);
  });
});

describe('devices', () => {
  it('kick removes membership but rejoining works', () => {
    const { store, uid, op, devA, devB } = setup();
    const r = op(devA, { k: 'device.kick', devId: devB.dev_id });
    expect(r.kickedHash).toBe(hashToken(T2));
    expect(store.isMember(uid, hashToken(T2))).toBe(false);
    store.joinDevice(uid, hashToken(T2), 'Phone B');
    expect(store.isMember(uid, hashToken(T2))).toBe(true);
  });

  it('shopping mode expires', () => {
    const { store, uid, db, op, devA } = setup();
    op(devA, { k: 'device.shopping', on: true });
    expect(store.devices(uid)[0].shoppingUntil).toBeGreaterThan(Date.now());
    db.q('UPDATE devices SET shopping_until = ?').run(Date.now() - 1);
    expect(store.devices(uid)[0].shoppingUntil).toBeNull();
  });
});

describe('guards', () => {
  it('refuses to delete the last list and hides items of deleted lists', () => {
    const { store, uid, listId, op, devA } = setup();
    expect(() => op(devA, { k: 'list.delete', id: listId })).toThrow(/last list/);
    op(devA, { k: 'list.add', id: 'list00002', name: 'Second' });
    op(devA, { k: 'item.add', id: 'item00001', listId: 'list00002', name: 'X' });
    op(devA, { k: 'list.delete', id: 'list00002' });
    expect(store.snapshot(uid).items).toHaveLength(0);
    const r = op(devA, { k: 'list.restore', id: 'list00002' });
    expect(r.changes.some((c) => c.e === 'item' && c.row?.id === 'item00001')).toBe(true);
  });
});

describe('shadow list and import', () => {
  it('clear checked parks items; setState undoes it; parked items are not merged', () => {
    const { store, uid, listId, op, devA, item } = setup();
    op(devA, { k: 'item.add', id: 'item00001', listId, name: 'Milk' });
    op(devA, { k: 'item.set', id: 'item00001', fields: { checked: true }, base: {} });
    op(devA, { k: 'list.clearChecked', listId });
    expect(item('item00001')).toMatchObject({ checked: false, parked: true });
    op(devA, { k: 'item.add', id: 'item00002', listId, name: 'milk' });
    expect(store.snapshot(uid).items).toHaveLength(2);
    op(devA, { k: 'item.setState', ids: ['item00001'], checked: true });
    expect(item('item00001')).toMatchObject({ checked: true, parked: false });
    op(devA, { k: 'item.set', id: 'item00002', fields: { parked: true }, base: {} });
    const r = op(devA, { k: 'list.clearParked', listId });
    expect(r.result.ids).toEqual(['item00002']);
  });

  it('imports with duplicate check into an existing space', () => {
    const { store, uid, listId, op, devA } = setup();
    op(devA, { k: 'item.add', id: 'item00001', listId, name: 'Milk' });
    op(devA, { k: 'item.add', id: 'item00002', listId, name: 'Bread', parked: true });
    const doc = {
      lists: [
        { name: '', items: [
          { name: 'milk', state: 'open' },
          { name: 'Bread', state: 'open' },
          { name: 'Cheese', qty: '200', unit: 'g', state: 'open', group: 'Fridge', subgroup: 'Dairy' }, // old backup: subgroup wins
        ] },
        { name: 'DIY', items: [{ name: 'Screws', state: 'parked' }] },
      ],
    };
    const res = store.importDoc(uid, devA, doc, { defaultListId: listId });
    expect(res.stats).toEqual({ lists: 1, added: 2, skipped: 1, reactivated: 1 });
    const snap = store.snapshot(uid);
    expect(snap.lists.map((l) => l.name)).toContain('DIY');
    expect(snap.items.find((i) => i.name === 'Bread').parked).toBe(false);
    expect(snap.items.find((i) => i.name === 'Screws').parked).toBe(true);
    expect(snap.groups.map((g) => g.name)).toEqual(['Dairy']);
    expect(snap.memory).toContainEqual({ scope: listId, norm: 'cheese', group: 'Dairy', subgroup: '' });
    // importing the same again adds nothing
    expect(store.importDoc(uid, devA, doc, { defaultListId: listId }).stats.added).toBe(0);
  });
});

describe('migration', () => {
  it('adds the parked column to databases from v0.1.0', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { DatabaseSync } = await import('node:sqlite');
    const dir = mkdtempSync(join(tmpdir(), 'shopwiz-'));
    const old = new DatabaseSync(join(dir, 'shopwiz.db'));
    old.exec(`CREATE TABLE items (space_uid INTEGER NOT NULL, id TEXT NOT NULL, list_id TEXT NOT NULL, group_id TEXT, name TEXT NOT NULL,
      norm TEXT NOT NULL, qty TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      checked INTEGER NOT NULL DEFAULT 0, checked_by TEXT, added_by TEXT, pos REAL NOT NULL, meta TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL, deleted_at INTEGER, PRIMARY KEY (space_uid, id))`);
    old.exec(`INSERT INTO items (space_uid, id, list_id, name, norm, pos, created_at) VALUES (1, 'x', 'l', 'Milk', 'milk', 1, 1)`);
    old.close();
    const db = openDb(dir);
    expect(db.prepare('PRAGMA table_info(items)').all().map((c) => c.name)).toContain('parked');
    expect(db.prepare('SELECT parked FROM items').get().parked).toBe(0);
    db.close();
  });
});

describe('list address', () => {
  it('is stored, validated and imported', () => {
    const { store, uid, listId, op, devA } = setup();
    op(devA, { k: 'list.update', id: listId, address: '  Conad, Via Roma 1, Olbia ' });
    expect(store.snapshot(uid).lists[0].address).toBe('Conad, Via Roma 1, Olbia');
    store.importDoc(uid, devA, { lists: [{ name: 'Beach', address: 'Spiaggia 2', items: [{ name: 'Water', state: 'open' }] }] });
    expect(store.snapshot(uid).lists.find((l) => l.name === 'Beach').address).toBe('Spiaggia 2');
  });
});

describe('spot while shopping', () => {
  it('remembers the group of the last checked item only while checked in', () => {
    const { store, uid, listId, op, devA } = setup();
    op(devA, { k: 'group.add', id: 'grp000001', listId, name: 'Fridge' });
    op(devA, { k: 'item.add', id: 'item00001', listId, name: 'Milk', groupId: 'grp000001' });
    op(devA, { k: 'item.add', id: 'item00002', listId, name: 'Bread' });
    op(devA, { k: 'item.set', id: 'item00001', fields: { checked: true }, base: {} });
    expect(store.devices(uid)[0].spot).toBeNull(); // not checked in
    op(devA, { k: 'item.set', id: 'item00001', fields: { checked: false }, base: {} });
    op(devA, { k: 'device.shopping', on: true });
    const r = op(devA, { k: 'item.set', id: 'item00001', fields: { checked: true }, base: {} });
    expect(store.devices(uid)[0].spot).toMatchObject({ group: 'Fridge', item: 'Milk' });
    expect(r.allDone).toBeUndefined(); // Bread still open
    const r2 = op(devA, { k: 'item.set', id: 'item00002', fields: { checked: true }, base: {} });
    expect(r2.allDone).toMatchObject({ listId });
    expect(store.devices(uid)[0].spot).toMatchObject({ group: '', item: 'Bread' });
    op(devA, { k: 'device.shopping', on: true });
    expect(store.devices(uid)[0].spot).toBeNull(); // a new trip starts fresh
  });

  it('ends the check-in after an hour without activity; activity extends it', () => {
    const { store, uid, op, devA } = setup();
    const MIN = 60_000;
    const t0 = Date.now();
    op(devA, { k: 'device.shopping', on: true }, t0);
    const until = () => store.devices(uid)[0].shoppingUntil;
    expect(until()).toBeGreaterThanOrEqual(t0 + 59 * MIN);
    expect(until()).toBeLessThanOrEqual(Date.now() + 60 * MIN);
    // right after checking in nothing needs to be written
    expect(store.keepShopping(uid, devA.token_hash, Date.now() + MIN)).toBeNull();
    // activity after 40 minutes → another full hour from then
    const later = Date.now() + 40 * MIN;
    expect(store.keepShopping(uid, devA.token_hash, later).shoppingUntil).toBe(later + 60 * MIN);
    // once it has run out, activity doesn't check you in again
    db_expire(store, uid);
    expect(store.keepShopping(uid, devA.token_hash)).toBeNull();
    expect(store.devices(uid)[0].shoppingUntil).toBeNull();
  });
});

function db_expire(store, uid) {
  store.db.q('UPDATE devices SET shopping_until = ? WHERE space_uid = ?').run(Date.now() - 1000, uid);
}

describe('subgroup migration', () => {
  it('turns subgroups of older versions into normal groups', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'shopwiz-'));
    let db = openDb(dir);
    const ins = db.prepare('INSERT INTO groups (space_uid, id, list_id, parent_id, name, pos, created_at) VALUES (1, ?, ?, ?, ?, ?, 1)');
    db.exec("INSERT INTO spaces (uid, public_id, name, ttl_days, last_active_at, created_at) VALUES (1, 'AAAAAAAAAA', 'S', 181, 1, 1)");
    ins.run('fridge', 'l1', null, 'Fridge', 1);
    ins.run('drinks', 'l1', null, 'Drinks', 2);
    ins.run('dairy', 'l1', 'fridge', 'Dairy', 1);
    ins.run('juice', 'l1', 'drinks', 'drinks', 1); // same name as a top-level group → merged
    db.prepare("INSERT INTO items (space_uid, id, list_id, group_id, name, norm, pos, created_at) VALUES (1, 'i1', 'l1', 'dairy', 'Milk', 'milk', 1, 1)").run();
    db.prepare("INSERT INTO items (space_uid, id, list_id, group_id, name, norm, pos, created_at) VALUES (1, 'i2', 'l1', 'juice', 'Juice', 'juice', 1, 1)").run();
    db.prepare("INSERT INTO memory (space_uid, scope, norm, group_name, subgroup_name, updated_at) VALUES (1, 'l1', 'milk', 'Fridge', 'Dairy', 1)").run();
    db.close();
    db = openDb(dir);
    const groups = db.prepare('SELECT id, parent_id, pos, deleted_at FROM groups ORDER BY pos').all();
    expect(groups.every((g) => g.parent_id === null)).toBe(true);
    expect(groups.filter((g) => !g.deleted_at).map((g) => g.id)).toEqual(['fridge', 'dairy', 'drinks']);
    expect(db.prepare("SELECT group_id FROM items WHERE id = 'i2'").get().group_id).toBe('drinks');
    expect(db.prepare('SELECT group_name, subgroup_name FROM memory').get()).toEqual({ group_name: 'Dairy', subgroup_name: '' });
    db.close();
  });
});

describe('travel mode', () => {
  it('sets a country and language per list and remembers translations per name', () => {
    const { store, uid, listId, op, devA } = setup();
    op(devA, { k: 'list.update', id: listId, travel: { country: 'IT', lang: 'it' } });
    expect(store.snapshot(uid).lists[0].travel).toEqual({ country: 'IT', lang: 'it' });
    expect(() => op(devA, { k: 'list.update', id: listId, travel: { country: 'XX', lang: 'it' } })).toThrow(OpError);

    // a machine translation, then a person corrects it – machines never overwrite people
    const changes = store.saveAutoTranslations(uid, 'it', [['milch', 'Latte'], ['brot', 'Pane']]);
    expect(changes).toHaveLength(2);
    op(devA, { k: 'translation.set', name: 'Milch', lang: 'it', text: 'Latte intero' });
    expect(store.saveAutoTranslations(uid, 'it', [['milch', 'Latte']])).toHaveLength(0);
    const tr = store.snapshot(uid).translations;
    expect(tr).toContainEqual(expect.objectContaining({ norm: 'milch', lang: 'it', text: 'Latte intero', auto: false }));
    expect(tr).toContainEqual(expect.objectContaining({ norm: 'brot', text: 'Pane', auto: true }));
    expect(store.knownTranslations(uid, 'it', ['milch', 'eier'])).toEqual(new Map([['milch', 'Latte intero']]));

    // clearing removes it; switching travel mode off keeps the translations
    op(devA, { k: 'translation.set', name: 'Brot', lang: 'it', text: '' });
    op(devA, { k: 'list.update', id: listId, travel: null });
    const snap = store.snapshot(uid);
    expect(snap.lists[0].travel).toBeNull();
    expect(snap.translations.map((t) => t.norm)).toEqual(['milch']);
  });
});

