// An ID's own translation service: its key is stored encrypted, used instead of the server's services,
// never shown to anybody, and not subject to the server's daily character cap.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

const A = 'token-trcfgtrcfgtrcfgtrcfg1';
const KEY = 'abcdefgh-1234-5678-deepl:fx';

/** stands in for every service – records what was asked, answers like the real one would */
function fakeProvider() {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ host: u.host, path: u.pathname, auth: init.headers?.authorization ?? '', body: init.body ? JSON.parse(init.body) : null });
    const json = (data) => ({ ok: true, status: 200, json: async () => data });
    if (u.host === 'api.mymemory.translated.net') return json({ responseStatus: 200, responseData: { translatedText: `${u.searchParams.get('q')} (mm)` } });
    if (u.host === 'api-free.deepl.com' && u.pathname === '/v2/usage') return json({ character_count: 5, character_limit: 500_000 });
    if (u.host === 'api-free.deepl.com') return json({ translations: JSON.parse(init.body).text.map((t) => ({ text: `${t} (dl)` })) });
    if (u.host === 'translation.googleapis.com') return json({ data: { translations: (JSON.parse(init.body ?? '{}').q ?? []).map((t) => ({ translatedText: `${t} (gg)` })) } });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { calls, fetch };
}

async function start(extra = {}) {
  const p = fakeProvider();
  const app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist', fetch: p.fetch, translateProviders: ['mymemory'], ...extra });
  const h = { 'x-shopwiz-token': A, 'content-type': 'application/json' };
  const id = (await app.inject({ method: 'POST', url: '/api/spaces', payload: { name: 'T', token: A, deviceName: 'Phone' } })).json().id;
  return {
    app,
    id,
    calls: p.calls,
    tr: (names, extra2 = {}) => app.inject({ method: 'POST', url: `/api/spaces/${id}/translate`, headers: h, payload: { lang: 'it', from: 'de', names, ...extra2 } }),
    cfg: (body, sid = id) => app.inject({ method: 'POST', url: `/api/spaces/${sid}/translate/config`, headers: h, payload: body }),
    status: () => app.inject({ method: 'GET', url: `/api/spaces/${id}/translate/status`, headers: h }),
    get: (path, sid = id) => app.inject({ method: 'GET', url: `/api/spaces/${sid}/${path}`, headers: h }),
  };
}

