const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

export const MAX_SPACE_TTL_DAYS = 367;

/**
 * Which proxies may tell the client address (X-Forwarded-For).
 * "true" = proxies in the local/Docker network (loopback, 10.x, 172.16–31.x, 192.168.x, fc00::/7) –
 * a client on the internet can't fake its address by writing the header itself;
 * a number = that many proxies in a row (e.g. 2 for Cloudflare + nginx);
 * or the proxies' addresses/networks, comma separated.
 */
export function trustProxy(v) {
  const s = String(v ?? '').trim();
  if (!s || /^(false|0|no|off)$/i.test(s)) return false;
  if (/^(true|yes|on)$/i.test(s)) return 'loopback, linklocal, uniquelocal';
  if (/^\d+$/.test(s)) {
    const hops = Math.min(Number(s), 10);
    return (addr, i) => i < hops;
  }
  return s;
}

export function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 8080),
    host: env.HOST || '0.0.0.0',
    dataDir: env.DATA_DIR || './data',
    publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
    spaceTtlDays: Math.min(Math.max(int(env.SPACE_TTL_DAYS, 181), 1), MAX_SPACE_TTL_DAYS),
    deviceTtlDays: Math.max(int(env.DEVICE_TTL_DAYS, 30), 1),
    activityTtlDays: Math.max(int(env.ACTIVITY_TTL_DAYS, 14), 1),
    trustProxy: trustProxy(env.TRUST_PROXY),
    // Failed ID lookups allowed per client address and window (brute-force protection).
    lookupLimit: int(env.LOOKUP_LIMIT, 30),
    lookupWindowMin: int(env.LOOKUP_WINDOW_MIN, 15),
    // New ids per client address and hour
    createLimit: int(env.CREATE_LIMIT, 30),
    // check-in at the shop ends after this many minutes without activity
    shoppingIdleMin: Math.max(int(env.SHOPPING_IDLE_MIN, 60), 1),
    // undelivered "find each other" signals wait this long for a device to come back
    signalTtlMin: Math.max(int(env.SIGNAL_TTL_MIN, 30), 1),
    // travel mode: machine translation of item names. One service or several in order –
    // the next one steps in when one is used up or down, e.g. "deepl,azure,mymemory".
    translateProviders: (env.TRANSLATE_PROVIDER || 'mymemory')
      .toLowerCase()
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
    // one key per service
    deeplApiKey: env.DEEPL_API_KEY || '',
    googleApiKey: env.GOOGLE_API_KEY || '',
    azureTranslatorKey: env.AZURE_TRANSLATOR_KEY || '',
    azureTranslatorRegion: env.AZURE_TRANSLATOR_REGION || '',
    libretranslateUrl: env.LIBRETRANSLATE_URL || env.TRANSLATE_URL || '',
    libretranslateApiKey: env.LIBRETRANSLATE_API_KEY || '',
    mymemoryEmail: env.MYMEMORY_EMAIL || env.TRANSLATE_EMAIL || '',
    mymemoryApiKey: env.MYMEMORY_API_KEY || '',
    // older single key (v0.2.x): used for the first service in the list that has no own key
    translateApiKey: env.TRANSLATE_API_KEY || '',
    // item names per ID and hour sent to the provider (remembered translations don't count)
    translateLimit: Math.max(int(env.TRANSLATE_LIMIT, 300), 1),
    // characters per day for the whole server (every ID and address together) – the provider's
    // quota is one quota for all; 0 = no limit
    translateDailyChars: Math.max(int(env.TRANSLATE_DAILY_CHARS, 100_000), 0),
    // encrypts what IDs keep secret in the database (their own translation API keys); unset = a key
    // made once in the data folder
    encryptionKey: env.ENCRYPTION_KEY || '',
    // one JSON line per security event with the client's address, for CrowdSec & co. (server/security-log.js)
    securityLog: /^(1|true|on|yes)$/i.test(env.SECURITY_LOG ?? ''),
    // AI assistants (Claude, ChatGPT, Grok, Siri …) via MCP (/mcp) and REST (/api/v1)
    mcpEnabled: env.MCP_ENABLED === 'true' || env.MCP_ENABLED === '1',
    // IDs a device may create itself (0 = no limit); joining doesn't count
    spacesPerDevice: Math.max(int(env.SPACES_PER_DEVICE, 0), 0),
    // optional administration (docs/ADMIN.md): ADMIN=on – the main admin is set up in the browser
    // with a code from the log; ADMIN=reset sets them up again (forgotten password, lost passkey)
    admin: /^(on|true|1|yes)$/i.test((env.ADMIN || '').trim()) ? 'on' : /^reset$/i.test((env.ADMIN || '').trim()) ? 'reset' : 'off',
    // without the browser (v0.5.0): both set = the main admin comes from here
    adminUser: (env.ADMIN_USER || '').trim(),
    adminPasswordHash: (env.ADMIN_PASSWORD_HASH || '').trim(),
    logLevel: env.LOG_LEVEL || 'warn',
    staticDir: env.STATIC_DIR || './dist',
    // your own skins (CSS files, see skins/README.md) – read at runtime, no rebuild needed
    skinsDir: env.SKINS_DIR || (env.DATA_DIR === ':memory:' ? '' : `${env.DATA_DIR || './data'}/skins`),
  };
}
