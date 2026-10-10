# ShopWiz

**Shared shopping lists without sign-up or tracking.**
Create a list, share a 10-character ID (or a QR code), and everyone shops along – in real time, on every device, even with a bad connection in the supermarket.

🇩🇪 [Deutsche Version](README.de.md)

<p>
  <img src="docs/screenshots/list.png" width="240" alt="A shopping list with groups, a subgroup and items">
  <img src="docs/screenshots/list-dark.png" width="240" alt="The same list on a second device in dark mode">
  <img src="docs/screenshots/share.png" width="240" alt="Share dialog with QR code and ID">
</p>

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Install with Docker / Portainer](#install-with-docker--portainer)
- [HTTPS and reverse proxy](#https-and-reverse-proxy)
- [Configuration](#configuration)
- [Run without Docker](#run-without-docker)
- [Backup and update](#backup-and-update)
- [Privacy](#privacy)
- [Development](#development)
- [Adding a language](#adding-a-language)
- [Project structure](#project-structure)

## Features

| | |
|---|---|
| **No login** | A 10-character ID is the key to your lists. It is stored on your device and can be removed with one tap. |
| **Several lists per ID** | Switch between lists (e.g. “Weekly shop”, “Hardware store”) with a dropdown. |
| **Groups that learn** | Two levels of groups (e.g. *Fridge › Dairy*). Put milk into “Fridge” once and it lands there automatically from now on – until you move it somewhere else. |
| **Live sync** | Changes show up on all devices within a second. |
| **Works offline** | Changes are saved on the device and sent later. Simultaneous edits of the same field show a gentle notice where you pick the right value. |
| **Autocomplete** | Everything you have ever added is suggested while typing – including the learned group. |
| **Smart entry** | `2 milk`, `500g minced meat`, `milk x2` are split into amount and name. Pasting several lines adds several items. |
| **Duplicate hint** | “Milk is already on the list” → increase the amount or add anyway. A checked item is simply re-activated. |
| **Checked items stay** | They move to the end of their group and can be unchecked again. |
| **Participants** | Every device chooses its own name. Items show who added or checked them. Devices can be removed. |
| **“I'm shopping”** | Others see that you are in the shop. Items added meanwhile are highlighted on your phone. |
| **Keep screen on** | Optional button so your phone doesn't lock while shopping. |
| **History** | Who did what, with “restore” for deleted items. Cleared automatically after 14 days. |
| **Undo** | Every action can be undone right away. |
| **Sharing** | QR code, native share menu with a proper title, and link previews in messengers. A camera button scans QR codes. |
| **Copy / move** | Move or copy items and whole groups to another list or another ID. |
| **Renew ID** | Creates a new ID, the old one stops working. All participating devices move along automatically. |
| **Delete ID** | For everyone, with double confirmation. Participants can continue with a copy under a new ID. |
| **Languages** | English and German, per device. Your entries are never translated. |
| **Light & dark** | Follows the system or can be set per device. Design: *Feierabend design system v2*. |
| **Installable** | Works as an app on the home screen (PWA). |

## How it works

### The ID

- An ID looks like `K7QM-2XPA-9F`: 10 characters, no easily confused characters (no `O`/`0`, `I`/`1`, `L`).
- **Anyone who knows the ID can open and edit the lists.** Treat it like a key.
- The link `https://your-server/K7QM2XPA9F` opens the lists directly.
- Every ID has a name (it doesn't have to be unique) and can contain several lists.
- **Expiry:** an ID and all its data is deleted after **181 days without any active device**. This can be changed per ID in the settings (7–367 days).

### Devices and participants

- The first time you open a list, you choose a name for your device (“Alex's phone”).
- The participant row shows everybody; a green dot means “online right now”.
- A device can be removed by any participant. Without a login this is not a lock-out – with the ID you can join again. To really lock someone out, use **Settings → Renew ID**.
- Devices without activity for **30 days** are removed automatically. They can rejoin anytime with the link or ID.

### Groups and learning

- Each list has its own groups by default. In **List options → Groups** a list can use the **shared groups of the ID** instead – then all lists in that mode share groups and what was learned.
- Tap **+** on a group to add items directly into it, or drag items by the handle (⋮⋮) to another group.
- ShopWiz remembers the last group of every item name. Adding it again puts it there automatically.

### Sync and conflicts

- Every change is sent as a small operation (“milk checked”), never as the whole list. Offline changes are queued and sent when the connection is back.
- If two devices changed **the same field** of the same item at the same time, the newest change wins for now and a notice “1 simultaneous change to check” appears. Anyone can choose the right value or keep the current one.
- If an item was deleted while someone else edited it offline, the deletion wins – the edit is kept in the history and the item can be restored there.

### Buttons in the settings

| Button | What happens |
|---|---|
| **Forget ID on this device** | The “reset button”: removes the ID and its cached data from this device only. Nothing is deleted on the server. |
| **Renew ID** | New ID, old ID invalid. Participating devices move along; people who only have the old link lose access. |
| **Delete ID for everyone** | Asks twice (you type the name). Participants then see “This list was deleted” and can continue with a copy under a new ID. Once the last device has expired, everything is gone for good. |

## Install with Docker / Portainer

ShopWiz is a single container with a single volume. No separate database container is needed (it uses SQLite).

### Portainer (Stacks)

1. **Stacks → Add stack**.
2. Either
   - **Repository**: point it to this Git repository. Portainer builds the image from the `Dockerfile`, or
   - **Web editor**: paste the content of [`docker-compose.yml`](docker-compose.yml). It uses the prebuilt image `ghcr.io/jake-double-one/shopwiz:latest`, which the CI publishes on every push to `main`. If the repository is private, the image is private too: either make the package public on GitHub or add `ghcr.io` with a token under **Registries** in Portainer.
3. Set `PUBLIC_URL` to the address people will use (e.g. `https://shop.example.com`).
4. Deploy. The app listens on port **8080**.

### Docker Compose (command line)

```bash
git clone https://github.com/jake-double-one/shopwiz.git
cd shopwiz
docker compose up -d --build
```

Open <http://localhost:8080>.

The compose file already runs the container hardened: read-only file system, no Linux capabilities, `no-new-privileges`, non-root user, and a health check.

## HTTPS and reverse proxy

ShopWiz works over plain HTTP, but **browsers only allow the camera (QR scan), the native share menu, keeping the screen on and the offline app over HTTPS**. Without HTTPS these buttons are hidden, and “Copy link” is shown instead.

Put ShopWiz behind your existing reverse proxy and set `TRUST_PROXY=true` (so rate limiting sees real client addresses). The proxy must forward **WebSockets** on `/ws`.

**Caddy**

```
shop.example.com {
    reverse_proxy shopwiz:8080
}
```

**nginx**

```nginx
location / {
    proxy_pass http://shopwiz:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 1h;
}
```

**Nginx Proxy Manager:** enable “Websockets Support” for the proxy host.

**Traefik:** WebSockets work out of the box.

## Configuration

All settings are environment variables. The defaults are fine for most setups.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port inside the container |
| `PUBLIC_URL` | *(empty)* | Public address, used for link previews. Without it, the request's host is used. |
| `SPACE_TTL_DAYS` | `181` | Default for new IDs: delete after this many days without any active device (1–367) |
| `DEVICE_TTL_DAYS` | `30` | Remove devices after this many days without activity |
| `ACTIVITY_TTL_DAYS` | `14` | Keep history, deleted items and conflicts this long |
| `TRUST_PROXY` | `false` | `true` behind a reverse proxy |
| `LOOKUP_LIMIT` | `30` | Unknown IDs a client address may try … |
| `LOOKUP_WINDOW_MIN` | `15` | … per this many minutes (protection against guessing IDs) |
| `CREATE_LIMIT` | `30` | New IDs per client address and hour |
| `LOG_LEVEL` | `warn` | `info`, `warn`, `error`, … |
| `DATA_DIR` | `/data` | Where the database lives (in Docker: the volume) |

## Run without Docker

Requires **Node.js 22.13 or newer** (ShopWiz uses the built-in `node:sqlite`).

```bash
npm ci
npm run build
npm start          # http://localhost:8080, data in ./data
```

## Backup and update

All data is in one SQLite database in the volume (`/data/shopwiz.db`).

```bash
# consistent backup while running
docker exec shopwiz node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/shopwiz.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker cp shopwiz:/data/backup.db ./shopwiz-backup.db
```

Update: in Portainer use **Pull and redeploy** (web editor) or **Pull and redeploy / re-build** (repository). On the command line: `git pull && docker compose up -d --build`. The database schema is created and kept up to date automatically.

## Privacy

- No accounts, no cookies, no analytics, no fingerprinting.
- No external requests: fonts, icons and the QR code library are served by ShopWiz itself.
- Logs contain no IP addresses, IDs or tokens. Rate limiting only keeps counters in memory.
- Stored: list contents, the names you enter, and timestamps. Each device has a random secret token; only its hash is stored on the server.
- Expired IDs and inactive devices are deleted for good. Old IDs are never given out again.
- Strict security headers (Content Security Policy, `Referrer-Policy: no-referrer` so the ID never leaks via links).

## Development

```bash
npm ci
npm run dev        # server on :8080 + Vite dev server on :5173 with hot reload
```

| Command | What it does |
|---|---|
| `npm test` | Unit and integration tests (Vitest) for parsing, sync logic, conflicts and the WebSocket server |
| `npm run test:e2e` | End-to-end tests in a real browser (Playwright): two devices, offline + conflicts, renew, delete, transfer, … Run `npm run build` first. |
| `npm run check` | Svelte compiler and accessibility checks |
| `npm run build` | Builds the client into `dist/` |

**Tech:** Node.js + Fastify + WebSockets + SQLite on the server, Svelte 5 + Vite as an installable PWA on the client. Drag and drop uses SortableJS, QR codes use `qrcode` and `jsqr`.

## Adding a language

1. Copy `client/src/locales/en.json` to e.g. `fr.json` and translate the values (keep the `{placeholders}`). Keys ending in `_one` / `_other` are singular / plural.
2. Register it in `client/src/lib/i18n.svelte.js` in `LANGUAGES`.

Missing keys fall back to English.

## Project structure

```
server/        Fastify app, WebSocket hub, SQLite schema and all list operations (core.js)
shared/        Code used by server and client: ID format, entry parsing
client/        Svelte app
  src/lib/       sync engine (offline queue, optimistic updates), actions, i18n
  src/components UI components
  src/locales/   translations
  public/        icons, manifest, service worker, link preview image
test/          Vitest tests
e2e/           Playwright tests
docs/          Screenshots and the original plan (German)
```
