import { load, save } from './storage.js';

export const THEMES = ['auto', 'light', 'dark'];

export function applyTheme(theme = load('theme', 'auto')) {
  const t = THEMES.includes(theme) ? theme : 'auto';
  document.documentElement.dataset.theme = t;
  return t;
}

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
