import { deviceToken } from './device.js';
import { sync } from './sync.svelte.js';

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      // an ID opened from the administration: everything happens as "Admin"
      headers: { 'content-type': 'application/json', 'x-shopwiz-token': deviceToken(), ...(sync.admin && { 'x-shopwiz-admin': sync.admin }) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('offline'), { code: 'offline' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error || 'error', status: res.status, limit: data.limit, detail: data.message });
  return data;
}

export const api = {
  createSpace: (name, deviceName, listName, doc) => call('POST', '/api/spaces', { name, deviceName, listName, doc, token: deviceToken() }),
  importInto: (id, doc, listId) => call('POST', `/api/spaces/${id}/import`, { doc, listId }),
  lists: (id) => call('GET', `/api/spaces/${id}/lists`),
  activity: (id, listId) => call('GET', `/api/spaces/${id}/activity?list=${encodeURIComponent(listId)}`),
  renew: (id) => call('POST', `/api/spaces/${id}/renew`, {}),
  leave: (id) => call('POST', `/api/spaces/${id}/leave`, {}),
  remove: (id) => call('POST', `/api/spaces/${id}/delete`, {}),
  continueSpace: (id, deviceName) => call('POST', `/api/spaces/${id}/continue`, { deviceName }),
  transfer: (id, body) => call('POST', `/api/spaces/${id}/transfer`, body),
  translate: (id, body) => call('POST', `/api/spaces/${id}/translate`, body),
  translateStatus: (id) => call('GET', `/api/spaces/${id}/translate/status`),
  translateConfig: (id, body) => call('POST', `/api/spaces/${id}/translate/config`, body),
  connectAi: (id, name) => call('POST', `/api/spaces/${id}/ai`, { name }),
};
