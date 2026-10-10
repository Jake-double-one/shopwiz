// Parsing of quick-entry text like "3 Äpfel", "500g Hack", "Milch x2", "1,5 l Milch".

const UNITS = [
  'kg', 'g', 'mg', 'l', 'ml', 'cl', 'dl', 'oz', 'lb',
  'stk', 'st', 'stück', 'pcs', 'pc', 'pck', 'pkg', 'pack', 'packs', 'pkt',
  'dose', 'dosen', 'can', 'cans', 'fl', 'flasche', 'flaschen', 'bottle', 'bottles',
  'bund', 'bunch', 'glas', 'gläser', 'jar', 'jars', 'becher', 'beutel', 'bag', 'bags',
  'tüte', 'tüten', 'box', 'kiste', 'kisten', 'rolle', 'rollen', 'roll', 'rolls', 'x',
];
const UNIT_RE = UNITS.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const NUM = '(\\d+(?:[.,]\\d+)?|\\d+\\/\\d+|½|¼|¾)';

const LEADING = new RegExp(`^${NUM}\\s*(?:(${UNIT_RE})\\.?(?=\\s|$)|(?=\\s))\\s*(.+)$`, 'iu');
const LEADING_X = new RegExp(`^${NUM}\\s*x\\s+(.+)$`, 'iu');
const TRAILING = new RegExp(`^(.+?)\\s+(?:x\\s*${NUM}|${NUM}\\s*x|${NUM}\\s*(${UNIT_RE})\\.?)$`, 'iu');

function cleanNum(n) {
  if (n === '½') return '0.5';
  if (n === '¼') return '0.25';
  if (n === '¾') return '0.75';
  return n.replace(',', '.');
}

function cleanUnit(u) {
  if (!u) return '';
  const l = u.toLowerCase();
  if (l === 'x') return '';
  if (['l', 'ml', 'cl', 'dl'].includes(l)) return l === 'l' ? 'l' : l;
  return l;
}

/** Split a raw entry into { name, qty, unit }. qty/unit are '' when absent. */
export function parseEntry(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { name: '', qty: '', unit: '' };
  let m = text.match(LEADING_X);
  if (m) return { name: m[2].trim(), qty: cleanNum(m[1]), unit: '' };
  m = text.match(LEADING);
  if (m && m[3] && !/^\d/.test(m[3])) return { name: m[3].trim(), qty: cleanNum(m[1]), unit: cleanUnit(m[2]) };
  m = text.match(TRAILING);
  if (m) {
    const qty = m[2] || m[3] || m[4];
    const unit = m[5] ? cleanUnit(m[5]) : '';
    if (qty && m[1].trim()) return { name: m[1].trim(), qty: cleanNum(qty), unit };
  }
  return { name: text, qty: '', unit: '' };
}

/** Key used for learning, duplicates and autocomplete. */
export function normalizeName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Add two amounts if they are compatible, otherwise null. */
export function addAmounts(a, b) {
  const qa = a.qty === '' ? null : Number(a.qty);
  const qb = b.qty === '' ? null : Number(b.qty);
  if (qa === null && qb === null) return { qty: '', unit: a.unit || b.unit || '' };
  if ((a.unit || '') !== (b.unit || '') && a.qty !== '' && b.qty !== '') return null;
  const total = (qa ?? 1) + (qb ?? 1);
  if (!Number.isFinite(total)) return null;
  return { qty: String(Math.round(total * 1000) / 1000), unit: a.unit || b.unit || '' };
}

/** Split pasted multi-line text into entries (also handles bullets and numbering). */
export function splitLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•·◦▪–]|\[\s?[xX ]?\]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
}

export function formatAmount(qty, unit) {
  if (!qty && !unit) return '';
  const q = qty ? String(qty).replace(/\.0+$/, '') : '';
  if (!unit) return q ? `${q}×` : '';
  return q ? `${q} ${unit}` : unit;
}

const BIG_STEP_UNITS = ['g', 'ml', 'mg', 'cl'];

/**
 * One step up (+1) or down (-1) for the +/- buttons. Without an amount an item counts as 1.
 * g/ml change in steps of 100. Returns null when it can't go lower.
 */
export function stepAmount(qty, unit, dir) {
  const big = BIG_STEP_UNITS.includes((unit || '').toLowerCase());
  const step = big ? 100 : 1;
  const cur = qty === '' || qty == null ? (big ? 0 : 1) : Number(qty);
  if (!Number.isFinite(cur)) return null;
  let next = Math.round((cur + dir * step) * 1000) / 1000;
  if (dir < 0) {
    if (next < step) return null;
  } else if (big && cur % step) next = Math.ceil(cur / step) * step; // 250 g → 300 g
  // a plain "1×" is the same as no amount
  if (!unit && next === 1) return { qty: '', unit: '' };
  return { qty: String(next), unit: unit || '' };
}
