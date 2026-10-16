import { describe, it, expect } from 'vitest';
import { openDb } from '../server/db.js';
import { Store, hashToken } from '../server/core.js';
import { loadConfig } from '../server/config.js';
import { toMarkdown, parseMarkdown } from '../shared/backup.js';

const T1 = 'token-aaaaaaaaaaaaaaaaaaaaaa';
let n = 0;
const opId = () => `lop${++n}`;

/** A space with three shops: Lidl, Conad and a DIY store. */
function setup() {
  const db = openDb(':memory:');
  const store = new Store(db, loadConfig({}));
  const id = store.createSpace({ name: 'Home', token: T1, deviceName: 'Phone A', listName: 'Lidl' });
  const uid = store.resolve(id, null).space.uid;
  const dev = store.device(uid, hashToken(T1));
  const op = (o, oid = opId()) => store.applyOp(uid, dev, oid, o, Date.now());
  const lidl = store.snapshot(uid).lists[0].id;
  op({ k: 'list.add', id: 'conad0001', name: 'Conad', pos: 2 });
  op({ k: 'list.add', id: 'diy000001', name: 'DIY', pos: 3 });
  const snap = () => store.snapshot(uid);
  const item = (iid) => snap().items.find((i) => i.id === iid);
  const shows = (listId) => {
    const s = snap();
    const link = s.lists.find((l) => l.id === listId).linkId;
    const linked = new Set(s.lists.filter((l) => link && l.linkId === link).map((l) => l.id));
    return s.items.filter((i) => i.listId === listId || (i.shared && linked.has(i.listId))).map((i) => i.name).sort();
  };
  return { store, uid, dev, op, lidl, conad: 'conad0001', diy: 'diy000001', snap, item, shows };
}

