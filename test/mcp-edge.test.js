// MCP edge cases: protocol misuse, ambiguous names, shared groups, parallel calls, permissions.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { hashToken } from '../server/core.js';

let app, base, id, key, uid, phone;
const T1 = 'token-protoprotoprotoprotoproto';
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' };
const post = (path, body, headers = H) => fetch(`${base}${path}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const call = async (name, args, k = key) => {
  const r = await post(`/mcp/${k}`, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const j = await r.json();
  let data = null;
  try {
    data = j.result ? JSON.parse(j.result.content[0].text) : null;
  } catch {
    data = { text: j.result.content[0].text };
  }
  return { status: r.status, j, data, isError: !!j.result?.isError };
};
beforeAll(async () => {
  app = await buildApp({ ...loadConfig({}), registrations: 'open', dataDir: ':memory:', staticDir: './does-not-exist', mcpEnabled: true, translateProviders: ['none'] });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
  ({ id } = await (await post('/api/spaces', { name: 'Home', token: T1, deviceName: 'Phone' }, { 'content-type': 'application/json' })).json());
  key = (await (await post(`/api/spaces/${id}/ai`, { name: 'Claude' }, { 'content-type': 'application/json', 'x-shopwiz-token': T1 })).json()).key;
  uid = app.store.resolve(id, null).space.uid;
  phone = app.store.device(uid, hashToken(T1));
  app.store.db.q('UPDATE spaces SET ai_write = 1').run();
  const op = (o) => app.store.applyOp(uid, phone, `o${Math.random()}`, o, Date.now());
  op({ k: 'list.update', id: app.store.snapshot(uid).lists[0].id, name: 'Wein' });
  op({ k: 'list.add', id: 'list00002', name: 'Weinladen', pos: 2, groupMode: 'own' });
  op({ k: 'list.add', id: 'list00003', name: 'Baumarkt', pos: 3, groupMode: 'shared' });
  op({ k: 'list.add', id: 'list00004', name: 'Drogerie', pos: 4, groupMode: 'shared' });
});
afterAll(() => app.close());

it('protocol edge cases', async () => {
  const out = {};
  out.badJson = (await post(`/mcp/${key}`, '{"jsonrpc":"2.0",')).status;
  out.emptyBody = (await post(`/mcp/${key}`, '')).status;
  out.noAccept = (await post(`/mcp/${key}`, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'content-type': 'application/json' })).status;
  out.textPlain = (await post(`/mcp/${key}`, 'hello', { ...H, 'content-type': 'text/plain' })).status;
  out.get = (await fetch(`${base}/mcp/${key}`)).status;
  out.unknownMethod = (await (await post(`/mcp/${key}`, { jsonrpc: '2.0', id: 1, method: 'foo/bar' })).json()).error?.code;
  out.unknownTool = await call('drop_database', {});
  out.notification = (await post(`/mcp/${key}`, { jsonrpc: '2.0', method: 'notifications/initialized' })).status;
  const batch = await post(`/mcp/${key}`, [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_lists', arguments: {} } }]);
  out.batch = batch.status;
  out.argsArray = (await (await post(`/mcp/${key}`, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'list_lists', arguments: [] } })).json()).error?.code;
  out.proto = await call('add_items', JSON.parse('{"items":["Milk"],"__proto__":{"polluted":1}}'));
  out.polluted = {}.polluted;
  out.bearer = (await fetch(`${base}/mcp`, { method: 'POST', headers: { ...H, authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).status;
  out.noKey = (await fetch(`${base}/mcp`, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).status;
  out.wrongKey = (await post('/mcp/swk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status;
  out.huge = (await post(`/mcp/${key}`, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add_items', arguments: { items: ['x'.repeat(3_000_000)] } } })).status;
  out.oldProtocol = (await post(`/mcp/${key}`, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { ...H, 'mcp-protocol-version': '1999-01-01' })).status;
  expect(out.badJson).toBeLessThan(500);
  expect(out.emptyBody).toBeLessThan(500);
  expect(out.noAccept).toBeLessThan(500);
  expect(out.textPlain).toBeLessThan(500);
  expect(out.get).toBe(405);
  expect(out.unknownMethod).toBe(-32601);
  expect(out.unknownTool.status).toBe(200);
  expect(out.notification).toBe(202);
  expect(out.batch).toBeLessThan(500);
  expect(out.argsArray).toBe(-32602);
  expect(out.proto.status).toBe(400); // JSON with __proto__ is refused as a whole
  expect(out.polluted).toBeUndefined();
  expect(out.bearer).toBe(200);
  expect(out.noKey).toBe(401);
  expect(out.wrongKey).toBe(401);
  expect(out.huge).toBe(413);
  expect(out.oldProtocol).toBeLessThan(500);
});

it('semantics: lists, groups, translations, permissions', async () => {
  // ambiguous part of a list name is refused, a clear one works
  expect((await call('read_list', { list: 'ein' })).data.error).toBe('ambiguous');
  expect((await call('read_list', { list: 'laden' })).data.list.name).toBe('Weinladen');
  expect((await call('read_list', { list: 'wein' })).data.list.name).toBe('Wein');
  // shared groups: created via one list, visible in the other shared list – and not in an own-groups list
  await call('add_groups', { list: 'Baumarkt', groups: ['Tools'] });
  expect((await call('read_list', { list: 'Drogerie' })).data.groups).toEqual(['Tools']);
  expect((await call('read_list', { list: 'Wein' })).data.groups).toEqual([]);
  // the same item twice at once: one item, amounts added
  await Promise.all(Array.from({ length: 10 }, () => call('add_items', { list: 'Wein', items: ['1 Rotwein'] })));
  const wine = (await call('read_list', { list: 'Wein' })).data.items.filter((i) => i.name === 'Rotwein');
  expect(wine).toHaveLength(1);
  expect(wine[0].amount).toBe('10×');
  // parallel group creation never doubles a group
  await Promise.all(Array.from({ length: 10 }, (_, i) => call('add_items', { list: 'Wein', items: [{ name: `Wine ${i}`, group: 'Rot' }] })));
  expect((await call('read_list', { list: 'Wein' })).data.groups).toEqual(['Rot']);
  // names with "und" stay one item where an exact item is meant
  await call('add_items', { list: 'Wein', items: [{ name: 'Salz und Pfeffer' }] });
  expect((await call('update_item', { list: 'Wein', item: 'Salz und Pfeffer', note: 'grob' })).data.item).toMatchObject({ name: 'Salz und Pfeffer', note: 'grob' });
  await call('set_travel_mode', { list: 'Wein', country: 'IT' });
  expect((await call('set_translations', { list: 'Wein', translations: [{ item: 'Salz und Pfeffer', text: 'sale e pepe' }] })).data.translated).toEqual(['Salz und Pfeffer']);
  // a translation is not an item: an item named in another list is not found here
  expect((await call('set_translations', { list: 'Wein', translations: [{ item: 'Milk', text: 'latte' }] })).data.notFound).toEqual(['Milk']);
  // renaming a group onto another name that exists is refused
  await call('add_groups', { list: 'Wein', groups: ['Weiß'] });
  expect((await call('rename_group', { list: 'Wein', group: 'Rot', name: 'weiß' })).data.error).toBe('exists');
  // the assistant can never delete items: inactive only, and back with one tap
  await call('move_to_inactive', { list: 'Wein', items: ['Rotwein'] });
  const snap = app.store.snapshot(uid);
  expect(snap.items.find((i) => i.name === 'Rotwein')).toMatchObject({ parked: true });
  // read-only: write tools are not even offered, a call is refused cleanly
  app.store.db.q('UPDATE spaces SET ai_write = 0').run();
  const ro = await call('add_groups', { list: 'Wein', groups: ['X'] });
  expect(ro.status).toBe(200);
  expect(ro.j.error ?? ro.isError).toBeTruthy();
  expect(app.store.snapshot(uid).groups.find((g) => g.name === 'X')).toBeUndefined();
  app.store.db.q('UPDATE spaces SET ai_write = 1').run();
  // a removed assistant is cut off at once
  const dev = app.store.snapshot(uid).devices.find((d) => d.name === 'Claude');
  app.store.applyOp(uid, phone, 'kick', { k: 'device.kick', devId: dev.devId }, Date.now());
  expect((await post(`/mcp/${key}`, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
});
