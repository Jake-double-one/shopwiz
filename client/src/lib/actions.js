import { sync, newId } from './sync.svelte.js';
import { toast } from './toast.svelte.js';
import { t, i18n } from './i18n.svelte.js';
import { api } from './api.js';
import { setDeviceName } from './device.js';
import { parseEntry, normalizeName, addAmounts, splitPrio } from '../../../shared/parse.js';
import { groupSet, learnedPlacement, findGroupByName, endPos, listItems, translationOf, listTree, listAsText, showsItem } from './model.js';

const v = () => sync.data;
const undoToast = (text, undo) => toast({ text, action: { label: t('undo'), run: undo } });
/** The item as it is now, still seen from the same list (a shared item of a list group: that shop) */
const current = (item) => ({ ...(sync.data.items[item.id] ?? item), ...(item.view && { view: item.view }) });
/** The stored item without the view of one list – for restoring it as it was */
const stored = (item) => {
  const { view: _v, ...row } = sync.data.items[item.id] ?? item;
  return { ...row };
};
/** Ops with id lists are limited to 300 ids – bigger undos go in parts */
const inParts = (ids, send) => {
  for (let i = 0; i < ids.length; i += 300) send(ids.slice(i, i + 300));
};

function baseOf(item, fields) {
  const base = {};
  for (const f of Object.keys(fields)) if (item.meta?.[f]?.v !== undefined) base[f] = item.meta[f].v;
  return base;
}

/** Find or create group (+ subgroup) by name in a list's group set. Returns the deepest id. */
export function ensureGroupPath(list, groupName, subgroupName) {
  // one level of groups only: an old "group › subgroup" placement means the subgroup
  if (subgroupName) {
    groupName = subgroupName;
    subgroupName = '';
  }
  if (!groupName) return null;
  const owner = list.groupMode === 'shared' ? null : list.id;
  let top = findGroupByName(v(), list, groupName, null);
  if (!top) {
    const id = newId();
    sync.send({ k: 'group.add', id, listId: owner, name: groupName, pos: endPos(groupSet(v(), list).filter((g) => !g.parentId)) });
    top = { id };
  }
  if (!subgroupName) return top.id;
  let sub = findGroupByName(v(), list, subgroupName, top.id);
  if (!sub) {
    const id = newId();
    sync.send({ k: 'group.add', id, listId: owner, parentId: top.id, name: subgroupName, pos: endPos(groupSet(v(), list).filter((g) => g.parentId === top.id)) });
    sub = { id };
  }
  return sub.id;
}

/**
 * Add one entry like "2 Milch". Returns { status: 'added' | 'duplicate' | 'reactivated', ... }.
 * opts.groupId: explicit target group (teaches the list). opts.force: skip duplicate check.
 */
/** "!Milk" / "?Basil" → importance, when the list allows the shortcut */
export function prioFromText(list, raw) {
  return list?.prioShortcuts ? splitPrio(raw) : { prio: 0, text: raw };
}

export function addEntry(listId, raw, opts = {}) {
  const list = v().lists[listId];
  if (!list) return { status: 'empty' };
  const typed = prioFromText(list, raw);
  const prio = typed.prio || opts.prio || 0;
  // opts.exact: name and amount from separate fields (the "new item" dialog) – nothing to read out of the text
  const parsed = opts.exact ? { name: typed.text.trim(), qty: opts.exact.qty ?? '', unit: opts.exact.unit ?? '', prio } : { ...parseEntry(typed.text), prio };
  const note = (opts.note ?? '').trim();
  if (!parsed.name) return { status: 'empty' };
  const norm = normalizeName(parsed.name);
  const same = listItems(v(), listId).filter((i) => normalizeName(i.name) === norm);
  if (!opts.force) {
    if (opts.parked) {
      // adding to the inactive items: something with that name exists already → nothing to do
      const any = same[0];
      if (any) return { status: 'exists', existing: any };
    }
    const open = same.find((i) => !i.checked && !i.parked);
    if (open) return { status: 'duplicate', existing: open, parsed };
    // checked or inactive → simply bring it back
    const done = same.find((i) => i.checked) ?? same.find((i) => i.parked);
    if (done) {
      const fields = { ...(done.parked ? { parked: false } : { checked: false }), ...detailFields(done, parsed, opts, note) };
      editItem(done, fields, { silent: true });
      const back = { ...(done.parked ? { parked: true } : { checked: true }), ...previous(done, fields) };
      if (!opts.quiet) undoToast(t('toast.reactivated', { name: done.name }), () => editItem(current(done), back, { silent: true }));
      return { status: 'reactivated', item: done };
    }
  }
  let groupId = opts.groupId ?? null;
  let learn = !!groupId;
  if (opts.groupId === undefined) {
    const place = learnedPlacement(v(), list, parsed.name);
    if (place) {
      groupId = ensureGroupPath(list, place.group, place.subgroup);
      learn = true;
    }
  }
  const siblings = listItems(v(), listId).filter((i) => (i.groupId ?? null) === groupId);
  const id = newId();
  // in a list group: for every list of it, unless the add bar says "only here"
  const shared = !!list.linkId && opts.shared !== false;
  sync.send({ k: 'item.add', id, listId, groupId, name: parsed.name, qty: parsed.qty, unit: parsed.unit, pos: endPos(siblings), force: !!opts.force, learn, ...(opts.parked && { parked: true }), ...(prio && { prio }), ...(shared && { shared }), ...(note && { note }) });
  return { status: 'added', id, groupId };
}

