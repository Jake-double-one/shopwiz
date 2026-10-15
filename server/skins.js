// Skins: one CSS file per skin – the built-in ones in skins/ and your own in SKINS_DIR (default:
// <DATA_DIR>/skins). They are read at runtime (and again a few seconds after a change), so a file
// dropped into the folder shows up without rebuilding anything. See skins/README.md for the format.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUILTIN_DIR = fileURLToPath(new URL('../skins', import.meta.url));

/** The colors every skin has (a missing one comes from the standard skin of the same kind) */
export const TOKENS = [
  'bg', 'surface', 'surface-2', 'ink', 'muted', 'line', 'dusk', 'dusk-soft', 'sun', 'sun-soft', 'alert', 'ok',
  'control', 'control-ink', 'on-dusk', 'on-sun', 'on-alert', 'focus-bg', 'focus-ink', 'focus-dim', 'shadow',
];
const COLOR_RE = /^#[0-9a-f]{6}$/i;
// anything that could leave the CSS block (;{}<>) or load something (url, @, \) is refused
const SAFE_VALUE = /^[#a-z0-9(),.%\s+-]{1,200}$/i;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;

/** WCAG contrast ratio of two #rrggbb colors */
export function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Text on its backgrounds needs 4.5:1, checkbox borders 3:1 (WCAG AA) → list of shortfalls */
export function contrastProblems(v) {
  const text = [['ink', 'bg'], ['ink', 'surface'], ['ink', 'surface-2'], ['ink', 'dusk-soft'], ['ink', 'sun-soft'], ['muted', 'bg'], ['muted', 'surface'],
    ['dusk', 'surface'], ['dusk', 'bg'], ['alert', 'surface'], ['on-dusk', 'dusk'], ['on-sun', 'sun'], ['on-alert', 'alert'], ['focus-ink', 'focus-bg']];
  const out = [];
  const check = (a, b, min) => {
    if (!COLOR_RE.test(v[a] ?? '') || !COLOR_RE.test(v[b] ?? '')) return;
    const c = contrast(v[a], v[b]);
    if (c < min) out.push(`${a} on ${b} ${c.toFixed(2)}:1 (needs ${min}:1)`);
  };
  for (const [a, b] of text) check(a, b, 4.5);
  check('control', 'surface', 3);
  return out;
}

/** Parse one skin file → { id, names, scheme, default, order, vars, problems } */
export function parseSkin(id, text) {
  const problems = [];
  const head = text.match(/^\s*\/\*([\s\S]*?)\*\//)?.[1] ?? '';
  const meta = {};
  for (const line of head.split('\n')) {
    // "name: Ocean   ← explanation" – everything from an arrow on is a comment
    const m = line.replace(/\s*←.*$/, '').match(/^\s*\*?\s*([a-z]+(?:\.[a-z-]+)?)\s*:\s*(.+?)\s*$/i);
    if (m) meta[m[1].toLowerCase()] = m[2];
  }
  const names = { '': meta.name || id };
  for (const [k, val] of Object.entries(meta)) if (k.startsWith('name.')) names[k.slice(5)] = val;
  const scheme = meta.scheme === 'dark' ? 'dark' : 'light';
  if (meta.scheme && !['dark', 'light'].includes(meta.scheme)) problems.push(`scheme must be light or dark, not "${meta.scheme}"`);
  const vars = {};
  const body = text.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;{}]*?)\s*(?:;|(?=}))/gi)) {
    const [, name, value] = m;
    if (!TOKENS.includes(name)) problems.push(`unknown color --${name}`);
    else if (!SAFE_VALUE.test(value) || (name !== 'shadow' && !COLOR_RE.test(value))) problems.push(`--${name}: "${value.slice(0, 40)}" is not ${name === 'shadow' ? 'a valid shadow' : 'a #rrggbb color'}`);
    else vars[name] = value.toLowerCase();
  }
  return {
    id,
    names,
    scheme,
    default: ['dark', 'light'].includes(meta.default) ? meta.default : null,
    order: Number.isFinite(Number(meta.order)) ? Number(meta.order) : 100,
    vars,
    problems,
  };
}

