// REGISTRATIONS=open|invite|off: who may create IDs, invitation codes (SWIV-XXX-XXX), limits.
import { describe, it, expect } from 'vitest';
import { buildApp } from '../server/app.js';
import { loadConfig, registrations } from '../server/config.js';
import { parseInviteCode, formatInviteCode, randomInviteCode } from '../shared/ids.js';

const T1 = 'token-memberdevicememberdev1';
const T2 = 'token-newcomernewcomernewc2';
const T3 = 'token-thirdthirdthirdthird3';
const boot = (extra = {}) => buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: './does-not-exist', ...extra });
const mk = (app, token, extra = {}, ip) => app.inject({ method: 'POST', url: '/api/spaces', payload: { name: 'L', token, deviceName: 'X', ...extra }, ...(ip && { remoteAddress: ip }) });
const invites = (app, id, token, method = 'GET', code = '') => app.inject({ method: code ? 'POST' : method, url: `/api/spaces/${id}/invites${code ? '/revoke' : ''}`, headers: { 'x-shopwiz-token': token }, ...(code && { payload: { code } }) });

describe('invitation codes', () => {
  it('parse, format, generate', () => {
    expect(parseInviteCode('swiv-k7q-m2x')).toBe('SWIVK7QM2X');
    expect(parseInviteCode(' SWIVK7QM2X ')).toBe('SWIVK7QM2X');
    expect(parseInviteCode('https://shop.example/?invite=SWIV-K7Q-M2X')).toBe('SWIVK7QM2X');
    expect(parseInviteCode('SWIV-K7Q-M2')).toBeNull();
    expect(parseInviteCode('K7QM-2XPA-9F')).toBeNull();
    expect(parseInviteCode('SWIV-K7Q-M2U')).toBeNull(); // U is not in the alphabet
    expect(formatInviteCode('SWIVK7QM2X')).toBe('SWIV-K7Q-M2X');
    const code = randomInviteCode((b) => b.fill(255));
    expect(code).toMatch(/^SWIV[0-9A-Z]{6}$/);
    expect(parseInviteCode(formatInviteCode(code))).toBe(code);
  });
});

