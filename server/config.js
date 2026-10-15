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
    // AI assistants (Claude, ChatGPT, Grok, Siri …) via MCP (/mcp) and REST (/api/v1)
    mcpEnabled: env.MCP_ENABLED === 'true' || env.MCP_ENABLED === '1',
    logLevel: env.LOG_LEVEL || 'warn',
    staticDir: env.STATIC_DIR || './dist',
  };
}
