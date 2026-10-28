// MCP fuzz test (fixed seed): every tool, random good, half-good and broken arguments.
// Allowed answers: a result, our own readable error, or "invalid params" – never an internal error.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

let app, base, id, key, uid;
const keys = [];
let calls = 0;
const T1 = 'token-fuzzfuzzfuzzfuzzfuzzfuzz';
let s = Number(process.env.SEED ?? 11);
const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];

async function rpc(body, headers = {}) {
  // 120 calls per minute and assistant – rotate through several assistants
  const k = keys[Math.floor(calls++ / 110) % keys.length] ?? key;
  const res = await fetch(`${base}/mcp/${k}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, text, json };
}

beforeAll(async () => {
  app = await buildApp({ ...loadConfig({}), registrations: 'open', dataDir: ':memory:', staticDir: './does-not-exist', mcpEnabled: true, translateProviders: ['none'] });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
  ({ id } = await (await fetch(`${base}/api/spaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Home', token: T1, deviceName: 'Phone' }) })).json());
  const r = await (await fetch(`${base}/api/spaces/${id}/ai`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopwiz-token': T1 }, body: JSON.stringify({ name: 'Claude' }) })).json();
  key = r.key;
  for (let i = 0; i < 20; i++) {
    const x = await (await fetch(`${base}/api/spaces/${id}/ai`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopwiz-token': T1 }, body: JSON.stringify({ name: `Bot ${i}` }) })).json();
    keys.push(x.key);
  }
  uid = app.store.resolve(id, null).space.uid;
  app.store.db.q('UPDATE spaces SET ai_write = 1').run();
  // a second list in shared group mode, to have both kinds
  app.store.applyOp(uid, app.store.device(uid, (await import('../server/core.js')).hashToken(T1)), 'x1', { k: 'list.add', id: 'list00002', name: 'Hardware', pos: 2, groupMode: 'shared' }, Date.now());
});
afterAll(() => app.close());

const JUNK = [null, '', ' ', 0, -5, 3.7, 1e300, true, false, [], {}, ['a'], { a: 1 }, 'x'.repeat(3000), '💥', '\u0000\u0007', '__proto__', 'constructor', 'toString', "' OR 1=1 --", '../../etc', 'default', 'Hardware', 'hardware', 'ware', 'Milk', 'milk', 'Dairy', 'IT', 'it', 'pt-BR', 'xx', '!', '?', '2 l milk', 'milk and bread', 'Salz und Pfeffer'];
const goodish = {
  list: () => pick([undefined, 'default', 'Home', 'Hardware', 'hard', 'list00002', 'nope', ...JUNK]),
  items: () => pick([['milk'], ['2 l milk', '!bread', '? basil'], [{ name: 'butter', group: pick(['Dairy', 'dairy', ' Dairy ', '', 'Fruit  &  veg']), translation: pick([undefined, 'burro', '']) }], [{ name: pick(JUNK) }], JUNK, ['Salz und Pfeffer'], Array.from({ length: 101 }, (_, i) => `item ${i}`)]),
  names: () => pick([['milk'], ['milk', 'bread', 'caviar'], ['Salz und Pfeffer'], [], JUNK, [pick(JUNK)]]),
  groups: () => pick([['Dairy', 'Bakery'], ['dairy'], ['Fruit  &  veg', 'Fruit & veg'], [], [''], JUNK, Array.from({ length: 51 }, (_, i) => `g${i}`)]),
  str: () => pick(['Dairy', 'Bakery', 'milk', 'butter', '', 'Produce', ...JUNK]),
  translations: () => pick([[{ item: 'milk', text: 'latte' }], [{ item: 'butter', text: '' }], [{ item: 'Salz und Pfeffer', text: 'sale e pepe' }], [{ item: pick(JUNK), text: pick(JUNK) }], [], JUNK]),
};
const TOOLS = {
  list_lists: () => ({}),
  read_list: () => ({ list: goodish.list(), includeInactive: pick([true, false, undefined, 'yes']) }),
  add_items: () => ({ list: goodish.list(), items: goodish.items(), ...(rand() < 0.3 && { forLater: pick([true, false, 1]) }) }),
  check_items: () => ({ list: goodish.list(), items: goodish.names(), done: pick([true, false, undefined, 'no']) }),
  update_item: () => ({ list: goodish.list(), item: goodish.str(), ...(rand() < 0.5 && { quantity: pick([2, '2,5', 'abc', -1, 1e9]) }), ...(rand() < 0.4 && { unit: pick(['l', 'kg', '', 'x'.repeat(40)]) }), ...(rand() < 0.3 && { note: goodish.str() }), ...(rand() < 0.3 && { priority: pick(['important', 'normal', 'not important', 'mega']) }), ...(rand() < 0.3 && { name: goodish.str() }), ...(rand() < 0.4 && { group: goodish.str() }), ...(rand() < 0.4 && { translation: goodish.str() }), ...(rand() < 0.3 && { language: pick(['it', 'de', 'xx-YY', 'IT', '']) }) }),
  add_groups: () => ({ list: goodish.list(), groups: goodish.groups() }),
  order_groups: () => ({ list: goodish.list(), groups: goodish.groups() }),
  order_items: () => ({ list: goodish.list(), ...(rand() < 0.7 && { group: goodish.str() }), items: goodish.names() }),
  rename_group: () => ({ list: goodish.list(), group: goodish.str(), name: goodish.str() }),
  delete_group: () => ({ list: goodish.list(), group: goodish.str() }),
  set_travel_mode: () => ({ list: goodish.list(), ...(rand() < 0.7 && { country: pick(['IT', 'it', 'ES', 'XX', '', ...JUNK]) }), ...(rand() < 0.3 && { language: pick(['it', 'ca', 'xx-YY', 'IT', '']) }), ...(rand() < 0.2 && { off: pick([true, false, 'yes']) }) }),
  set_translations: () => ({ list: goodish.list(), translations: goodish.translations(), ...(rand() < 0.3 && { language: pick(['it', 'de', 'bad lang', '']) }) }),
  move_to_inactive: () => ({ list: goodish.list(), ...(rand() < 0.8 && { items: goodish.names() }), ...(rand() < 0.3 && { allChecked: pick([true, false, 'yes']) }) }),
  bring_back: () => ({ list: goodish.list(), items: goodish.names() }),
};

it('MCP tools never fail with an internal error, whatever the arguments', async () => {
  const bugs = [];
  const seen = { ok: 0, ourError: 0, invalidArgs: 0 };
  for (let i = 0; i < Number(process.env.N ?? 600); i++) {
    const name = pick(Object.keys(TOOLS));
    let args = TOOLS[name]();
    if (rand() < 0.08) args = pick([null, 'text', [], 42]);
    if (args && typeof args === 'object') for (const k of Object.keys(args)) if (args[k] === undefined) delete args[k];
    const r = await rpc({ jsonrpc: '2.0', id: i, method: 'tools/call', params: { name, arguments: args } });
    const where = `${name} ${JSON.stringify(args).slice(0, 160)}`;
    if (r.status !== 200) { bugs.push(`HTTP ${r.status} ${r.text.slice(0, 120)} ← ${where}`); continue; }
    if (!r.json) { bugs.push(`not JSON: ${r.text.slice(0, 100)} ← ${where}`); continue; }
    if (r.json.error) {
      // JSON-RPC level: only "invalid params" is fine
      if (r.json.error.code === -32602) seen.invalidArgs++;
      else bugs.push(`rpc error ${r.json.error.code} ${r.json.error.message} ← ${where}`);
      continue;
    }
    const res = r.json.result;
    const txt = res?.content?.[0]?.text ?? '';
    if (res?.isError) {
      let data = null;
      try { data = JSON.parse(txt); } catch { /* */ }
      if (data?.error && data?.message) seen.ourError++;
      else if (/Input validation error|Invalid arguments|invalid_type|Expected/i.test(txt)) seen.invalidArgs++;
      else bugs.push(`tool crashed: ${txt.slice(0, 200)} ← ${where}`);
      continue;
    }
    try { JSON.parse(txt); seen.ok++; } catch { bugs.push(`result not JSON ← ${where}`); }
  }
  // the data must still be consistent and readable
  const snap = app.store.snapshot(uid);
  const groupIds = new Set(snap.groups.map((g) => g.id));
  const dangling = snap.items.filter((it) => it.groupId && !groupIds.has(it.groupId));
  const lists = new Set(snap.lists.map((l) => l.id));
  const lost = snap.items.filter((it) => !lists.has(it.listId));
  // same group name twice in one scope
  const scopes = new Map();
  const dup = [];
  for (const g of snap.groups) {
    const k = `${g.listId ?? ''}|${g.name.toLowerCase()}`;
    if (scopes.has(k)) dup.push(g.name);
    scopes.set(k, true);
  }
  const read = await rpc({ jsonrpc: '2.0', id: 'last', method: 'tools/call', params: { name: 'read_list', arguments: { list: 'Home', includeInactive: true } } });
  expect(bugs.slice(0, 5)).toEqual([]);
  expect(seen.ok).toBeGreaterThan(20); // the fuzzer got through, too
  expect({ bugs: bugs.length, dangling: dangling.length, lost: lost.length, dup }).toEqual({ bugs: 0, dangling: 0, lost: 0, dup: [] });
  expect(read.json.result.isError).toBeFalsy();
}, 120_000);
