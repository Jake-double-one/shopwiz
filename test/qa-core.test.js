// Regression tests for the full code review (server core): each case was a confirmed bug.
import { describe, it, expect } from 'vitest';
import { openDb } from '../server/db.js';
import { Store, hashToken } from '../server/core.js';
import { loadConfig } from '../server/config.js';

const T1 = 'token-qaqaqaqaqaqaqaqaqaqaqa';
const T2 = 'token-qbqbqbqbqbqbqbqbqbqbqb';
let n = 0;
function setup() {
  const store = new Store(openDb(':memory:'), loadConfig({}));
  const id = store.createSpace({ name: 'Home', token: T1, deviceName: 'A', listName: 'Lidl' });
  const uid = store.resolve(id, null).space.uid;
  const devA = store.device(uid, hashToken(T1));
  const devB = store.joinDevice(uid, hashToken(T2), 'B');
  const opAs = (dev, o, at = Date.now()) => store.applyOp(uid, dev, `qa${++n}`, o, at);
  const op = (o) => opAs(devA, o);
  const lidl = store.snapshot(uid).lists[0].id;
  const item = (iid) => store.snapshot(uid).items.find((i) => i.id === iid);
  return { store, id, uid, devA, devB, op, opAs, lidl, item };
}

describe('full review: server core', () => {
  it('moving a group of the shared set takes only the items of the list it is sent from', () => {
    const { store, uid, devA, op, lidl } = setup();
    op({ k: 'list.update', id: lidl, groupMode: 'shared' });
    op({ k: 'list.add', id: 'conad0001', name: 'Conad', pos: 2, groupMode: 'shared' });
    op({ k: 'group.add', id: 'gdairy001', listId: null, name: 'Dairy' });
    op({ k: 'item.add', id: 'milk00001', listId: lidl, name: 'Milk', groupId: 'gdairy001' });
    op({ k: 'item.add', id: 'butter001', listId: lidl, name: 'Butter', groupId: 'gdairy001', parked: true });
    op({ k: 'item.add', id: 'yogurt001', listId: 'conad0001', name: 'Yogurt', groupId: 'gdairy001' });
    const id2 = store.createSpace({ name: 'Other', token: 'token-otherotherotherother', deviceName: 'X', listName: 'Target' });
    const uid2 = store.resolve(id2, null).space.uid;
    const target = store.snapshot(uid2).lists[0].id;
    const r = store.transfer(uid, devA, { targetUid: uid2, targetListId: target, groupId: 'gdairy001', fromListId: lidl, mode: 'move' });
    expect(r.count).toBe(2);
    const s = store.snapshot(uid);
    expect(s.items.map((i) => i.name)).toEqual(['Yogurt']);
    expect(s.groups.some((g) => g.id === 'gdairy001')).toBe(true); // Conad still uses it
    // inactive stays inactive
    expect(store.snapshot(uid2).items.find((i) => i.name === 'Butter')).toMatchObject({ parked: true, checked: false });
  });

  it('a conflict on a shared item belongs to the list it happened in', () => {
    const { store, uid, devA, devB, opAs, op, lidl } = setup();
    op({ k: 'list.add', id: 'conad0001', name: 'Conad', pos: 2 });
    op({ k: 'list.link', id: lidl, other: 'conad0001' });
    op({ k: 'item.add', id: 'milk00001', listId: lidl, name: 'Milk', shared: true });
    const v = store.snapshot(uid).items[0].meta.amount.v;
    opAs(devA, { k: 'item.set', id: 'milk00001', listId: 'conad0001', fields: { amount: { qty: '2', unit: '' } }, base: { amount: v } });
    opAs(devB, { k: 'item.set', id: 'milk00001', listId: 'conad0001', fields: { amount: { qty: '3', unit: '' } }, base: { amount: v } });
    expect(store.snapshot(uid).conflicts[0].listId).toBe('conad0001');
    expect(store.activity(uid, 'conad0001').some((a) => a.action === 'conflict')).toBe(true);
    expect(devA && devB).toBeTruthy();
  });

  it('switching to the shared groups keeps the places of shared items of other lists', () => {
    const { store, uid, op, lidl, item } = setup();
    op({ k: 'list.add', id: 'conad0001', name: 'Conad', pos: 2 });
    op({ k: 'list.link', id: lidl, other: 'conad0001' });
    op({ k: 'group.add', id: 'gconadai1', listId: 'conad0001', name: 'Dairy' });
    op({ k: 'item.add', id: 'milk00001', listId: lidl, name: 'Milk', shared: true });
    op({ k: 'item.set', id: 'milk00001', listId: 'conad0001', fields: { groupId: 'gconadai1' } });
    op({ k: 'list.update', id: 'conad0001', groupMode: 'shared' });
    const gid = item('milk00001').places.conad0001.groupId;
    expect(store.snapshot(uid).groups.find((g) => g.id === gid)).toMatchObject({ name: 'Dairy', listId: null });
  });

  it('checking off an item someone moved to "inactive" meanwhile puts it back on the list', () => {
    const { devA, devB, opAs, op, lidl, item } = setup();
    op({ k: 'item.add', id: 'milk00001', listId: lidl, name: 'Milk' });
    opAs(devA, { k: 'item.set', id: 'milk00001', fields: { parked: true, checked: false } });
    opAs(devB, { k: 'item.set', id: 'milk00001', fields: { checked: true } });
    expect(item('milk00001')).toMatchObject({ checked: true, parked: false });
  });

  it('continuing a deleted ID keeps its settings and leaves deleted lists behind', () => {
    const { store, uid, op, lidl } = setup();
    op({ k: 'list.update', id: lidl, prioShortcuts: true, travel: { country: 'IT', lang: 'it' } });
    op({ k: 'space.update', aiWrite: true });
    op({ k: 'translation.set', name: 'Milk', lang: 'it', text: 'Latte', auto: true, provider: 'deepl' });
    op({ k: 'list.add', id: 'gone00001', name: 'Gone', pos: 2 });
    op({ k: 'group.add', id: 'ggone0001', listId: 'gone00001', name: 'G' });
    op({ k: 'item.add', id: 'gonei0001', listId: 'gone00001', name: 'Old', groupId: 'ggone0001' });
    op({ k: 'list.delete', id: 'gone00001' });
    store.deleteSpace(uid, 'A');
    const newId = store.continueSpace(uid, hashToken(T1), 'A');
    const uid2 = store.resolve(newId, null).space.uid;
    const s = store.snapshot(uid2);
    expect(s.lists).toHaveLength(1);
    expect(s.lists[0]).toMatchObject({ prioShortcuts: true, travel: { country: 'IT', lang: 'it' } });
    expect(s.space.aiWrite).toBe(true);
    expect(s.translations[0]).toMatchObject({ text: 'Latte', by: 'deepl' });
    expect(s.groups).toHaveLength(0);
    expect(store.db.q('SELECT COUNT(*) AS c FROM items WHERE space_uid = ?').get(uid2).c).toBe(0);
  });

  it('undoing a group delete puts shared items back into it in the other shop', () => {
    const { op, lidl, item } = setup();
    op({ k: 'list.add', id: 'conad0001', name: 'Conad', pos: 2 });
    op({ k: 'list.link', id: lidl, other: 'conad0001' });
    op({ k: 'group.add', id: 'gconadai1', listId: 'conad0001', name: 'Dairy' });
    op({ k: 'item.add', id: 'milk00001', listId: lidl, name: 'Milk', shared: true });
    op({ k: 'item.set', id: 'milk00001', listId: 'conad0001', fields: { groupId: 'gconadai1' } });
    const r = op({ k: 'group.delete', id: 'gconadai1' }).result;
    expect(item('milk00001').places.conad0001.groupId).toBeNull();
    op({ k: 'group.restore', ids: r.groupIds, moves: r.moves });
    expect(item('milk00001').places.conad0001.groupId).toBe('gconadai1');
  });

  it('a deletion shows up in the history of the list it was made in', () => {
    const { store, uid, op, lidl } = setup();
    op({ k: 'list.add', id: 'conad0001', name: 'Conad', pos: 2 });
    op({ k: 'list.link', id: lidl, other: 'conad0001' });
    op({ k: 'item.add', id: 'milk00001', listId: lidl, name: 'Milk', shared: true });
    op({ k: 'item.delete', ids: ['milk00001'], listId: 'conad0001' });
    expect(store.activity(uid, 'conad0001').some((a) => a.action === 'item.delete')).toBe(true);
  });

  it('restoring a list respects the list limit', () => {
    const { op, lidl } = setup();
    op({ k: 'list.add', id: 'gone00001', name: 'Gone', pos: 2 });
    op({ k: 'list.delete', id: 'gone00001' });
    for (let i = 0; i < 9; i++) op({ k: 'list.add', id: `full${String(i).padStart(5, '0')}`, name: `L${i}`, pos: i + 3 });
    expect(() => op({ k: 'list.restore', id: 'gone00001' })).toThrow(/too many lists/);
    expect(lidl).toBeTruthy();
  });

  it('cleaning up removes the groups of deleted lists, too', () => {
    const { store, uid, op } = setup();
    op({ k: 'list.add', id: 'gone00001', name: 'Gone', pos: 2 });
    op({ k: 'group.add', id: 'ggone0001', listId: 'gone00001', name: 'G' });
    op({ k: 'list.delete', id: 'gone00001' });
    expect(store.snapshot(uid).groups).toHaveLength(0); // not shown meanwhile
    store.cleanup(Date.now() + 365 * 86_400_000 * 0 + 30 * 86_400_000);
    expect(store.db.q('SELECT COUNT(*) AS c FROM groups WHERE space_uid = ?').get(uid)?.c ?? 0).toBe(0);
  });

  it('an item added twice while offline and checked off there ends up checked', () => {
    const { devA, devB, opAs, lidl, item, store, uid } = setup();
    opAs(devA, { k: 'item.add', id: 'milk00001', listId: lidl, name: 'Milk', qty: '1' });
    // B was offline: added Milk too and checked it off – both ops arrive later
    const r = opAs(devB, { k: 'item.add', id: 'milkoffb1', listId: lidl, name: 'Milk', qty: '1' });
    expect(r.result.merged).toBe('milk00001');
    opAs(devB, { k: 'item.set', id: 'milkoffb1', fields: { checked: true } });
    expect(item('milk00001')).toMatchObject({ checked: true, qty: '2' });
    expect(store.snapshot(uid).items).toHaveLength(1);
  });

  it('leaving a list group: the copy keeps how often it was bought', () => {
    const { op, lidl, store, uid } = setup();
    op({ k: 'list.add', id: 'conad0001', name: 'Conad', pos: 2 });
    op({ k: 'list.link', id: lidl, other: 'conad0001' });
    op({ k: 'item.add', id: 'milk00001', listId: lidl, name: 'Milk', shared: true });
    for (let i = 0; i < 3; i++) op({ k: 'item.set', id: 'milk00001', fields: { checked: !(i % 2) } });
    op({ k: 'list.unlink', id: 'conad0001' });
    const copy = store.snapshot(uid).items.find((i) => i.listId === 'conad0001');
    expect(copy.bought).toBe(2);
  });
});
