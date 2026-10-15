# ShopWiz

**Shared shopping lists without sign-up or tracking.**
Create a list, share a 10-character ID (or a QR code), and everyone shops along – in real time, on every device, even with a bad connection in the supermarket.

🇩🇪 [Deutsche Version](README.de.md)

<p>
  <img src="docs/screenshots/list.png" width="240" alt="A shopping list with groups and items">
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
| **Groups that learn** | Sort the list by groups (e.g. *Bakery*, *Fridge*). Put milk into “Fridge” once and it lands there automatically from now on – until you move it somewhere else. |
| **Live sync** | Changes show up on all devices within a second. |
| **Works offline** | Changes are saved on the device and sent later. Simultaneous edits of the same field show a gentle notice where you pick the right value. |
| **Autocomplete** | Everything you have ever added is suggested while typing – including the learned group. |
| **Amount buttons** | On tablets and computers, − and + sit right next to the amount (g/ml in steps of 100). On phones the amount is changed in the item's edit dialog. |
| **Smart entry** | `2 milk`, `500g minced meat`, `milk x2` are split into amount and name. Pasting several lines adds several items. |
| **Duplicate hint** | “Milk is already on the list” → increase the amount or add anyway. A checked item is simply re-activated. |
| **Important / not important** | Mark items ↑ important (“don't come home without it”) or ↓ not important. Important rows are highlighted, unimportant ones grey. Set in the item details or with the button next to the group picker; optionally per list with the shortcuts `!Diapers` / `? Basil` when typing. How the mark looks is chosen per device. |
| **Checked items stay** | They move to the end of their group and can be unchecked again. |
| **Inactive items** | A collapsed “shadow list” at the bottom of every list, with the same groups as the list: things you don't need right now and groups without items. Clearing checked items moves them there; one tap puts them back on the list. |
| **Shop address** | Optionally give a list the address of its shop – a “Start navigation” button appears next to the list name (just an arrow on phones). |
| **Backup & import** | Download your lists as a Markdown file, edit it in any text editor and import it again – into the same ID (no duplicates) or as a new ID. |
| **Participants** | Every device chooses its own name. An item's details show who added or checked it. Devices can be removed. |
| **“I'm shopping”** | Others see that you are in the shop. Items added meanwhile are highlighted on your phone. |
| **Find each other** | In a big shop, everybody checked in sees where the others are (the group of their last checked item). A **Call** button sends one of four fixed signals – “Where are you?”, “Come to me”, “Meet at the checkout”, “I'm done” – no chat. |
| **Travel mode** | Shopping abroad? Per list, items get their translation underneath – with the country's flag, taken from the shop address. Tap it to show it big to the staff. Translate everything at once or correct single items. |
| **AI assistants** | Claude, ChatGPT, Grok or Siri read your lists and – if allowed per ID – add or check off items. Each one is its own participant with its own key. |
| **Keep screen on** | Optional button so your phone doesn't lock while shopping. |
| **History** | Who did what, with “restore” for deleted items. Cleared automatically after 14 days. |
| **Undo** | Every action can be undone right away. |
| **Sharing** | QR code, native share menu with a proper title, and link previews in messengers. A camera button scans QR codes. |
| **Copy / move** | Move or copy items and whole groups to another list or another ID. |
| **Renew ID** | Creates a new ID, the old one stops working. All participating devices move along automatically. |
| **Delete ID** | For everyone, with double confirmation. Participants can continue with a copy under a new ID. |
| **Languages** | English and German, per device. Your entries are only translated if you turn on travel mode for a list. |
| **Light & dark** | Follows the system or can be set per device. Design: *Feierabend design system v2*. |
| **Built-in help** | A (?) in the header (and “How ShopWiz works” on the start screen) explains every feature in short topics – offline and in the device's language. New users get a one-time hint. |
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

### Inactive items (shadow list)

At the bottom of every list there is a collapsed section **Inactive items**:

- **Clear checked** moves checked items there – nothing is lost. They keep their group, amount and note.
- Tap an inactive item (or its **+**) to put it back on the list, unchecked.
- Add things you don't need yet directly there, or drag items in and out by the handle.
- Typing the name of an inactive item in the normal input brings it back instead of creating a duplicate.
- The list itself only shows groups that contain items. A group whose last item becomes inactive moves down there with it (still under its name), and comes back as soon as one of its items is back on the list. Empty groups wait there, too – move an item into one via the item's details. A newly created group is empty, so the input is aimed at it right away: the next item you type lands there.
- Inactive items don't count towards the progress bar. **Delete all inactive** really deletes them (restorable from the history for 14 days).

### Shop address and navigation

In **List options** you can enter the address of the shop (or paste a map link). A **Start navigation** button then appears next to the list name – written out on tablets and computers, just an arrow on phones. It opens the device's map app: Android lets you choose your navigation app, iPhone/Mac use Apple Maps, other devices Google Maps in the browser. Nothing is loaded from a map service until you tap it.

### Backup and import as a file

**Settings → Backup & import** (also in the list options):

- **Export** downloads a Markdown file (`.md`) – all lists of the ID, or just the current list. It works offline.
- **Import** takes such a file, any Markdown or plain text with one item per line – choose a file or paste the text.
  - **Into this ID:** lists and groups are matched by name; an item that is already on the list is not added again (if the file says it's needed and it is checked or inactive, it is re-activated). Items without a list heading go into the current list.
  - **As a new ID:** creates a new ID with the imported lists. This is also available on the start screen (“Import a file as a new list”).

The format is easy to write by hand:

```markdown
# Home                          ← name of the ID (optional)
## Weekly shop                  ← list
> 📍 Via Roma 1, Olbia          ← shop address (optional)
- [ ] Bread                     ← open item without a group
### Fridge                      ← group
- [ ] 2 l Milk // lactose free  ← amount, name, note after //
- [x] Butter                    ← checked
- [-] Feta                      ← inactive
```

Plain lines like `Milk`, `- 2 Bread` or `* Apples` work too. A name that starts with a number and has no amount is written in quotes (`"4711 Cologne"`).

### Finding each other in the shop

Shops can be big, and when you split up you lose each other. While you are checked in (**I'm shopping**):

- The banner of everybody else in the shop shows **where they are**: the group of the item they checked last (“Jana is shopping – at Fruit & veg · just now”). No GPS – the list's groups are the map.
- As soon as at least one other person is in the shop, a **Call** button appears next to “I'm shopping” (just an arrow on phones). It sends a fixed signal to everybody in the shop or to one person:
  - **Where are you?** – the other phone vibrates and shows a card; one tap answers “I'm at *Bakery*” (their last spot), “Come to the checkout”, or a group they choose.
  - **Come to me – *Fridge*** – with your last spot (or a group you pick).
  - **Meet at the checkout** · **I'm done**
- When the last item is checked, everybody else in the shop gets “Everything is in the cart – meet at the checkout?”.

There is deliberately no free text, so it never becomes a chat. Signals never touch the database. If a phone is offline or its display is off, the server keeps the signal in memory for up to 30 minutes and delivers it as soon as ShopWiz is open there again. A call made without reception goes out once the connection is back.

The check-in ends with the button, once everything is checked, or automatically after **60 minutes without activity** (checking, adding, calling or opening ShopWiz extends it).

### Travel mode

For when the shop staff don't speak your language. In the list menu (⋯ next to the list name) turn on **Show items in the local language**:

- The **country** comes from the list's shop address (e.g. `Via Roma 3, Olbia, Italia` → 🇮🇹 Italian) – detected on the device, no map service involved. If the address doesn't name a country, or the country has several languages (Switzerland, Belgium …), you pick it.
- Under every item its translation appears in italics with the country's flag. **Tap it** and it is shown full screen for the staff; swipe (or use the arrows) for the next item.
- **Translate N items** translates everything that is still missing in one go. Single items are translated or corrected in the item details – adding items stays as it is.
- Translations are remembered per name for the whole ID: once “Milch” is “Latte”, it is “Latte” on every list and every device, without asking the translation service again. A translation you typed is never overwritten by a machine.
- Turning travel mode off only hides the translations.

Machine translation runs on the ShopWiz server – a translation service only ever sees item names, never your device or address. `TRANSLATE_PROVIDER` names one service or several in order, e.g. `deepl,azure`: when one is used up, down or rejects its key, the next one steps in. Every service has its own settings (see [Configuration](#configuration)):

| Service | Free | Needs |
|---|---|---|
| `mymemory` (default) | about 5,000 characters a day, about 50,000 with `MYMEMORY_EMAIL`; quality for single words varies | nothing |
| `deepl` | DeepL API (Developer plan): 1,000,000 characters once – they don't renew | `DEEPL_API_KEY` |
| `azure` | Microsoft Translator, free tier “F0”: about 2,000,000 characters a month | `AZURE_TRANSLATOR_KEY`, usually `AZURE_TRANSLATOR_REGION` |
| `google` | Google Cloud Translation: about 500,000 characters a month covered by the monthly credit | `GOOGLE_API_KEY` |
| `libretranslate` | unlimited, self-hosted (open source, 1–2 GB RAM) – clearly weaker with compound words | `LIBRETRANSLATE_URL`, see the example in `docker-compose.yml` |
| `none` | – | translations are only typed in by hand |

A good free setup: `TRANSLATE_PROVIDER=deepl,azure,mymemory` – DeepL's quality first, Microsoft as long-term fallback, MyMemory as the last resort.

Item names are short (10–15 characters) and every name is translated only once per ID – remembered translations cost nothing. Even DeepL's one-time million lasts for tens of thousands of items. “Translate” in the item details always asks again; the list menu can delete all translations of the list to start over. The item details say which service translated an item, and the help shows the services in use next to the version, each with a green or red dot – the server checks every service (wrong or missing key, used up, not reachable) and names the reason. For DeepL the help also shows how much of its quota is used (“271 of 1,000,000 characters used”).

### AI assistants (Claude, ChatGPT, Grok, Siri)

Assistants can read the lists and – if you allow it – change them: “Plan dinner for the week and put the ingredients on the list”, “What's still on the hardware store list?”, “Hey Siri, milk on the list”.

1. Switch it on for the server: `MCP_ENABLED: "true"` (see [Configuration](#configuration)). ShopWiz must be reachable from the internet over **HTTPS** – the assistants' servers call it.
2. In ShopWiz: **Settings → AI assistants**.
   - **Assistants may change lists** – off by default: assistants can only read. On: they can add, check off, change and remove items (removing moves to “inactive”, nothing is deleted for good). Applies to all assistants of this ID.
   - **Connect an assistant**: Claude, ChatGPT, Grok, Siri or another name. Every assistant gets its own secret key and shows up as its own participant (marked “AI”) – in the history, too (“Claude added 8 items”). The key is shown once; remove the assistant (here or under participants) to cut it off.
3. Add it to the assistant:

| Assistant | How |
|---|---|
| **Claude** (web, desktop, app) | Settings → Connectors → *Add custom connector* → name “ShopWiz”, paste the MCP address `https://<your-server>/mcp/swk_…` |
| **ChatGPT** | Settings → Apps & Connectors → turn on developer mode → *Create connector* → paste the MCP address, no authentication. Depends on the plan. |
| **Grok** | grok.com/connectors → *New connector* → *Custom* → paste the MCP address |
| **Siri** | Shortcuts app: *Dictate text* → *Get contents of URL*: `https://<your-server>/api/v1/lists/default/items`, method POST, header `Authorization: Bearer swk_…`, JSON body field `text` = dictated text. ShopWiz shows these steps when connecting. |
| **Other** (Home Assistant, scripts …) | MCP address, or the REST API with `Authorization: Bearer swk_…` – description at `/api/v1/openapi.json` |

**What assistants can do** (MCP tools / REST): `list_lists` (`GET /api/v1/lists`), `read_list` (`GET /api/v1/lists/{list}`), and with permission `add_items` (`POST …/{list}/items`, e.g. `{"text": "milk, bread and 200g minced meat"}` or `{"items": ["2 l milk", "!diapers"]}`), `check_items` (`POST …/{list}/check`), `update_item` (`PATCH …/{list}/items/{item}`), `remove_items` (`POST …/{list}/remove`). `{list}` is the id, the name or `default` (the first list). Items added by an assistant behave like typed ones: same item → amount added, a checked one comes back, learned groups apply.

Never possible for assistants: deleting or renewing the ID, managing devices, changing settings, deleting items for good. **Renewing the ID cuts all assistants.** Privacy: the assistant's provider sees the lists whenever you ask it about them; item names typed by others are passed on as data.

### Sync and conflicts

- Every change is sent as a small operation (“milk checked”), never as the whole list. Offline changes are queued and sent when the connection is back.
- If two devices changed **the same field** of the same item at the same time, the newest change wins for now and a notice “1 simultaneous change to check” appears. Anyone can choose the right value or keep the current one.
- If an item was deleted while someone else edited it offline, the deletion wins – the edit is kept in the history and the item can be restored there.

### Buttons in the settings

| Button | What happens |
|---|---|
| **Your ID** | Shown hidden; the eye reveals it, tapping it copies it. |
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
| `SHOPPING_IDLE_MIN` | `60` | Check-in at the shop ends after this many minutes without activity |
| `SIGNAL_TTL_MIN` | `30` | How long a call waits for a device that is offline |
| `TRANSLATE_PROVIDER` | `mymemory` | Travel mode translation: one service or several in order, e.g. `deepl,azure,mymemory` – `mymemory`, `deepl`, `azure`, `google`, `libretranslate` or `none` |
| `DEEPL_API_KEY` | – | DeepL key (keys ending in `:fx` use the free API host) |
| `AZURE_TRANSLATOR_KEY` | – | Microsoft Translator key (Azure “Translator” resource) |
| `AZURE_TRANSLATOR_REGION` | – | Region of that resource, e.g. `westeurope` (leave empty for a “global” resource) |
| `GOOGLE_API_KEY` | – | Google Cloud Translation key |
| `LIBRETRANSLATE_URL` | `http://libretranslate:5000` | Address of your LibreTranslate |
| `LIBRETRANSLATE_API_KEY` | – | Only if your LibreTranslate requires keys |
| `MYMEMORY_EMAIL` | – | Optional for MyMemory: raises the free quota to about 50,000 characters a day |
| `MCP_ENABLED` | `false` | `true` lets AI assistants (Claude, ChatGPT, Grok, Siri …) connect via MCP (`/mcp`) and REST (`/api/v1`) – see [AI assistants](#ai-assistants-claude-chatgpt-grok-siri) |
| `TRANSLATE_LIMIT` | `300` | Item names per ID and hour sent to translation services |

Settings of v0.2.0/0.2.1 keep working: `TRANSLATE_API_KEY` is used for the first listed service that has no own key, `TRANSLATE_URL` and `TRANSLATE_EMAIL` count as `LIBRETRANSLATE_URL` and `MYMEMORY_EMAIL`.
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
- No external requests from your device: fonts, icons, flags and the QR code library are served by ShopWiz itself.
- Travel mode only: the server sends item names (nothing else) to the configured translation service. Set `TRANSLATE_PROVIDER=none` to switch that off.
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

## Third-party licenses

Country flags: [flag-icons](https://github.com/lipis/flag-icons) © Panayiotis Lipiridis, MIT license – the license text is shipped with the app as `/licenses.txt`.

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
