// Security log (SECURITY_LOG=true): one JSON line per security-relevant event, with the client's
// address – for CrowdSec, fail2ban or a pair of eyes. Off by default: ShopWiz keeps no addresses
// otherwise. Never anything about lists or items, only who hammers at the door and who got in
// as admin. Lines go to stdout next to the normal log (one line, starts with '{', has
// "log":"shopwiz-security" – that is what the CrowdSec parser in crowdsec/ looks for).
//
// Events:
//   id_notfound        an unknown ID was tried (via: rest | ws | transfer; id: what was tried, cut short)
//   id_limited         too many unknown IDs from this address – requests are refused for a while
//   create_limited     too many new IDs from this address
//   import_limited     too many imports into one ID
//   transfer_limited   too many items transferred from one ID or address
//   translate_limited  translation budget of the ID, the address or the day used up
//   ws_too_many        more than 50 sync connections from this address
//   ws_flood           a connection sent more than its budget allows (at: hello | op)
//   ws_slow_reader     a connection stopped reading and was dropped
//   ai_key_invalid     an unknown or revoked assistant key (via: rest | mcp)
//   ai_limited         an assistant key over its rate
//   admin_login_failed wrong password, setup code, promotion code or passkey (method)
//   admin_limited      too many failed admin logins from this address
//   admin_setup        the main admin was set up with the setup code
//   admin_login        an admin logged in (method: password | passkey; role: main | device)
//   admin_passkey      an admin passkey was registered (role)
//   admin_session_invalid  a sync connection presented an admin session that isn't one
export function createSecurityLog(config) {
  const enabled = !!config.securityLog;
  const sink = config.securitySink ?? ((line) => process.stdout.write(line + '\n'));
  return {
    enabled,
    /** event name, the client's address (req.ip), and a few plain fields */
    event(event, ip, extra = {}) {
      if (!enabled) return;
      sink(JSON.stringify({ time: new Date().toISOString(), log: 'shopwiz-security', event, ip: ip ?? null, ...extra }));
    },
  };
}
