// ShopWiz backup format: a plain Markdown file that is easy to read and edit by hand.
//
//   # Home                      ← name of the ID (optional)
//   ## Weekly shop              ← list
//   - [ ] Bread                 ← open item without group
//   ### Fridge                  ← group
//   #### Dairy                  ← subgroup
//   - [ ] 2 l Milk // lactose free   ← amount, name and a note after //
//   - [x] Butter                ← checked
//   - [-] Feta                  ← inactive (shadow list)
//
// For import, plain lines ("Milk", "- Milk", "* 2 Milk") work as well.

import { parseEntry } from './parse.js';

export const BACKUP_MARKER = 'shopwiz-backup';

const byPos = (a, b) => a.pos - b.pos;

function itemLine(it) {
  const box = it.parked ? '-' : it.checked ? 'x' : ' ';
  let text = it.name;
  const amount = [it.qty, it.unit].filter(Boolean).join(' ');
  // keep names that start with a number (e.g. "4711 …") from being read as an amount
  if (!amount && parseEntry(text).qty) text = `"${text}"`;
  if (amount) text = `${amount} ${text}`;
  const note = (it.note || '').replace(/\s*\n\s*/g, ' ').trim();
  return `- [${box}] ${text}${note ? ` // ${note}` : ''}`;
}

/**
 * Build the Markdown backup from the app state.
 * v: { space, lists, groups, items }, listIds: optional subset of lists to export.
 */
export function toMarkdown(v, { listIds = null, date = new Date() } = {}) {
  const out = [];
  out.push(`# ${v.space?.name ?? 'ShopWiz'}`);
  out.push(`<!-- ${BACKUP_MARKER} v1 · ${date.toISOString().slice(0, 10)} · [ ] open · [x] checked · [-] inactive · text after // is a note -->`);
  const lists = Object.values(v.lists)
    .filter((l) => !listIds || listIds.includes(l.id))
    .sort(byPos);
  const items = Object.values(v.items);
  for (const list of lists) {
    out.push('', `## ${list.name}`);
    const owner = list.groupMode === 'shared' ? null : list.id;
    const groups = Object.values(v.groups).filter((g) => g.listId === owner);
    const ids = new Set(groups.map((g) => g.id));
    const mine = items.filter((i) => i.listId === list.id);
    const block = (groupId) => mine.filter((i) => (groupId ? i.groupId === groupId : !i.groupId || !ids.has(i.groupId))).sort(byPos);
    for (const it of block(null)) out.push(itemLine(it));
    for (const g of groups.filter((x) => !x.parentId).sort(byPos)) {
      out.push('', `### ${g.name}`);
      for (const it of block(g.id)) out.push(itemLine(it));
      for (const s of groups.filter((x) => x.parentId === g.id).sort(byPos)) {
        out.push('', `#### ${s.name}`);
        for (const it of block(s.id)) out.push(itemLine(it));
      }
    }
  }
  return `${out.join('\n')}\n`;
}

const ITEM_RE = /^\s*(?:[-*+•]|\d+[.)])\s+(?:\[([ xX\-~])\]\s+)?(.*)$/;
const BOX_RE = /^\s*\[([ xX\-~])\]\s+(.*)$/;

/**
 * Parse a Markdown/plain-text list. Returns
 * { spaceName, lists: [{ name, items: [{ name, qty, unit, note, state, group, subgroup }] }] }.
 * Items before the first "## list" heading get list name '' (= the current list on import).
 */
export function parseMarkdown(text) {
  const doc = { spaceName: '', lists: [] };
  let list = null;
  let group = '';
  let subgroup = '';
  const ensureList = (name) => {
    list = { name, items: [] };
    doc.lists.push(list);
    group = '';
    subgroup = '';
  };
  let inComment = false;
  for (const rawLine of String(text ?? '').replace(/^﻿/, '').split(/\r?\n/)) {
    let line = rawLine.trim();
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    if (line.startsWith('<!--')) {
      if (!line.includes('-->')) inComment = true;
      continue;
    }
    if (!line || /^(-{3,}|\*{3,}|_{3,})$/.test(line) || line.startsWith('>')) continue;
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const title = h[2].trim();
      if (h[1].length === 1) {
        if (!doc.spaceName) doc.spaceName = title;
      } else if (h[1].length === 2) ensureList(title);
      else if (h[1].length === 3) {
        if (!list) ensureList('');
        group = title;
        subgroup = '';
      } else {
        if (!list) ensureList('');
        subgroup = group ? title : '';
        if (!group) group = title;
      }
      continue;
    }
    let state = 'open';
    let body = line;
    const m = line.match(ITEM_RE) ?? line.match(BOX_RE);
    if (m) {
      const box = m[1];
      if (box === 'x' || box === 'X') state = 'checked';
      else if (box === '-' || box === '~') state = 'parked';
      body = m[2];
    }
    let note = '';
    const cut = body.indexOf(' // ');
    if (cut >= 0) {
      note = body.slice(cut + 4).trim();
      body = body.slice(0, cut);
    }
    body = body.trim();
    let entry;
    const quoted = body.match(/^(.*?)"(.+)"$/);
    if (quoted) {
      const amount = parseEntry(`${quoted[1].trim()} x`);
      entry = { name: quoted[2], qty: quoted[1].trim() ? amount.qty : '', unit: quoted[1].trim() ? amount.unit : '' };
    } else entry = parseEntry(body);
    if (!entry.name) continue;
    if (!list) ensureList('');
    list.items.push({ ...entry, note, state, group, subgroup });
  }
  return doc;
}

export function docStats(doc) {
  const items = doc.lists.flatMap((l) => l.items);
  return {
    lists: doc.lists.filter((l) => l.name).length,
    items: items.length,
    open: items.filter((i) => i.state === 'open').length,
    checked: items.filter((i) => i.state === 'checked').length,
    parked: items.filter((i) => i.state === 'parked').length,
  };
}
