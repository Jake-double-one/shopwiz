// Travel mode: countries a list can be set to, their languages (first = default) and
// detection of the country from a free-text shop address. Names come from Intl.DisplayNames,
// so nothing has to be translated by hand.

/** ISO 3166 country → languages spoken in shops there (BCP 47, first = default). */
// no prototype: a country code like "constructor" must not count as known
export const COUNTRY_LANGS = Object.assign(Object.create(null), {
  AD: ['ca'], AE: ['ar', 'en'], AL: ['sq'], AR: ['es'], AT: ['de'], AU: ['en'], BA: ['bs'], BE: ['nl', 'fr', 'de'],
  BG: ['bg'], BR: ['pt-BR'], BY: ['ru'], CA: ['en', 'fr'], CH: ['de', 'fr', 'it'], CL: ['es'], CN: ['zh'], CO: ['es'],
  CR: ['es'], CU: ['es'], CY: ['el', 'tr'], CZ: ['cs'], DE: ['de'], DK: ['da'], DO: ['es'], EE: ['et'], EG: ['ar'],
  ES: ['es', 'ca'], FI: ['fi', 'sv'], FR: ['fr'], GB: ['en'], GE: ['ka'], GR: ['el'], HK: ['zh-TW', 'en'], HR: ['hr'],
  HU: ['hu'], ID: ['id'], IE: ['en'], IL: ['he'], IN: ['hi', 'en'], IS: ['is'], IT: ['it'], JO: ['ar'], JP: ['ja'],
  KE: ['sw', 'en'], KR: ['ko'], LI: ['de'], LK: ['si', 'en'], LT: ['lt'], LU: ['fr', 'de'], LV: ['lv'], MA: ['ar', 'fr'],
  MC: ['fr'], MD: ['ro'], ME: ['sr'], MK: ['mk'], MT: ['mt', 'en'], MU: ['fr', 'en'], MV: ['en'], MX: ['es'], MY: ['ms'],
  NL: ['nl'], NO: ['nb'], NZ: ['en'], PE: ['es'], PH: ['en'], PL: ['pl'], PT: ['pt'], RO: ['ro'], RS: ['sr'], RU: ['ru'],
  SA: ['ar'], SE: ['sv'], SG: ['en', 'zh'], SI: ['sl'], SK: ['sk'], SM: ['it'], TH: ['th'], TN: ['ar', 'fr'], TR: ['tr'],
  TW: ['zh-TW'], TZ: ['sw', 'en'], UA: ['uk'], US: ['en'], VA: ['it'], VN: ['vi'], ZA: ['en', 'af'],
});

export const COUNTRIES = Object.keys(COUNTRY_LANGS);
export const LANG_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
export const COUNTRY_RE = /^[A-Z]{2}$/;

/** Languages a list can be translated to (all languages of the countries above). */
export const LANGS = [...new Set(Object.values(COUNTRY_LANGS).flat())].sort();

/** Short local spellings and abbreviations people put into addresses. */
const EXTRA = {
  AT: ['österreich', 'osterreich'], CH: ['schweiz', 'suisse', 'svizzera', 'svizra'], DE: ['deutschland'],
  ES: ['españa', 'espana'], GB: ['uk', 'united kingdom', 'great britain', 'england', 'scotland', 'wales', 'grossbritannien', 'großbritannien'],
  US: ['usa', 'u.s.a.', 'united states', 'vereinigte staaten'], NL: ['holland', 'nederland'], BE: ['belgië', 'belgie', 'belgique'],
  GR: ['ελλάδα', 'hellas', 'griechenland'], HR: ['hrvatska'], SI: ['slovenija'], CZ: ['česko', 'cesko', 'tschechien', 'czechia'],
  PL: ['polska'], HU: ['magyarország', 'magyarorszag'], DK: ['danmark'], SE: ['sverige'], NO: ['norge'], FI: ['suomi'],
  IT: ['italia'], PT: ['portugal'], TR: ['türkiye', 'turkiye', 'türkei'], AE: ['uae', 'vae'], IS: ['ísland'],
  CY: ['κύπρος', 'kıbrıs'], ME: ['crna gora'], RS: ['srbija'], BA: ['bosna i hercegovina'], MK: ['nordmazedonien', 'north macedonia'],
  LU: ['lëtzebuerg', 'luxemburg'], IE: ['éire', 'eire'], RO: ['românia'], BG: ['българия'], SK: ['slovensko'], MT: ['malta'],
};

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();

let names = null;
/** name (lower case) → country code, in German, English, the local languages and EXTRA. */
function countryNames() {
  if (names) return names;
  names = new Map();
  const add = (name, code, min = 3) => {
    const n = norm(name);
    if (n.length >= min && !names.has(n)) names.set(n, code);
  };
  for (const [code, langs] of Object.entries(COUNTRY_LANGS)) {
    for (const lang of ['de', 'en', ...langs]) {
      try {
        add(new Intl.DisplayNames([lang], { type: 'region' }).of(code), code);
      } catch {
        /* unknown locale data */
      }
    }
    for (const x of EXTRA[code] ?? []) add(x, code, 2);
  }
  return names;
}

/**
 * Country of a shop address like "Via Roma 3, 39100 Bozen, Italien" → 'IT', or null.
 * Looks at the parts from the end (the country is usually last), then anywhere in the text.
 */
export function detectCountry(address) {
  const text = norm(address);
  if (!text) return null;
  const map = countryNames();
  const parts = text.split(/[,\n;]+/).map((p) => p.trim()).filter(Boolean).reverse();
  for (const p of parts) {
    if (map.has(p)) return map.get(p);
    // "39100 Bozen IT" / "IT-39100 Bozen" / "I-39100"
    const code = p.match(/(?:^|\s)([a-z]{2})(?:-\d|\s*$)/);
    if (code && COUNTRY_LANGS[code[1].toUpperCase()] && parts.indexOf(p) === 0) return code[1].toUpperCase();
  }
  let best = null;
  for (const [name, code] of map) {
    const i = text.lastIndexOf(name);
    if (i < 0) continue;
    const before = i === 0 || /[\s,(]/.test(text[i - 1]);
    const after = i + name.length === text.length || /[\s,).]/.test(text[i + name.length]);
    if (before && after && (!best || i > best.i || (i === best.i && name.length > best.len))) best = { i, len: name.length, code };
  }
  return best?.code ?? null;
}

/** Display name of a country / language in the UI language. */
export function countryName(code, uiLang) {
  try {
    return new Intl.DisplayNames([uiLang], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
export function langName(code, uiLang) {
  try {
    return new Intl.DisplayNames([uiLang], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
