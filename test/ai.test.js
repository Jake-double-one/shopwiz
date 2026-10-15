import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { splitSpoken } from '../server/ai.js';

const T1 = 'token-aiaiaiaiaiaiaiaiaiaiai';
let app;
let base;
let id;
let key;

const req = (method, path, { body, token, auth } = {}) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(token && { 'x-shopwiz-token': token }),
      ...(auth && { authorization: `Bearer ${auth}` }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

/** one MCP JSON-RPC call over Streamable HTTP */
async function mcp(path, method, params, n = 1) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: n, method, params }),
  });
  return { status: res.status, body: await res.json() };
}
const toolData = (r) => JSON.parse(r.body.result.content[0].text);

beforeAll(async () => {
  app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist', mcpEnabled: true, translateProviders: ['none'] });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
  ({ id } = await (await req('POST', '/api/spaces', { body: { name: 'Home', token: T1, deviceName: 'Phone' } })).json());
});
afterAll(() => app.close());

describe('AI assistants', () => {
  it('connects an assistant as its own device (members only)', async () => {
    expect((await req('POST', `/api/spaces/${id}/ai`, { body: { name: 'Claude' } })).status).toBe(403);
    const r = await (await req('POST', `/api/spaces/${id}/ai`, { body: { name: 'Claude' }, token: T1 })).json();
    expect(r.name).toBe('Claude');
    expect(r.key).toMatch(/^swk_/);
    key = r.key;
    const lists = await (await req('GET', '/api/v1/lists', { auth: key })).json();
    expect(lists).toMatchObject({ name: 'Home', assistantsMayChange: false });
    expect(lists.lists).toHaveLength(1);
  });

  it('only reads until the ID allows changes', async () => {
    const r = await req('POST', '/api/v1/lists/default/items', { auth: key, body: { items: ['Milk'] } });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe('read_only');
    expect((await req('GET', '/api/v1/lists', { auth: 'swk_wrongwrongwrongwrongwrong' })).status).toBe(401);
  });

  it('adds, checks, changes and removes items once allowed (REST)', async () => {
    app.store.db.q('UPDATE spaces SET ai_write = 1').run();
    const add = await (await req('POST', '/api/v1/lists/default/items', { auth: key, body: { text: '2 l milk, bread and !diapers' } })).json();
    expect(add.added).toEqual(['milk', 'bread', 'diapers']);
    // same item again → amount added instead of a duplicate
    expect((await (await req('POST', '/api/v1/lists/default/items', { auth: key, body: { items: ['1 l milk'] } })).json()).merged).toEqual(['milk']);
    let list = await (await req('GET', '/api/v1/lists/default', { auth: key })).json();
    expect(list.items.find((i) => i.name === 'milk').amount).toBe('3 l');
    expect(list.items.find((i) => i.name === 'diapers').priority).toBe('important');

    expect((await (await req('POST', '/api/v1/lists/default/check', { auth: key, body: { items: ['bread'] } })).json()).checked).toEqual(['bread']);
    await req('PATCH', '/api/v1/lists/default/items/milk', { auth: key, body: { note: 'lactose free', priority: 'not important' } });
    const rm = await (await req('POST', '/api/v1/lists/default/remove', { auth: key, body: { items: ['diapers', 'caviar'] } })).json();
    expect(rm).toMatchObject({ movedToInactive: ['diapers'], notFound: ['caviar'] });
    list = await (await req('GET', '/api/v1/lists/default?inactive=1', { auth: key })).json();
    expect(list.items.find((i) => i.name === 'milk')).toMatchObject({ note: 'lactose free', priority: 'not important' });
    expect(list.items.find((i) => i.name === 'bread').done).toBe(true);
    expect(list.inactive).toEqual(['diapers']);
    // the assistant shows up in the history like a person
    const snap = app.store.snapshot(app.store.resolve(id, null).space.uid);
    expect(snap.devices.find((d) => d.name === 'Claude')).toMatchObject({ ai: true });
  });

  it('speaks MCP: tools depend on the permission', async () => {
    const init = await mcp(`/mcp/${key}`, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe('shopwiz');
    const tools = await mcp(`/mcp/${key}`, 'tools/list', {});
    expect(tools.body.result.tools.map((t) => t.name)).toEqual(['list_lists', 'read_list', 'add_items', 'check_items', 'update_item', 'remove_items']);
    const added = await mcp(`/mcp/${key}`, 'tools/call', { name: 'add_items', arguments: { items: [{ name: 'apples', quantity: 6 }] } });
    expect(toolData(added).added).toEqual(['apples']);
    const read = await mcp(`/mcp/${key}`, 'tools/call', { name: 'read_list', arguments: {} });
    expect(toolData(read).items.find((i) => i.name === 'apples').amount).toBe('6×');

    app.store.db.q('UPDATE spaces SET ai_write = 0').run();
    const ro = await mcp(`/mcp/${key}`, 'tools/list', {});
    expect(ro.body.result.tools.map((t) => t.name)).toEqual(['list_lists', 'read_list']);
    expect((await mcp('/mcp/swk_nonononononononononononono', 'tools/list', {})).status).toBe(401);
  });

  it('a new ID cuts the assistants', async () => {
    await req('POST', `/api/spaces/${id}/renew`, { token: T1 });
    expect((await req('GET', '/api/v1/lists', { auth: key })).status).toBe(401);
  });

  it('splits dictated text', () => {
    expect(splitSpoken('Milch, Brot und 200g Hack; Eier')).toEqual(['Milch', 'Brot', '200g Hack', 'Eier']);
  });
});
