import { describe, it, expect } from 'vitest';
import { toMarkdown, parseMarkdown, docStats } from '../shared/backup.js';

const v = {
  space: { name: 'Home' },
  lists: { l1: { id: 'l1', name: 'Weekly', pos: 1, groupMode: 'own', address: 'Via Roma 1, Olbia' }, l2: { id: 'l2', name: 'DIY', pos: 2, groupMode: 'own' } },
  groups: {
    g1: { id: 'g1', listId: 'l1', parentId: null, name: 'Fridge', pos: 1 },
    g2: { id: 'g2', listId: 'l1', parentId: null, name: 'Dairy', pos: 2 },
  },
  items: {
    a: { id: 'a', listId: 'l1', groupId: null, name: 'Bread', qty: '', unit: '', note: '', checked: false, parked: false, prio: 1, pos: 1 },
    b: { id: 'b', listId: 'l1', groupId: 'g2', name: 'Milk', qty: '2', unit: 'l', note: 'lactose free', checked: false, parked: false, pos: 1 },
    c: { id: 'c', listId: 'l1', groupId: 'g2', name: 'Butter', qty: '', unit: '', note: '', checked: true, parked: false, pos: 2 },
    d: { id: 'd', listId: 'l1', groupId: 'g1', name: 'Feta', qty: '200', unit: 'g', note: '', checked: false, parked: true, pos: 3 },
    e: { id: 'e', listId: 'l2', groupId: null, name: '4711 Cologne', qty: '', unit: '', note: '', checked: false, parked: false, pos: 1 },
  },
};

describe('backup', () => {
  it('writes readable markdown', () => {
    const md = toMarkdown(v, { date: new Date('2026-10-10') });
    expect(md).toContain('# Home');
    expect(md).toContain('## Weekly\n> 📍 Via Roma 1, Olbia\n- [ ] ! Bread');
    expect(md).toContain('### Fridge\n- [-] 200 g Feta');
    expect(md).toContain('### Dairy\n- [ ] 2 l Milk // lactose free\n- [x] Butter');
    expect(md).toContain('## DIY\n- [ ] "4711 Cologne"');
  });

  it('round-trips', () => {
    const doc = parseMarkdown(toMarkdown(v));
    expect(doc.spaceName).toBe('Home');
    expect(doc.lists.map((l) => l.name)).toEqual(['Weekly', 'DIY']);
    expect(doc.lists[0].address).toBe('Via Roma 1, Olbia');
    expect(doc.lists[0].items).toEqual([
      { name: 'Bread', qty: '', unit: '', note: '', state: 'open', group: '', subgroup: '', prio: 1 },
      { name: 'Feta', qty: '200', unit: 'g', note: '', state: 'parked', group: 'Fridge', subgroup: '' },
      { name: 'Milk', qty: '2', unit: 'l', note: 'lactose free', state: 'open', group: 'Dairy', subgroup: '' },
      { name: 'Butter', qty: '', unit: '', note: '', state: 'checked', group: 'Dairy', subgroup: '' },
    ]);
    expect(doc.lists[1].items[0].name).toBe('4711 Cologne');
  });

  it('accepts plain text and simple bullet lists', () => {
    const doc = parseMarkdown('Milk\n- 2 Bread\n* Apples // green\n\n1. Coffee\n');
    expect(doc.lists).toHaveLength(1);
    expect(doc.lists[0].name).toBe('');
    expect(doc.lists[0].items.map((i) => [i.name, i.qty, i.note])).toEqual([
      ['Milk', '', ''],
      ['Bread', '2', ''],
      ['Apples', '', 'green'],
      ['Coffee', '', ''],
    ]);
    expect(docStats(doc)).toMatchObject({ items: 4, open: 4, lists: 0 });
  });

  it('ignores comments and handles groups without a list heading', () => {
    const doc = parseMarkdown('<!-- note\nmore -->\n### Bakery\n- [ ] Rolls\n');
    expect(doc.lists[0].items[0]).toMatchObject({ name: 'Rolls', group: 'Bakery' });
  });

  it('reads #### headings of older backups as groups', () => {
    const doc = parseMarkdown('## L\n### Fridge\n#### Dairy\n- [ ] Milk\n');
    expect(doc.lists[0].items[0]).toMatchObject({ name: 'Milk', group: 'Dairy', subgroup: '' });
  });
});
