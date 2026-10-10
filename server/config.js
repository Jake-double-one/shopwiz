const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

export const MAX_SPACE_TTL_DAYS = 367;

export function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 8080),
    host: env.HOST || '0.0.0.0',
    dataDir: env.DATA_DIR || './data',
    publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
    spaceTtlDays: Math.min(Math.max(int(env.SPACE_TTL_DAYS, 181), 1), MAX_SPACE_TTL_DAYS),
    deviceTtlDays: Math.max(int(env.DEVICE_TTL_DAYS, 30), 1),
    activityTtlDays: Math.max(int(env.ACTIVITY_TTL_DAYS, 14), 1),
    trustProxy: env.TRUST_PROXY === 'true' || env.TRUST_PROXY === '1',
    // Failed ID lookups allowed per client address and window (brute-force protection).
    lookupLimit: int(env.LOOKUP_LIMIT, 30),
    lookupWindowMin: int(env.LOOKUP_WINDOW_MIN, 15),
    // New ids per client address and hour
    createLimit: int(env.CREATE_LIMIT, 30),
    // check-in at the shop ends after this many minutes without activity
    shoppingIdleMin: Math.max(int(env.SHOPPING_IDLE_MIN, 60), 1),
    // undelivered "find each other" signals wait this long for a device to come back
    signalTtlMin: Math.max(int(env.SIGNAL_TTL_MIN, 30), 1),
    logLevel: env.LOG_LEVEL || 'warn',
    staticDir: env.STATIC_DIR || './dist',
  };
}
