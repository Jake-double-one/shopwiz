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