describe('an ID with its own translation service', () => {
  it('uses its own DeepL key instead of the server\'s service, keeps it encrypted and never shows it', async () => {
    const s = await start();
    expect((await s.tr(['Milch'])).json().by.Milch).toBe('mymemory'); // the server's service, as before

    const r = await s.cfg({ mode: 'own', provider: 'deepl', key: KEY });
    expect(r.statusCode).toBe(200);
    expect(r.json().translate).toEqual({ mode: 'own', provider: 'deepl', hasKey: true, keyHint: 'l:fx', region: '', email: '' });
    const stored = s.app.store.db.q('SELECT tr_key FROM spaces').get().tr_key;
    expect(stored.startsWith('enc1.')).toBe(true);
    expect(stored).not.toContain('abcdefgh');

    const t = await s.tr(['Brot']);
    expect(t.json()).toMatchObject({ translations: { Brot: 'Brot (dl)' }, by: { Brot: 'deepl' } });
    const dl = s.calls.find((c) => c.host === 'api-free.deepl.com' && c.path === '/v2/translate');
    expect(dl.auth).toBe(`DeepL-Auth-Key ${KEY}`);
    expect(dl.body.text).toEqual(['Brot']);

    // nothing a member gets to see carries the key: snapshot, history, status
    await s.app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(`ws://127.0.0.1:${s.app.server.address().port}/ws`);
    const welcome = await new Promise((resolve) => {
      ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', space: s.id, token: A, name: 'Phone' })));
      ws.addEventListener('message', (e) => JSON.parse(e.data).t === 'welcome' && resolve(e.data));
    });
    ws.close();
    expect(welcome).not.toContain('abcdefgh');
    expect(JSON.parse(welcome).snapshot.space.translate).toMatchObject({ mode: 'own', provider: 'deepl', hasKey: true });
    const act = (await s.get('activity')).body;
    expect(act).toContain('translate.config');
    expect(act).not.toContain('abcdefgh');
    const st = (await s.status()).json();
    expect(st.own).toBe(true);
    expect(st.services).toEqual([{ provider: 'deepl', ok: true, usage: { used: 5, limit: 500_000 } }]);
    expect(JSON.stringify(st)).not.toContain('abcdefgh');

    // saving again without typing a key keeps the stored one; another service needs its own key
    expect((await s.cfg({ mode: 'own', provider: 'deepl', key: '' })).json().translate.hasKey).toBe(true);
    expect((await s.cfg({ mode: 'own', provider: 'google', key: '' })).json()).toEqual({ error: 'invalid', message: 'key' });
    expect((await s.cfg({ mode: 'own', provider: 'libretranslate', key: 'x' })).statusCode).toBe(400); // an address the server would fetch – not for members
    expect((await s.cfg({ mode: 'own', provider: 'deepl', key: 'with space' })).statusCode).toBe(400);
    expect((await s.cfg({ mode: 'own', provider: 'mymemory', email: 'not-an-email' })).statusCode).toBe(400);
    expect((await s.cfg({ mode: 'own', provider: 'mymemory', email: 'me@example.com' })).json().translate).toMatchObject({ provider: 'mymemory', hasKey: false, email: 'me@example.com' });

    // off: translations are typed by hand; server: back to the server's chain
    expect((await s.cfg({ mode: 'off' })).statusCode).toBe(200);
    expect((await s.tr(['Eier'])).statusCode).toBe(501);
    expect((await s.status()).json()).toEqual({ services: [], own: false });
    expect((await s.cfg({ mode: 'server' })).statusCode).toBe(200);
    expect((await s.tr(['Eier'])).json().by.Eier).toBe('mymemory');
    await s.app.close();
  });

  it('the server\'s daily character cap is for the server\'s services – not for an ID\'s own key', async () => {
    const s = await start({ translateDailyChars: 10 });
    expect((await s.tr(['Zwiebelkuchen'])).statusCode).toBe(429);
    await s.cfg({ mode: 'own', provider: 'deepl', key: KEY });
    expect((await s.tr(['Zwiebelkuchen'])).statusCode).toBe(200);
    expect((await s.tr(['Zwiebelkuchen'], { force: true })).statusCode).toBe(200);
    await s.app.close();
  });

  it('server mode is refused when the server has no service; a stale mode falls back to off', async () => {
    const s = await start({ translateProviders: ['none'] });
    expect((await s.cfg({ mode: 'server' })).json()).toEqual({ error: 'not_configured' });
    expect((await s.tr(['Milch'])).statusCode).toBe(501);
    expect((await s.cfg({ mode: 'own', provider: 'mymemory' })).statusCode).toBe(200);
    expect((await s.tr(['Milch'])).json().by.Milch).toBe('mymemory');
    await s.app.close();
  });

  it('continuing a deleted ID keeps its translation setting', async () => {
    const s = await start();
    await s.cfg({ mode: 'own', provider: 'deepl', key: KEY });
    await s.app.inject({ method: 'POST', url: `/api/spaces/${s.id}/delete`, headers: { 'x-shopwiz-token': A }, payload: {} });
    const c = (await s.app.inject({ method: 'POST', url: `/api/spaces/${s.id}/continue`, headers: { 'x-shopwiz-token': A }, payload: { deviceName: 'Phone' } })).json().id;
    const r = await s.app.inject({ method: 'POST', url: `/api/spaces/${c}/translate`, headers: { 'x-shopwiz-token': A }, payload: { lang: 'it', from: 'de', names: ['Butter'] } });
    expect(r.json().by.Butter).toBe('deepl');
    await s.app.close();
  });
});

describe('ENCRYPTION_KEY', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopwiz-trkey-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('a stored key survives restarts with the same ENCRYPTION_KEY and is unusable with another', async () => {
    const boot = (encryptionKey) => start({ dataDir: dir, encryptionKey });
    let s = await boot('the first key of this server');
    await s.cfg({ mode: 'own', provider: 'deepl', key: KEY });
    const id = s.id;
    await s.app.close();

    s = await boot('the first key of this server');
    let r = await s.app.inject({ method: 'POST', url: `/api/spaces/${id}/translate`, headers: { 'x-shopwiz-token': A }, payload: { lang: 'it', from: 'de', names: ['Milch'] } });
    expect(r.json().by.Milch).toBe('deepl');
    await s.app.close();

    s = await boot('a different key');
    r = await s.app.inject({ method: 'POST', url: `/api/spaces/${id}/translate`, headers: { 'x-shopwiz-token': A }, payload: { lang: 'it', from: 'de', names: ['Brot'] } });
    expect(r.statusCode).toBe(501); // the key can't be opened: translation is off for the ID until a new key is saved
    await s.app.close();
  });
});
