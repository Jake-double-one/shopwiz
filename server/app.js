import Fastify, { LogController } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { openDb } from './db.js';
import { Store, OpError, hashToken, mapDevice, LIMITS, newEntityId } from './core.js';
import { Hub } from './hub.js';
import { createSkins } from './skins.js';
import { Limiter } from './limiter.js';
import { createTranslator, TranslateError } from './translate.js';
import { createAi, AiError } from './ai.js';
import { openApi } from './openapi.js';
import { LANG_RE } from '../shared/countries.js';
import { normalizeName } from '../shared/parse.js';
import { parseSpaceId, formatSpaceId } from '../shared/ids.js';

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function buildApp(config) {
  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      level: config.logLevel,
      // never log addresses, ids or tokens
      serializers: { req: (req) => ({ method: req.method }) },
    },
  });

  const db = openDb(config.dataDir);
  const store = new Store(db, config);
  const hub = new Hub();
  const limiter = new Limiter({ limit: config.lookupLimit, windowMs: config.lookupWindowMin * 60_000 });
  // creating ids is cheap for clients – cap it per address to keep spam out of the database
  const createLimiter = new Limiter({ limit: config.createLimit, windowMs: 3_600_000 });
  const translator = createTranslator(config, config.fetch, (provider, e) => {
    if (e.code !== 'quota') app.log.warn({ provider, err: e.message }, 'translation service failed – trying the next one');
  });
  for (const p of translator.problems) app.log.warn(`translation service "${p.provider}" is off: ${p.problem}`);
  // names sent to the translation provider per ID and hour – remembered ones are free
  const trUsage = new Map();
  const trIpUsage = new Map(); // the same budget per address, so many new IDs don't multiply it
  const wsPerIp = new Map(); // open sync connections per address
  app.decorate('store', store);
  app.decorate('hub', hub);

  const cleanup = () => {
    try {
      store.cleanup();
    } catch (e) {
      app.log.error(e, 'cleanup failed');
    }
  };
  cleanup();
  const cleanupTimer = setInterval(cleanup, 3_600_000).unref();
  app.addHook('onClose', async () => {
    clearInterval(cleanupTimer);
    limiter.stop();
    createLimiter.stop();
    db.close();
  });

  // ---------- security headers ----------
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), interest-cohort=()');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; media-src 'self' blob:; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    return payload;
  });

  // ---------- helpers ----------
  const clientKey = (req) => req.ip || 'unknown';

  /** Resolve :id for REST. Applies the lookup limiter. */
  function lookup(req, reply, { requireMember = false } = {}) {
    const key = clientKey(req);
    if (limiter.blocked(key)) {
      reply.code(429).send({ error: 'rate_limited' });
      return null;
    }
    const id = parseSpaceId(req.params.id);
    const token = req.headers['x-shopwiz-token'];
    const tokenHash = typeof token === 'string' && TOKEN_RE.test(token) ? hashToken(token) : null;
    const res = id ? store.resolve(id, tokenHash) : { status: 'notfound' };
    if (res.status === 'notfound') {
      limiter.fail(key);
      reply.code(404).send({ error: 'notfound' });
      return null;
    }
    if (requireMember) {
      if (!tokenHash || !store.isMember(res.space?.uid ?? -1, tokenHash)) {
        reply.code(403).send({ error: 'not_member' });
        return null;
      }
    }
    return { ...res, tokenHash };
  }

  function sendError(reply, e) {
    if (e instanceof OpError) return reply.code(e.code === 'notfound' ? 404 : 400).send({ error: e.code, message: e.message });
    throw e;
  }

  // ---------- REST ----------
  app.get('/healthz', async () => ({ ok: true }));

  app.post('/api/spaces', async (req, reply) => {
    const { name, token, deviceName, listName, doc } = req.body ?? {};
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return reply.code(400).send({ error: 'invalid', message: 'token' });
    if (createLimiter.blocked(clientKey(req))) return reply.code(429).send({ error: 'rate_limited' });
    createLimiter.fail(clientKey(req));
    try {
      const id = store.createSpace({ name, token, deviceName, listName });
      // optional: start the new space from a backup file
      if (doc) {
        const { space } = store.resolve(id, null);
        try {
          const res = store.importDoc(space.uid, store.device(space.uid, hashToken(token)), doc);
          return { id, stats: res.stats };
        } catch (e) {
          store.db.q('DELETE FROM spaces WHERE uid = ?').run(space.uid); // don't leave a half-imported id behind
          throw e;
        }
      }
      return { id };
    } catch (e) {
      return sendError(reply, e);
    }
  });

  // Lists of a space – used to pick a target when transferring items. Knowing the id is enough.
  app.get('/api/spaces/:id/lists', async (req, reply) => {
    const r = lookup(req, reply);
    if (!r) return;
    if (r.status !== 'ok') return reply.code(404).send({ error: 'notfound' });
    return { id: r.space.public_id, name: r.space.name, lists: store.listsOf(r.space.uid) };
  });

  app.get('/api/spaces/:id/activity', async (req, reply) => {
    const r = lookup(req, reply, { requireMember: true });
    if (!r) return;
    const listId = typeof req.query.list === 'string' ? req.query.list : '';
    return { activity: store.activity(r.space.uid, listId) };
  });

  app.post('/api/spaces/:id/renew', async (req, reply) => {
    const r = lookup(req, reply, { requireMember: true });
    if (!r) return;
    if (r.status !== 'ok') return reply.code(409).send({ error: r.status });
    // a new ID cuts the AI connections – tell the devices which ones are gone
    const aiDevs = store.db.q("SELECT dev_id FROM devices WHERE space_uid = ? AND kind = 'ai'").all(r.space.uid);
    const newId = store.renew(r.space.uid);
    if (aiDevs.length) hub.broadcast(r.space.uid, { t: 'patch', changes: aiDevs.map((d) => ({ e: 'device', del: d.dev_id })) });
    hub.broadcast(r.space.uid, { t: 'renewed', id: newId });
    return { id: newId };
  });

  app.post('/api/spaces/:id/delete', async (req, reply) => {
    const r = lookup(req, reply, { requireMember: true });
    if (!r) return;
    if (r.status !== 'ok') return reply.code(409).send({ error: r.status });
    const dev = store.device(r.space.uid, r.tokenHash);
    store.deleteSpace(r.space.uid, dev.name);
    hub.broadcast(r.space.uid, { t: 'deleted', by: dev.name, at: Date.now() });
    return { ok: true };
  });

  app.post('/api/spaces/:id/continue', async (req, reply) => {
    const r = lookup(req, reply, { requireMember: true });
    if (!r) return;
    if (r.status !== 'deleted') return reply.code(409).send({ error: 'not_deleted' });
    try {
      return { id: store.continueSpace(r.space.uid, r.tokenHash, req.body?.deviceName) };
    } catch (e) {
      if (e instanceof OpError) return reply.code(400).send({ error: e.code, message: e.message });
      throw e;
    }
  });

  // Import a backup (parsed client side, see shared/backup.js) into an existing space
  app.post('/api/spaces/:id/import', async (req, reply) => {
    const r = lookup(req, reply, { requireMember: true });
    if (!r) return;
    if (r.status !== 'ok') return reply.code(409).send({ error: r.status });
    const dev = store.device(r.space.uid, r.tokenHash);
    try {
      const res = store.importDoc(r.space.uid, dev, req.body?.doc, { defaultListId: typeof req.body?.listId === 'string' ? req.body.listId : null });
      if (res.changes.length) hub.broadcast(r.space.uid, { t: 'patch', rev: res.rev, changes: res.changes });
      return { stats: res.stats };
    } catch (e) {
      return sendError(reply, e);
    }
  });

  // Travel mode: translate item names (remembered translations first, the provider for the rest)
  app.post('/api/spaces/:id/translate', async (req, reply) => {
    const r = lookup(req, reply, { requireMember: true });
    if (!r) return;
    if (r.status !== 'ok') return reply.code(409).send({ error: r.status });
    if (!translator.available) return reply.code(501).send({ error: 'not_configured' });
    const { lang, from } = req.body ?? {};
    if (!LANG_RE.test(lang ?? '') || !LANG_RE.test(from ?? '')) return reply.code(400).send({ error: 'invalid', message: 'lang' });
    const raw = Array.isArray(req.body?.names) ? req.body.names : [];
    const byNorm = new Map();
    for (const n of raw.slice(0, 50)) {
      if (typeof n !== 'string' || !n.trim()) continue;
      const name = n.trim().slice(0, 120);
      byNorm.set(normalizeName(name), name);
    }
    const uid = r.space.uid;
    // force: ask the provider again (a typed translation is still never overwritten)
    const force = req.body?.force === true;
    const known = force ? new Map() : store.knownTranslations(uid, lang, [...byNorm.keys()]);
    const todo = [...byNorm].filter(([norm]) => !known.has(norm));
    const out = Object.fromEntries([...known].map(([norm, text]) => [byNorm.get(norm), text]));
    if (!todo.length) return { translations: out };

    const now = Date.now();
    let use = trUsage.get(uid);
    if (!use || use.reset <= now) trUsage.set(uid, (use = { count: 0, reset: now + 3_600_000 }));
    const ip = clientKey(req);
    let ipUse = trIpUsage.get(ip);
    if (!ipUse || ipUse.reset <= now) trIpUsage.set(ip, (ipUse = { count: 0, reset: now + 3_600_000 }));
    if (use.count + todo.length > config.translateLimit || ipUse.count + todo.length > config.translateLimit * 2) {
      return reply.code(429).send({ error: 'translate_limit', translations: out });
    }
    use.count += todo.length;
    ipUse.count += todo.length;
    if (trIpUsage.size > 10_000) for (const [k, u] of trIpUsage) if (u.reset <= now) trIpUsage.delete(k);

    let res;
    try {
      res = await translator.translate(todo.map(([, name]) => name), from, lang);
    } catch (e) {
      if (!(e instanceof TranslateError)) throw e;
      const code = e.code === 'config' ? 501 : 503;
      return reply.code(code).send({ error: e.code === 'config' ? 'not_configured' : e.code, translations: out });
    }
    const { texts, providers } = res;
    const changes = store.saveAutoTranslations(uid, lang, todo.map(([norm], i) => [norm, texts[i], providers[i]]));
    if (changes.length) hub.broadcast(uid, { t: 'patch', changes });
    const by = {};
    todo.forEach(([, name], i) => texts[i] && ((out[name] = texts[i]), (by[name] = providers[i])));
    return { translations: out, by, failed: texts.filter((t) => !t).length };
  });

  // Do the translation services work (and how much of DeepL's quota is used)? Shown in the help.
  // One check per service and minute at most, whoever asks.
  let statusCache = { at: 0, data: null };
  app.get('/api/spaces/:id/translate/status', async (req, reply) => {
    const r = lookup(req, reply, { requireMember: true });
    if (!r) return;
    if (Date.now() - statusCache.at > 60_000) statusCache = { at: Date.now(), data: translator.status() };
    return { services: await statusCache.data };
  });

  // ---------- AI assistants (MCP + REST) ----------
  const ai = createAi({ store, hub, config, log: app.log });

  // a member connects an assistant → its key, shown once
  app.post('/api/spaces/:id/ai', async (req, reply) => {
    const r = lookup(req, reply, { requireMember: true });
    if (!r) return;
    if (r.status !== 'ok') return reply.code(409).send({ error: r.status });
    try {
      const { key, device } = ai.connect(r.space.uid, req.body?.name);
      return { key, devId: device.dev_id, name: device.name };
    } catch (e) {
      if (e instanceof AiError) return reply.code(e.status).send({ error: e.code, message: e.message });
      return sendError(reply, e);
    }
  });

  const bearer = (req) => {
    const h = req.headers.authorization;
    return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  };

  // MCP (Streamable HTTP, stateless): the key in the address – that is what "custom connectors"
  // in Claude, ChatGPT & co. can take – or as Bearer token
  app.post('/mcp/:key', (req, reply) => ai.handleMcp(req, reply, req.params.key));
  app.post('/mcp', (req, reply) => ai.handleMcp(req, reply, bearer(req)));
  const noStream = async (req, reply) => reply.code(405).header('allow', 'POST').send({ error: 'method_not_allowed' });
  app.get('/mcp', noStream);
  app.get('/mcp/:key', noStream);
  app.delete('/mcp', noStream);
  app.delete('/mcp/:key', noStream);

  // REST for Siri shortcuts, Home Assistant, scripts … – Authorization: Bearer <key>
  const rest = (fn) => async (req, reply) => {
    try {
      const ctx = ai.auth(bearer(req));
      return await fn(ctx, req);
    } catch (e) {
      if (e instanceof AiError) return reply.code(e.status).send({ error: e.code, message: e.message });
      if (e instanceof OpError) return reply.code(e.code === 'notfound' ? 404 : 400).send({ error: e.code, message: e.message });
      throw e;
    }
  };
  const itemsOf = (body) => body?.items ?? body?.text ?? body?.item;
  app.get('/api/v1/openapi.json', async () => openApi(config.publicUrl));
  app.get('/api/v1/lists', rest((ctx) => ai.listLists(ctx)));
  app.get('/api/v1/lists/:list', rest((ctx, req) => ai.readList(ctx, req.params.list, { inactive: req.query?.inactive === '1' || req.query?.inactive === 'true' })));
  app.post('/api/v1/lists/:list/items', rest((ctx, req) => ai.addItems(ctx, req.params.list, itemsOf(req.body), { forLater: req.body?.forLater === true, onlyThisList: req.body?.onlyThisList === true })));
  app.post('/api/v1/lists/:list/check', rest((ctx, req) => ai.setDone(ctx, req.params.list, itemsOf(req.body), req.body?.done !== false)));
  app.post('/api/v1/lists/:list/remove', rest((ctx, req) => ai.removeItems(ctx, req.params.list, itemsOf(req.body))));
  app.post('/api/v1/lists/:list/inactive', rest((ctx, req) => ai.moveToInactive(ctx, req.params.list, itemsOf(req.body) ?? [], { allChecked: req.body?.allChecked === true })));
  app.post('/api/v1/lists/:list/bring-back', rest((ctx, req) => ai.bringBack(ctx, req.params.list, itemsOf(req.body))));
  app.patch('/api/v1/lists/:list/items/:item', rest((ctx, req) => ai.updateItem(ctx, req.params.list, req.params.item, req.body ?? {})));
  app.post('/api/v1/lists/:list/groups', rest((ctx, req) => ai.addGroups(ctx, req.params.list, req.body?.groups ?? req.body?.group)));
  app.put('/api/v1/lists/:list/groups', rest((ctx, req) => ai.orderGroups(ctx, req.params.list, req.body?.groups)));
  app.put('/api/v1/lists/:list/items/order', rest((ctx, req) => ai.orderItems(ctx, req.params.list, req.body?.group ?? '', req.body?.items)));
  app.patch('/api/v1/lists/:list/groups/:group', rest((ctx, req) => ai.renameGroup(ctx, req.params.list, req.params.group, req.body?.name)));
  app.delete('/api/v1/lists/:list/groups/:group', rest((ctx, req) => ai.deleteGroup(ctx, req.params.list, req.params.group)));
  app.put('/api/v1/lists/:list/translations', rest((ctx, req) => ai.setTranslations(ctx, req.params.list, req.body?.translations, req.body?.language)));
  app.put('/api/v1/lists/:list/travel', rest((ctx, req) => ai.setTravelMode(ctx, req.params.list, req.body ?? {})));

  app.post('/api/spaces/:id/transfer', async (req, reply) => {
    const r = lookup(req, reply, { requireMember: true });
    if (!r) return;
    if (r.status !== 'ok') return reply.code(409).send({ error: r.status });
    const { to, listId, itemIds, groupId, mode } = req.body ?? {};
    const targetId = parseSpaceId(to ?? '');
    const target = targetId ? store.resolve(targetId, r.tokenHash) : { status: 'notfound' };
    if (target.status !== 'ok') {
      limiter.fail(clientKey(req));
      return reply.code(404).send({ error: 'target_notfound' });
    }
    const dev = store.device(r.space.uid, r.tokenHash);
    try {
      const res = store.transfer(r.space.uid, dev, { targetUid: target.space.uid, targetListId: listId, itemIds, groupId, mode });
      if (res.source.changes.length) hub.broadcast(r.space.uid, { t: 'patch', rev: res.source.rev, changes: res.source.changes });
      if (target.space.uid !== r.space.uid || res.target.changes.length) {
        hub.broadcast(target.space.uid, { t: 'patch', rev: res.target.rev, changes: res.target.changes });
      }
      return { count: res.count };
    } catch (e) {
      return sendError(reply, e);
    }
  });

  // ---------- signals ----------
  const SIGNALS = new Set(['where', 'come', 'checkout', 'done', 'here']);

  // A signal waits in memory (never on disk) until its device confirms it – phones in the shop
  // lose the connection or turn the display off. Key: `${uid}:${devId}` → [{ id, at, data }].
  const inbox = new Map();
  const signalTtl = config.signalTtlMin * 60_000;
  const pruneInbox = (key, now = Date.now()) => {
    const q = (inbox.get(key) ?? []).filter((s) => s.at > now - signalTtl);
    if (q.length) inbox.set(key, q);
    else inbox.delete(key);
    return q;
  };
  const sweep = setInterval(() => {
    for (const key of inbox.keys()) pruneInbox(key);
  }, 5 * 60_000);
  sweep.unref();
  app.addHook('onClose', async () => clearInterval(sweep));

  /** Send everything still waiting for this device (after it (re)connected). */
  function deliverInbox(conn) {
    for (const s of pruneInbox(`${conn.uid}:${conn.devId}`)) conn.send(s.data);
  }

  /**
   * Deliver a signal to one device (to = devId) or to everybody currently checked in at the shop.
   * The sender's last spot is attached. Devices that aren't connected get it when they come back.
   * Returns the number of devices it is meant for.
   */
  function sendSignal(uid, dev, { kind, place = '', replyTo = null, at = Date.now() }, to, exceptDevId) {
    const devices = store.devices(uid);
    const me = devices.find((d) => d.devId === dev.dev_id);
    const targets = new Set(
      devices.filter((d) => d.devId !== exceptDevId && (to ? d.devId === to : !!d.shoppingUntil)).map((d) => d.devId),
    );
    if (!targets.size) return 0;
    const now = Date.now();
    const id = newEntityId();
    const data = JSON.stringify({
      t: 'signal',
      id,
      kind,
      from: { devId: dev.dev_id, name: dev.name },
      to,
      place: place || me?.spot?.group || '',
      item: kind === 'allDone' ? '' : me?.spot?.item || '',
      replyTo,
      at,
    });
    for (const devId of targets) {
      const key = `${uid}:${devId}`;
      inbox.set(key, [...pruneInbox(key, now), { id, at: now, data }].slice(-20));
    }
    for (const c of hub.conns(uid)) if (targets.has(c.devId)) c.send(data);
    return targets.size;
  }

  /** Activity while checked in keeps the check-in alive – tell the others when it was extended. */
  function keepShopping(conn) {
    const row = store.keepShopping(conn.uid, conn.tokenHash);
    if (row) hub.broadcast(conn.uid, { t: 'patch', changes: [{ e: 'device', row }] });
  }

  // ---------- WebSocket sync ----------
  await app.register(fastifyWebsocket, { options: { maxPayload: 512 * 1024 } });

  app.get('/ws', { websocket: true }, (ws, req) => {
    const key = clientKey(req);
    // a few devices behind one address are normal – hundreds of open connections are not
    const open = (wsPerIp.get(key) ?? 0) + 1;
    if (open > 50) return ws.close(1013, 'too many connections');
    wsPerIp.set(key, open);
    ws.on('close', () => {
      const n = (wsPerIp.get(key) ?? 1) - 1;
      if (n > 0) wsPerIp.set(key, n);
      else wsPerIp.delete(key);
    });
    // ops per connection: a bucket that refills – room for a long offline queue, not for a flood
    const bucket = { tokens: 600, at: Date.now() };
    // a phone that vanished (no network, app killed) leaves a half-open socket: ping, and drop it
    // when no answer came – it would count against the per-address limit otherwise
    let alive = true;
    ws.on('pong', () => (alive = true));
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 45_000).unref?.();
    ws.on('close', () => clearInterval(heartbeat));
    const conn = {
      uid: null,
      devId: null,
      tokenHash: null,
      send: (data) => ws.readyState === 1 && ws.send(data),
      close: () => ws.close(),
    };
    const reply = (msg) => conn.send(JSON.stringify(msg));

    ws.on('close', () => {
      if (conn.uid !== null) {
        hub.remove(conn);
        hub.presence(conn.uid);
      }
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return reply({ t: 'error', error: 'bad_json' });
      }
      try {
        if (msg.t === 'ping') return reply({ t: 'pong', serverTime: Date.now(), c: msg.c });
        if (msg.t === 'hello') return onHello(msg);
        if (msg.t === 'op') return onOp(msg);
        if (msg.t === 'signal') return onSignal(msg);
        if (msg.t === 'signalAck') return onSignalAck(msg);
        reply({ t: 'error', error: 'unknown_message' });
      } catch (e) {
        app.log.error(e, 'ws handler failed');
        reply({ t: 'error', error: 'server' });
      }
    });

    function onHello(msg) {
      if (limiter.blocked(key)) return reply({ t: 'error', error: 'rate_limited' });
      if (typeof msg.token !== 'string' || !TOKEN_RE.test(msg.token)) return reply({ t: 'error', error: 'bad_token' });
      const id = parseSpaceId(msg.space ?? '');
      const tokenHash = hashToken(msg.token);
      const res = id ? store.resolve(id, tokenHash) : { status: 'notfound' };
      if (res.status === 'notfound') {
        limiter.fail(key);
        return reply({ t: 'notfound' });
      }
      if (res.status === 'moved') return reply({ t: 'moved', id: res.id });
      if (res.status === 'deleted') return reply({ t: 'deleted', by: res.by, at: res.at });

      if (conn.uid !== null) {
        hub.remove(conn);
        hub.presence(conn.uid);
      }
      let dev;
      try {
        dev = store.joinDevice(res.space.uid, tokenHash, msg.name);
      } catch (e) {
        if (e instanceof OpError) {
          reply({ t: 'error', error: 'too_many_devices' });
          return conn.close();
        }
        throw e;
      }
      store.touch(res.space.uid, tokenHash);
      conn.uid = res.space.uid;
      conn.devId = dev.dev_id;
      conn.tokenHash = tokenHash;
      hub.add(conn);
      reply({
        t: 'welcome',
        serverTime: Date.now(),
        me: { devId: dev.dev_id, name: dev.name },
        online: hub.online(conn.uid),
        features: { translate: translator.available, translators: translator.providers, ai: config.mcpEnabled },
        snapshot: store.snapshot(conn.uid),
      });
      hub.broadcast(conn.uid, { t: 'patch', changes: [{ e: 'device', row: mapDevice(store.device(conn.uid, tokenHash)) }] }, conn);
      hub.presence(conn.uid);
      keepShopping(conn);
      deliverInbox(conn);
    }

    function onSignalAck(msg) {
      if (conn.uid === null || typeof msg.id !== 'string') return;
      const key = `${conn.uid}:${conn.devId}`;
      const q = (inbox.get(key) ?? []).filter((s) => s.id !== msg.id);
      if (q.length) inbox.set(key, q);
      else inbox.delete(key);
    }

    // ----- "find each other in the shop": short fixed signals, never stored -----
    const sent = [];
    function onSignal(msg) {
      if (conn.uid === null) return;
      const dev = store.device(conn.uid, conn.tokenHash);
      if (!dev) return;
      const now = Date.now();
      while (sent.length && sent[0] < now - 60_000) sent.shift();
      if (sent.length >= 20 || (sent.length && now - sent.at(-1) < 1500)) return reply({ t: 'error', error: 'signal_rate' });
      if (!SIGNALS.has(msg.kind)) return reply({ t: 'error', error: 'bad_signal' });
      sent.push(now);
      keepShopping(conn);
      const to = typeof msg.to === 'string' && msg.to ? msg.to : null;
      const place = typeof msg.place === 'string' ? msg.place.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120) : '';
      // a signal sent while offline keeps the time it was sent at
      const at = Number.isFinite(msg.at) ? Math.min(now, Math.max(now - signalTtl, msg.at)) : now;
      const cid = typeof msg.cid === 'string' ? msg.cid.slice(0, 24) : null;
      const n = sendSignal(conn.uid, dev, { kind: msg.kind, place, at, replyTo: typeof msg.replyTo === 'string' ? msg.replyTo.slice(0, 24) : null }, to, conn.devId);
      reply({ t: 'signalSent', cid, kind: msg.kind, to, count: n });
    }

    function onOp(msg) {
      if (conn.uid === null) return reply({ t: 'ack', id: msg.id, ok: false, error: 'no_hello' });
      const t = Date.now();
      bucket.tokens = Math.min(600, bucket.tokens + ((t - bucket.at) / 1000) * 10);
      bucket.at = t;
      if (bucket.tokens < 1) {
        // no ack: the device keeps the op and sends it again after reconnecting (with back-off)
        reply({ t: 'error', error: 'busy' });
        return conn.close();
      }
      bucket.tokens -= 1;
      const space = store.spaceByUid(conn.uid);
      if (!space || space.deleted_at) return reply({ t: 'deleted', by: space?.deleted_by, at: space?.deleted_at });
      const dev = store.device(conn.uid, conn.tokenHash);
      if (!dev) {
        reply({ t: 'kicked' });
        return conn.close();
      }
      store.touch(conn.uid, conn.tokenHash);
      try {
        const res = store.applyOp(conn.uid, dev, msg.id, msg.op, msg.at);
        if (msg.op?.k !== 'device.shopping') keepShopping(conn);
        if (res.changes.length) hub.broadcast(conn.uid, { t: 'patch', rev: res.rev, changes: res.changes });
        reply({ t: 'ack', id: msg.id, ok: true, result: res.result });
        if (res.allDone) sendSignal(conn.uid, dev, { kind: 'allDone', place: res.allDone.listName }, null, conn.devId);
        if (msg.op?.k === 'device.kick' && res.result?.kicked) {
          const kickedHash = res.kickedHash;
          if (kickedHash) hub.kick(conn.uid, kickedHash);
          inbox.delete(`${conn.uid}:${res.result.kicked}`);
          hub.presence(conn.uid);
        }
      } catch (e) {
        if (e instanceof OpError) return reply({ t: 'ack', id: msg.id, ok: false, error: e.code, message: e.message });
        throw e;
      }
    }
  });

  // ---------- skins ----------
  const skins = createSkins({ customDir: config.skinsDir || null, log: app.log });
  skins(); // read once at start – problems show up in the log right away
  // the dev server (Vite) has no server-made index.html, so the app can ask for them, too
  app.get('/api/skins', async (req, reply) => {
    reply.header('Cache-Control', 'no-cache');
    const { css, list } = skins();
    return { css, ...list };
  });
  const skinsHtml = () => {
    const { css, list } = skins();
    // JSON in a <script> tag: "<" escaped, so a name can never end the tag
    const json = JSON.stringify(list).replace(/</g, '\\u003c');
    return `<style id="skins">\n${css}\n</style>\n    <script type="application/json" id="skin-list">${json}</script>`;
  };

  // ---------- static client + link previews ----------
  const staticDir = resolve(config.staticDir);
  const indexFile = join(staticDir, 'index.html');
  const template = existsSync(indexFile) ? readFileSync(indexFile, 'utf8') : null;

  // the manifest comes from the route below: the app shortcut speaks the phone's language
  const manifestFile = join(staticDir, 'manifest.webmanifest');
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : null;
  const SHORTCUT_NAMES = { de: ['Artikel hinzufügen', 'Hinzufügen'], en: ['Add item', 'Add'] };
  if (manifest) {
    app.get('/manifest.webmanifest', async (req, reply) => {
      const lang = /^\s*de\b/i.test(String(req.headers['accept-language'] ?? '')) ? 'de' : 'en';
      const [name, short] = SHORTCUT_NAMES[lang];
      const body = { ...manifest, lang, shortcuts: (manifest.shortcuts ?? []).map((s) => (s.url === '/add' ? { ...s, name, short_name: short } : s)) };
      reply.header('Cache-Control', 'no-cache').header('Vary', 'Accept-Language').type('application/manifest+json; charset=utf-8');
      return JSON.stringify(body);
    });
  }

  if (existsSync(staticDir)) {
    await app.register(fastifyStatic, {
      root: staticDir,
      wildcard: false,
      index: false,
      globIgnore: manifest ? ['manifest.webmanifest'] : [],
      cacheControl: false,
      setHeaders(reply, path) {
        const immutable = path.startsWith(join(staticDir, 'assets'));
        reply.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  function renderIndex(req, publicId) {
    let title = 'ShopWiz';
    let description = 'Shared shopping lists – no login, no tracking.';
    let canonical = '';
    if (publicId && !limiter.blocked(clientKey(req))) {
      const space = db.q('SELECT name, uid FROM spaces WHERE public_id = ? AND deleted_at IS NULL').get(publicId);
      if (!space) limiter.fail(clientKey(req));
      if (space) {
        const count = db.q('SELECT COUNT(*) AS c FROM items WHERE space_uid = ? AND deleted_at IS NULL AND checked = 0').get(space.uid).c;
        title = `${space.name} · ShopWiz`;
        description = `Shared shopping list · ${count} open item${count === 1 ? '' : 's'} · ${formatSpaceId(publicId)}`;
      }
    }
    const base = config.publicUrl || `${req.protocol}://${req.headers.host}`;
    canonical = publicId ? `${base}/${publicId}` : `${base}/`;
    const meta = [
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="ShopWiz">`,
      `<meta property="og:title" content="${escapeHtml(title)}">`,
      `<meta property="og:description" content="${escapeHtml(description)}">`,
      `<meta property="og:url" content="${escapeHtml(canonical)}">`,
      `<meta property="og:image" content="${escapeHtml(base)}/og.png">`,
      `<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="630">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="description" content="${escapeHtml(description)}">`,
    ].join('\n    ');
    // functions, not strings: "$&" or "$`" in a list name must not be read as replacement patterns
    return template
      .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
      .replace('<!--og-->', () => meta)
      .replace('<!--skins-->', skinsHtml);
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url.startsWith('/ws') || !template) {
      return reply.code(404).send({ error: 'notfound' });
    }
    const path = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+|\/+$/g, '');
    // Asset-like paths that do not exist are real 404s
    if (/\.[a-z0-9]{2,5}$/i.test(path)) return reply.code(404).send({ error: 'notfound' });
    const publicId = path && !path.includes('/') ? parseSpaceId(path) : null;
    reply.header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(renderIndex(req, publicId));
  });

  app.limits = LIMITS;
  return app;
}
