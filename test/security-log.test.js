// SECURITY_LOG: one JSON line per security event with the client's address – and nothing at all
// while it is off.
import { describe, it, expect } from 'vitest';
import { buildApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { hashPassword } from '../server/password.js';

const T = 'token-seclogseclogseclogsec';
const PW = 'a main admin password';

async function start(extra = {}) {
  const lines = [];
  const app = await buildApp({
    ...loadConfig({}), registrations: 'open',
    dataDir: ':memory:',
    staticDir: './does-not-exist',
    securityLog: true,
    securitySink: (l) => lines.push(JSON.parse(l)),
    adminUser: 'boss',
    adminPasswordHash: await hashPassword(PW, { N: 1024, r: 8, p: 1 }),
    mcpEnabled: true,
    lookupLimit: 3,
    createLimit: 1,
    ...extra,
  });
  const inject = (method, url, { body, token, ip = '203.0.113.7', headers = {} } = {}) =>
    app.inject({ method, url, remoteAddress: ip, headers: { 'content-type': 'application/json', ...(token && { 'x-shopwiz-token': token }), ...headers }, payload: body });
  const events = (name) => lines.filter((l) => l.event === name);
  return { app, lines, inject, events };
}

describe('security log', () => {
  it('writes one line per event: unknown IDs, limits, admin logins, assistant keys', async () => {
    const s = await start();
    const id = (await s.inject('POST', '/api/spaces', { body: { name: 'L', token: T, deviceName: 'A' } })).json().id;
    expect(s.lines).toEqual([]); // ordinary use leaves no trace

    // unknown IDs, then the limit
    for (let i = 0; i < 4; i++) await s.inject('GET', '/api/spaces/ZZZZZZZZZ1/lists', { token: T });
    expect(s.events('id_notfound')).toHaveLength(3);
    expect(s.events('id_notfound')[0]).toMatchObject({ log: 'shopwiz-security', ip: '203.0.113.7', via: 'rest', id: 'ZZZZZZZZZ1' });
    expect(s.events('id_notfound')[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(s.events('id_limited')).toEqual([expect.objectContaining({ ip: '203.0.113.7', via: 'rest' })]);
    // a transfer into an unknown ID counts too
    await s.inject('POST', `/api/spaces/${id}/transfer`, { token: T, ip: '203.0.113.8', body: { to: 'ZZZZZZZZZ2', listId: 'x', itemIds: [] } });
    expect(s.events('id_notfound').at(-1)).toMatchObject({ ip: '203.0.113.8', via: 'transfer', id: 'ZZZZZZZZZ2' });

    // too many new IDs
    expect((await s.inject('POST', '/api/spaces', { body: { name: 'M', token: T, deviceName: 'A' } })).statusCode).toBe(429);
    expect(s.events('create_limited')).toEqual([expect.objectContaining({ ip: '203.0.113.7' })]);

    // admin: wrong password, right password
    await s.inject('POST', '/api/admin/login', { body: { user: 'boss', password: 'nope nope nope' }, headers: { host: 'localhost' }, ip: '198.51.100.9' });
    expect(s.events('admin_login_failed')).toEqual([expect.objectContaining({ ip: '198.51.100.9', method: 'password' })]);
    await s.inject('POST', '/api/admin/login', { body: { user: 'boss', password: PW }, headers: { host: 'localhost' }, ip: '198.51.100.9' });
    expect(s.events('admin_login')).toEqual([expect.objectContaining({ ip: '198.51.100.9', method: 'password', role: 'main' })]);

    // assistants: an unknown key over REST and over MCP
    await s.inject('GET', '/api/v1/lists', { headers: { authorization: 'Bearer swk_nopenopenopenopenopenope' }, ip: '203.0.113.9' });
    await s.inject('POST', '/mcp/swk_nopenopenopenopenopenope', { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, ip: '203.0.113.9' });
    expect(s.events('ai_key_invalid')).toEqual([expect.objectContaining({ ip: '203.0.113.9', via: 'rest' }), expect.objectContaining({ ip: '203.0.113.9', via: 'mcp' })]);

    // nothing about lists or items in any line
    for (const l of s.lines) expect(Object.keys(l).sort()).toEqual(expect.not.arrayContaining(['name', 'items', 'token']));
    await s.app.close();
  });

  it('sync connections: unknown ID, flood', { timeout: 20_000 }, async () => {
    const s = await start();
    const id = (await s.inject('POST', '/api/spaces', { body: { name: 'W', token: T, deviceName: 'A' } })).json().id;
    await s.app.listen({ port: 0, host: '127.0.0.1' });
    const base = `127.0.0.1:${s.app.server.address().port}`;
    const open = async () => {
      const ws = new WebSocket(`ws://${base}/ws`);
      await new Promise((r) => ws.addEventListener('open', r));
      return ws;
    };
    const a = await open();
    a.send(JSON.stringify({ t: 'hello', space: 'ZZZZZZZZZ3', token: T, name: 'A' }));
    await new Promise((r) => a.addEventListener('message', r));
    expect(s.events('id_notfound').at(-1)).toMatchObject({ ip: '127.0.0.1', via: 'ws', id: 'ZZZZZZZZZ3' });
    a.send(JSON.stringify({ t: 'hello', space: id, token: T, name: 'A' }));
    for (let i = 0; i < 700; i++) a.send(JSON.stringify({ t: 'op', id: `s${i}`, op: { k: 'space.update', name: `W ${i}` }, at: Date.now() }));
    await new Promise((r) => a.addEventListener('close', r));
    expect(s.events('ws_flood')).toEqual([expect.objectContaining({ ip: '127.0.0.1', at: 'op' })]);
    await s.app.close();
  });

  it('is off by default – the sink is never called', async () => {
    const lines = [];
    const app = await buildApp({ ...loadConfig({}), registrations: 'open', dataDir: ':memory:', staticDir: './does-not-exist', securitySink: (l) => lines.push(l) });
    for (let i = 0; i < 3; i++) await app.inject({ method: 'GET', url: '/api/spaces/ZZZZZZZZZ4/lists', headers: { 'x-shopwiz-token': T } });
    expect(lines).toEqual([]);
    expect(loadConfig({ SECURITY_LOG: 'true' }).securityLog).toBe(true);
    expect(loadConfig({ SECURITY_LOG: 'false' }).securityLog).toBe(false);
    expect(loadConfig({}).securityLog).toBe(false);
    await app.close();
  });
});
