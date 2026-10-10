import { normalizeName } from '../../../shared/parse.js';
import { scopeOf } from './sync.svelte.js';

const byPos = (a, b) => a.pos - b.pos || (a.id < b.id ? -1 : 1);

export function sortedLists(v) {
  return Object.values(v.lists).sort(byPos);
}

/** Groups visible in a list: own groups, or the space's shared set. */
export function groupSet(v, list) {
  if (!list) return [];
  const owner = list.groupMode === 'shared' ? null : list.id;
  return Object.values(v.groups).filter((g) => g.listId === owner);
}

/**
 * Tree for rendering: { ungrouped: Item[], groups: [{group, items, subs: [{group, items}]}] }
 * Unchecked items first (by position), checked ones at the end of each block.
 */
export function listTree(v, list) {
  const groups = groupSet(v, list);
  const ids = new Set(groups.map((g) => g.id));
  const itemsBy = new Map();
  for (const it of Object.values(v.items)) {
    if (it.listId !== list.id) continue;
    const key = it.groupId && ids.has(it.groupId) ? it.groupId : '';
    if (!itemsBy.has(key)) itemsBy.set(key, []);
    itemsBy.get(key).push(it);
  }
  const sortItems = (arr = []) => arr.sort((a, b) => (a.checked - b.checked) || byPos(a, b));
  const top = groups.filter((g) => !g.parentId || !ids.has(g.parentId)).sort(byPos);
  return {
    ungrouped: sortItems(itemsBy.get('')),
    groups: top.map((g) => ({
      group: g,
      items: sortItems(itemsBy.get(g.id)),
      subs: groups
        .filter((s) => s.parentId === g.id)
        .sort(byPos)
        .map((s) => ({ group: s, items: sortItems(itemsBy.get(s.id)) })),
    })),
  };
}

export function listItems(v, listId) {
  return Object.values(v.items).filter((it) => it.listId === listId);
}

export function progress(v, listId) {
  const items = listItems(v, listId);
  return { done: items.filter((i) => i.checked).length, total: items.length };
}

/** Next position at the end of a container. */
export function endPos(items) {
  return items.reduce((m, i) => Math.max(m, i.pos ?? 0), 0) + 1;
}

export function posBetween(before, after) {
  if (before == null && after == null) return Date.now();
  if (before == null) return after - 1;
  if (after == null) return before + 1;
  return (before + after) / 2;
}

/** Learned placement for a name in a list → { group, subgroup } names or null. */
export function learnedPlacement(v, list, name) {
  if (!list) return null;
  const m = v.memory[`${scopeOf(list)}|${normalizeName(name)}`];
  return m && m.group ? m : null;
}

export function findGroupByName(v, list, name, parentId = null) {
  const n = name.toLowerCase();
  return groupSet(v, list).find((g) => (g.parentId ?? null) === parentId && g.name.toLowerCase() === n) ?? null;
}

export function groupLabel(v, groupId) {
  const g = groupId ? v.groups[groupId] : null;
  if (!g) return '';
  const parent = g.parentId ? v.groups[g.parentId] : null;
  return parent ? `${parent.name} › ${g.name}` : g.name;
}

/** Flat list for pickers: top-level groups each followed by their subgroups. */
export function groupOptions(v, list) {
  const set = groupSet(v, list);
  const out = [];
  for (const g of set.filter((g) => !g.parentId).sort(byPos)) {
    out.push({ id: g.id, label: g.name, depth: 0 });
    for (const s of set.filter((s) => s.parentId === g.id).sort(byPos)) out.push({ id: s.id, label: s.name, depth: 1, parent: g.name });
  }
  return out;
}

export function suggestionsFor(v, list, query, limit = 6) {
  const q = normalizeName(query);
  if (!q) return [];
  const onList = new Set(listItems(v, list.id).filter((i) => !i.checked).map((i) => normalizeName(i.name)));
  const scored = [];
  const now = Date.now();
  for (const s of Object.values(v.suggestions)) {
    const idx = s.norm.indexOf(q);
    if (idx < 0 || s.norm === q) continue;
    const ageDays = (now - s.lastUsedAt) / 86_400_000;
    const score = (idx === 0 ? 100 : s.norm.includes(` ${q}`) ? 60 : 20) + Math.min(s.uses, 30) * 2 - Math.min(ageDays, 60) / 3;
    scored.push({ ...s, score, onList: onList.has(s.norm), placement: learnedPlacement(v, list, s.name) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export const isShopping = (d) => !!d?.shoppingUntil && d.shoppingUntil > Date.now();
