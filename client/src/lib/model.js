import { normalizeName, formatAmount } from '../../../shared/parse.js';
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

// ----- list groups (Listenverbund) -----

/** The other lists of a list's list group, in list order. */
export function linkedLists(v, list) {
  if (!list?.linkId) return [];
  return sortedLists(v).filter((l) => l.linkId === list.linkId && l.id !== list.id);
}

/** Is the item on this list – its own, or a shared one of the list group? */
export function showsItem(v, list, it) {
  if (it.listId === list.id) return true;
  if (!it.shared || !list.linkId) return false;
  return v.lists[it.listId]?.linkId === list.linkId;
}

/**
 * The item as this list shows it: a shared item of another shop of the list group has its own
 * group and position here. view = the list it is shown in (edits go there).
 */
export function viewItem(v, list, it) {
  if (it.listId === list.id) return it.view === list.id ? it : { ...it, view: list.id };
  const p = it.places?.[list.id];
  return { ...it, view: list.id, groupId: p?.groupId ?? null, pos: p?.pos ?? it.pos };
}

/** Shop name for "bought at …" when the item was checked off in another list. */
export function boughtAt(v, list, it) {
  if (!it.checked || !it.shared || !it.checkedIn || it.checkedIn === list.id) return '';
  return v.lists[it.checkedIn]?.name ?? '';
}

/**
 * Two trees with the same structure:
 * - the active list: only groups that contain items on the list (open or checked),
 * - the inactive part ("shadow list"): inactive items under the same groups, plus empty groups.
 * Shape: { ungrouped: Item[], groups: [{ group, items, subs: [{ group, items }] }] }.
 * In the active tree unchecked items come first – important ones on top, not important ones
 * below the rest – and checked ones at the end of each block.
 */
export function listTree(v, list) {
  const groups = groupSet(v, list);
  const ids = new Set(groups.map((g) => g.id));
  const active = new Map();
  const parked = new Map();
  const all = [];
  for (const it of listItems(v, list.id)) {
    const key = it.groupId && ids.has(it.groupId) ? it.groupId : '';
    const target = it.parked ? parked : active;
    if (!target.has(key)) target.set(key, []);
    target.get(key).push(it);
    if (it.parked) all.push(it);
  }
  const rank = (it) => (it.checked ? 0 : -(it.prio ?? 0));
  const sortActive = (arr = []) => arr.sort((a, b) => a.checked - b.checked || rank(a) - rank(b) || byPos(a, b));
  // inactive items: the ones bought most often first – rarely used ones gather at the end for tidying up
  // (counted since checking off is counted; before that, how often the name was added decides)
  const uses = (it) => it.bought ?? 0;
  const added = (it) => v.suggestions?.[normalizeName(it.name)]?.uses ?? 0;
  const sortParked = (arr = []) => arr.sort((a, b) => uses(b) - uses(a) || added(b) - added(a) || a.name.localeCompare(b.name));
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

/** Items sort in bands (open important → open → open not important → checked); a move only reorders within one band. */
export const orderBand = (it) => (it.parked ? 'p' : it.checked ? 'c' : `o${it.prio ?? 0}`);

/** Position for an item dropped at index in a container shown in order (the item itself not included). */
export function dropPos(item, shown, index) {
  const band = orderBand(item);
  let before = null;
  let after = null;
  for (let i = index - 1; i >= 0; i--) if (orderBand(shown[i]) === band) { before = shown[i].pos; break; }
  for (let i = index; i < shown.length; i++) if (orderBand(shown[i]) === band) { after = shown[i].pos; break; }
  return posBetween(before, after);
}

/** Everything a list shows (as shown there): its own items and the shared ones of its list group. */
export function listItems(v, listId) {
  const list = v.lists[listId];
  if (!list) return [];
  const out = [];
  for (const it of Object.values(v.items)) if (showsItem(v, list, it)) out.push(viewItem(v, list, it));
  return out;
}

/** Items that are actually on the list (not in the inactive shadow list). */
export function activeItems(v, listId) {
  return listItems(v, listId).filter((it) => !it.parked);
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

/** Translation of an item name in travel mode, or ''. */
export const translationOf = (v, name, lang) => (lang && v.translations?.[`${normalizeName(name)}|${lang}`]?.text) || '';

/** Checked in at the shop – ends by itself after an hour without activity (server side). */
export const isShopping = (d, now = Date.now()) => !!d?.shoppingUntil && d.shoppingUntil > now;

/** The list as plain text: name, then one open item per line in shop order. */
export function listAsText(list, tree) {
  const items = [...tree.ungrouped, ...tree.groups.flatMap((n) => n.items)].filter((i) => !i.checked);
  const line = (i) => [formatAmount(i.qty, i.unit), i.name].filter(Boolean).join(' ') + (i.note ? ` (${i.note.replace(/\s+/g, ' ').trim()})` : '');
  return [list.name, '', ...items.map(line)].join('\n');
}
