import { describe, it, expect } from 'vitest';
import { parseEntry, normalizeName, addAmounts, splitLines, splitPrio } from '../shared/parse.js';
import { parseSpaceId, formatSpaceId, randomSpaceId } from '../shared/ids.js';
import { webcrypto } from 'node:crypto';

describe('parseEntry', () => {
  const cases = [
    ['Milch', 'Milch', '', ''],
    ['3 Äpfel', 'Äpfel', '3', ''],
    ['500g Hack', 'Hack', '500', 'g'],
    ['500 g Hack', 'Hack', '500', 'g'],
    ['200gr Hackfleisch', 'Hackfleisch', '200', 'g'],
    ['200 gr. Hackfleisch', 'Hackfleisch', '200', 'g'],
    ['Hackfleisch 200gr', 'Hackfleisch', '200', 'g'],
    ['250 Gramm Butter', 'Butter', '250', 'g'],
    ['2 grüne Paprika', 'grüne Paprika', '2', ''],
    ['1,5 l Milch', 'Milch', '1.5', 'l'],
    ['2x Milch', 'Milch', '2', ''],
    ['2 x Milch', 'Milch', '2', ''],
    ['Milch x2', 'Milch', '2', ''],
    ['Milch 2x', 'Milch', '2', ''],
    ['Hack 500g', 'Hack', '500', 'g'],
    ['7up', '7up', '', ''],
    ['4711 Kölnisch Wasser', 'Kölnisch Wasser', '4711', ''],
    ['Glasreiniger', 'Glasreiniger', '', ''],
    ['2 Dosen Tomaten', 'Tomaten', '2', 'dosen'],
    ['  eggs   12x ', 'eggs', '12', ''],
  ];
  for (const [input, name, qty, unit] of cases) {
    it(input, () => expect(parseEntry(input)).toEqual({ name, qty, unit }));
  }
});

describe('importance shortcuts', () => {
  const cases = [
    ['!Windeln', 1, 'Windeln'],
    ['! Windeln', 1, 'Windeln'], // phone keyboards add a space after "!"
    ['!  2 Windeln', 1, '2 Windeln'],
    ['?Basilikum', -1, 'Basilikum'],
    ['? Basilikum', -1, 'Basilikum'],
    ['Milch!', 0, 'Milch!'],
    ['Milch', 0, 'Milch'],
    ['!', 0, '!'], // nothing behind the mark – not a shortcut
  ];
  for (const [raw, prio, text] of cases) it(raw, () => expect(splitPrio(raw)).toEqual({ prio, text }));
});

describe('helpers', () => {
  it('normalizes names', () => expect(normalizeName('  Hafer   Milch ')).toBe('hafer milch'));
  it('adds amounts', () => {
    expect(addAmounts({ qty: '2', unit: '' }, { qty: '3', unit: '' })).toEqual({ qty: '5', unit: '' });
    expect(addAmounts({ qty: '', unit: '' }, { qty: '', unit: '' })).toEqual({ qty: '', unit: '' });
    expect(addAmounts({ qty: '', unit: '' }, { qty: '2', unit: '' })).toEqual({ qty: '3', unit: '' });
    expect(addAmounts({ qty: '500', unit: 'g' }, { qty: '1', unit: 'kg' })).toBeNull();
  });
  it('splits pasted lines', () => {
    expect(splitLines('- Milch\n* Brot\n\n1. Eier\n[x] Käse\n• Butter')).toEqual(['Milch', 'Brot', 'Eier', 'Käse', 'Butter']);
  });
});

describe('space ids', () => {
  it('parses with separators and look-alikes', () => {
    expect(parseSpaceId('k7qm-2xpa-9f')).toBe('K7QM2XPA9F');
    expect(parseSpaceId('o1lI-0000-00')).toBe('0111000000');
    expect(parseSpaceId('https://shop.example/K7QM2XPA9F')).toBe('K7QM2XPA9F');
    expect(parseSpaceId('https://shop.example/K7QM-2XPA-9F')).toBe('K7QM2XPA9F');
    expect(parseSpaceId('K7QM2XPA9')).toBeNull();
    expect(parseSpaceId('K7QM2XPA9U')).toBeNull();
    expect(parseSpaceId('https://shop.example/K7QM-2XPA-9F/')).toBe('K7QM2XPA9F');
    expect(parseSpaceId('/K7QM2XPA9F')).toBe('K7QM2XPA9F');
    expect(parseSpaceId('shop.example/K7QM 2XPA 9F')).toBe('K7QM2XPA9F');
  });
  it('costs linear time on hostile input (no catastrophic backtracking)', () => {
    // 'a'×45+'!' used to take over a minute; 'a'×100+'!' must be instant
    for (const n of [45, 100, 255]) {
      const t = performance.now();
      expect(parseSpaceId('a'.repeat(n) + '!')).toBeNull();
      expect(parseSpaceId('https://x/' + 'a-'.repeat(n / 2) + '!')).toBeNull();
      expect(performance.now() - t).toBeLessThan(50);
    }
    expect(parseSpaceId('K7QM2XPA9F'.padEnd(257, '/'))).toBeNull(); // over the input cap
    expect(parseSpaceId('K7QM2XPA9F'.padEnd(256, '/'))).toBe('K7QM2XPA9F'); // at the cap
  });
  it('formats', () => expect(formatSpaceId('K7QM2XPA9F')).toBe('K7QM-2XPA-9F'));
  it('generates valid ids', () => {
    for (let i = 0; i < 100; i++) {
      const id = randomSpaceId((b) => webcrypto.getRandomValues(b));
      expect(parseSpaceId(id)).toBe(id);
    }
  });
});

import { stepAmount } from '../shared/parse.js';
describe('stepAmount', () => {
  it('counts a missing amount as 1', () => {
    expect(stepAmount('', '', 1)).toEqual({ qty: '2', unit: '' });
    expect(stepAmount('', '', -1)).toBeNull();
    expect(stepAmount('2', '', -1)).toEqual({ qty: '', unit: '' });
    expect(stepAmount('3', 'dosen', -1)).toEqual({ qty: '2', unit: 'dosen' });
  });
  it('uses steps of 100 for g and ml', () => {
    expect(stepAmount('500', 'g', 1)).toEqual({ qty: '600', unit: 'g' });
    expect(stepAmount('250', 'g', 1)).toEqual({ qty: '300', unit: 'g' });
    expect(stepAmount('200', 'ml', -1)).toEqual({ qty: '100', unit: 'ml' });
    expect(stepAmount('100', 'g', -1)).toBeNull();
    expect(stepAmount('1.5', 'kg', 1)).toEqual({ qty: '2.5', unit: 'kg' });
  });
});