describe('REGISTRATIONS', () => {
  it('parses the setting – invite is the default', () => {
    expect(loadConfig({}).registrations).toBe('invite');
    expect(loadConfig({ REGISTRATIONS: 'open' }).registrations).toBe('open');
    expect(registrations(' OFF ')).toBe('off');
    expect(registrations('nonsense')).toBe('invite');
  });

  it('invite: the first ID is free, members create more, a stranger needs a code from a member', async () => {
    const app = await boot();
    expect((await app.inject({ method: 'GET', url: '/api/config' })).json()).toEqual({ registrations: 'invite', firstFree: true, member: false });
    const first = await mk(app, T1);
    expect(first.statusCode).toBe(200);
    const id = first.json().id;
    expect((await mk(app, T1)).statusCode).toBe(200); // a member, no code needed
    expect((await app.inject({ method: 'GET', url: '/api/config', headers: { 'x-shopwiz-token': T1 } })).json()).toEqual({ registrations: 'invite', firstFree: false, member: true });
    // a stranger: no code → invite_required; a wrong one → invite_invalid
    expect((await mk(app, T2)).json()).toEqual({ error: 'invite_required' });
    expect((await mk(app, T2, { invite: 'SWIV-AAA-AAA' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/invites/SWIV-AAA-AAA' })).statusCode).toBe(404);
    // the member issues a code
    const inv = await invites(app, id, T1, 'POST');
    expect(inv.statusCode).toBe(200);
    const { code } = inv.json();
    expect(code).toMatch(/^SWIV-[0-9A-Z]{3}-[0-9A-Z]{3}$/);
    expect((await invites(app, id, T1)).json()).toEqual({ mayInvite: true, invites: [expect.objectContaining({ code })] });
    expect((await app.inject({ method: 'GET', url: `/api/invites/${code}` })).json()).toEqual({ ok: true });
    // the stranger uses it (lower case, without dashes) – once
    expect((await mk(app, T2, { invite: code.toLowerCase().replace(/-/g, '') })).statusCode).toBe(200);
    expect((await mk(app, T3, { invite: code })).json()).toEqual({ error: 'invite_invalid' });
    // the newcomer is a member now: creates freely, may invite
    expect((await mk(app, T2)).statusCode).toBe(200);
    expect((await invites(app, id, T1)).json().invites).toEqual([]);
    // the administration's log knows who invited whom
    const log = app.store.db.q('SELECT actor, action, detail FROM admin_log ORDER BY id').all().map((r) => ({ ...r, detail: JSON.parse(r.detail) }));
    expect(log.map((e) => e.action)).toEqual(['invite_created', 'invite_redeemed']);
    expect(log[1].detail.code).toBe(code);
    expect(log[1].actor).toBe(log[0].actor);
    expect(log[1].detail.did).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    // at most 5 open codes per device; withdrawing one makes room – but only one's own
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await invites(app, id, T1, 'POST')).json().code);
    expect((await invites(app, id, T1, 'POST')).statusCode).toBe(400);
    const id2 = (await mk(app, T2)).json().id;
    expect((await invites(app, id2, T2, 'DELETE', codes[0])).statusCode).toBe(404);
    expect((await invites(app, id, T1, 'DELETE', codes[0])).statusCode).toBe(200);
    expect((await invites(app, id, T1, 'POST')).statusCode).toBe(200);
    // a code runs out after 7 days
    app.store.db.q('UPDATE invites SET expires_at = ? WHERE code = ?').run(Date.now() - 1, codes[1].replace(/-/g, ''));
    expect((await mk(app, T3, { invite: codes[1] })).statusCode).toBe(404);
    expect((await invites(app, id, T1)).json().invites.map((i) => i.code)).not.toContain(codes[1]);
    await app.close();
  });

  it('a new ID from a backup file needs the code, too', async () => {
    const app = await boot();
    await mk(app, T1);
    expect((await mk(app, T2, { doc: { lists: [{ name: 'L', items: [{ name: 'Milk' }] }] } })).json()).toEqual({ error: 'invite_required' });
    await app.close();
  });

  it('guessing codes is limited like guessing IDs', async () => {
    const app = await boot({ lookupLimit: 3 });
    await mk(app, T1);
    for (let i = 0; i < 3; i++) await app.inject({ method: 'GET', url: `/api/invites/SWIV-AAA-AA${i}` });
    expect((await app.inject({ method: 'GET', url: '/api/invites/SWIV-AAA-AAA' })).statusCode).toBe(429);
    expect((await mk(app, T2, { invite: 'SWIV-AAA-AAA' })).statusCode).toBe(429);
    // another address is not affected
    expect((await mk(app, T2, { invite: 'SWIV-AAA-AAA' }, '10.4.4.4')).statusCode).toBe(404);
    await app.close();
  });

  it("off: members keep creating, strangers are turned away, only an admin's code lets them in", async () => {
    const app = await boot({ registrations: 'off' });
    const id = (await mk(app, T1)).json().id;
    expect((await mk(app, T1)).statusCode).toBe(200);
    expect((await mk(app, T2)).json()).toEqual({ error: 'closed' });
    expect((await invites(app, id, T1)).json()).toEqual({ mayInvite: false, invites: [] });
    expect((await invites(app, id, T1, 'POST')).json()).toEqual({ error: 'closed' });
    // a code the administration issued (see admin.test.js for the route) does
    const inv = app.store.createInvite('admin:main', 'main');
    expect((await app.inject({ method: 'GET', url: `/api/invites/${inv.code}` })).statusCode).toBe(200);
    expect((await mk(app, T2, { invite: formatInviteCode(inv.code) })).statusCode).toBe(200);
    expect(app.store.checkInvite(inv.code)).toBeNull();
    await app.close();
  });

  it('open: as before – anyone creates, codes are not a thing', async () => {
    const app = await boot({ registrations: 'open' });
    await mk(app, T1);
    expect((await mk(app, T2)).statusCode).toBe(200);
    const id = (await mk(app, T1)).json().id;
    expect((await invites(app, id, T1)).json()).toEqual({ mayInvite: false, invites: [] });
    expect((await invites(app, id, T1, 'POST')).json()).toEqual({ error: 'closed' });
    await app.close();
  });

  it('cleanup forgets used and run-out codes after a month', async () => {
    const app = await boot();
    await mk(app, T1);
    const a = app.store.createInvite('x', 'XXXXX-XXXXX');
    const b = app.store.createInvite('x', 'XXXXX-XXXXX');
    app.store.redeemInvite(a.code, 'YYYYY-YYYYY', Date.now() - 31 * 86_400_000);
    app.store.db.q('UPDATE invites SET expires_at = ? WHERE code = ?').run(Date.now() - 31 * 86_400_000, b.code);
    app.store.cleanup();
    expect(app.store.db.q('SELECT COUNT(*) AS c FROM invites').get().c).toBe(0);
    await app.close();
  });
});
