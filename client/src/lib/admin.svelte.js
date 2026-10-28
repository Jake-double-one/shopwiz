// The administration's login lives only here, in the memory of this tab: no cookie, nothing in the
// device's storage – reloading the page means logging in again (with a passkey: one touch).
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { deviceToken } from './device.js';

export const adminSession = $state({ token: null, role: null, did: null });

export const passkeysPossible = () => typeof window !== 'undefined' && window.isSecureContext && typeof window.PublicKeyCredential === 'function';

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-shopwiz-token': deviceToken(),
        ...(adminSession.token && { 'x-shopwiz-admin': adminSession.token }),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('offline'), { code: 'offline' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // the session ended (timeout, logout elsewhere, revoked) – back to the login
    if (res.status === 401 && data.error === 'login') forget();
    throw Object.assign(new Error(data.error || 'error'), { code: data.error || 'error', status: res.status });
  }
  return data;
}

function take(r) {
  adminSession.token = r.session;
  adminSession.role = r.role;
  adminSession.did = r.did ?? null;
  return r;
}

export function forget() {
  adminSession.token = null;
  adminSession.role = null;
  adminSession.did = null;
}

/** The browser's passkey dialog was closed or isn't possible here */
const cancelled = (e) => e?.name === 'NotAllowedError' || e?.name === 'AbortError';

async function passkey(purpose, code) {
  const { ticket, options } = await call('POST', '/api/admin/passkey/options', { purpose, ...(code && { code }) });
  let response;
  try {
    response = purpose === 'login' ? await startAuthentication({ optionsJSON: options }) : await startRegistration({ optionsJSON: options });
  } catch (e) {
    throw Object.assign(new Error('passkey'), { code: cancelled(e) ? 'cancelled' : e?.name === 'InvalidStateError' ? 'exists' : 'passkey' });
  }
  return take(await call('POST', '/api/admin/passkey/verify', { ticket, response }));
}

export const admin = {
  status: () => call('GET', '/api/admin/status'),
  setup: async (code, user, password) => take(await call('POST', '/api/admin/setup', { code, user, password })),
  setPasswordLogin: (on) => call('POST', '/api/admin/password-login', { on }),
  loginPassword: async (user, password) => take(await call('POST', '/api/admin/login', { user, password })),
  loginPasskey: () => passkey('login'),
  /** code: the promotion code a device got from the main admin (not needed for the main admin's own) */
  registerPasskey: (code) => passkey('register', code),
  async logout() {
    try {
      await call('POST', '/api/admin/logout', {});
    } finally {
      forget();
    }
  },
  overview: () => call('GET', '/api/admin/overview'),
  alertsSeen: () => call('POST', '/api/admin/alerts/seen', {}),
  promote: (did) => call('POST', '/api/admin/promote', { did }),
  invite: () => call('POST', '/api/admin/invites', {}),
  revokeInvite: (code) => call('POST', '/api/admin/invites/revoke', { code }),
  revoke: (did) => call('POST', '/api/admin/revoke', { did }),
  deleteKey: (id) => call('POST', '/api/admin/keys/delete', { id }),
  deleteSpace: (id) => call('POST', `/api/admin/spaces/${id}/delete`, {}),
};