/**
 * What else an entry changes on an item that is there already: amount, importance, note –
 * and from the "new item" dialog (opts.exact) also its group, list group and a chosen "normal".
 */
function detailFields(item, parsed, opts, note) {
  const f = {};
  if (parsed.qty || (opts.exact && parsed.unit)) f.amount = { qty: parsed.qty, unit: parsed.unit };
  const prio = parsed.prio ?? 0;
  if ((prio || opts.exact) && prio !== (item.prio ?? 0)) f.prio = prio;
  if (note && note !== item.note) f.note = note;
  if (opts.groupId !== undefined && opts.groupId !== (item.groupId ?? null)) f.groupId = opts.groupId;
  if (opts.shared !== undefined && v().lists[item.listId]?.linkId && !!opts.shared !== !!item.shared) f.shared = !!opts.shared;
  return f;
}

/** The values fields had on the item before – for undo. */
function previous(item, fields) {
  const out = {};
  for (const k of Object.keys(fields)) {
    if (k === 'amount') out.amount = { qty: item.qty, unit: item.unit };
    else if (k === 'groupId') out.groupId = item.groupId ?? null;
    else if (k !== 'parked' && k !== 'checked') out[k] = k === 'prio' ? (item.prio ?? 0) : k === 'shared' ? !!item.shared : item[k];
  }
  return out;
}

/** extra: more changes from the "new item" dialog (opts like addEntry's: note, prio, groupId, shared) */
export function increaseAmount(item, parsed, extra = null) {
  const sum = addAmounts({ qty: item.qty, unit: item.unit }, { qty: parsed.qty, unit: parsed.unit }) ?? { qty: item.qty, unit: item.unit };
  const more = extra ? detailFields(item, { ...parsed, qty: '', unit: '' }, { ...extra, exact: true }, (extra.note ?? '').trim()) : parsed.prio && parsed.prio !== (item.prio ?? 0) ? { prio: parsed.prio } : {};
  const fields = { amount: sum, ...more };
  const before = previous(item, fields);
  editItem(item, fields, { silent: true });
  undoToast(t('toast.amountIncreased', { name: item.name }), () => editItem(current(item), before, { silent: true }));
}

/** item.view: the list it is shown in – for a shared item of a list group that shop's place and "bought at". */
export function editItem(item, fields, { learn } = {}) {
  sync.send({ k: 'item.set', id: item.id, fields, base: baseOf(item, fields), ...(item.view && item.view !== item.listId && { listId: item.view }), ...(learn === false && { learn: false }) });
}

export function toggleItem(item) {
  if (!item.checked) navigator.vibrate?.(8);
  editItem(item, { checked: !item.checked });
}

export function moveItem(item, groupId, pos) {
  const fields = { groupId };
  if (pos !== undefined) fields.pos = pos;
  editItem(item, fields);
}

export function deleteItems(items) {
  if (!items.length) return;
  const rows = items.map(stored);
  const where = items[0].view;
  inParts(rows.map((r) => r.id), (ids) => sync.send({ k: 'item.delete', ids, ...(where && { listId: where }) }));
  undoToast(rows.length === 1 ? t('toast.deleted', { name: rows[0].name }) : t('toast.deletedMany', { count: rows.length }), () => restoreRows(rows));
}

