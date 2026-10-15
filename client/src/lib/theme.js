import { load, save } from './storage.js';

export const THEMES = ['auto', 'light', 'dark'];

export function applyTheme(theme = load('theme', 'auto')) {
  const t = THEMES.includes(theme) ? theme : 'auto';
  document.documentElement.dataset.theme = t;
  syncThemeColor();
  return t;
}

// ----- color of the browser / system bars (status bar, Android navigation bar) -----
// The <meta name="theme-color"> tags in index.html only follow the system setting; the app's own
// light/dark choice and the focus mode have to win, so one tag without media query is kept up to date.
const BAR = { light: '#E9EDE6', dark: '#101714' };
let barOverride = null; // { light, dark } while e.g. the focus mode is shown
const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (t !== 'light' && !!darkQuery?.matches);
};

/**
 * Installed app (home screen, Chromium/Brave on Android): the manifest has no theme_color on purpose, so
 * Android colors the navigation bar after the phone's light/dark mode. The status bar and the color of the
 * navigation buttons follow theme-color – so there, the bars follow the phone, too, not the app's own choice.
 * (No viewport-fit=cover either: with it, Chrome makes the navigation bar see-through over the manifest's
 * background_color, which can't change with the theme.)
 */
const installed = () => typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;

export function syncThemeColor() {
  const dark = installed() ? !!darkQuery?.matches : isDark();
  const color = (barOverride ?? BAR)[dark ? 'dark' : 'light'];
  const tags = [...document.querySelectorAll('meta[name="theme-color"]')];
  const tag = tags[0] ?? document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }));
  for (const extra of tags.slice(1)) extra.remove();
  tag.removeAttribute('media');
  tag.setAttribute('content', color);
}

/** colors: { light, dark } for the bars, or null for the normal ones */
export function setBarColors(colors) {
  barOverride = colors;
  syncThemeColor();
}

darkQuery?.addEventListener?.('change', syncThemeColor);

export function setTheme(theme) {
  save('theme', theme);
  return applyTheme(theme);
}

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
