// The official MCP client against ShopWiz – the way Claude, ChatGPT & co. connect.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import Ajv from 'ajv';
import { buildApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

let app, base, id, key;
const T1 = 'token-clientclientclientclient';
beforeAll(async () => {
  app = await buildApp({ ...loadConfig({}), registrations: 'open', dataDir: ':memory:', staticDir: './does-not-exist', mcpEnabled: true, translateProviders: ['none'] });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
  const j = (r) => r.json();
  ({ id } = await j(await fetch(`${base}/api/spaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Home', token: T1, deviceName: 'Phone' }) })));
  key = (await j(await fetch(`${base}/api/spaces/${id}/ai`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopwiz-token': T1 }, body: JSON.stringify({ name: 'Claude' }) }))).key;
  app.store.db.q('UPDATE spaces SET ai_write = 1').run();
});
afterAll(() => app.close());

it('a standard MCP client connects, sees valid schemas and runs a whole shopping conversation', async () => {
  const client = new Client({ name: 'qa', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${key}`)));
  expect(client.getServerVersion().name).toBe('shopwiz');
  expect(client.getInstructions()).toMatch(/Groups are the categories/);
  const { tools } = await client.listTools();
  const ajv = new Ajv({ strict: false });
  for (const t of tools) {
    expect(t.description?.length, t.name).toBeGreaterThan(10);
    expect(t.inputSchema.type, t.name).toBe('object');
    expect(() => ajv.compile(t.inputSchema), t.name).not.toThrow();
  }
  const run = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    const data = JSON.parse(r.content[0].text);
    if (r.isError) throw new Error(`${name}: ${data.message}`);
    return data;
  };
  // "Plan pasta night, sort by aisles of an Italian supermarket and translate"
  await run('add_groups', { groups: ['Pasta & Reis', 'Gemüse', 'Kühlregal'] });
  await run('add_items', {
    items: [
      { name: 'Spaghetti', quantity: 500, unit: 'g', group: 'Pasta & Reis' },
      { name: 'Tomaten', quantity: 6, group: 'Gemüse' },
      { name: 'Parmesan', group: 'Kühlregal', note: 'am Stück' },
      'Basilikum',
    ],
  });
  await run('update_item', { item: 'Basilikum', group: 'Gemüse', priority: 'important' });
  await run('order_groups', { groups: ['Gemüse', 'Pasta & Reis', 'Kühlregal'] });
  const travel = await run('set_travel_mode', { country: 'IT' });
  expect(travel.untranslated.sort()).toEqual(['Basilikum', 'Parmesan', 'Spaghetti', 'Tomaten']);
  await run('set_translations', {
    translations: [
      { item: 'Spaghetti', text: 'spaghetti' },
      { item: 'Tomaten', text: 'pomodori' },
      { item: 'Parmesan', text: 'parmigiano' },
      { item: 'Basilikum', text: 'basilico' },
    ],
  });
  const list = await run('read_list', {});
  expect(list.groups).toEqual(['Gemüse', 'Pasta & Reis', 'Kühlregal']);
  // same order as in the app: important items first in their group
  expect(list.items.map((i) => [i.name, i.group, i.translation])).toEqual([
    ['Basilikum', 'Gemüse', 'basilico'],
    ['Tomaten', 'Gemüse', 'pomodori'],
    ['Spaghetti', 'Pasta & Reis', 'spaghetti'],
    ['Parmesan', 'Kühlregal', 'parmigiano'],
  ]);
  // check off while shopping, take something off
  await run('check_items', { items: ['Tomaten', 'Spaghetti'] });
  await run('move_to_inactive', { items: ['Basilikum'] });
  const after = await run('read_list', { includeInactive: true });
  expect(after.items.filter((i) => i.done).map((i) => i.name)).toEqual(['Tomaten', 'Spaghetti']);
  expect(after.inactive).toEqual([expect.objectContaining({ name: 'Basilikum', group: 'Gemüse', translation: 'basilico' })]);
  // errors arrive as readable tool errors, not as protocol failures
  const bad = await client.callTool({ name: 'rename_group', arguments: { group: 'Fleisch', name: 'Metzger' } });
  expect(bad.isError).toBe(true);
  expect(JSON.parse(bad.content[0].text).message).toMatch(/no group "Fleisch" – groups: Gemüse, Pasta & Reis, Kühlregal/);
  // the phone's live view gets every change: the snapshot has it all
  const uid = app.store.resolve(id, null).space.uid;
  const snap = app.store.snapshot(uid);
  expect(snap.translations.filter((t) => t.lang === 'it' && !t.auto)).toHaveLength(4);
  await client.close();
});
