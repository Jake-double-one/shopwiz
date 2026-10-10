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
 * Two trees with the same structure:
 * - the active list: only groups that contain items on the list (open or checked),
 * - the inactive part ("shadow list"): inactive items under the same groups, plus empty groups.
 * Shape: { ungrouped: Item[], groups: [{ group, items, subs: [{ group, items }] }] }.
 * In the active tree unchecked items come first, checked ones at the end of each block.
 */
export function listTree(v, list) {
  const groups = groupSet(v, list);
  const ids = new Set(groups.map((g) => g.id));
  const active = new Map();
  const parked = new Map();
  const all = [];
  for (const it of Object.values(v.items)) {
    if (it.listId !== list.id) continue;
    const key = it.groupId && ids.has(it.groupId) ? it.groupId : '';
    const target = it.parked ? parked : active;
    if (!target.has(key)) target.set(key, []);
    target.get(key).push(it);
    if (it.parked) all.push(it);
  }
  const sortActive = (arr = []) => arr.sort((a, b) => a.checked - b.checked || byPos(a, b));
  const sortParked = (arr = []) => arr.sort(byPos);
  const top = groups.filter((g) => !g.parentId || !ids.has(g.parentId)).sort(byPos);
  const subsOf = (g) => groups.filter((s) => s.parentId === g.id).sort(byPos);
  const hasAny = (id) => active.has(id) || parked.has(id);

  const activeGroups = [];
  const shadowGroups = [];
  for (const g of top) {
    const subs = subsOf(g);
    const aSubs = subs.filter((s) => active.has(s.id)).map((s) => ({ group: s, items: sortActive(active.get(s.id)) }));
    if (active.has(g.id) || aSubs.length) activeGroups.push({ group: g, items: sortActive(active.get(g.id)), subs: aSubs });
    // inactive side: subgroups with inactive items, or completely empty ones
    const sSubs = subs.filter((s) => parked.has(s.id) || !hasAny(s.id)).map((s) => ({ group: s, items: sortParked(parked.get(s.id)) }));
    const visibleActive = active.has(g.id) || aSubs.length;
    if (parked.has(g.id) || sSubs.length || !visibleActive) {
      shadowGroups.push({ group: g, items: sortParked(parked.get(g.id)), subs: sSubs });
    }
  }
  return {
    ungrouped: sortActive(active.get('')),
    groups: activeGroups,
    shadow: { ungrouped: sortParked(parked.get('')), groups: shadowGroups },
    parked: all,
  };
}

export function listItems(v, listId) {
  return Object.values(v.items).filter((it) => it.listId === listId);
}

/** Items that are actually on the list (not in the inactive shadow list). */
export function activeItems(v, listId) {
  return Object.values(v.items).filter((it) => it.listId === listId && !it.parked);
}

export function progress(v, listId) {
  const items = activeItems(v, listId);
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
  const onList = new Set(listItems(v, list.id).filter((i) => !i.checked && !i.parked).map((i) => normalizeName(i.name)));
  const inactive = new Set(listItems(v, list.id).filter((i) => i.parked).map((i) => normalizeName(i.name)));
  const scored = [];
  const now = Date.now();
  for (const s of Object.values(v.suggestions)) {
    const idx = s.norm.indexOf(q);
    if (idx < 0 || s.norm === q) continue;
    const ageDays = (now - s.lastUsedAt) / 86_400_000;
    const score = (idx === 0 ? 100 : s.norm.includes(` ${q}`) ? 60 : 20) + Math.min(s.uses, 30) * 2 - Math.min(ageDays, 60) / 3;
    scored.push({ ...s, score, onList: onList.has(s.norm), inactive: inactive.has(s.norm), placement: learnedPlacement(v, list, s.name) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export const isShopping = (d) => !!d?.shoppingUntil && d.shoppingUntil > Date.now();
