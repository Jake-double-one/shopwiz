import { load, save } from './storage.js';
import { deviceToken, deviceName, rememberSpace, replaceKnown, forgetSpace, knownSpaces } from './device.js';
import { normalizeName } from '../../../shared/parse.js';
import { randomEntityId } from '../../../shared/ids.js';

export const newId = () => randomEntityId((b) => crypto.getRandomValues(b));
const SHOPPING_MS = 2 * 3_600_000;

/** How long a signal waits for a connection – the same time the server keeps it for others. */
const SIGNAL_WAIT_MS = 30 * 60_000;

const empty = () => ({ space: null, lists: {}, groups: {}, items: {}, memory: {}, suggestions: {}, conflicts: {}, translations: {}, devices: {} });

const COLLECTION = {
  list: ['lists', (r) => r.id],
  group: ['groups', (r) => r.id],
  item: ['items', (r) => r.id],
  memory: ['memory', (r) => `${r.scope}|${r.norm}`],
  suggestion: ['suggestions', (r) => r.norm],
  conflict: ['conflicts', (r) => r.id],
  translation: ['translations', (r) => `${r.norm}|${r.lang}`],
  device: ['devices', (r) => r.devId],
};

function fromSnapshot(s) {
  const base = empty();
  base.space = s.space;
  for (const [e, rows] of [
    ['list', s.lists],
    ['group', s.groups],
    ['item', s.items],
    ['memory', s.memory],
    ['suggestion', s.suggestions],
    ['conflict', s.conflicts],
    ['translation', s.translations ?? []],
    ['device', s.devices],
  ]) {
    const [col, key] = COLLECTION[e];
    for (const r of rows) base[col][key(r)] = r;
  }
  return base;
}

/** Which scope learned placements live in for a list. */
export const scopeOf = (list) => (list?.groupMode === 'shared' ? '' : list?.id ?? '');

export function groupPath(v, groupId) {
  const g = groupId ? v.groups[groupId] : null;
  if (!g) return { group: '', subgroup: '' };
  if (g.parentId) return { group: v.groups[g.parentId]?.name ?? '', subgroup: g.name };
  return { group: g.name, subgroup: '' };
}

function learn(v, listId, name, groupId) {
  const list = v.lists[listId];
  if (!list) return;
  const scope = scopeOf(list);
  const norm = normalizeName(name);
  v.memory[`${scope}|${norm}`] = { scope, norm, ...groupPath(v, groupId) };
}

/** Does a list show the item – its own, or a shared one of its list group? */
function shows(v, listId, it) {
  if (it.listId === listId) return true;
  const link = v.lists[listId]?.linkId;
  return !!it.shared && !!link && v.lists[it.listId]?.linkId === link;
}

