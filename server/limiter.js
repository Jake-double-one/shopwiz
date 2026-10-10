// In-memory counter for failed ID lookups. Nothing is persisted; addresses vanish when the window ends.
export class Limiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
    this.timer = setInterval(() => this.sweep(), windowMs).unref();
  }
  blocked(key) {
    const h = this.hits.get(key);
    return !!h && h.reset > Date.now() && h.count >= this.limit;
  }
  fail(key) {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.reset <= now) this.hits.set(key, { count: 1, reset: now + this.windowMs });
    else h.count++;
  }
  sweep() {
    const now = Date.now();
    for (const [k, h] of this.hits) if (h.reset <= now) this.hits.delete(k);
  }
  stop() {
    clearInterval(this.timer);
  }
}
