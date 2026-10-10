import { deviceToken } from './device.js';

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-shopwiz-token': deviceToken() },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('offline'), { code: 'offline' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error || 'error', status: res.status });
  return data;
}

export const api = {
  createSpace: (name, deviceName, listName, doc) => call('POST', '/api/spaces', { name, deviceName, listName, doc, token: deviceToken() }),
  importInto: (id, doc, listId) => call('POST', `/api/spaces/${id}/import`, { doc, listId }),
  lists: (id) => call('GET', `/api/spaces/${id}/lists`),
  activity: (id, listId) => call('GET', `/api/spaces/${id}/activity?list=${encodeURIComponent(listId)}`),
  renew: (id) => call('POST', `/api/spaces/${id}/renew`, {}),
  remove: (id) => call('POST', `/api/spaces/${id}/delete`, {}),
  continueSpace: (id, deviceName) => call('POST', `/api/spaces/${id}/continue`, { deviceName }),
  transfer: (id, body) => call('POST', `/api/spaces/${id}/transfer`, body),
  translate: (id, body) => call('POST', `/api/spaces/${id}/translate`, body),
};