/** Optimistic, local version of the server's op handlers. Never mutates existing objects. */
function reduce(v, op, at, me) {
  const myName = me?.name ?? '';
  switch (op.k) {
    case 'space.update':
      v.space = { ...v.space, ...(op.name !== undefined && { name: op.name }), ...(op.ttlDays !== undefined && { ttlDays: op.ttlDays }) };
      break;
    case 'list.add':
      v.lists[op.id] = { id: op.id, name: op.name, pos: op.pos, groupMode: op.groupMode === 'shared' ? 'shared' : 'own', linkId: null, createdAt: at };
      break;
    case 'list.link': {
      const a = v.lists[op.id];
      const b = v.lists[op.other];
      if (!a || !b) break;
      const link = a.linkId ?? b.linkId ?? `new-${op.id}`;
      for (const l of Object.values(v.lists)) {
        if (l.id === a.id || l.id === b.id || (l.linkId && (l.linkId === a.linkId || l.linkId === b.linkId))) {
          if (op.share !== false && !l.linkId) {
            for (const it of Object.values(v.items)) if (it.listId === l.id && !it.shared) v.items[it.id] = { ...it, shared: true };
          }
          v.lists[l.id] = { ...l, linkId: link };
        }
      }
      break;
    }
    case 'list.unlink': {
      const l = v.lists[op.id];
      if (!l?.linkId) break;
      const rest = Object.values(v.lists).filter((x) => x.linkId === l.linkId && x.id !== l.id);
      v.lists[l.id] = { ...l, linkId: null };
      if (rest.length === 1) v.lists[rest[0].id] = { ...rest[0], linkId: null };
      break;
    }
    case 'list.update': {
      const l = v.lists[op.id];
      if (l) {
        v.lists[op.id] = {
          ...l,
          ...(op.name !== undefined && { name: op.name }),
          ...(op.pos !== undefined && { pos: op.pos }),
          ...(op.address !== undefined && { address: op.address }),
          ...(op.travel !== undefined && { travel: op.travel }),
          ...(op.prioShortcuts !== undefined && { prioShortcuts: !!op.prioShortcuts }),
        };
      }
      break;
    }
    case 'list.delete':
      delete v.lists[op.id];
      break;
    case 'list.restore':
      if (op.row) v.lists[op.id] = op.row;
      break;
    case 'list.clearChecked':
      for (const it of Object.values(v.items)) {
        if (shows(v, op.listId, it) && it.checked && !it.parked) v.items[it.id] = { ...it, checked: false, checkedBy: null, checkedIn: null, parked: true };
      }
      break;
    case 'list.clearParked':
      for (const it of Object.values(v.items)) if (shows(v, op.listId, it) && it.parked) delete v.items[it.id];
      break;
    case 'item.setState':
      for (const id of op.ids) {
        const it = v.items[id];
        if (it) v.items[id] = { ...it, checked: !!op.checked, checkedBy: op.checked ? (it.checkedBy ?? myName) : null, checkedIn: op.checked ? (it.checkedIn ?? it.listId) : null, parked: !!op.parked && !op.checked };
      }
      break;
    case 'group.add':
      v.groups[op.id] = { id: op.id, listId: op.listId ?? null, parentId: op.parentId ?? null, name: op.name, pos: op.pos };
      break;
    case 'group.update': {
      const g = v.groups[op.id];
      if (g) {
        v.groups[op.id] = {
          ...g,
          ...(op.name !== undefined && { name: op.name }),
          ...(op.pos !== undefined && { pos: op.pos }),
          ...(op.parentId !== undefined && { parentId: op.parentId }),
        };
      }
      break;
    }
    case 'group.delete': {
      const ids = new Set([op.id, ...Object.values(v.groups).filter((g) => g.parentId === op.id).map((g) => g.id)]);
      for (const id of ids) delete v.groups[id];
      for (const it of Object.values(v.items)) if (ids.has(it.groupId)) v.items[it.id] = { ...it, groupId: null };
      break;
    }
    case 'group.restore':
      for (const r of op.rows ?? []) v.groups[r.id] = r;
      for (const m of op.moves ?? []) if (v.items[m.id]) v.items[m.id] = { ...v.items[m.id], groupId: m.groupId };
      break;
    case 'item.add': {
      v.items[op.id] = {
        id: op.id,
        listId: op.listId,
        groupId: op.groupId ?? null,
        name: op.name,
        qty: op.qty ?? '',
        unit: op.unit ?? '',
        note: op.note ?? '',
        checked: !!op.checked && !op.parked,
        checkedBy: op.checked && !op.parked ? myName : null,
        parked: !!op.parked,
        prio: op.prio > 0 ? 1 : op.prio < 0 ? -1 : 0,
        shared: !!op.shared && !!v.lists[op.listId]?.linkId,
        checkedIn: op.checked && !op.parked ? op.listId : null,
        places: {},
        addedBy: myName,
        pos: op.pos,
        meta: {},
        createdAt: at,
        pending: true,
      };
      if (op.learn !== false) learn(v, op.listId, op.name, op.groupId ?? null);
      const norm = normalizeName(op.name);
      const s = v.suggestions[norm];
      v.suggestions[norm] = { norm, name: op.name, uses: (s?.uses ?? 0) + 1, lastUsedAt: at };
      break;
    }
    case 'item.set': {
      const it = v.items[op.id];
      if (!it) break;
      const f = op.fields;
      const next = { ...it, pending: true };
      // changed in another shop of the list group: group and position are that shop's
      const view = op.listId && op.listId !== it.listId && shows(v, op.listId, it) ? op.listId : it.listId;
      const foreign = view !== it.listId;
      if ('name' in f) next.name = f.name;
      if ('amount' in f) Object.assign(next, { qty: f.amount.qty ?? '', unit: f.amount.unit ?? '' });
      if ('note' in f) next.note = f.note;
      if ('checked' in f) Object.assign(next, { checked: !!f.checked, checkedBy: f.checked ? myName : null, checkedIn: f.checked ? view : null });
      if ('parked' in f) {
        next.parked = !!f.parked;
        if (f.parked && !('checked' in f)) Object.assign(next, { checked: false, checkedBy: null, checkedIn: null });
      }
      if (foreign && ('groupId' in f || 'pos' in f)) {
        const cur = it.places?.[view] ?? { groupId: null, pos: it.pos };
        next.places = { ...it.places, [view]: { groupId: 'groupId' in f ? f.groupId : cur.groupId, pos: 'pos' in f ? f.pos : cur.pos } };
      } else {
        if ('groupId' in f) next.groupId = f.groupId;
        if ('pos' in f) next.pos = f.pos;
      }
      if ('shared' in f && !!v.lists[it.listId]?.linkId) {
        next.shared = !!f.shared;
        if (!f.shared && foreign) {
          const p = (next.places ?? {})[view] ?? {};
          Object.assign(next, { listId: view, groupId: p.groupId ?? null, pos: p.pos ?? it.pos });
        }
        if (!f.shared) next.places = {};
      }
      if ('prio' in f) next.prio = f.prio > 0 ? 1 : f.prio < 0 ? -1 : 0;
      v.items[op.id] = next;
      if ('groupId' in f && op.learn !== false) learn(v, view, next.name, f.groupId);
      if ('name' in f) {
        const norm = normalizeName(f.name);
        const s = v.suggestions[norm];
        v.suggestions[norm] = { norm, name: f.name, uses: (s?.uses ?? 0) + 1, lastUsedAt: at };
      }
      break;
    }
    case 'item.delete':
      for (const id of op.ids) delete v.items[id];
      break;
    case 'item.restore':
      for (const r of op.rows ?? []) v.items[r.id] = r;
      break;
    case 'translation.set': {
      const norm = normalizeName(op.name);
      const key = `${norm}|${op.lang}`;
      if (op.text) v.translations[key] = { norm, lang: op.lang, text: op.text, auto: !!op.auto, by: op.auto ? (op.provider ?? null) : null, at };
      else delete v.translations[key];
      break;
    }
    case 'translation.clear':
      for (const n of op.names ?? []) delete v.translations[`${normalizeName(n)}|${op.lang}`];
      break;
    case 'suggestion.delete':
      delete v.suggestions[normalizeName(op.norm)];
      break;
    case 'conflict.resolve': {
      const c = v.conflicts[op.id];
      delete v.conflicts[op.id];
      const it = c && v.items[c.itemId];
      const value = c?.options[op.index]?.value;
      if (!it || value === undefined) break;
      if (c.field === 'amount') v.items[it.id] = { ...it, qty: value.qty, unit: value.unit };
      else if (c.field === 'checked') v.items[it.id] = { ...it, checked: !!value };
      else if (c.field === 'parked') v.items[it.id] = { ...it, parked: !!value, checked: value ? false : it.checked };
      else v.items[it.id] = { ...it, [c.field]: value };
      break;
    }
    case 'conflict.dismiss':
      delete v.conflicts[op.id];
      break;
    case 'device.rename':
      if (me && v.devices[me.devId]) v.devices[me.devId] = { ...v.devices[me.devId], name: op.name };
      break;
    case 'device.kick':
      delete v.devices[op.devId];
      break;
    case 'device.shopping':
      if (me && v.devices[me.devId]) v.devices[me.devId] = { ...v.devices[me.devId], shoppingUntil: op.on ? at + SHOPPING_MS : null };
      break;
    default:
      break;
  }
}

