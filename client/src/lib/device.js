import { load, save, remove } from './storage.js';

function randomToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Per-browser secret that identifies this device as a member. Never shown to anyone. */
export function deviceToken() {
  let t = load('token');
  if (typeof t !== 'string' || t.length < 20) {
    t = randomToken();
    save('token', t);
  }
  return t;
}

export const deviceName = () => load('deviceName', '');
export const setDeviceName = (name) => save('deviceName', name);

export function suggestDeviceName() {
  const ua = navigator.userAgent || '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android' : 'Tablet';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'PC';
  return 'Device';
}

// ----- remembered spaces -----

export const knownSpaces = () => load('spaces', []);
export const currentSpace = () => load('current', null);

export function rememberSpace(id, name) {
  const list = knownSpaces().filter((s) => s.id !== id);
  list.unshift({ id, name, lastUsed: Date.now() });
  save('spaces', list.slice(0, 20));
  save('current', id);
}

export function renameKnown(id, name) {
  save('spaces', knownSpaces().map((s) => (s.id === id ? { ...s, name } : s)));
}

export function replaceKnown(oldId, newId) {
  save('spaces', knownSpaces().map((s) => (s.id === oldId ? { ...s, id: newId } : s)));
  if (currentSpace() === oldId) save('current', newId);
  for (const k of ['snap', 'pending', 'list', 'shopSince']) {
    const v = load(`${k}.${oldId}`);
    if (v) save(`${k}.${newId}`, v);
    remove(`${k}.${oldId}`);
  }
}

/** The reset button: forget an id on this device, including cached data. */
export function forgetSpace(id) {
  save('spaces', knownSpaces().filter((s) => s.id !== id));
  if (currentSpace() === id) remove('current');
  remove(`snap.${id}`);
  remove(`pending.${id}`);
  remove(`signals.${id}`);
}

export const clearCurrent = () => remove('current');
