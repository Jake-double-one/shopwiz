// ShopWiz backup format: a plain Markdown file that is easy to read and edit by hand.
//
//   # Home                      ← name of the ID (optional)
//   ## Weekly shop              ← list
//   > 📍 Via Roma 1, Olbia      ← optional shop address of the list
//   - [ ] Bread                 ← open item without group
//   ### Fridge                  ← group
//   - [ ] 2 l Milk // lactose free   ← amount, name and a note after //
//   (#### headings from older backups are read as groups, too)
//   - [x] Butter                ← checked
//   - [-] Feta                  ← inactive (shadow list)
//   - [ ] ! Diapers             ← "!" important, "?" not important
//   > ✈️ IT it                   ← optional travel mode of the list: country and language
//   - [ ] Milk → Latte          ← translation of the name (lists in travel mode)
//   > 🔗 Conad 1, Conad 2       ← list group: shared items are on these lists, too
//   - [ ] ↯ Charcoal            ← in a list group: only on this list
//
// For import, plain lines ("Milk", "- Milk", "* 2 Milk") work as well.

import { parseEntry, splitPrio, normalizeName } from './parse.js';
import { COUNTRY_LANGS, LANG_RE } from './countries.js';

export const BACKUP_MARKER = 'shopwiz-backup';

const byPos = (a, b) => a.pos - b.pos;

const TRAVEL_RE = /^>\s*✈\uFE0F?\s*([A-Za-z]{2})[\s·,/]+([A-Za-z]{2,3}(?:-[A-Za-z]{2})?)\s*$/u;
const ARROW = ' → ';

const LINK_RE = /^>\s*🔗\s*(.+)$/u;
const LOCAL = '↯ ';

