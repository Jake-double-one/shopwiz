# CrowdSec for ShopWiz

ShopWiz writes a security log when `SECURITY_LOG: "true"` is set: one JSON line per security event with the client's address (see the README, "Security log and CrowdSec"). These files teach CrowdSec to read it and to ban addresses that guess IDs, hammer the admin login, try assistant keys or abuse the sync connections.

## Install

Copy the files into CrowdSec's configuration and let it know about ShopWiz's container log:

```sh
cp parsers/s01-parse/shopwiz-logs.yaml   /etc/crowdsec/parsers/s01-parse/
cp scenarios/*.yaml                       /etc/crowdsec/scenarios/
cp collections/shopwiz.yaml               /etc/crowdsec/collections/
cp acquis.yaml                            /etc/crowdsec/acquis.d/shopwiz.yaml   # or append it to acquis.yaml
systemctl reload crowdsec                 # docker: restart the crowdsec container
```

With CrowdSec in Docker, mount the files at the same paths and make sure it can read the Docker socket (the docker datasource needs it). The container name in `acquis.yaml` must match yours (`container_name: shopwiz` in the compose example).

## Check

```sh
cscli parsers list | grep shopwiz        # shopwiz/shopwiz-logs
cscli scenarios list | grep shopwiz      # the four scenarios
cscli metrics                            # "shopwiz" lines parsed, scenarios' events
cscli explain --file test.log --type shopwiz   # dry-run with a few lines copied from the container log
cscli decisions list                     # who got banned
```

## What gets banned, and when

| Scenario | Events | Trips after | Ban |
|---|---|---|---|
| `shopwiz/id-bruteforce` | `id_notfound`, `id_limited` | 20 unknown IDs in ~10 minutes from one address | CrowdSec's default (4 h) |
| `shopwiz/admin-bruteforce` | `admin_login_failed`, `admin_limited` | 5 failed logins in ~10 minutes | default |
| `shopwiz/ai-key-bruteforce` | `ai_key_invalid` | 10 unknown keys in ~10 minutes | default |
| `shopwiz/sync-abuse` | `ws_too_many`, `ws_flood`, `ws_slow_reader`, `create_limited` | 15 events in ~15 minutes | default |

Successful admin logins (`admin_login`, `admin_setup`, `admin_passkey`) are logged for your eyes and don't trip anything. Adjust `capacity` and `leakspeed` to taste; the numbers above are a few times what an honest user produces (mistyped IDs, a forgotten password).

## Mind the proxy

Behind a reverse proxy, `TRUST_PROXY` must be set right (`true` for a proxy in your own network) – otherwise every line carries the proxy's address and CrowdSec would ban your own proxy. CrowdSec's default whitelists (`crowdsecurity/whitelists`) never ban private addresses, so a wrong setting shows up as "nothing ever gets banned" rather than as a lock-out; `/healthz` shows the address ShopWiz counts you as.
