import en from '../locales/en.json';
import de from '../locales/de.json';
import { load, save } from './storage.js';

// Adding a language = adding a JSON file here. English is the fallback for missing keys.
export const LANGUAGES = { en: { name: 'English', dict: en }, de: { name: 'Deutsch', dict: de } };

function detect() {
  const stored = load('lang');
  if (stored && LANGUAGES[stored]) return stored;
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = String(l).slice(0, 2).toLowerCase();
    if (LANGUAGES[code]) return code;
  }
  return 'en';
}

export const i18n = $state({ lang: detect() });

export function setLang(code) {
  if (!LANGUAGES[code]) return;
  i18n.lang = code;
  save('lang', code);
  document.documentElement.lang = code;
}

/** t('key', {var}) – `{var}` placeholders; `key` with `count` picks `key_one`/`key_other`. */
export function t(key, vars) {
  const dict = LANGUAGES[i18n.lang].dict;
  let k = key;
  if (vars && typeof vars.count === 'number') k = `${key}_${vars.count === 1 ? 'one' : 'other'}`;
  let s = dict[k] ?? en[k] ?? dict[key] ?? en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, v) => (vars[v] ?? `{${v}}`));
  return s;
}

export function relTime(ts) {
  if (!ts) return '';
  const diff = (ts - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(i18n.lang, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return t('time.now');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function clock(ts) {
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  return new Intl.DateTimeFormat(i18n.lang, sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}