class Sync {
  spaceId = $state(null);
  /** idle | connecting | online | offline | notfound | deleted | kicked | limited */
  status = $state('idle');
  me = $state(null);
  // what this server offers, e.g. { translate: true }
  features = $state({});
  online = $state([]);
  deleted = $state(null);
  ready = $state(false);
  pendingCount = $state(0);
  data = $state.raw(empty());

  base = empty();
  pending = [];
  // "find each other" signals waiting for a connection, and ids of signals already shown
  outbox = [];
  seenSignals = new Set();
  outboxTimer = null;
  offset = 0;
  ws = null;
  retry = 0;
  retryTimer = null;
  pingTimer = null;
  persistTimer = null;
  rebuildQueued = false;
  listeners = new Set();
  opSeq = 0;

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(type, detail) {
    for (const fn of this.listeners) fn(type, detail);
  }

  now() {
    return Date.now() + this.offset;
  }

  open(id) {
    this.close();
    this.spaceId = id;
    this.status = 'connecting';
    this.deleted = null;
    const cached = load(`snap.${id}`);
    this.base = cached?.base ?? empty();
    this.me = cached?.me ?? null;
    this.features = cached?.features ?? {};
    this.offset = cached?.offset ?? 0;
    this.pending = load(`pending.${id}`, []);
    this.outbox = load(`signals.${id}`, []);
    this.ready = !!cached?.base?.space;
    this.rebuild(true);
    this.connect();
  }

