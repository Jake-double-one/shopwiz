import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

const T1 = 'token-aaaaaaaaaaaaaaaaaaaaaa';
const T2 = 'token-bbbbbbbbbbbbbbbbbbbbbb';
let app;
let base;

// stands in for MyMemory – tests never reach the internet
const providerCalls = [];
const fakeFetch = async (url) => {
  const q = new URL(url).searchParams.get('q');
  providerCalls.push(q);
  return { ok: true, status: 200, json: async () => ({ responseStatus: 200, responseData: { translatedText: `${q} (it)` } }) };
};

beforeAll(async () => {
  app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist', lookupLimit: 5, fetch: fakeFetch });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `127.0.0.1:${app.server.address().port}`;
});
afterAll(() => app.close());

function client() {
  const ws = new WebSocket(`ws://${base}/ws`);
  const inbox = [];
  const waiters = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    inbox.push(msg);
    for (const w of [...waiters]) {
      if (w.pred(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  const open = new Promise((r) => ws.addEventListener('open', r));
  return {
    ws,
    inbox,
    send: async (m) => {
      await open;
      ws.send(JSON.stringify(m));
    },
    wait: (pred) =>
      new Promise((resolve, reject) => {
        const found = inbox.find(pred);
        if (found) return resolve(found);
        waiters.push({ pred, resolve });
        setTimeout(() => reject(new Error('timeout')), 2000);
      }),
  };
}

const post = (path, body, token) =>
  fetch(`http://${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-shopwiz-token': token } : {}) },
    body: JSON.stringify(body ?? {}),
  });

describe('websocket sync', () => {
  it('syncs ops between two devices', async () => {
    const { id } = await (await post('/api/spaces', { name: 'Home', token: T1, deviceName: 'A' })).json();
    const a = client();
    await a.send({ t: 'hello', space: id, token: T1, name: 'A' });
    const wa = await a.wait((m) => m.t === 'welcome');
    const listId = wa.snapshot.lists[0].id;

    const b = client();
    await b.send({ t: 'hello', space: id.toLowerCase(), token: T2, name: 'B' });
    const wb = await b.wait((m) => m.t === 'welcome');
    expect(wb.snapshot.devices.map((d) => d.name)).toEqual(['A', 'B']);
    await a.wait((m) => m.t === 'presence' && m.online.length === 2);

    await a.send({ t: 'op', id: 'o1', at: Date.now(), op: { k: 'item.add', id: 'item00001', listId, name: 'Milk' } });
    const patch = await b.wait((m) => m.t === 'patch' && m.changes.some((c) => c.e === 'item'));
    expect(patch.changes.find((c) => c.e === 'item').row.name).toBe('Milk');
    const ack = await a.wait((m) => m.t === 'ack' && m.id === 'o1');
    expect(ack.ok).toBe(true);

    // renew moves connected devices
    const r = await (await post(`/api/spaces/${id}/renew`, {}, T2)).json();
    const renewed = await a.wait((m) => m.t === 'renewed');
    expect(renewed.id).toBe(r.id);

    // old id → moved for members
    const c = client();
    await c.send({ t: 'hello', space: id, token: T1, name: 'A' });
    expect((await c.wait((m) => m.t === 'moved')).id).toBe(r.id);

    // kick B
    const devB = wb.me.devId;
    await a.send({ t: 'op', id: 'o2', at: Date.now(), op: { k: 'device.kick', devId: devB } });
    await b.wait((m) => m.t === 'kicked');

    // delete → A is told, can continue
    await post(`/api/spaces/${r.id}/delete`, {}, T1);
    await a.wait((m) => m.t === 'deleted');
    const cont = await (await post(`/api/spaces/${r.id}/continue`, { deviceName: 'A' }, T1)).json();
    expect(cont.id).toMatch(/^[0-9A-Z]{10}$/);
    for (const x of [a, b, c]) x.ws.close();
  });

  it('delivers signals to people in the shop or to one person, never stored', async () => {
    const TA = 'token-cccccccccccccccccccccc';
    const TB = 'token-dddddddddddddddddddddd';
    const TC = 'token-eeeeeeeeeeeeeeeeeeeeee';
    const { id } = await (await post('/api/spaces', { name: 'Shop', token: TA, deviceName: 'A' })).json();
    const join = async (token, name) => {
      const c = client();
      await c.send({ t: 'hello', space: id, token, name });
      const w = await c.wait((m) => m.t === 'welcome');
      return { c, w };
    };
    const a = await join(TA, 'A');
    const b = await join(TB, 'B');
    const c = await join(TC, 'C'); // not in the shop
    const listId = a.w.snapshot.lists[0].id;
    let n = 0;
    const op = (x, o) => x.c.send({ t: 'op', id: `s${++n}`, at: Date.now(), op: o });
    await op(a, { k: 'device.shopping', on: true });
    await op(b, { k: 'device.shopping', on: true });
    await op(a, { k: 'group.add', id: 'grp0shop1', listId, name: 'Bakery' });
    await op(a, { k: 'item.add', id: 'itemshop1', listId, name: 'Bread', groupId: 'grp0shop1' });
    await op(a, { k: 'item.add', id: 'itemshop2', listId, name: 'Milk' });
    await op(a, { k: 'item.set', id: 'itemshop1', fields: { checked: true }, base: {} });
    await b.c.wait((m) => m.t === 'patch' && m.changes.some((ch) => ch.e === 'device' && ch.row?.spot?.group === 'Bakery'));

    // "come to me" to everybody in the shop: B gets it with A's spot, C (not shopping) doesn't
    await a.c.send({ t: 'signal', kind: 'come' });
    const sig = await b.c.wait((m) => m.t === 'signal' && m.kind === 'come');
    expect(sig).toMatchObject({ from: { name: 'A' }, place: 'Bakery', item: 'Bread' });
    expect((await a.c.wait((m) => m.t === 'signalSent')).count).toBe(1);
    // a direct reply reaches A only
    await new Promise((r) => setTimeout(r, 1600));
    await b.c.send({ t: 'signal', kind: 'here', to: a.w.me.devId, place: 'Fruit', replyTo: sig.id });
    expect(await a.c.wait((m) => m.t === 'signal' && m.kind === 'here')).toMatchObject({ place: 'Fruit', from: { name: 'B' } });
    // checking the last open item tells everybody else in the shop
    await op(b, { k: 'item.set', id: 'itemshop2', fields: { checked: true }, base: {} });
    await a.c.wait((m) => m.t === 'signal' && m.kind === 'allDone');
    await new Promise((r) => setTimeout(r, 100));
    expect(c.c.inbox.some((m) => m.t === 'signal')).toBe(false);
    expect(b.c.inbox.some((m) => m.t === 'signal' && m.kind === 'allDone')).toBe(false);
    for (const x of [a, b, c]) x.c.ws.close();
  });

  it('keeps signals for devices that are offline and delivers them once', async () => {
    const TA = 'token-ffffffffffffffffffffff';
    const TB = 'token-gggggggggggggggggggggg';
    const { id } = await (await post('/api/spaces', { name: 'Shop 2', token: TA, deviceName: 'A' })).json();
    const join = async (token, name) => {
      const c = client();
      await c.send({ t: 'hello', space: id, token, name });
      const w = await c.wait((m) => m.t === 'welcome');
      return { c, w };
    };
    const a = await join(TA, 'A');
    let b = await join(TB, 'B');
    await a.c.send({ t: 'op', id: 'q1', at: Date.now(), op: { k: 'device.shopping', on: true } });
    await b.c.send({ t: 'op', id: 'q2', at: Date.now(), op: { k: 'device.shopping', on: true } });
    await a.c.wait((m) => m.t === 'ack' && m.id === 'q1');
    await b.c.wait((m) => m.t === 'ack' && m.id === 'q2');

    // B's display goes off
    b.c.ws.close();
    await a.c.wait((m) => m.t === 'presence' && m.online.length === 1 && a.c.inbox.indexOf(m) > 3);
    // A calls after a minute without reception – the original time is kept
    const sentAt = Date.now() - 60_000;
    await a.c.send({ t: 'signal', kind: 'come', cid: 'c1', at: sentAt });
    expect(await a.c.wait((m) => m.t === 'signalSent')).toMatchObject({ cid: 'c1', count: 1 });

    // B is back: the call is delivered
    b = await join(TB, 'B');
    const sig = await b.c.wait((m) => m.t === 'signal' && m.kind === 'come');
    expect(sig).toMatchObject({ from: { name: 'A' }, at: sentAt });
    await b.c.send({ t: 'signalAck', id: sig.id });
    await new Promise((r) => setTimeout(r, 50));
    b.c.ws.close();

    // confirmed signals are not delivered again
    b = await join(TB, 'B');
    await new Promise((r) => setTimeout(r, 100));
    expect(b.c.inbox.some((m) => m.t === 'signal')).toBe(false);
    a.c.ws.close();
    b.c.ws.close();
  });

  it('translates item names for travel mode and remembers them', async () => {
    const TA = 'token-hhhhhhhhhhhhhhhhhhhhhh';
    const { id } = await (await post('/api/spaces', { name: 'Trip', token: TA, deviceName: 'A' })).json();
    const a = client();
    await a.send({ t: 'hello', space: id, token: TA, name: 'A' });
    expect((await a.wait((m) => m.t === 'welcome')).features).toEqual({ translate: true, translators: ['mymemory'], ai: false, admin: false });

    const r1 = await (await post(`/api/spaces/${id}/translate`, { lang: 'it', from: 'de', names: ['Milch', 'Brot', 'milch'] }, TA)).json();
    expect(r1.translations).toEqual({ milch: 'milch (it)', Brot: 'Brot (it)' });
    const patch = await a.wait((m) => m.t === 'patch' && m.changes.some((c) => c.e === 'translation'));
    expect(patch.changes.map((c) => c.row.norm).sort()).toEqual(['brot', 'milch']);

    // remembered: no second request to the provider
    const before = providerCalls.length;
    const r2 = await (await post(`/api/spaces/${id}/translate`, { lang: 'it', from: 'de', names: ['Brot'] }, TA)).json();
    expect(r2.translations).toEqual({ Brot: 'Brot (it)' });
    expect(providerCalls.length).toBe(before);
    // force: ask the provider again
    await post(`/api/spaces/${id}/translate`, { lang: 'it', from: 'de', names: ['Brot'], force: true }, TA);
    expect(providerCalls.length).toBe(before + 1);

    // service status for the help
    const get = (path, token) => fetch(`http://${base}${path}`, { headers: token ? { 'x-shopwiz-token': token } : {} });
    expect(await (await get(`/api/spaces/${id}/translate/status`, TA)).json()).toEqual({ services: [{ provider: 'mymemory', ok: true }] });
    expect((await get(`/api/spaces/${id}/translate/status`)).status).toBe(403);

    // members only, valid languages only
    expect((await post(`/api/spaces/${id}/translate`, { lang: 'it', from: 'de', names: ['X'] })).status).toBe(403);
    expect((await post(`/api/spaces/${id}/translate`, { lang: 'italian', from: 'de', names: ['X'] }, TA)).status).toBe(400);
    a.ws.close();
  });

  it('rate-limits unknown ids', async () => {
    let last;
    for (let i = 0; i < 7; i++) last = await fetch(`http://${base}/api/spaces/ZZZZZZZZZZ/lists`);
    expect(last.status).toBe(429);
  });

  it('sends security headers', async () => {
    const res = await fetch(`http://${base}/healthz`);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  });
});
