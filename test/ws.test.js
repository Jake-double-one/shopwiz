import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

const T1 = 'token-aaaaaaaaaaaaaaaaaaaaaa';
const T2 = 'token-bbbbbbbbbbbbbbbbbbbbbb';
let app;
let base;

beforeAll(async () => {
  app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist', lookupLimit: 5 });
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
