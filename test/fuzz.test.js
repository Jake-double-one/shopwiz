// Fuzz tests with a fixed seed: random and broken input must be rejected cleanly (OpError), never crash.
import { it, expect } from 'vitest';
import { toMarkdown, parseMarkdown } from '../shared/backup.js';
import { normalizeName } from '../shared/parse.js';
import { openDb } from '../server/db.js';
import { Store, hashToken, OpError } from '../server/core.js';
import { loadConfig } from '../server/config.js';

let s = 7;
const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
const KINDS = 'space.update list.add list.update list.delete list.restore list.clearChecked list.clearParked item.setState group.add group.update group.delete group.restore item.add item.addMany item.set item.delete item.restore translation.set translation.clear suggestion.delete conflict.resolve conflict.dismiss device.rename device.shopping'.split(' ');

it('random and broken ops never crash the store', () => {
  const db = openDb(':memory:');
  const store = new Store(db, loadConfig({}));
  const id = store.createSpace({ name: 'Home', token: 't1', deviceName: 'A' });
  const uid = store.resolve(id, null).space.uid;
  const dev = store.device(uid, hashToken('t1'));
  const ids = () => {
    const snap = store.snapshot(uid);
    return { lists: snap.lists.map((l) => l.id), items: snap.items.map((i) => i.id), groups: snap.groups.map((g) => g.id), conflicts: snap.conflicts.map((c) => c.id) };
  };
  const junk = () => pick([null, undefined, '', ' ', 0, -1, 1e308, NaN, true, [], {}, [1, 2], { a: 1 }, 'x'.repeat(5000), '💥', '\u0000', '__proto__', 'constructor', "'; DROP TABLE items;--", '1e999', '!', '?', '   !   ']);
  const value = (known) => (rand() < 0.6 && known.length ? pick(known) : junk());
  const crashes = [];
  let ok = 0;
  let n = 0;
  for (let i = 0; i < 3000; i++) {
    const k = ids();
    const kind = pick(KINDS);
    const op = { k: kind };
    const fields = ['id', 'listId', 'groupId', 'name', 'pos', 'qty', 'unit', 'note', 'prio', 'parked', 'checked', 'ids', 'fields', 'base', 'text', 'lang', 'names', 'items', 'travel', 'address', 'groupMode', 'prioShortcuts', 'aiWrite', 'ttlDays', 'on', 'index', 'auto', 'provider', 'parentId', 'norm', 'amount', 'rows'];
    for (const f of fields) {
      if (rand() < 0.35) continue;
      if (f === 'id') op.id = rand() < 0.5 ? pick([...k.lists, ...k.items, ...k.groups, ...k.conflicts, 'abcdefghi']) : junk();
      else if (f === 'listId') op.listId = value(k.lists);
      else if (f === 'groupId') op.groupId = value(k.groups);
      else if (f === 'ids') op.ids = rand() < 0.5 ? k.items.slice(0, 3) : junk();
      else if (f === 'fields') op.fields = rand() < 0.6 ? { [pick(['name', 'checked', 'parked', 'prio', 'note', 'groupId', 'amount', 'pos', 'qty'])]: rand() < 0.5 ? junk() : pick(['Milk', true, false, 1, -1, { qty: '2', unit: 'l' }]) } : junk();
      else if (f === 'travel') op.travel = rand() < 0.5 ? pick([{ country: 'IT', lang: 'it' }, null, { country: 'XX' }, { lang: 'it' }]) : junk();
      else if (f === 'items') op.items = rand() < 0.5 ? ['2 Milk', '!Bread', junk()] : junk();
      else if (f === 'lang') op.lang = rand() < 0.5 ? pick(['it', 'de', 'pt-BR']) : junk();
      else if (f === 'name') op.name = rand() < 0.6 ? pick(['Milk', 'Bread', 'ä', '!x']) : junk();
      else op[f] = junk();
    }
    if (['list.add', 'item.add', 'group.add'].includes(kind) && rand() < 0.7) op.id = `r${String(i).padStart(8, '0')}`;
    try {
      store.applyOp(uid, dev, `op${i}`, op, Date.now());
      ok++;
    } catch (e) {
      if (!(e instanceof OpError)) crashes.push(`${kind}: ${e.constructor.name}: ${e.message} ← ${JSON.stringify(op).slice(0, 200)}`);
    }
    n++;
    // snapshot must always work
    if (i % 200 === 0) store.snapshot(uid);
  }
  // import of broken documents
  for (let i = 0; i < 1000; i++) {
    const doc = rand() < 0.2 ? junk() : { lists: rand() < 0.2 ? junk() : [{ name: junk(), address: junk(), travel: rand() < 0.5 ? { country: pick(['IT', 'xx', junk()]), lang: pick(['it', junk()]) } : junk(), items: rand() < 0.2 ? junk() : [junk(), { name: junk(), qty: junk(), unit: junk(), note: junk(), state: junk(), group: junk(), prio: junk(), translation: junk() }, { name: 'Milk', translation: junk() }] }] };
    try {
      store.importDoc(uid, dev, doc, { defaultListId: pick([...ids().lists, junk()]) });
    } catch (e) {
      if (!(e instanceof OpError)) crashes.push(`import: ${e.constructor.name}: ${e.message} ← ${JSON.stringify(doc).slice(0, 200)}`);
    }
  }
  store.snapshot(uid);
  expect(crashes.slice(0, 5)).toEqual([]);
  expect(ok).toBeGreaterThan(n / 10); // the fuzzer did real work, too
});

it('backup lines with odd names, notes and translations read back the same', () => {
  const tok = ['Milch', '→', '//', '!', '?', '2', '4711', 'x2', 'g', 'l', '#', '>', '-', '[x]', '½', 'Ä', '😀', 'a', '*', '1.', '<!--', '-->', '📍', '✈️'];
  const words = (n) => Array.from({ length: 1 + Math.floor(rand() * n) }, () => pick(tok)).join(pick([' ', '', ' '])).replace(/\s+/g, ' ').trim();
  const bad = [];
  for (let i = 0; i < 1500; i++) {
    const name = words(5);
    const it = { id: 'a', listId: 'l', groupId: null, name, qty: rand() < 0.3 ? pick(['2', '0.5', '500']) : '', unit: '', note: rand() < 0.3 ? words(4) : '', checked: rand() < 0.3, parked: false, pos: 1, prio: pick([0, 1, -1]) };
    if (it.qty) it.unit = pick(['', 'g', 'l']);
    const tr = rand() < 0.4 ? words(3) : '';
    const v = { space: { name: 'S' }, lists: { l: { id: 'l', name: 'L', pos: 1, groupMode: 'own', travel: { country: 'IT', lang: 'it' } } }, groups: {}, items: { a: it }, translations: tr ? { [`${normalizeName(name)}|it`]: { text: tr } } : {} };
    const got = parseMarkdown(toMarkdown(v)).lists[0]?.items[0];
    const want = { name, qty: it.qty, unit: it.unit, note: it.note, prio: it.prio, translation: tr.replace(/\/\//g, '/').trim(), state: it.checked ? 'checked' : 'open' };
    const have = got && { name: got.name, qty: got.qty, unit: got.unit, note: got.note, prio: got.prio ?? 0, translation: got.translation ?? '', state: got.state };
    if (JSON.stringify(have) !== JSON.stringify(want)) bad.push({ want, have });
  }
  expect(bad.slice(0, 3)).toEqual([]);
});