describe('list groups (Listenverbund)', () => {
  it('links symmetrically and shares new items in every list of the group', () => {
    const { op, lidl, conad, diy, snap, shows } = setup();
    op({ k: 'list.link', id: conad, other: lidl });
    const lists = snap().lists;
    expect(lists.find((l) => l.id === lidl).linkId).toBeTruthy();
    expect(lists.find((l) => l.id === lidl).linkId).toBe(lists.find((l) => l.id === conad).linkId);
    expect(lists.find((l) => l.id === diy).linkId).toBeNull();
    op({ k: 'item.add', id: 'mince0001', listId: lidl, name: 'Mince', shared: true });
    op({ k: 'item.add', id: 'charcoal1', listId: lidl, name: 'Charcoal', shared: false });
    expect(shows(conad)).toEqual(['Mince']);
    expect(shows(lidl)).toEqual(['Charcoal', 'Mince']);
    expect(shows(diy)).toEqual([]);
  });

  it('one status for all shops, with the shop it was bought in', () => {
    const { op, lidl, conad, item } = setup();
    op({ k: 'list.link', id: lidl, other: conad });
    op({ k: 'item.add', id: 'mince0001', listId: lidl, name: 'Mince', shared: true });
    op({ k: 'item.set', id: 'mince0001', listId: conad, fields: { checked: true } });
    expect(item('mince0001')).toMatchObject({ checked: true, checkedIn: conad });
    // finishing the shop in Lidl also moves the item bought at Conad to the inactive items
    op({ k: 'list.clearChecked', listId: lidl });
    expect(item('mince0001')).toMatchObject({ checked: false, parked: true, checkedIn: null });
  });

  it('keeps group and order per shop and learns them per shop', () => {
    const { op, lidl, conad, item, snap } = setup();
    op({ k: 'list.link', id: lidl, other: conad });
    op({ k: 'group.add', id: 'gmeatlidl', listId: lidl, name: 'Meat counter' });
    op({ k: 'group.add', id: 'gmeatcona', listId: conad, name: 'Macelleria' });
    op({ k: 'item.add', id: 'mince0001', listId: lidl, name: 'Mince', groupId: 'gmeatlidl', shared: true });
    expect(item('mince0001').places[conad]).toMatchObject({ groupId: null });
    op({ k: 'item.set', id: 'mince0001', listId: conad, fields: { groupId: 'gmeatcona', pos: 5 } });
    expect(item('mince0001')).toMatchObject({ groupId: 'gmeatlidl', places: { [conad]: { groupId: 'gmeatcona', pos: 5 } } });
    expect(snap().memory.find((m) => m.scope === conad && m.norm === 'mince')?.group).toBe('Macelleria');
    // next time Conad knows where it goes
    op({ k: 'item.delete', ids: ['mince0001'] });
    op({ k: 'item.add', id: 'mince0002', listId: lidl, name: 'Mince', groupId: 'gmeatlidl', shared: true });
    expect(item('mince0002').places[conad].groupId).toBe('gmeatcona');
  });

  it('merges duplicates when linking, and undo brings everything back', () => {
    const { op, lidl, conad, item, snap, shows } = setup();
    op({ k: 'item.add', id: 'milklidl1', listId: lidl, name: 'Milk', qty: '1', unit: 'l', note: 'lactose free' });
    op({ k: 'item.add', id: 'milkcona1', listId: conad, name: 'Milk', qty: '2', unit: 'l', prio: 1, note: 'fresh' });
    op({ k: 'item.add', id: 'breadcon1', listId: conad, name: 'Bread', checked: true });
    op({ k: 'item.add', id: 'breadlid1', listId: lidl, name: 'Bread' });
    const r = op({ k: 'list.link', id: lidl, other: conad, share: true }, 'link-op-1');
    expect(r.result).toMatchObject({ linked: 2, mergedItems: 2 });
    expect(r.result._undo).toBeUndefined();
    const milk = snap().items.filter((i) => i.name === 'Milk');
    expect(milk).toHaveLength(1);
    expect(milk[0]).toMatchObject({ qty: '2', unit: 'l', prio: 1, shared: true });
    expect(milk[0].note).toContain('lactose free');
    expect(milk[0].note).toContain('fresh');
    // open beats checked
    expect(snap().items.filter((i) => i.name === 'Bread')).toEqual([expect.objectContaining({ id: 'breadlid1', checked: false })]);
    expect(shows(conad)).toEqual(['Bread', 'Milk']);

    op({ k: 'list.linkUndo', opId: 'link-op-1' });
    expect(snap().lists.every((l) => l.linkId === null)).toBe(true);
    expect(item('milklidl1')).toMatchObject({ qty: '1', note: 'lactose free', shared: false, prio: 0 });
    expect(item('milkcona1')).toMatchObject({ qty: '2', prio: 1 });
    expect(item('breadcon1')).toMatchObject({ checked: true });
  });

  it('"no" keeps existing items on their own list', () => {
    const { op, lidl, conad, shows } = setup();
    op({ k: 'item.add', id: 'milklidl1', listId: lidl, name: 'Milk' });
    op({ k: 'list.link', id: lidl, other: conad, share: false });
    expect(shows(conad)).toEqual([]);
  });

  it('a third list joins the whole group; leaving gives copies, a group of one ends', () => {
    const { op, lidl, conad, diy, snap, shows, item } = setup();
    op({ k: 'list.link', id: lidl, other: conad });
    op({ k: 'list.link', id: diy, other: conad });
    expect(new Set(snap().lists.map((l) => l.linkId)).size).toBe(1);
    op({ k: 'item.add', id: 'mince0001', listId: lidl, name: 'Mince', shared: true, qty: '400', unit: 'g' });
    op({ k: 'item.set', id: 'mince0001', listId: lidl, fields: { checked: true } });
    op({ k: 'list.unlink', id: lidl });
    // Lidl has its own copy, the others keep the shared item
    expect(shows(lidl)).toEqual(['Mince']);
    expect(shows(conad)).toEqual(['Mince']);
    expect(shows(diy)).toEqual(['Mince']);
    const copies = snap().items.filter((i) => i.name === 'Mince');
    expect(copies).toHaveLength(2);
    expect(copies.find((i) => i.listId === lidl)).toMatchObject({ shared: false, checked: true, qty: '400' });
    expect(item('mince0001').listId).toBe(conad);
    op({ k: 'list.unlink', id: diy });
    expect(snap().lists.every((l) => l.linkId === null)).toBe(true);
    expect(shows(conad)).toEqual(['Mince']);
    expect(shows(diy)).toEqual(['Mince']);
    expect(item('mince0001').shared).toBe(false);
  });

  it('"only here" moves a shared item to the list it was changed in', () => {
    const { op, lidl, conad, item, shows } = setup();
    op({ k: 'list.link', id: lidl, other: conad });
    op({ k: 'item.add', id: 'mince0001', listId: lidl, name: 'Mince', shared: true });
    op({ k: 'item.set', id: 'mince0001', listId: conad, fields: { shared: false } });
    expect(item('mince0001')).toMatchObject({ listId: conad, shared: false });
    expect(shows(lidl)).toEqual([]);
    op({ k: 'item.set', id: 'mince0001', listId: conad, fields: { shared: true } });
    expect(shows(lidl)).toEqual(['Mince']);
  });

  it('adding a name the group already has merges instead of a duplicate', () => {
    const { op, lidl, conad, snap } = setup();
    op({ k: 'list.link', id: lidl, other: conad });
    op({ k: 'item.add', id: 'mince0001', listId: lidl, name: 'Mince', shared: true, qty: '400', unit: 'g' });
    const r = op({ k: 'item.add', id: 'mince0002', listId: conad, name: 'Mince', shared: true, qty: '100', unit: 'g' });
    expect(r.result.merged).toBe('mince0001');
    const out = op({ k: 'item.addMany', listId: conad, items: [{ name: 'Eggs' }, { name: 'Mince' }] });
    expect(out.result).toMatchObject({ added: ['Eggs'], merged: ['Mince'] });
    expect(snap().items.find((i) => i.name === 'Eggs')).toMatchObject({ listId: conad, shared: true });
  });

  it('deleting a list of a group leaves the shared items with the others', () => {
    const { op, lidl, conad, shows } = setup();
    op({ k: 'list.link', id: lidl, other: conad });
    op({ k: 'item.add', id: 'mince0001', listId: lidl, name: 'Mince', shared: true });
    op({ k: 'list.delete', id: lidl });
    expect(shows(conad)).toEqual(['Mince']);
  });

  it('backup round trip keeps the list group and "only here" items', () => {
    const { op, lidl, conad, snap, store, uid, dev } = setup();
    op({ k: 'list.link', id: lidl, other: conad });
    op({ k: 'item.add', id: 'mince0001', listId: lidl, name: 'Mince', shared: true });
    op({ k: 'item.add', id: 'charcoal1', listId: lidl, name: 'Charcoal', shared: false });
    const s = snap();
    const md = toMarkdown({ ...s, lists: Object.fromEntries(s.lists.map((l) => [l.id, l])), groups: {}, items: Object.fromEntries(s.items.map((i) => [i.id, i])) });
    expect(md).toContain('> 🔗 Conad');
    expect(md).toContain('- [ ] ↯ Charcoal');
    expect(md).toContain('- [ ] Mince');
    const doc = parseMarkdown(md);
    expect(doc.lists[0]).toMatchObject({ name: 'Lidl', link: ['Conad'] });
    expect(doc.lists[0].items.find((i) => i.name === 'Charcoal').local).toBe(true);

    // into a fresh space
    const id2 = store.createSpace({ name: 'Copy', token: 'token-cccccccccccccccccccccc', deviceName: 'X', listName: 'Other' });
    const uid2 = store.resolve(id2, null).space.uid;
    store.importDoc(uid2, dev, doc);
    const s2 = store.snapshot(uid2);
    const l2 = s2.lists.find((l) => l.name === 'Lidl');
    const c2 = s2.lists.find((l) => l.name === 'Conad');
    expect(l2.linkId).toBeTruthy();
    expect(l2.linkId).toBe(c2.linkId);
    expect(s2.items.find((i) => i.name === 'Mince').shared).toBe(true);
    expect(s2.items.find((i) => i.name === 'Charcoal').shared).toBe(false);
    expect(uid2).not.toBe(uid);
  });
});