function restoreRows(rows) {
  inParts(rows.map((r) => r.id), (ids) => sync.send({ k: 'item.restore', ids, rows: rows.filter((r) => ids.includes(r.id)) }));
}

export function restoreItems(ids) {
  sync.send({ k: 'item.restore', ids });
}

/** Checked items leave the list and become inactive (shadow list). */
export function clearChecked(listId) {
  const ids = listItems(v(), listId).filter((i) => i.checked && !i.parked).map((i) => i.id);
  if (!ids.length) return;
  sync.send({ k: 'list.clearChecked', listId });
  undoToast(t('toast.cleared', { count: ids.length }), () => inParts(ids, (part) => sync.send({ k: 'item.setState', ids: part, checked: true })));
}

export function clearParked(listId) {
  const rows = listItems(v(), listId).filter((i) => i.parked).map(stored);
  if (!rows.length) return;
  sync.send({ k: 'list.clearParked', listId });
  undoToast(t('toast.deletedMany', { count: rows.length }), () => restoreRows(rows));
}

/** Move an item to the inactive items, or back onto the list. */
export function setParked(item, parked, { undo = false } = {}) {
  const before = { parked: !!item.parked, checked: !!item.checked };
  editItem(item, parked ? { parked: true, checked: false } : { parked: false });
  if (undo) undoToast(t(parked ? 'toast.parked' : 'toast.unparked', { name: item.name }), () => editItem(current(item), before));
}

/** Done shopping: checked items become inactive, the check-in ends. */
export function finishShopping(listId, { checkOut = false } = {}) {
  const ids = listItems(v(), listId).filter((i) => i.checked && !i.parked).map((i) => i.id);
  if (ids.length) sync.send({ k: 'list.clearChecked', listId });
  if (checkOut) setShopping(false);
  if (ids.length) undoToast(t('shopping.finished', { count: ids.length }), () => inParts(ids, (part) => sync.send({ k: 'item.setState', ids: part, checked: true })));
  else toast(t('shopping.finishedEmpty'));
}

