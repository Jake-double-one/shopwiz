// Machine translation for travel mode. Always called by the server – services never see a
// device, only the item names. Which services, in which order, and their keys come from the
// environment. When one is used up, down or rejects its key, the next one in line steps in.

export const PROVIDERS = ['mymemory', 'libretranslate', 'deepl', 'google', 'azure'];
export const PROVIDER_NAMES = { mymemory: 'MyMemory', libretranslate: 'LibreTranslate', deepl: 'DeepL', google: 'Google', azure: 'Microsoft' };

export class TranslateError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code; // 'quota' | 'unavailable' | 'config'
  }
}

const base = (lang) => lang.split('-')[0];

/** Language codes as each service expects them. */
const CODES = {
  mymemory: (l) => ({ nb: 'no' })[l] ?? l,
  libretranslate: (l) => ({ 'zh-TW': 'zt', 'pt-BR': 'pb', zh: 'zh-Hans' })[l] ?? base(l),
  google: (l) => ({ nb: 'no', 'zh-TW': 'zh-TW', zh: 'zh-CN', he: 'iw' })[l] ?? base(l),
  azure: (l) => ({ zh: 'zh-Hans', 'zh-TW': 'zh-Hant', 'pt-BR': 'pt', pt: 'pt-pt', sr: 'sr-Latn' })[l] ?? base(l),
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

/** Settings of each service; `missing` says what is needed before it can be used. */
function settingsOf(name, config, legacyKey) {
  const key = (own) => own || legacyKey;
  switch (name) {
    case 'deepl': {
      const k = key(config.deeplApiKey);
      return { key: k, missing: k ? null : 'DEEPL_API_KEY' };
    }
    case 'google': {
      const k = key(config.googleApiKey);
      return { key: k, missing: k ? null : 'GOOGLE_API_KEY' };
    }
    case 'azure': {
      const k = key(config.azureTranslatorKey);
      return { key: k, region: config.azureTranslatorRegion || '', missing: k ? null : 'AZURE_TRANSLATOR_KEY' };
    }
    case 'libretranslate':
      return { url: (config.libretranslateUrl || 'http://libretranslate:5000').replace(/\/+$/, ''), key: config.libretranslateApiKey || '', missing: null };
    case 'mymemory':
      return { email: config.mymemoryEmail || '', key: config.mymemoryApiKey || '', missing: null };
    default:
      return { missing: 'unknown service' };
  }
}

/**
 * createTranslator(config, fetch) → {
 *   providers: usable services in order, problems: [{ provider, problem }], available,
 *   translate(texts, from, to) → { texts: string[], providers: string[] }  ('' when nobody could)
 * }
 */
export function createTranslator(config, fetchImpl = globalThis.fetch, onError = null) {
  const wanted = (config.translateProviders ?? []).filter((p) => p !== 'none');
  const timeout = 10_000;

  // the old single TRANSLATE_API_KEY belongs to the first listed service that needs a key and has none
  const needsKey = (p) => ({ deepl: config.deeplApiKey, google: config.googleApiKey, azure: config.azureTranslatorKey })[p];
  const legacyFor = config.translateApiKey ? wanted.find((p) => ['deepl', 'google', 'azure'].includes(p) && !needsKey(p)) : null;

  const problems = [];
  const chain = [];
  for (const name of [...new Set(wanted)]) {
    if (!PROVIDERS.includes(name)) {
      problems.push({ provider: name, code: 'unknown', problem: 'unknown service' });
      continue;
    }
    const s = settingsOf(name, config, name === legacyFor ? config.translateApiKey : '');
    if (s.missing) problems.push({ provider: name, code: 'missing_key', detail: s.missing, problem: `${s.missing} is missing` });
    else chain.push({ name, ...s });
  }

  async function call(url, init) {
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeout) });
    } catch {
      throw new TranslateError('unavailable');
    }
    if (res.status === 429 || res.status === 456) throw new TranslateError('quota');
    if (res.status === 401 || res.status === 403) throw new TranslateError('config', `answered ${res.status}`);
    if (!res.ok) throw new TranslateError('unavailable', `answered ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new TranslateError('unavailable', 'answer is not JSON');
    }
  }

  const impl = {
    async mymemory(s, texts, from, to) {
      const out = [];
      for (const q of texts) {
        const params = new URLSearchParams({ q, langpair: `${CODES.mymemory(from)}|${CODES.mymemory(to)}` });
        if (s.email) params.set('de', s.email);
        if (s.key) params.set('key', s.key);
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
    async libretranslate(s, texts, from, to) {
      const data = await call(`${s.url}/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: texts, source: CODES.libretranslate(from), target: CODES.libretranslate(to), format: 'text', ...(s.key && { api_key: s.key }) }),
      });
      const t = data?.translatedText;
      return (Array.isArray(t) ? t : [t]).map(decode);
    },
    async deepl(s, texts, from, to) {
      const host = s.key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
      const data = await call(`${host}/v2/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `DeepL-Auth-Key ${s.key}` },
        body: JSON.stringify({ text: texts, source_lang: CODES.deeplSource(from), target_lang: CODES.deeplTarget(to) }),
      });
      return (data?.translations ?? []).map((t) => decode(t.text));
    },
    async google(s, texts, from, to) {
      const data = await call(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(s.key)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: texts, source: CODES.google(from), target: CODES.google(to), format: 'text' }),
      });
      return (data?.data?.translations ?? []).map((t) => decode(t.translatedText));
    },
    async azure(s, texts, from, to) {
      const params = new URLSearchParams({ 'api-version': '3.0', from: CODES.azure(from), to: CODES.azure(to) });
      const data = await call(`https://api.cognitive.microsofttranslator.com/translate?${params}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'ocp-apim-subscription-key': s.key,
          ...(s.region && { 'ocp-apim-subscription-region': s.region }),
        },
        body: JSON.stringify(texts.map((t) => ({ Text: t }))),
      });
      return (Array.isArray(data) ? data : []).map((r) => decode(r?.translations?.[0]?.text));
    },
  };

  /** Cheap checks that a service works with its settings – no or a single character used. */
  const checks = {
    async deepl(s) {
      const host = s.key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
      const d = await call(`${host}/v2/usage`, { headers: { authorization: `DeepL-Auth-Key ${s.key}` } });
      const used = Number(d?.character_count);
      const limit = Number(d?.character_limit);
      if (!Number.isFinite(used) || !Number.isFinite(limit)) return {};
      if (limit && used >= limit) throw new TranslateError('quota');
      return { usage: { used, limit } };
    },
    async google(s) {
      await call(`https://translation.googleapis.com/language/translate/v2/languages?key=${encodeURIComponent(s.key)}`);
      return {};
    },
    async libretranslate(s) {
      await call(`${s.url}/languages`);
      return {};
    },
    async azure(s) {
      const r = await impl.azure(s, ['a'], 'de', 'en');
      if (!r[0]) throw new TranslateError('unavailable');
      return {};
    },
    async mymemory(s) {
      await impl.mymemory(s, ['a'], 'de', 'en');
      return {};
    },
  };

  /**
   * State of every listed service, in order: [{ provider, ok, problem?, detail?, usage? }]
   * problem: 'missing_key' (detail = variable) | 'unknown' | 'quota' | 'rejected' | 'unreachable'
   */
  async function status() {
    const out = [];
    for (const name of [...new Set(wanted)]) {
      const p = problems.find((x) => x.provider === name);
      if (p) {
        out.push({ provider: name, ok: false, problem: p.code, ...(p.detail && { detail: p.detail }) });
        continue;
      }
      const s = chain.find((c) => c.name === name);
      try {
        out.push({ provider: name, ok: true, ...(await checks[name](s)) });
      } catch (e) {
        out.push({ provider: name, ok: false, problem: { quota: 'quota', config: 'rejected' }[e?.code] ?? 'unreachable' });
      }
    }
    return out;
  }

  return {
    status,
    providers: chain.map((c) => c.name),
    problems,
    available: chain.length > 0,
    async translate(texts, from, to) {
      if (!chain.length) throw new TranslateError('config', 'no translation service configured');
      const out = { texts: texts.map(() => ''), providers: texts.map(() => null) };
      if (!texts.length) return out;
      if (from === to) return { texts: [...texts], providers: texts.map(() => null) };
      let todo = texts.map((_, i) => i);
      let lastError = null;
      for (const s of chain) {
        if (!todo.length) break;
        try {
          const res = await impl[s.name](s, todo.map((i) => texts[i]), from, to);
          todo.forEach((i, j) => {
            const t = (res[j] ?? '').slice(0, 120);
            if (t) (out.texts[i] = t), (out.providers[i] = s.name);
          });
          todo = todo.filter((i) => !out.texts[i]);
        } catch (e) {
          if (!(e instanceof TranslateError)) throw e;
          lastError = e; // used up, down or key rejected → next one in line
          onError?.(s.name, e);
        }
      }
      if (todo.length === texts.length && lastError) throw lastError;
      return out;
    },
  };
}
