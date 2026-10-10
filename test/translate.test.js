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

describe('translation providers', () => {
  it('MyMemory: one request per name, no key, entities decoded', async () => {
    const f = fakeFetch((url) => ({ json: { responseStatus: 200, responseData: { translatedText: new URL(url).searchParams.get('q') === 'Milch' ? 'Latte' : 'Pane &amp; Co' } } }));
    const tr = createTranslator({ translateProvider: 'mymemory', translateEmail: 'me@example.org' }, f);
    expect(await tr.translate(['Milch', 'Brot'], 'de', 'it')).toEqual(['Latte', 'Pane & Co']);
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
    expect(await createTranslator({ translateProvider: 'mymemory' }, f).translate(['Eier'], 'de', 'it')).toEqual(['Uova']);
  });

  it('MyMemory: a used-up quota is reported as such', async () => {
    const f = fakeFetch(() => ({ json: { responseStatus: 429, responseDetails: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' } }));
    const tr = createTranslator({ translateProvider: 'mymemory' }, f);
    await expect(tr.translate(['Milch'], 'de', 'it')).rejects.toMatchObject({ code: 'quota' });
    const sneaky = fakeFetch(() => ({ json: { responseStatus: 200, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' } } }));
    await expect(createTranslator({ translateProvider: 'mymemory' }, sneaky).translate(['Milch'], 'de', 'it')).rejects.toMatchObject({ code: 'quota' });
  });

  it('DeepL: free keys use the free host, targets with a variant', async () => {
    const f = fakeFetch(() => ({ json: { translations: [{ text: 'Milk' }, { text: 'Bread' }] } }));
    const tr = createTranslator({ translateProvider: 'deepl', translateApiKey: 'abc:fx' }, f);
    expect(await tr.translate(['Milch', 'Brot'], 'de', 'en')).toEqual(['Milk', 'Bread']);
    expect(f.calls[0].url).toBe('https://api-free.deepl.com/v2/translate');
    expect(f.calls[0].init.headers.authorization).toBe('DeepL-Auth-Key abc:fx');
    expect(f.calls[0].body).toMatchObject({ text: ['Milch', 'Brot'], source_lang: 'DE', target_lang: 'EN-GB' });
  });

  it('DeepL and Google need a key', async () => {
    for (const p of ['deepl', 'google']) {
      const tr = createTranslator({ translateProvider: p }, fakeFetch(() => ({ json: {} })));
      await expect(tr.translate(['Milch'], 'de', 'it')).rejects.toBeInstanceOf(TranslateError);
    }
  });

  it('LibreTranslate: batch request to the configured URL', async () => {
    const f = fakeFetch(() => ({ json: { translatedText: ['Latte', 'Pane'] } }));
    const tr = createTranslator({ translateProvider: 'libretranslate', translateUrl: 'http://lt:5000/' }, f);
    expect(await tr.translate(['Milch', 'Brot'], 'de', 'it')).toEqual(['Latte', 'Pane']);
    expect(f.calls[0].url).toBe('http://lt:5000/translate');
    expect(f.calls[0].body).toMatchObject({ q: ['Milch', 'Brot'], source: 'de', target: 'it', format: 'text' });
  });

  it('Google: v2 with key, Norwegian as "no"', async () => {
    const f = fakeFetch(() => ({ json: { data: { translations: [{ translatedText: 'Melk' }] } } }));
    const tr = createTranslator({ translateProvider: 'google', translateApiKey: 'k' }, f);
    expect(await tr.translate(['Milch'], 'de', 'nb')).toEqual(['Melk']);
    expect(f.calls[0].url).toContain('translation.googleapis.com/language/translate/v2?key=k');
    expect(f.calls[0].body).toMatchObject({ target: 'no' });
  });

  it('"none" is not available; errors and timeouts become TranslateErrors', async () => {
    expect(createTranslator({ translateProvider: 'none' }).available).toBe(false);
    expect(createTranslator({ translateProvider: 'whatever' }).provider).toBe('none');
    const down = createTranslator({ translateProvider: 'mymemory' }, async () => {
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
