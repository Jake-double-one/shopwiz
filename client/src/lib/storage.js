// localStorage can throw (private mode, blocked storage) – never let that break the app.
const PREFIX = 'shopwiz.';
const memory = new Map();

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return memory.has(key) ? memory.get(key) : fallback;
  }
}

export function save(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or blocked – keep in memory */
  }
}

export function remove(key) {
  memory.delete(key);
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