  close() {
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    clearTimeout(this.outboxTimer);
    this.persist();
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.close();
    this.status = 'idle';
    this.spaceId = null;
    this.ready = false;
    this.base = empty();
    this.pending = [];
    this.outbox = [];
    this.online = [];
    this.data = empty();
  }

  connect() {
    if (!this.spaceId) return;
    clearTimeout(this.retryTimer);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;
    try {
      ws = new WebSocket(`${proto}//${location.host}/ws`);
    } catch {
      return this.scheduleReconnect();
    }
    this.ws = ws;
    if (this.status !== 'connecting') this.status = this.ready ? 'offline' : 'connecting';
    ws.onopen = () => {
      if (this.ws !== ws) return;
      ws.send(JSON.stringify({ t: 'hello', space: this.spaceId, token: deviceToken(), name: deviceName() }));
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      this.ws = null;
      this.online = [];
      if (['notfound', 'deleted', 'kicked', 'limited', 'idle'].includes(this.status)) return;
      this.status = 'offline';
      this.scheduleReconnect();
    };
  }

  /** Detect dead connections (e.g. mobile network gone without a close event). */
  startHeartbeat() {
    clearInterval(this.pingTimer);
    this.lastPong = Date.now();
    this.pingTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== 1) return;
      if (Date.now() - this.lastPong > 45_000) return this.dropConnection();
      ws.send(JSON.stringify({ t: 'ping', c: Date.now() }));
    }, 15_000);
  }

  /** Treat the connection as lost right away and reconnect with backoff. */
  dropConnection() {
    const ws = this.ws;
    if (!ws) return;
    ws.onclose?.();
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }

  scheduleReconnect() {
    clearTimeout(this.retryTimer);
    const delay = Math.min(30_000, 1000 * 2 ** this.retry) * (0.75 + Math.random() * 0.5);
    this.retry = Math.min(this.retry + 1, 6);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  /** Reconnect right away, e.g. when the tab becomes visible or the network returns. */
  nudge() {
    if (this.spaceId && !this.ws && this.status === 'offline') {
      this.retry = 0;
      this.connect();
    }
  }

  stop(status) {
    this.status = status;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.close();
  }

  handle(msg) {
    switch (msg.t) {
      case 'welcome': {
        this.offset = msg.serverTime - Date.now();
        this.me = msg.me;
        this.features = msg.features ?? {};
        this.online = msg.online;
        this.base = fromSnapshot(msg.snapshot);
        this.status = 'online';
        this.ready = true;
        this.retry = 0;
        rememberSpace(this.spaceId, this.base.space.name);
        this.rebuild(true);
        for (const p of this.pending) this.ws?.send(JSON.stringify({ t: 'op', ...p }));
        this.persist();
        this.startHeartbeat();
        this.flushOutbox();
        this.emit('welcome');
        break;
      }
      case 'patch':
        this.applyPatch(msg.changes);
        this.rebuild();
        this.persistSoon();
        break;
      case 'ack': {
        const i = this.pending.findIndex((p) => p.id === msg.id);
        const p = i >= 0 ? this.pending.splice(i, 1)[0] : null;
        this.rebuild();
        this.persistSoon();
        if (!msg.ok) this.emit('rejected', { op: p?.op, error: msg.error });
        else if (p) this.emit('ack', { id: p.id, op: p.op, result: msg.result });
        break;
      }
      case 'presence':
        this.online = msg.online;
        break;
      case 'signal':
        // confirm it, so the server doesn't deliver it again after a reconnect
        this.ws?.send(JSON.stringify({ t: 'signalAck', id: msg.id }));
        if (this.seenSignals.has(msg.id)) break;
        this.seenSignals.add(msg.id);
        this.emit('signal', msg);
        break;
      case 'signalSent':
        this.outbox = this.outbox.filter((s) => s.cid !== msg.cid);
        this.persistSoon();
        clearTimeout(this.outboxTimer);
        if (this.outbox.length) this.outboxTimer = setTimeout(() => this.flushOutbox(), 1600);
        this.emit('signalSent', msg);
        break;
      case 'pong':
        this.lastPong = Date.now();
        if (typeof msg.c === 'number') this.offset = msg.serverTime - (msg.c + Date.now()) / 2;
        break;
      case 'moved':
      case 'renewed': {
        const old = this.spaceId;
        replaceKnown(old, msg.id);
        this.spaceId = msg.id;
        this.emit('moved', { from: old, to: msg.id, live: msg.t === 'renewed' });
        if (msg.t === 'moved') this.ws?.send(JSON.stringify({ t: 'hello', space: msg.id, token: deviceToken(), name: deviceName() }));
        break;
      }
      case 'deleted':
        this.deleted = { by: msg.by, at: msg.at };
        this.persist();
        this.stop('deleted');
        break;
      case 'kicked':
        forgetSpace(this.spaceId);
        this.stop('kicked');
        break;
      case 'notfound':
        this.stop('notfound');
        break;
      case 'error':
        if (msg.error === 'rate_limited') this.stop('limited');
        break;
      default:
        break;
    }
  }

  applyPatch(changes) {
    const copied = new Set();
    for (const c of changes) {
      if (c.e === 'space') {
        this.base.space = c.row;
        renameKnownSoon(this.spaceId, c.row.name);
        continue;
      }
      const spec = COLLECTION[c.e];
      if (!spec) continue;
      const [col, key] = spec;
      if (!copied.has(col)) {
        this.base[col] = { ...this.base[col] };
        copied.add(col);
      }
      if (c.del !== undefined) delete this.base[col][c.del];
      else this.base[col][key(c.row)] = c.row;
    }
    this.emit('patch', changes);
  }

  rebuild(now = false) {
    if (!now) {
      if (this.rebuildQueued) return;
      this.rebuildQueued = true;
      queueMicrotask(() => {
        this.rebuildQueued = false;
        this.rebuild(true);
      });
      return;
    }
    const b = this.base;
    const v = {
      space: b.space,
      lists: { ...b.lists },
      groups: { ...b.groups },
      items: { ...b.items },
      memory: { ...b.memory },
      suggestions: { ...b.suggestions },
      conflicts: { ...b.conflicts },
      translations: { ...b.translations },
      devices: { ...b.devices },
    };
    for (const p of this.pending) reduce(v, p.op, p.at, this.me);
    this.data = v;
    this.pendingCount = this.pending.length;
  }

  /** Queue an operation: applied locally right away, sent when connected. */
  send(op) {
    const p = { id: `${Date.now().toString(36)}-${(++this.opSeq).toString(36)}-${newId().slice(0, 6)}`, op, at: this.now() };
    this.pending.push(p);
    this.rebuild(true);
    save(`pending.${this.spaceId}`, this.pending);
    if (this.status === 'online' && this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'op', ...p }));
    return p.id;
  }

  /**
   * Short "find each other" signal. Without a connection it waits (up to SIGNAL_WAIT_MS) and is
   * sent as soon as the device is back online. Returns 'sent' or 'queued'.
   */
  sendSignal({ kind, to = null, place = '', replyTo = null }) {
    this.outbox.push({ cid: newId(), kind, to, place, replyTo, at: this.now() });
    this.outbox = this.outbox.slice(-5);
    this.persistSoon();
    if (this.status !== 'online' || this.ws?.readyState !== 1) return 'queued';
    this.flushOutbox();
    return 'sent';
  }

  /** One signal at a time – the server accepts at most one every 1.5 s. */
  flushOutbox() {
    clearTimeout(this.outboxTimer);
    this.outbox = this.outbox.filter((s) => s.at > this.now() - SIGNAL_WAIT_MS);
    if (!this.outbox.length || this.status !== 'online' || this.ws?.readyState !== 1) return;
    // stays in the outbox until the server confirms it (signalSent)
    this.ws.send(JSON.stringify({ t: 'signal', ...this.outbox[0] }));
    this.outboxTimer = setTimeout(() => this.flushOutbox(), 5000);
  }

  persistSoon() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persist(), 800);
  }

  persist() {
    clearTimeout(this.persistTimer);
    if (!this.spaceId || !this.base.space) return;
    // a forgotten (reset / kicked) id must not be written back to the device
    if (!knownSpaces().some((s) => s.id === this.spaceId)) return;
    save(`snap.${this.spaceId}`, { base: this.base, me: this.me, features: this.features, offset: this.offset });
    save(`pending.${this.spaceId}`, this.pending);
    save(`signals.${this.spaceId}`, this.outbox);
  }
}

let renameTimer;
function renameKnownSoon(id, name) {
  clearTimeout(renameTimer);
  renameTimer = setTimeout(() => rememberSpace(id, name), 300);
}

export const sync = new Sync();

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => sync.nudge());
  window.addEventListener('offline', () => sync.dropConnection());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync.nudge();
    else sync.persist();
  });
  window.addEventListener('pagehide', () => sync.persist());
}
