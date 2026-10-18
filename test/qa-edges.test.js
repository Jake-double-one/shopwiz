// Regression tests for the full code review (parsing, backup, assistants): each case was a confirmed bug.
import { describe, it, expect } from 'vitest';
import { parseEntry, splitLines } from '../shared/parse.js';
import { toMarkdown, parseMarkdown } from '../shared/backup.js';
import { detectCountryMatch } from '../shared/countries.js';
import { splitSpoken, createAi } from '../server/ai.js';
import { openDb } from '../server/db.js';
import { Store, hashToken } from '../server/core.js';
import { loadConfig } from '../server/config.js';

const backupOf = (items, lists = [{ id: 'l1', name: 'Weekly', pos: 1 }]) =>
  toMarkdown({
    space: { name: 'Home' },
    lists: Object.fromEntries(lists.map((l) => [l.id, l])),
    groups: {},
    items: Object.fromEntries(items.map((it, i) => [`i${i}`, { id: `i${i}`, listId: 'l1', pos: i, note: '', prio: 0, ...it }])),
  });

describe('full review: parsing and backup', () => {
  it('units of any kind survive a backup round trip', () => {
    const items = [
      { name: 'Milch', qty: '2', unit: 'Liter' },
      { name: 'Bier', qty: '1', unit: 'Kasten' },
      { name: 'Mehl', qty: '', unit: 'kg' },
      { name: 'Saft', qty: '1.5', unit: 'L' },
      { name: '4711 Kölnisch Wasser', qty: '', unit: '' },
    ];
    const back = parseMarkdown(backupOf(items)).lists[0].items;
    for (const it of items) expect(back.find((b) => b.name === it.name)).toMatchObject({ qty: it.qty, unit: it.unit });
  });

  it('fractions and Markdown checklists are read as meant', () => {
    expect(parseEntry('1/2 Zitrone')).toMatchObject({ name: 'Zitrone', qty: '0.5' });
    expect(splitLines('- [ ] Eier\n- [x] Brot\n* [ ] Milch\n1. Butter')).toEqual(['Eier', 'Brot', 'Milch', 'Butter']);
  });

  it('a list group survives a backup when the list names contain commas', () => {
    const md = toMarkdown({
      space: { name: 'Home' },
      lists: { a: { id: 'a', name: 'Conad, Olbia', pos: 1, linkId: 'L' }, b: { id: 'b', name: 'Lidl, Olbia', pos: 2, linkId: 'L' } },
      groups: {},
      items: {},
    });
    const doc = parseMarkdown(md);
    const store = new Store(openDb(':memory:'), loadConfig({}));
    const id = store.createSpace({ name: 'Home', token: 'token-backupbackupbackupbk', deviceName: 'A', listName: 'Other' });
    const uid = store.resolve(id, null).space.uid;
    store.importDoc(uid, store.device(uid, hashToken('token-backupbackupbackupbk')), doc);
    const lists = store.snapshot(uid).lists.filter((l) => l.name.includes('Olbia'));
    expect(lists).toHaveLength(2);
    expect(lists[0].linkId).toBeTruthy();
    expect(lists[0].linkId).toBe(lists[1].linkId);
  });

  it('a bare two-letter code is only a guess (FI = Florence or Finland?), a country name is sure', () => {
    expect(detectCountryMatch('Via Roma 1, 50123 Firenze FI')).toEqual({ code: 'FI', byName: false });
    expect(detectCountryMatch('Via Roma 3, 07026 Olbia, Italia')).toEqual({ code: 'IT', byName: true });
  });
});

describe('full review: assistants', () => {
  it('decimal commas stay inside an item', () => {
    expect(splitSpoken('1,5 l Milch und 2 Brot')).toEqual(['1,5 l Milch', '2 Brot']);
    expect(splitSpoken('Eier, Mehl,Zucker')).toEqual(['Eier', 'Mehl', 'Zucker']);
  });

  it('items are found by their whole name first, amounts with units are read', () => {
    const store = new Store(openDb(':memory:'), loadConfig({}));
    const id = store.createSpace({ name: 'Home', token: 'token-aiaiaiaiaiaiaiaiaiaiai', deviceName: 'A', listName: 'Weekly' });
    const uid = store.resolve(id, null).space.uid;
    store.db.q('UPDATE spaces SET ai_write = 1 WHERE uid = ?').run(uid);
    const ai = createAi({ store, hub: { broadcast() {} }, config: { mcpEnabled: true }, log: console });
    const { key } = store.createAiDevice(uid, 'Bot');
    const ctx = () => ai.auth(key);
    ai.addItems(ctx(), 'Weekly', [{ name: 'Mac and Cheese' }, { name: '4711 Kölnisch Wasser', quantity: '' }, { name: 'Saft', quantity: '2 l' }, 'Brot']);
    const read = () => ai.readList(ctx(), 'Weekly').items;
    expect(read().map((i) => i.name).sort()).toEqual(['4711 Kölnisch Wasser', 'Brot', 'Mac and Cheese', 'Saft']);
    expect(read().find((i) => i.name === 'Saft').amount).toBe('2 l');
    expect(ai.setDone(ctx(), 'Weekly', ['Mac and Cheese', '4711 Kölnisch Wasser'])).toMatchObject({ checked: ['Mac and Cheese', '4711 Kölnisch Wasser'] });
    // spoken text with several items still works when the whole text is no item
    expect(ai.setDone(ctx(), 'Weekly', ['Saft und Brot'])).toMatchObject({ checked: ['Saft', 'Brot'] });
    ai.updateItem(ctx(), 'Weekly', 'Brot', { quantity: '500 g' });
    expect(read().find((i) => i.name === 'Brot').amount).toBe('500 g');
    expect(() => ai.updateItem(ctx(), 'Weekly', 'Brot', { quantity: 'lots' })).toThrow(/not a number/);
  });
});
