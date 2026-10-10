import Fastify, { LogController } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { openDb } from './db.js';
import { Store, OpError, hashToken, mapDevice, LIMITS } from './core.js';
import { Hub } from './hub.js';
import { Limiter } from './limiter.js';
import { parseSpaceId, formatSpaceId } from '../shared/ids.js';

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function buildApp(config) {
  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 256 * 1024,
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
    const { name, token, deviceName, listName } = req.body ?? {};
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return reply.code(400).send({ error: 'invalid', message: 'token' });
    try {
      const id = store.createSpace({ name, token, deviceName, listName });
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
    const newId = store.renew(r.space.uid);
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
    const id = store.continueSpace(r.space.uid, r.tokenHash, req.body?.deviceName);
    return { id };
  });

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

  // ---------- WebSocket sync ----------
  await app.register(fastifyWebsocket, { options: { maxPayload: 512 * 1024 } });

  app.get('/ws', { websocket: true }, (ws, req) => {
    const key = clientKey(req);
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
      const dev = store.joinDevice(res.space.uid, tokenHash, msg.name);
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
        snapshot: store.snapshot(conn.uid),
      });
      hub.broadcast(conn.uid, { t: 'patch', changes: [{ e: 'device', row: mapDevice(store.device(conn.uid, tokenHash)) }] }, conn);
      hub.presence(conn.uid);
    }

    function onOp(msg) {
      if (conn.uid === null) return reply({ t: 'ack', id: msg.id, ok: false, error: 'no_hello' });
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
        if (res.changes.length) hub.broadcast(conn.uid, { t: 'patch', rev: res.rev, changes: res.changes });
        reply({ t: 'ack', id: msg.id, ok: true, result: res.result });
        if (msg.op?.k === 'device.kick' && res.result?.kicked) {
          const kickedHash = res.kickedHash;
          if (kickedHash) hub.kick(conn.uid, kickedHash);
          hub.presence(conn.uid);
        }
      } catch (e) {
        if (e instanceof OpError) return reply({ t: 'ack', id: msg.id, ok: false, error: e.code, message: e.message });
        throw e;
      }
    }
  });

  // ---------- static client + link previews ----------
  const staticDir = resolve(config.staticDir);
  const indexFile = join(staticDir, 'index.html');
  const template = existsSync(indexFile) ? readFileSync(indexFile, 'utf8') : null;

  if (existsSync(staticDir)) {
    await app.register(fastifyStatic, {
      root: staticDir,
      wildcard: false,
      index: false,
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
    return template
      .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
      .replace('<!--og-->', meta);
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
