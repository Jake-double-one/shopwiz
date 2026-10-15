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
    expect(list.inactive).toEqual([{ id: expect.any(String), name: 'diapers', priority: 'important' }]);
    // the assistant shows up in the history like a person
    const snap = app.store.snapshot(app.store.resolve(id, null).space.uid);
    expect(snap.devices.find((d) => d.name === 'Claude')).toMatchObject({ ai: true });
  });

  it('speaks MCP: tools depend on the permission', async () => {
    const init = await mcp(`/mcp/${key}`, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe('shopwiz');
    const tools = await mcp(`/mcp/${key}`, 'tools/list', {});
    expect(tools.body.result.tools.map((t) => t.name)).toEqual([
      'list_lists', 'read_list', 'add_items', 'check_items', 'update_item', 'add_groups', 'order_groups', 'rename_group', 'delete_group', 'set_travel_mode', 'set_translations', 'move_to_inactive', 'bring_back',
    ]);
    const added = await mcp(`/mcp/${key}`, 'tools/call', { name: 'add_items', arguments: { items: [{ name: 'apples', quantity: 6 }] } });
    expect(toolData(added).added).toEqual(['apples']);
    const read = await mcp(`/mcp/${key}`, 'tools/call', { name: 'read_list', arguments: {} });
    expect(toolData(read).items.find((i) => i.name === 'apples').amount).toBe('6×');

    app.store.db.q('UPDATE spaces SET ai_write = 0').run();
    const ro = await mcp(`/mcp/${key}`, 'tools/list', {});
    expect(ro.body.result.tools.map((t) => t.name)).toEqual(['list_lists', 'read_list']);
    expect((await mcp('/mcp/swk_nonononononononononononono', 'tools/list', {})).status).toBe(401);
  });

  it('creates, sorts and fills groups; travel mode and own translations', async () => {
    app.store.db.q('UPDATE spaces SET ai_write = 1').run();
    const call = async (name, args) => toolData(await mcp(`/mcp/${key}`, 'tools/call', { name, arguments: args }));
    expect(await call('add_groups', { groups: ['Dairy', 'Bakery', 'dairy', '  Bakery '] })).toMatchObject({ created: ['Dairy', 'Bakery'], alreadyThere: ['dairy', 'Bakery'] });
    // into a group: new items, and items that are already on the list move there
    const add = await call('add_items', { items: [{ name: 'butter', group: 'Dairy' }, { name: 'milk', group: 'Dairy' }, { name: 'rolls', group: 'Bakery' }] });
    expect(add).toMatchObject({ added: ['butter', 'rolls'], merged: ['milk'], movedToGroup: ['milk'] });
    expect(await call('order_groups', { groups: ['bakery', 'Fruit'] })).toMatchObject({ groups: ['Bakery', 'Dairy'], notFound: ['Fruit'] });
    let list = await call('read_list', {});
    expect(list.groups).toEqual(['Bakery', 'Dairy']);
    expect(list.items.find((i) => i.name === 'milk').group).toBe('Dairy');
    // moving an item into a group that doesn't exist yet creates it at the end
    expect(await call('update_item', { item: 'apples', group: 'Fruit & veg' })).toMatchObject({ item: { group: 'Fruit & veg' } });
    expect((await call('read_list', {})).groups).toEqual(['Bakery', 'Dairy', 'Fruit & veg']);
    expect(await call('rename_group', { group: 'Fruit & veg', name: 'Produce' })).toMatchObject({ renamed: { from: 'Fruit & veg', to: 'Produce' } });

    // translations need a language
    const noLang = await mcp(`/mcp/${key}`, 'tools/call', { name: 'set_translations', arguments: { translations: [{ item: 'milk', text: 'latte' }] } });
    expect(noLang.body.result.isError).toBe(true);
    const travel = await call('set_travel_mode', { country: 'it' });
    expect(travel.travelMode).toMatchObject({ country: 'IT', language: 'it', countryName: 'Italy' });
    expect(travel.untranslated).toEqual(expect.arrayContaining(['milk', 'butter', 'rolls']));
    expect(await call('set_translations', { translations: [{ item: 'milk', text: 'latte' }, { item: 'Butter', text: 'burro' }, { item: 'caviar', text: 'caviale' }] })).toMatchObject({
      language: 'it',
      translated: ['milk', 'butter'],
      notFound: ['caviar'],
    });
    await call('add_items', { items: [{ name: 'pasta', translation: 'pasta', group: 'Pantry' }] });
    list = await call('read_list', {});
    expect(list.list.travelMode).toEqual({ country: 'IT', language: 'it' });
    expect(Object.fromEntries(list.items.filter((i) => i.translation).map((i) => [i.name, i.translation]))).toEqual({ milk: 'latte', butter: 'burro', pasta: 'pasta' });
    // manual translations: the app does not replace them with machine ones
    const uid = app.store.resolve(id, null).space.uid;
    expect(app.store.snapshot(uid).translations.find((t) => t.norm === 'milk')).toMatchObject({ auto: false, text: 'latte' });

    // the same over REST
    expect((await (await req('POST', '/api/v1/lists/default/groups', { auth: key, body: { groups: ['Drinks'] } })).json()).created).toEqual(['Drinks']);
    expect((await (await req('PUT', '/api/v1/lists/default/groups', { auth: key, body: { groups: ['Drinks'] } })).json()).groups[0]).toBe('Drinks');
    await req('PATCH', '/api/v1/lists/default/items/rolls', { auth: key, body: { group: '', translation: 'panini' } });
    await req('PUT', '/api/v1/lists/default/translations', { auth: key, body: { translations: [{ item: 'pasta', text: '' }] } });
    expect((await req('DELETE', '/api/v1/lists/default/groups/Produce', { auth: key })).status).toBe(200);
    list = await (await req('GET', '/api/v1/lists/default', { auth: key })).json();
    expect(list.groups).toEqual(['Drinks', 'Bakery', 'Dairy', 'Pantry']);
    expect(list.items.find((i) => i.name === 'rolls')).toMatchObject({ translation: 'panini' });
    expect(list.items.find((i) => i.name === 'rolls').group).toBeUndefined();
    expect(list.items.find((i) => i.name === 'pasta').translation).toBeUndefined();
    expect(list.items.find((i) => i.name === 'apples').group).toBeUndefined(); // its group is gone, the item stays
    expect((await (await req('PUT', '/api/v1/lists/default/travel', { auth: key, body: { off: true } })).json()).travelMode).toBeNull();
    expect((await req('PUT', '/api/v1/lists/default/travel', { auth: key, body: { country: 'XX' } })).status).toBe(400);
  });

  it('knows inactive items: takes them off the list, brings them back, remembers for later', async () => {
    app.store.db.q('UPDATE spaces SET ai_write = 1').run();
    const call = async (name, args) => toolData(await mcp(`/mcp/${key}`, 'tools/call', { name, arguments: args }));
    await call('add_items', { items: [{ name: 'flour', quantity: 1, unit: 'kg', group: 'Baking', note: 'type 550' }, 'sugar', 'eggs'] });
    expect(await call('move_to_inactive', { items: ['flour', 'sugar'] })).toMatchObject({ movedToInactive: ['flour', 'sugar'] });
    expect(await call('move_to_inactive', { items: ['flour'] })).toMatchObject({ alreadyInactive: ['flour'] });
    let list = await call('read_list', {});
    expect(list.inactiveCount).toBeGreaterThanOrEqual(2);
    list = await call('read_list', { includeInactive: true });
    expect(list.inactive.find((i) => i.name === 'flour')).toMatchObject({ amount: '1 kg', group: 'Baking', note: 'type 550' });
    // back with everything it had
    expect(await call('bring_back', { items: ['flour', 'eggs', 'unicorn'] })).toMatchObject({ backOnList: ['flour'], alreadyOnList: ['eggs'], notFound: ['unicorn'] });
    list = await call('read_list', {});
    expect(list.items.find((i) => i.name === 'flour')).toMatchObject({ amount: '1 kg', group: 'Baking', note: 'type 550', done: false });
    // adding an inactive name brings it back, too
    expect((await call('add_items', { items: ['sugar'] })).reactivated).toEqual(['sugar']);
    // for later: straight to inactive – and a known inactive name stays there
    await call('move_to_inactive', { items: ['sugar'] });
    expect(await call('add_items', { items: ['baking powder', 'sugar'], forLater: true })).toMatchObject({ addedToInactive: ['baking powder'], alreadyKnown: ['sugar'] });
    list = await call('read_list', { includeInactive: true });
    expect(list.inactive.map((i) => i.name)).toEqual(expect.arrayContaining(['sugar', 'baking powder']));
    expect(list.items.map((i) => i.name)).not.toContain('sugar');
    // after shopping: everything checked to inactive
    await call('check_items', { items: ['flour', 'eggs'] });
    expect((await call('move_to_inactive', { allChecked: true })).movedToInactive.sort()).toEqual(expect.arrayContaining(['eggs', 'flour']));
    expect((await call('read_list', {})).items.filter((i) => i.done)).toEqual([]);
    const bad = await mcp(`/mcp/${key}`, 'tools/call', { name: 'move_to_inactive', arguments: {} });
    expect(bad.body.result.isError).toBe(true);
    // REST
    expect((await (await req('POST', '/api/v1/lists/default/bring-back', { auth: key, body: { items: ['sugar'] } })).json()).backOnList).toEqual(['sugar']);
    expect((await (await req('POST', '/api/v1/lists/default/inactive', { auth: key, body: { items: ['sugar'] } })).json()).movedToInactive).toEqual(['sugar']);
  });

  it('a new ID cuts the assistants', async () => {
    await req('POST', `/api/spaces/${id}/renew`, { token: T1 });
    expect((await req('GET', '/api/v1/lists', { auth: key })).status).toBe(401);
  });

  it('splits dictated text', () => {
    expect(splitSpoken('Milch, Brot und 200g Hack; Eier')).toEqual(['Milch', 'Brot', '200g Hack', 'Eier']);
  });
});