/** Send the open items as plain text (share dialog of the device, or the clipboard). */
export async function shareListText(list) {
  const text = listAsText(list, listTree(v(), list));
  if (navigator.share && window.isSecureContext) {
    try {
      await navigator.share({ title: list.name, text });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(t('shareText.copied'));
  } catch {
    window.prompt(t('share.copyManual'), text);
  }
}


// ----- lists -----

export function addList(name, groupMode = 'own') {
  const id = newId();
  const pos = Object.values(v().lists).reduce((m, l) => Math.max(m, l.pos), 0) + 1;
  sync.send({ k: 'list.add', id, name, pos, groupMode });
  return id;
}

// ----- list groups (Listenverbund) -----

/** Link a list with another one (and everything that is linked to it). share: existing items, too. */
export function linkLists(list, other, share = true) {
  const opId = sync.send({ k: 'list.link', id: list.id, other: other.id, share });
  pendingLinks.add(opId);
}
/** op ids of links made on this device – their result gets a toast with undo */
export const pendingLinks = new Set();
export function undoLink(opId) {
  sync.send({ k: 'list.linkUndo', opId });
}
export const unlinkList = (list) => sync.send({ k: 'list.unlink', id: list.id });

export const renameList = (list, name) => sync.send({ k: 'list.update', id: list.id, name });
export const setGroupMode = (list, groupMode) => sync.send({ k: 'list.update', id: list.id, groupMode });
export const setAddress = (list, address) => sync.send({ k: 'list.update', id: list.id, address });
export const setPrioShortcuts = (list, on) => sync.send({ k: 'list.update', id: list.id, prioShortcuts: !!on });

// ----- travel mode -----

/** Display name of the server's translation service */
export const translatorName = (p) => ({ mymemory: 'MyMemory', libretranslate: 'LibreTranslate', deepl: 'DeepL', google: 'Google', azure: 'Microsoft' })[p] ?? '';
/** "DeepL → Microsoft": the services in the order they are asked ('' = none) */
export const translatorChain = () => (sync.features.translators ?? []).map(translatorName).filter(Boolean).join(' → ');

/** travel: { country, lang } or null (off) */
export const setTravel = (list, travel) => sync.send({ k: 'list.update', id: list.id, travel });
/** auto: the text is an unchanged machine translation */
export const setTranslation = (name, lang, text, auto = false, provider = null) => sync.send({ k: 'translation.set', name, lang, text, auto, provider });
export const clearTranslations = (names, lang) => sync.send({ k: 'translation.clear', names, lang });

/** Names on the list (active and inactive) that have no translation yet. */
export function missingTranslations(list) {
  const lang = list.travel?.lang;
  if (!lang) return [];
  const names = new Map();
  for (const it of Object.values(v().items)) {
    if (showsItem(v(), list, it) && !translationOf(v(), it.name, lang)) names.set(normalizeName(it.name), it.name);
  }
  return [...names.values()];
}

/** Names on the list that have a translation (to clear them). */
export function translatedNames(list) {
  const lang = list.travel?.lang;
  if (!lang) return [];
  const names = new Map();
  for (const it of Object.values(v().items)) {
    if (showsItem(v(), list, it) && translationOf(v(), it.name, lang)) names.set(normalizeName(it.name), it.name);
  }
  return [...names.values()];
}

/**
 * Machine-translate names via the server (remembered translations are reused there).
 * → { translations: {name: text}, failed, error }
 */
export async function translateNames(names, lang, { force = false } = {}) {
  const out = { translations: {}, by: {}, failed: 0, error: null };
  for (let i = 0; i < names.length; i += 50) {
    try {
      const r = await api.translate(sync.spaceId, { lang, from: i18n.lang, names: names.slice(i, i + 50), force });
      Object.assign(out.translations, r.translations);
      Object.assign(out.by, r.by);
      out.failed += r.failed ?? 0;
    } catch (e) {
      out.error = e.code ?? 'error';
      break;
    }
  }
  return out;
}

export function deleteList(list, onUndo) {
  // a deleted list leaves its list group – it comes back on its own
  const row = { ...list, linkId: null };
  sync.send({ k: 'list.delete', id: list.id });
  undoToast(t('toast.listDeleted', { name: list.name }), () => {
    sync.send({ k: 'list.restore', id: row.id, row });
    onUndo?.(row.id);
  });
}

// ----- groups -----

export function addGroup(list, name) {
  const id = newId();
  const owner = list.groupMode === 'shared' ? null : list.id;
  const siblings = groupSet(v(), list).filter((g) => !g.parentId);
  sync.send({ k: 'group.add', id, listId: owner, name, pos: endPos(siblings) });
  return id;
}

export const renameGroup = (group, name) => sync.send({ k: 'group.update', id: group.id, name });
export const moveGroup = (group, pos) => sync.send({ k: 'group.update', id: group.id, pos });

export function deleteGroup(group) {
  const all = Object.values(v().groups);
  const rows = [group, ...all.filter((g) => g.parentId === group.id)].map((g) => ({ ...g }));
  const ids = new Set(rows.map((r) => r.id));
  const moves = [];
  for (const i of Object.values(v().items)) {
    if (ids.has(i.groupId)) moves.push({ id: i.id, groupId: i.groupId });
    // shared items of a list group placed in this group in another shop
    for (const [listId, p] of Object.entries(i.places ?? {})) if (ids.has(p?.groupId)) moves.push({ id: i.id, groupId: p.groupId, listId });
  }
  sync.send({ k: 'group.delete', id: group.id });
  undoToast(t('toast.groupDeleted', { name: group.name }), () => sync.send({ k: 'group.restore', ids: [...ids], rows, moves }));
}

// ----- conflicts, devices, space -----

export const resolveConflict = (c, index) => sync.send({ k: 'conflict.resolve', id: c.id, index });
export const dismissConflict = (c) => sync.send({ k: 'conflict.dismiss', id: c.id });

export function renameDevice(name) {
  setDeviceName(name);
  sync.send({ k: 'device.rename', name });
}
export const kickDevice = (devId) => sync.send({ k: 'device.kick', devId });
export const setShopping = (on) => sync.send({ k: 'device.shopping', on });
export const deleteSuggestion = (norm) => sync.send({ k: 'suggestion.delete', norm });
export const updateSpace = (fields) => sync.send({ k: 'space.update', ...fields });
