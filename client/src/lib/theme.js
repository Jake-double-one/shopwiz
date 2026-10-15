import { load, save } from './storage.js';
import { SKINS, SKIN_IDS, DEFAULT_SKIN } from '../../../shared/skins.js';

export { SKINS, SKIN_IDS };

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const browserScheme = () => (darkQuery?.matches ? 'dark' : 'light');

/** The skin someone picked on this device, or null (then the standard light/dark one, like the browser) */
export const savedSkin = () => (SKIN_IDS.includes(load('theme')) ? load('theme') : null);
/** The skin that is shown right now */
export const currentSkin = () => savedSkin() ?? DEFAULT_SKIN[browserScheme()];

/** data-theme="auto" (nothing saved) lets the CSS follow the browser; otherwise it names the skin */
export function applyTheme(skin = savedSkin()) {
  const t = SKIN_IDS.includes(skin) ? skin : 'auto';
  document.documentElement.dataset.theme = t;
  syncThemeColor();
  return t;
}

export function setTheme(skin) {
  if (!SKIN_IDS.includes(skin)) return currentSkin();
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
  let skin = currentSkin();
  if (installed() && SKINS[skin].scheme !== browserScheme()) skin = DEFAULT_SKIN[browserScheme()];
  const color = SKINS[skin][focusBars ? 'focus-bg' : 'bg'];
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
