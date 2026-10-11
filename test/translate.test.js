import { describe, it, expect } from 'vitest';
import { createTranslator, TranslateError } from '../server/translate.js';
import { detectCountry, COUNTRY_LANGS } from '../shared/countries.js';

/** fetch stand-in: records the calls, answers with `reply(url, init)` */
function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    const r = reply(String(url), init);
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.json };
  };
  fn.calls = calls;
  return fn;
}

const cfg = (providers, extra = {}) => ({ translateProviders: providers.split(','), ...extra });
const run = async (tr, texts, from = 'de', to = 'it') => (await tr.translate(texts, from, to)).texts;

describe('translation services', () => {
  it('MyMemory: one request per name, no key, entities decoded', async () => {
    const f = fakeFetch((url) => ({ json: { responseStatus: 200, responseData: { translatedText: new URL(url).searchParams.get('q') === 'Milch' ? 'Latte' : 'Pane &amp; Co' } } }));
    const tr = createTranslator(cfg('mymemory', { mymemoryEmail: 'me@example.org' }), f);
    expect(await tr.translate(['Milch', 'Brot'], 'de', 'it')).toEqual({ texts: ['Latte', 'Pane & Co'], providers: ['mymemory', 'mymemory'] });
    const u = new URL(f.calls[0].url);
    expect(u.host).toBe('api.mymemory.translated.net');
    expect(u.searchParams.get('langpair')).toBe('de|it');
    expect(u.searchParams.get('de')).toBe('me@example.org');
  });

  it("MyMemory: prefers its machine translation over odd memory matches", async () => {
    const f = fakeFetch(() => ({
      json: {
        responseStatus: 200,
        responseData: { translatedText: 'Panna liquida', match: 1 },
        matches: [
          { translation: 'Panna liquida', 'created-by': 'Someone', quality: '74' },
          { translation: 'Uova', 'created-by': 'MT!', quality: '70' },
        ],
      },
    }));
    expect(await run(createTranslator(cfg('mymemory'), f), ['Eier'])).toEqual(['Uova']);
  });

  it('MyMemory: a used-up quota is reported as such', async () => {
    const f = fakeFetch(() => ({ json: { responseStatus: 429, responseDetails: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' } }));
    await expect(createTranslator(cfg('mymemory'), f).translate(['Milch'], 'de', 'it')).rejects.toMatchObject({ code: 'quota' });
    const sneaky = fakeFetch(() => ({ json: { responseStatus: 200, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' } } }));
    await expect(createTranslator(cfg('mymemory'), sneaky).translate(['Milch'], 'de', 'it')).rejects.toMatchObject({ code: 'quota' });
  });

  it('DeepL: own key, free keys use the free host, targets with a variant', async () => {
    const f = fakeFetch(() => ({ json: { translations: [{ text: 'Milk' }, { text: 'Bread' }] } }));
    const tr = createTranslator(cfg('deepl', { deeplApiKey: 'abc:fx' }), f);
    expect(await run(tr, ['Milch', 'Brot'], 'de', 'en')).toEqual(['Milk', 'Bread']);
    expect(f.calls[0].url).toBe('https://api-free.deepl.com/v2/translate');
    expect(f.calls[0].init.headers.authorization).toBe('DeepL-Auth-Key abc:fx');
    expect(f.calls[0].body).toMatchObject({ text: ['Milch', 'Brot'], source_lang: 'DE', target_lang: 'EN-GB' });
  });

  it('Microsoft (Azure): key and region headers, one array request', async () => {
    const f = fakeFetch(() => ({ json: [{ translations: [{ text: 'Tovagliette per fasciatoio', to: 'it' }] }] }));
    const tr = createTranslator(cfg('azure', { azureTranslatorKey: 'k', azureTranslatorRegion: 'westeurope' }), f);
    expect(await run(tr, ['Wickeltischunterlagen'])).toEqual(['Tovagliette per fasciatoio']);
    const u = new URL(f.calls[0].url);
    expect(u.host).toBe('api.cognitive.microsofttranslator.com');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ 'api-version': '3.0', from: 'de', to: 'it' });
    expect(f.calls[0].init.headers).toMatchObject({ 'ocp-apim-subscription-key': 'k', 'ocp-apim-subscription-region': 'westeurope' });
    expect(f.calls[0].body).toEqual([{ Text: 'Wickeltischunterlagen' }]);
  });

  it('services without their key are left out and named', () => {
    const tr = createTranslator(cfg('deepl,google,azure,mymemory'), fakeFetch(() => ({ json: {} })));
    expect(tr.providers).toEqual(['mymemory']);
    expect(tr.problems.map((p) => p.problem)).toEqual(['DEEPL_API_KEY is missing', 'GOOGLE_API_KEY is missing', 'AZURE_TRANSLATOR_KEY is missing']);
    expect(createTranslator(cfg('deepl')).available).toBe(false);
  });

  it('the old single TRANSLATE_API_KEY belongs to the first service without an own key', () => {
    const tr = createTranslator(cfg('deepl,azure', { translateApiKey: 'old', azureTranslatorKey: 'own' }));
    expect(tr.providers).toEqual(['deepl', 'azure']);
    expect(createTranslator(cfg('deepl,google', { translateApiKey: 'old' })).providers).toEqual(['deepl']);
  });

  it('falls back to the next service when one is used up, and says who translated', async () => {
    const f = fakeFetch((url) => {
      if (url.includes('deepl')) return { status: 456, json: {} }; // DeepL: quota used up
      return { json: [{ translations: [{ text: 'Latte' }] }, { translations: [{ text: 'Pane' }] }] };
    });
    const tr = createTranslator(cfg('deepl,azure', { deeplApiKey: 'd', azureTranslatorKey: 'a' }), f);
    expect(await tr.translate(['Milch', 'Brot'], 'de', 'it')).toEqual({ texts: ['Latte', 'Pane'], providers: ['azure', 'azure'] });
  });

  it('asks the next service only for what the first one left empty', async () => {
    const f = fakeFetch((url) => {
      if (url.includes('localhost')) return { json: { translatedText: ['Latte', ''] } };
      return { json: { responseStatus: 200, responseData: { translatedText: 'Pane' } } };
    });
    const tr = createTranslator(cfg('libretranslate,mymemory', { libretranslateUrl: 'http://localhost:5000' }), f);
    expect(await tr.translate(['Milch', 'Brot'], 'de', 'it')).toEqual({ texts: ['Latte', 'Pane'], providers: ['libretranslate', 'mymemory'] });
    expect(new URL(f.calls[1].url).searchParams.get('q')).toBe('Brot');
  });

  it('LibreTranslate: batch request to the configured URL', async () => {
    const f = fakeFetch(() => ({ json: { translatedText: ['Latte', 'Pane'] } }));
    const tr = createTranslator(cfg('libretranslate', { libretranslateUrl: 'http://lt:5000/' }), f);
    expect(await run(tr, ['Milch', 'Brot'])).toEqual(['Latte', 'Pane']);
    expect(f.calls[0].url).toBe('http://lt:5000/translate');
    expect(f.calls[0].body).toMatchObject({ q: ['Milch', 'Brot'], source: 'de', target: 'it', format: 'text' });
  });

  it('Google: v2 with its key, Norwegian as "no"', async () => {
    const f = fakeFetch(() => ({ json: { data: { translations: [{ translatedText: 'Melk' }] } } }));
    const tr = createTranslator(cfg('google', { googleApiKey: 'k' }), f);
    expect(await run(tr, ['Milch'], 'de', 'nb')).toEqual(['Melk']);
    expect(f.calls[0].url).toContain('translation.googleapis.com/language/translate/v2?key=k');
    expect(f.calls[0].body).toMatchObject({ target: 'no' });
  });

  it('"none" is not available; when every service fails the last error is reported', async () => {
    expect(createTranslator(cfg('none')).available).toBe(false);
    expect(createTranslator(cfg('whatever')).problems).toEqual([{ provider: 'whatever', problem: 'unknown service' }]);
    const down = createTranslator(cfg('mymemory'), async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(down.translate(['Milch'], 'de', 'it')).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('country from the shop address', () => {
  const cases = [
    ['Via Roma 3, 39100 Bozen, Italien', 'IT'],
    ['Supermercato, Olbia, Italia', 'IT'],
    ['Carrer de Mallorca 1, Barcelona, Spain', 'ES'],
    ['Calle 5, 07001 Palma ES', 'ES'],
    ['Hauptstr. 5, 8010 Graz, Österreich', 'AT'],
    ['Tesco, London, UK', 'GB'],
    ['Οδός 1, Αθήνα, Ελλάδα', 'GR'],
    ['Lidl Split Hrvatska', 'HR'],
    ['Edeka Hamburg', null],
    ['', null],
  ];
  for (const [address, code] of cases) it(address || '(empty)', () => expect(detectCountry(address)).toBe(code));
  it('every country has a language', () => {
    for (const langs of Object.values(COUNTRY_LANGS)) expect(langs.length).toBeGreaterThan(0);
  });
});