describe('list groups for AI assistants', () => {
  it('read_list shows the group, adding reaches every linked list, checking says where', async () => {
    const { createAi } = await import('../server/ai.js');
    const { store, uid, op, lidl, conad, item, snap } = setup();
    op({ k: 'list.link', id: lidl, other: conad });
    op({ k: 'group.add', id: 'gmeatcona', listId: conad, name: 'Macelleria' });
    const ai = createAi({ store, hub: { broadcast() {} }, config: { mcpEnabled: true }, log: console });
    const { key } = store.createAiDevice(uid, 'Claude');
    store.db.q('UPDATE spaces SET ai_write = 1 WHERE uid = ?').run(uid);
    const ctx = () => ai.auth(key);

    expect(ai.listLists(ctx()).lists.find((l) => l.name === 'Lidl').listGroup).toEqual(['Conad']);
    const added = ai.addItems(ctx(), 'Lidl', ['400 g mince', 'charcoal'], {});
    expect(added).toMatchObject({ listGroup: ['Conad'], sharedWithListGroup: true });
    ai.addItems(ctx(), 'Lidl', ['matches'], { onlyThisList: true });
    const read = ai.readList(ctx(), 'Conad');
    expect(read.list.listGroup).toEqual(['Lidl']);
    expect(read.items.map((i) => i.name).sort()).toEqual(['charcoal', 'mince']);

    // moving in Conad changes Conad's place only; checking there shows "bought at Conad" in Lidl
    ai.updateItem(ctx(), 'Conad', 'mince', { group: 'Macelleria' });
    const mince = snap().items.find((i) => i.name === 'mince');
    expect(mince.groupId).toBeNull();
    expect(mince.places[conad].groupId).toBe('gmeatcona');
    ai.setDone(ctx(), 'Conad', ['mince']);
    expect(item(mince.id).checkedIn).toBe(conad);
    expect(ai.readList(ctx(), 'Lidl').items.find((i) => i.name === 'mince')).toMatchObject({ done: true, boughtAt: 'Conad' });
    expect(ai.readList(ctx(), 'Lidl').items.find((i) => i.name === 'matches')).toMatchObject({ onlyThisList: true });
  });
});