function readDir(dir, log) {
  if (!dir || !existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.css')).sort()) {
    const id = file.slice(0, -4).toLowerCase();
    if (!ID_RE.test(id)) {
      log?.warn(`skin "${file}" skipped: the file name may only have a-z, 0-9 and "-"`);
      continue;
    }
    try {
      const path = join(dir, file);
      if (statSync(path).size > 20_000) throw new Error('larger than 20 kB');
      out.push(parseSkin(id, readFileSync(path, 'utf8')));
    } catch (e) {
      log?.warn(`skin "${file}" skipped: ${e.message}`);
    }
  }
  return out;
}

const block = (selectors, s, indent = '') =>
  `${indent}${selectors.join(`,\n${indent}`)} {\n${TOKENS.filter((t) => s.vars[t]).map((t) => `${indent}  --${t}: ${s.vars[t]};`).join('\n')}\n${indent}  color-scheme: ${s.scheme};\n${indent}}`;

/** All skins (built-in, then your own – same name replaces) → { skins, css, list } */
export function loadSkins({ builtinDir = BUILTIN_DIR, customDir = null, log = null } = {}) {
  const byId = new Map();
  for (const s of [...readDir(builtinDir, log), ...readDir(customDir, log)]) byId.set(s.id, s);
  let skins = [...byId.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  if (!skins.length) throw new Error(`no skins found in ${builtinDir}`);
  // the standard skins for a light and a dark browser
  const std = {};
  for (const scheme of ['light', 'dark']) {
    std[scheme] = skins.find((s) => s.default === scheme) ?? skins.find((s) => s.scheme === scheme) ?? skins[0];
  }
  // a missing color comes from the standard skin of the same kind
  for (const s of skins) {
    const base = std[s.scheme];
    const missing = TOKENS.filter((t) => !s.vars[t] && base.vars[t]);
    if (missing.length && s !== base) s.problems.push(`missing ${missing.map((t) => `--${t}`).join(', ')} – taken from "${base.id}"`);
    s.vars = { ...base.vars, ...s.vars };
    s.problems.push(...contrastProblems(s.vars).map((p) => `low contrast: ${p}`));
    for (const p of s.problems) log?.warn(`skin "${s.id}": ${p}`);
  }
  skins = skins.filter((s) => TOKENS.every((t) => s.vars[t] || t === 'shadow'));
  const css = [
    '/* skins – put together by the server from skins/ and SKINS_DIR */',
    block([':root', `:root[data-theme='${std.light.id}']`, `[data-skin='${std.light.id}']`], std.light),
    block([`:root[data-theme='${std.dark.id}']`, `[data-skin='${std.dark.id}']`], std.dark),
    `@media (prefers-color-scheme: dark) {\n${block([":root[data-theme='auto']"], std.dark, '  ')}\n}`,
    ...skins.filter((s) => s !== std.light && s !== std.dark).map((s) => block([`:root[data-theme='${s.id}']`, `[data-skin='${s.id}']`], s)),
  ].join('\n');
  const list = {
    defaults: { light: std.light.id, dark: std.dark.id },
    skins: skins.map((s) => ({ id: s.id, names: s.names, scheme: s.scheme, bg: s.vars.bg, accent: s.vars.dusk, ink: s.vars.ink, focusBg: s.vars['focus-bg'] })),
  };
  return { skins, css, list };
}

/** What is in the folders right now (names, sizes, times) – to notice a new or changed skin cheaply */
function signature(dirs) {
  return dirs
    .filter((d) => d && existsSync(d))
    .map((d) => readdirSync(d).filter((f) => f.endsWith('.css')).sort().map((f) => {
      const st = statSync(join(d, f));
      return `${d}/${f}:${st.size}:${st.mtimeMs}`;
    }).join('|'))
    .join('||');
}

/** Skins for the server: folders are looked at again every few seconds; a new or changed file is read in */
export function createSkins({ builtinDir = BUILTIN_DIR, customDir = null, log = null, checkMs = 5000 } = {}) {
  let cache = null;
  let sig = '';
  let checked = 0;
  return () => {
    if (cache && Date.now() - checked < checkMs) return cache;
    checked = Date.now();
    const now = signature([builtinDir, customDir]);
    if (cache && now === sig) return cache;
    try {
      cache = loadSkins({ builtinDir, customDir, log });
      if (sig) log?.info?.(`skins read again: ${cache.list.skins.map((x) => x.id).join(', ')}`);
      sig = now;
    } catch (e) {
      log?.error?.(`skins could not be read: ${e.message}`);
      if (!cache) throw e;
    }
    return cache;
  };
}
