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
    logLevel: env.LOG_LEVEL || 'warn',
    staticDir: env.STATIC_DIR || './dist',
  };
}
