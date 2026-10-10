import { sync, newId } from './sync.svelte.js';
import { toast } from './toast.svelte.js';
import { t } from './i18n.svelte.js';
import { setDeviceName } from './device.js';
import { parseEntry, normalizeName, addAmounts } from '../../../shared/parse.js';
import { groupSet, learnedPlacement, findGroupByName, endPos, listItems } from './model.js';

const v = () => sync.data;
const undoToast = (text, undo) => toast({ text, action: { label: t('undo'), run: undo } });

function baseOf(item, fields) {
  const base = {};
  for (const f of Object.keys(fields)) if (item.meta?.[f]?.v !== undefined) base[f] = item.meta[f].v;
  return base;
}

/** Find or create group (+ subgroup) by name in a list's group set. Returns the deepest id. */
export function ensureGroupPath(list, groupName, subgroupName) {
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
export function addEntry(listId, raw, opts = {}) {
  const parsed = parseEntry(raw);
  if (!parsed.name) return { status: 'empty' };
  const list = v().lists[listId];
  if (!list) return { status: 'empty' };
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
      const fields = done.parked ? { parked: false } : { checked: false };
      if (parsed.qty) fields.amount = { qty: parsed.qty, unit: parsed.unit };
      editItem(done, fields, { silent: true });
      const back = done.parked ? { parked: true } : { checked: true };
      if (!opts.quiet) undoToast(t('toast.reactivated', { name: done.name }), () => editItem(sync.data.items[done.id] ?? done, { ...back, ...(fields.amount && { amount: { qty: done.qty, unit: done.unit } }) }, { silent: true }));
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
  sync.send({ k: 'item.add', id, listId, groupId, name: parsed.name, qty: parsed.qty, unit: parsed.unit, pos: endPos(siblings), force: !!opts.force, learn, ...(opts.parked && { parked: true }) });
  return { status: 'added', id, groupId };
}

export function increaseAmount(item, parsed) {
  const sum = addAmounts({ qty: item.qty, unit: item.unit }, { qty: parsed.qty, unit: parsed.unit }) ?? { qty: item.qty, unit: item.unit };
  const before = { qty: item.qty, unit: item.unit };
  editItem(item, { amount: sum }, { silent: true });
  undoToast(t('toast.amountIncreased', { name: item.name }), () => editItem(sync.data.items[item.id] ?? item, { amount: before }, { silent: true }));
}

export function editItem(item, fields, { learn } = {}) {
  sync.send({ k: 'item.set', id: item.id, fields, base: baseOf(item, fields), ...(learn === false && { learn: false }) });
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
  const rows = items.map((i) => ({ ...i }));
  sync.send({ k: 'item.delete', ids: rows.map((r) => r.id) });
  undoToast(rows.length === 1 ? t('toast.deleted', { name: rows[0].name }) : t('toast.deletedMany', { count: rows.length }), () =>
    sync.send({ k: 'item.restore', ids: rows.map((r) => r.id), rows }),
  );
}

export function restoreItems(ids) {
  sync.send({ k: 'item.restore', ids });
}

/** Checked items leave the list and become inactive (shadow list). */
export function clearChecked(listId) {
  const ids = listItems(v(), listId).filter((i) => i.checked && !i.parked).map((i) => i.id);
  if (!ids.length) return;
  sync.send({ k: 'list.clearChecked', listId });
  undoToast(t('toast.cleared', { count: ids.length }), () => sync.send({ k: 'item.setState', ids, checked: true }));
}

export function clearParked(listId) {
  const rows = listItems(v(), listId).filter((i) => i.parked).map((i) => ({ ...i }));
  if (!rows.length) return;
  sync.send({ k: 'list.clearParked', listId });
  undoToast(t('toast.deletedMany', { count: rows.length }), () => sync.send({ k: 'item.restore', ids: rows.map((r) => r.id), rows }));
}

/** Move an item to the inactive items, or back onto the list. */
export function setParked(item, parked) {
  editItem(item, parked ? { parked: true, checked: false } : { parked: false });
}

// ----- lists -----

export function addList(name, groupMode = 'own') {
  const id = newId();
  const pos = Object.values(v().lists).reduce((m, l) => Math.max(m, l.pos), 0) + 1;
  sync.send({ k: 'list.add', id, name, pos, groupMode });
  return id;
}

export const renameList = (list, name) => sync.send({ k: 'list.update', id: list.id, name });
export const setGroupMode = (list, groupMode) => sync.send({ k: 'list.update', id: list.id, groupMode });

export function deleteList(list, onUndo) {
  const row = { ...list };
  sync.send({ k: 'list.delete', id: list.id });
  undoToast(t('toast.listDeleted', { name: list.name }), () => {
    sync.send({ k: 'list.restore', id: row.id, row });
    onUndo?.(row.id);
  });
}

// ----- groups -----

export function addGroup(list, name, parentId = null) {
  const id = newId();
  const owner = list.groupMode === 'shared' ? null : list.id;
  const siblings = groupSet(v(), list).filter((g) => (g.parentId ?? null) === parentId);
  sync.send({ k: 'group.add', id, listId: owner, parentId, name, pos: endPos(siblings) });
  return id;
}

export const renameGroup = (group, name) => sync.send({ k: 'group.update', id: group.id, name });
export const moveGroup = (group, pos) => sync.send({ k: 'group.update', id: group.id, pos });

export function deleteGroup(group) {
  const all = Object.values(v().groups);
  const rows = [group, ...all.filter((g) => g.parentId === group.id)].map((g) => ({ ...g }));
  const ids = new Set(rows.map((r) => r.id));
  const moves = Object.values(v().items).filter((i) => ids.has(i.groupId)).map((i) => ({ id: i.id, groupId: i.groupId }));
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
