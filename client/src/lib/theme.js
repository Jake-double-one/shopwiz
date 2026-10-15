import { load, save } from './storage.js';

// The skins come from the server (skins/ and SKINS_DIR, see skins/README.md): their colors as a <style> and
// the list as JSON in the page. The Vite dev server has no such page, so there they are fetched.
let list = { defaults: { light: 'light', dark: 'dark' }, skins: [] };
const listeners = new Set();
function readList() {
  try {
    const el = typeof document !== 'undefined' && document.getElementById('skin-list');
    if (el) list = JSON.parse(el.textContent);
  } catch {
    /* keep the fallback */
  }
}
readList();

/** In dev: get the skins from the server and add their colors to the page */
export async function ensureSkins() {
  if (list.skins.length) return list;
  try {
    const r = await fetch('/api/skins');
    const data = await r.json();
    const style = Object.assign(document.createElement('style'), { id: 'skins', textContent: data.css });
    document.head.append(style);
    list = { defaults: data.defaults, skins: data.skins };
    syncThemeColor();
    for (const fn of listeners) fn(list);
  } catch {
    /* offline in dev – the page keeps its fallback colors */
  }
  return list;
}

/** All skins: { id, names, scheme, bg, accent, ink, focusBg } */
export const skinList = () => list.skins;
export const onSkinList = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const skinName = (skin, lang) => skin.names[lang] ?? skin.names[''] ?? skin.id;

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const browserScheme = () => (darkQuery?.matches ? 'dark' : 'light');
/** skins that were renamed – a saved old name keeps working */
const RENAMED = { cream: 'mango' };
const known = (id) => !list.skins.length || list.skins.some((s) => s.id === id);

/** The skin someone picked on this device, or null (then the standard light/dark one, like the browser) */
export const savedSkin = () => {
  const s = RENAMED[load('theme')] ?? load('theme');
  return typeof s === 'string' && s !== 'auto' && known(s) ? s : null;
};
/** The skin that is shown right now */
export const currentSkin = () => savedSkin() ?? list.defaults[browserScheme()];

/** data-theme="auto" (nothing saved) lets the CSS follow the browser; otherwise it names the skin */
export function applyTheme(skin = savedSkin()) {
  const t = skin && known(skin) ? skin : 'auto';
  document.documentElement.dataset.theme = t;
  syncThemeColor();
  return t;
}

export function setTheme(skin) {
  if (!known(skin)) return currentSkin();
  save('theme', skin);
  applyTheme(skin);
  return skin;
}

// ----- color of the browser / system bars (status bar, Android navigation bar) -----
// The <meta name="theme-color"> tags in index.html only follow the browser; the skin and the focus mode
// have to win, so one tag without media query is kept up to date.
let focusBars = false;

/**
 * Installed app (home screen, Chromium/Brave on Android): the manifest has no theme_color on purpose, so
 * Android colors the navigation bar after the phone's light/dark mode. The status bar and the color of the
 * navigation buttons follow theme-color – so there, the bars stay on the phone's side (light or dark); a skin
 * of that kind still gives its own color (e.g. AMOLED black on a dark phone).
 * (No viewport-fit=cover either: with it, Chrome makes the navigation bar see-through over the manifest's
 * background_color, which can't change with the theme.)
 */
const installed = () => typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;

export function syncThemeColor() {
  const skins = list.skins;
  let skin = skins.find((x) => x.id === currentSkin());
  if (installed() && skin && skin.scheme !== browserScheme()) skin = skins.find((x) => x.id === list.defaults[browserScheme()]);
  // before the list is there (dev only): the standard colors
  const color = skin ? (focusBars ? skin.focusBg : skin.bg) : focusBars ? (browserScheme() === 'dark' ? '#000000' : '#ffffff') : browserScheme() === 'dark' ? '#101714' : '#e9ede6';
  const tags = [...document.querySelectorAll('meta[name="theme-color"]')];
  const tag = tags[0] ?? document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }));
  for (const extra of tags.slice(1)) extra.remove();
  tag.removeAttribute('media');
  tag.setAttribute('content', color);
}

/** Focus mode: the bars take its plain black/white */
export function setFocusBars(on) {
  focusBars = !!on;
  syncThemeColor();
}

darkQuery?.addEventListener?.('change', syncThemeColor);
/** Without a saved skin the shown one changes with the browser – for a picker that shows the current one */
export const onSchemeChange = (fn) => {
  darkQuery?.addEventListener?.('change', fn);
  return () => darkQuery?.removeEventListener?.('change', fn);
};

/** How "important" / "not important" items are marked – a per-device preference */
export const PRIO_STYLES = ['box', 'badge', 'gap'];

export function applyPrioStyle(style = load('prioStyle', 'box')) {
  const s = PRIO_STYLES.includes(style) ? style : 'box';
  document.documentElement.dataset.prio = s;
  return s;
}

export function setPrioStyle(style) {
  save('prioStyle', style);
  return applyPrioStyle(style);
}
