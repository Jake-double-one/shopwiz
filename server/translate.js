// Machine translation for travel mode. Always called by the server – providers never see a
// device, only the item names. Provider, key and URL come from the environment.

export const PROVIDERS = ['mymemory', 'libretranslate', 'deepl', 'google', 'none'];

export class TranslateError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code; // 'quota' | 'unavailable' | 'config'
  }
}

const base = (lang) => lang.split('-')[0];

/** Language codes as each provider expects them. */
const CODES = {
  mymemory: (l) => ({ nb: 'no', 'zh-TW': 'zh-TW', 'pt-BR': 'pt-BR' })[l] ?? l,
  libretranslate: (l) => ({ 'zh-TW': 'zt', 'pt-BR': 'pb', zh: 'zh-Hans' })[l] ?? base(l),
  google: (l) => ({ nb: 'no', 'zh-TW': 'zh-TW', zh: 'zh-CN', he: 'iw' })[l] ?? base(l),
  deeplSource: (l) => base(l).toUpperCase(),
  deeplTarget: (l) => ({ en: 'EN-GB', pt: 'PT-PT', 'pt-BR': 'PT-BR', zh: 'ZH-HANS', 'zh-TW': 'ZH-HANT' })[l] ?? base(l).toUpperCase(),
};

// "Tom &amp; Jerry" → "Tom & Jerry" (MyMemory and Google return HTML entities now and then)
const decode = (s) =>
  String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();

/**
 * MyMemory is a translation *memory*: for single words its top answer is often some
 * user-contributed segment ("Eier" → "Panna liquida"). Its own machine translation
 * (created-by "MT…") is far more reliable for item names – prefer it when it's there.
 */
function pickMyMemory(data, fallback) {
  const matches = Array.isArray(data?.matches) ? data.matches : [];
  const mt = matches.find((m) => /^MT/i.test(String(m?.['created-by'] ?? m?.createdBy ?? '')) && m?.translation);
  return mt ? mt.translation : fallback;
}

/**
 * createTranslator(config, fetch) → { provider, available, translate(texts, from, to) → string[] }
 * texts: short item names; the result has the same order ('' when a single text failed).
 */
export function createTranslator(config, fetchImpl = globalThis.fetch) {
  const provider = PROVIDERS.includes(config.translateProvider) ? config.translateProvider : 'none';
  const key = config.translateApiKey || '';
  const timeout = 10_000;

  async function call(url, init) {
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeout) });
    } catch {
      throw new TranslateError('unavailable');
    }
    if (res.status === 429 || res.status === 456) throw new TranslateError('quota');
    if (res.status === 401 || res.status === 403) throw new TranslateError('config', `provider answered ${res.status}`);
    if (!res.ok) throw new TranslateError('unavailable', `provider answered ${res.status}`);
    return res.json();
  }

  const impl = {
    async mymemory(texts, from, to) {
      const out = [];
      for (const q of texts) {
        const params = new URLSearchParams({ q, langpair: `${CODES.mymemory(from)}|${CODES.mymemory(to)}` });
        if (config.translateEmail) params.set('de', config.translateEmail);
        if (key) params.set('key', key);
        const data = await call(`https://api.mymemory.translated.net/get?${params}`);
        const status = Number(data?.responseStatus);
        const text = data?.responseData?.translatedText ?? '';
        // the quota warning sometimes arrives as the "translation" itself
        if (status === 429 || /MYMEMORY WARNING|USED ALL AVAILABLE FREE TRANSLATIONS/i.test(`${data?.responseDetails ?? ''} ${text}`)) {
          throw new TranslateError('quota');
        }
        out.push(status === 200 ? decode(pickMyMemory(data, text)) : '');
      }
      return out;
    },
    async libretranslate(texts, from, to) {
      const url = (config.translateUrl || 'http://libretranslate:5000').replace(/\/+$/, '');
      const data = await call(`${url}/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: texts, source: CODES.libretranslate(from), target: CODES.libretranslate(to), format: 'text', ...(key && { api_key: key }) }),
      });
      const t = data?.translatedText;
      return (Array.isArray(t) ? t : [t]).map(decode);
    },
    async deepl(texts, from, to) {
      if (!key) throw new TranslateError('config', 'TRANSLATE_API_KEY is missing');
      const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
      const data = await call(`${host}/v2/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `DeepL-Auth-Key ${key}` },
        body: JSON.stringify({ text: texts, source_lang: CODES.deeplSource(from), target_lang: CODES.deeplTarget(to) }),
      });
      return (data?.translations ?? []).map((t) => decode(t.text));
    },
    async google(texts, from, to) {
      if (!key) throw new TranslateError('config', 'TRANSLATE_API_KEY is missing');
      const data = await call(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: texts, source: CODES.google(from), target: CODES.google(to), format: 'text' }),
      });
      return (data?.data?.translations ?? []).map((t) => decode(t.translatedText));
    },
  };

  return {
    provider,
    available: provider !== 'none',
    async translate(texts, from, to) {
      if (provider === 'none') throw new TranslateError('config', 'no translation provider configured');
      if (!texts.length) return [];
      if (base(from) === base(to) && from === to) return [...texts];
      const res = await impl[provider](texts, from, to);
      return texts.map((_, i) => (res[i] ?? '').slice(0, 120));
    },
  };
}