function itemLine(it, tr = '', linked = false) {
  const box = it.parked ? '-' : it.checked ? 'x' : ' ';
  let text = it.name;
  const amount = [it.qty, it.unit].filter(Boolean).join(' ');
  // quotes keep names intact that would otherwise be read differently: a number at the start
  // (e.g. "4711 …") would become an amount, a leading ! or ? the priority, // a note, → a translation
  const read = parseEntry(amount ? `${amount} ${text}` : text);
  const changes = read.name !== text || (read.qty || '') !== (it.qty || '') || (read.unit || '') !== (it.unit || '');
  if (changes || /^[!?"↯]|"$|\/\/|→/.test(text)) text = `"${text}"`;
  if (amount) text = `${amount} ${text}`;
  const note = (it.note || '').replace(/\s*\n\s*/g, ' ').trim();
  const mark = it.prio > 0 ? '! ' : it.prio < 0 ? '? ' : '';
  const trans = tr.replace(/\s+/g, ' ').replace(/\/\//g, '/').trim();
  const local = linked && !it.shared ? LOCAL : '';
  return `- [${box}] ${mark}${local}${text}${trans ? `${ARROW}${trans}` : ''}${note ? ` // ${note}` : ''}`;
}

/**
 * Build the Markdown backup from the app state.
 * v: { space, lists, groups, items }, listIds: optional subset of lists to export.
 */
export function toMarkdown(v, { listIds = null, date = new Date() } = {}) {
  const out = [];
  out.push(`# ${v.space?.name ?? 'ShopWiz'}`);
  out.push(`<!-- ${BACKUP_MARKER} v1 · ${date.toISOString().slice(0, 10)} · [ ] open · [x] checked · [-] inactive · ! important · ? not important · ↯ only on this list of a 🔗 list group · text after → is the translation, after // a note -->`);
  const lists = Object.values(v.lists)
    .filter((l) => !listIds || listIds.includes(l.id))
    .sort(byPos);
  const items = Object.values(v.items);
  for (const list of lists) {
    out.push('', `## ${list.name}`);
    if (list.address) out.push(`> 📍 ${list.address.replace(/\s*\n\s*/g, ' ')}`);
    const lang = list.travel?.lang;
    if (lang) out.push(`> ✈️ ${list.travel.country} ${lang}`);
    const partners = list.linkId ? Object.values(v.lists).filter((l) => l.linkId === list.linkId && l.id !== list.id).sort(byPos) : [];
    if (partners.length) out.push(`> 🔗 ${partners.map((l) => l.name.replace(/,/g, ' ')).join(', ')}`);
    const line = (it) => itemLine(it, (lang && v.translations?.[`${normalizeName(it.name)}|${lang}`]?.text) || '', partners.length > 0);
    const owner = list.groupMode === 'shared' ? null : list.id;
    const groups = Object.values(v.groups).filter((g) => g.listId === owner);
    const ids = new Set(groups.map((g) => g.id));
    const mine = items.filter((i) => i.listId === list.id);
    const block = (groupId) => mine.filter((i) => (groupId ? i.groupId === groupId : !i.groupId || !ids.has(i.groupId))).sort(byPos);
    for (const it of block(null)) out.push(line(it));
    for (const g of groups.filter((x) => !x.parentId).sort(byPos)) {
      out.push('', `### ${g.name}`);
      for (const it of block(g.id)) out.push(line(it));
      for (const s of groups.filter((x) => x.parentId === g.id).sort(byPos)) {
        out.push('', `#### ${s.name}`);
        for (const it of block(s.id)) out.push(line(it));
      }
    }
  }
  return `${out.join('\n')}\n`;
}

const ITEM_RE = /^\s*(?:[-*+•]|\d+[.)])\s+(?:\[([ xX\-~])\]\s+)?(.*)$/;
const BOX_RE = /^\s*\[([ xX\-~])\]\s+(.*)$/;

/**
 * Parse a Markdown/plain-text list. Returns
 * { spaceName, lists: [{ name, address?, travel?: { country, lang }, link?: [list names], items: [{ name, qty, unit, note, state, group, subgroup, prio?, translation?, local? }] }] }.
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
    // a backup line is short – a huge one is cut instead of keeping the parser busy
    let line = rawLine.slice(0, 2000).trim();
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    if (line.startsWith('<!--')) {
      if (!line.includes('-->')) inComment = true;
      continue;
    }
    const trv = line.match(TRAVEL_RE);
    if (trv) {
      const country = trv[1].toUpperCase();
      const [base, region] = trv[2].split('-');
      const lang = region ? `${base.toLowerCase()}-${region.toUpperCase()}` : base.toLowerCase();
      if (list && COUNTRY_LANGS[country] && LANG_RE.test(lang)) list.travel = { country, lang };
      continue;
    }
    const link = line.match(LINK_RE);
    if (link) {
      if (list) list.link = link[1].split(',').map((n) => n.trim()).filter(Boolean);
      continue;
    }
    const addr = line.match(/^>\s*📍\s*(.+)$/u);
    if (addr) {
      if (list) list.address = addr[1].trim();
      continue;
    }
    if (!line || /^(-{3,}|\*{3,}|_{3,})$/.test(line) || line.startsWith('>')) continue;
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const title = h[2].trim();
      if (h[1].length === 1) {
        if (!doc.spaceName) doc.spaceName = title;
      } else if (h[1].length === 2) ensureList(title);
      else {
        // ### group – and #### (subgroups of older versions) is a group as well
        if (!list) ensureList('');
        group = title;
        subgroup = '';
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
    const pr = splitPrio(body.trim());
    let rest = pr.text.trim();
    const local = rest.startsWith(LOCAL);
    if (local) rest = rest.slice(LOCAL.length).trim();
    let entry = null;
    // "quoted name", optionally after an amount: 2 l "4711 Cologne" → translation // note
    const quoted = rest.match(/^(.*?)"(.+?)"(?=$| → | \/\/ )(.*)$/s);
    if (quoted) {
      const pre = quoted[1].trim();
      const amount = pre ? parseEntry(`${pre} x`) : null;
      if (!pre || (amount.name === 'x' && amount.qty)) {
        entry = { name: quoted[2], qty: amount?.qty ?? '', unit: amount?.unit ?? '' };
        rest = quoted[3];
      }
    }
    let note = '';
    const cut = rest.indexOf(' // ');
    if (cut >= 0) {
      note = rest.slice(cut + 4).trim();
      rest = rest.slice(0, cut);
    }
    let translation = '';
    const arrow = rest.indexOf(ARROW);
    if (arrow >= 0) {
      translation = rest.slice(arrow + ARROW.length).trim();
      rest = rest.slice(0, arrow);
    }
    entry ??= parseEntry(rest.trim());
    if (!entry.name) continue;
    if (!list) ensureList('');
    list.items.push({ ...entry, note, state, group, subgroup, ...(pr.prio && { prio: pr.prio }), ...(translation && { translation }), ...(local && { local: true }) });
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
