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
- [Administration (optional)](#administration-optional)
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
| **New item with details** | A long press on the yellow + opens a dialog: name, amount, priority, note, group and list at once; “Another” keeps it open. With the installed app: long press the app icon → “Add item” (on Android this needs the app installed from Chrome or Edge – Brave and others can't add the shortcut). |
| **Share to ShopWiz** | Select text on a web page or in a note → Share → ShopWiz: every line becomes an item (app installed from Chrome or Edge on Android – other browsers don't register it as a share target). |
| **Text size** | Small, normal or large per device; the focus mode has its own size (“Aa”). |
| **Important / not important** | Mark items ↑ important (“don't come home without it”) or ↓ not important. Important items move to the top of their group, unimportant ones to the bottom. Set in the item details or with the button next to the group picker; optionally per list with the shortcuts `!Diapers` / `? Basil` when typing. How the mark looks is chosen per device. |
| **Checked items stay** | They move to the end of their group and can be unchecked again. The eye button hides them while you shop (per device). |
| **Swipe** | On phones, swipe an item one way to check it off and the other way to make it inactive (with undo). Which way does what – or whether swiping is off – is set per device. |
| **Finish shopping** | Once everything is checked: one button moves the checked items to “Inactive”, ends your check-in and lets the screen turn off again. |
| **Focus mode** | Nothing but the list: categories and items to check off, large, black on white or white on black depending on the skin. Swiping and “keep screen on” work there, too. A banner at the top leaves it. |
| **Search** | The magnifier next to the list name filters the list – notes, translations and inactive items included. |
| **Share as text** | Send the open items, one per line, to a chat or a note (native share menu or clipboard). |
| **Inactive items** | A collapsed “shadow list” at the bottom of every list, with the same groups as the list: things you don't need right now and groups without items. Clearing checked items moves them there; one tap puts them back on the list. |
| **Shop address** | Optionally give a list the address of its shop – a “Start navigation” button appears next to the list name (just an arrow on phones). |
| **Backup & import** | Download your lists (including travel mode and translations) as a Markdown file, edit it in any text editor and import it again – into the same ID (no duplicates) or as a new ID. |
| **Participants** | Every device chooses its own name. An item's details show who added or checked it. Devices can be removed. |
| **“I'm shopping”** | Others see that you are in the shop. Items added meanwhile are highlighted on your phone. |
| **Find each other** | In a big shop, everybody checked in sees where the others are (the group of their last checked item). A **Call** button sends one of four fixed signals – “Where are you?”, “Come to me”, “Meet at the checkout”, “I'm done” – no chat. |
| **Travel mode** | Shopping abroad? Per list, items get their translation underneath – with the country's flag, taken from the shop address. Tap it to show it big to the staff. Translate everything at once or correct single items. |
| **List groups** | Several shops that sell similar things (say Lidl and two Conads) share their items: 400 g of mince is on all of them and is checked off once – wherever – with a green “bought at Lidl” label. Groups and order stay per shop. The DIY store sees none of it. |
| **AI assistants** | Claude, ChatGPT, Grok or Siri read your lists and – if allowed per ID – add or check off items. Each one is its own participant with its own key. |
| **Keep screen on** | Optional button so your phone doesn't lock while shopping. |
| **History** | Who did what, with “restore” for deleted items. Cleared automatically after 14 days. |
| **Undo** | Every action can be undone right away. |
| **Sharing** | QR code and native share menu with a proper title. A camera button scans QR codes. Link previews in messengers stay neutral: they never show the name of the ID or what is on it. |
| **Copy / move** | Move or copy items and whole groups to another list or another ID you are in as well. |
| **Renew ID** | Creates a new ID, the old one stops working. All participating devices move along automatically. |
| **Delete ID** | For everyone, with double confirmation. Participants can continue with a copy under a new ID. |
| **Languages** | English and German, per device. Your entries are only translated if you turn on travel mode for a list. |
| **Skins** | Dark, AMOLED (true black), Sunset (dark plum and coral), Light, Mint (soft mint and green) and Mango (bright and fruity) – picked per device in the settings. More can be dropped in as CSS files, also on a running server. On the first visit ShopWiz follows the browser (dark or light). Every skin meets the WCAG AA contrast level (tested automatically). Design: *Feierabend design system v4*. |
| **Built-in help** | A (?) in the header (and “How ShopWiz works” on the start screen) explains every feature in short topics – offline and in the device's language. New users get a one-time hint. |
| **Installable** | Works as an app on the home screen (PWA). On Android, install it from Chrome or Edge: only they give the app its shortcut (“Add item”) and the share target – Brave, Firefox and others only put a bookmark on the home screen. |

## How it works

### The ID

- An ID looks like `K7QM-2XPA-9F`: 10 characters, no easily confused characters (no `O`/`0`, `I`/`1`, `L`).
- **Anyone who knows the ID can open and edit the lists.** Treat it like a key.
- The link `https://your-server/K7QM2XPA9F` opens the lists directly.
- Every ID has a name (it doesn't have to be unique) and can contain up to 10 lists. The inactive part of a list keeps its 250 most recent items; older ones are deleted and stay in the history for 14 days.
- **Expiry:** an ID and all its data is deleted after **181 days without any active device**. This can be changed per ID in the settings (7–367 days).

### Devices and participants

- The first time you open a list, you choose a name for your device (“Alex's phone”).
- The participant row shows everybody; a green dot means “online right now”.
- A device can be removed by any participant. Without a login this is not a lock-out – with the ID you can join again. To really lock someone out, use **Settings → Renew ID**.
- Devices without activity for **30 days** are removed automatically. They can rejoin anytime with the link or ID.
- A device can be in up to 10 IDs at a time; **Settings → Forget ID on this device** frees a slot. An ID has room for 100 devices.

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
- [ ] ! Diapers                 ← "!" important, "?" not important
```

A list in travel mode keeps its country and language, and its items their translations:

```markdown
## Olbia
> ✈️ IT it                      ← travel mode: country, language
- [ ] 1 l Milk → Latte          ← translation after →
```

On import, translations that the ID already has are kept.

A list in a list group names the linked lists; shared items are written once, under the list they came from:

```markdown
## Lidl
> 🔗 Conad 1, Conad 2           ← list group
- [ ] 400 g Mince               ← shared
- [ ] ↯ Charcoal                ← "↯" only on this list
```

Plain lines like `Milk`, `- 2 Bread` or `* Apples` work too. A name that starts with a number and has no amount is written in quotes (`"4711 Cologne"`).

### List groups

For several grocery shops in one ID: an item should be bought in *one* of them – no matter which.

- **Link:** list menu → “List group” → tick the other lists. The link holds for everybody involved (ticking Conad 1 and Conad 2 in Lidl links all three); a list belongs to one group at most. A green chain next to the list name shows it.
- **Existing items:** when linking, ShopWiz asks once “Share the existing items in the group?”. Yes: items with the same name become one (the larger amount, notes joined, open beats checked, important beats normal) – with undo. No: only new items are shared.
- **Adding:** next to the priority button, a green “Group” button shows that the next item goes to every linked list. Tap it: “Only Conad”. The default can be set per device (Settings → “New items in a list group”).
- **In the shop:** a shared item has one status. Checked off at Lidl → checked at Conad, too, with a green “bought at Lidl” label. It goes to “Inactive” as usual with “Finish shopping” – then for everybody. Each shop learns groups and order on its own; a shop that doesn't know the item yet shows it without a group.
- **Item details:** one switch “Also at CONAD Cagliari” (with several partners “In the whole group”) – off = only on this list.
- **Leaving:** a list that leaves the group keeps its own copy of all shared items; the others keep the shared ones. With one list left, the group ends.
- Linking and leaving only work online. AI assistants see the group (`listGroup`) and add to the whole group, or with `onlyThisList` to one list.

### Finding each other in the shop

Shops can be big, and when you split up you lose each other. While you are checked in (**I'm shopping**):

- The banner of everybody else in the shop shows **where they are**: the group of the item they checked last (“Jana is shopping – at Fruit & veg · just now”). No GPS – the list's groups are the map.
- As soon as at least one other person is in the shop, a **Call** button appears next to “I'm shopping” (just an arrow on phones). It sends a fixed signal to everybody in the shop or to one person:
  - **Where are you?** – the other phone vibrates and shows a card; one tap answers “I'm at *Bakery*” (their last spot), “Come to the checkout”, or a group they choose.
  - **Come to me – *Fridge*** – with your last spot (or a group you pick).
  - **Meet at the checkout** · **I'm done**
- When the last item is checked, everybody else in the shop gets “Everything is in the cart – meet at the checkout?”.

There is deliberately no free text, so it never becomes a chat. Signals never touch the database. If a phone is offline or its display is off, the server keeps the signal in memory for up to 30 minutes and delivers it as soon as ShopWiz is open there again. A call made without reception goes out once the connection is back.

When everything is checked, **Finish shopping** appears (also as a notice right after the last check): checked items move to “Inactive”, the check-in ends and “keep screen on” is turned off. Otherwise the check-in ends with the button or automatically after **60 minutes without activity** (checking, adding, calling or opening ShopWiz extends it).

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

**Every ID can bring its own service.** Settings → Translation offers *Server translation* (the services above, if you configured any), *DeepL / Google / Microsoft – own API key*, *MyMemory – free* or *Off*. An ID's key is stored encrypted on the server (`ENCRYPTION_KEY`), is never shown again (only its last four characters) and is used by this ID only; the server's daily limit (`TRANSLATE_DAILY_CHARS`) does not apply to it. Everybody in the ID can change the setting. LibreTranslate is a server-side service only – it is an address the server would call. Want to be sure strangers never spend your quota? Then put no paid key into the server settings: leave `TRANSLATE_PROVIDER` at `mymemory` or `none`, and every ID pays with its own key.

Item names are short (10–15 characters) and every name is translated only once per ID – remembered translations cost nothing. Even DeepL's one-time million lasts for tens of thousands of items. “Translate” in the item details always asks again; the list menu can delete all translations of the list to start over. The item details say which service translated an item, and Settings → Translation shows the services in use, each with a green or red dot – the server checks every service (wrong or missing key, used up, not reachable) and names the reason. For DeepL it also shows how much of the quota is used (“271 of 1,000,000 characters used”), marked as the server's quota or the ID's own.

### AI assistants (Claude, ChatGPT, Grok, Siri)

Assistants can read the lists and – if you allow it – change them: “Plan dinner for the week and put the ingredients on the list”, “What's still on the hardware store list?”, “Hey Siri, milk on the list”.

1. Switch it on for the server: `MCP_ENABLED: "true"` (see [Configuration](#configuration)). ShopWiz must be reachable from the internet over **HTTPS** – the assistants' servers call it.
2. In ShopWiz: **Settings → AI assistants**.
   - **Assistants may change lists** – off by default: assistants can only read. On: they can add, check off and change items (amount, note, priority, group, translation) and move them to “Inactive” – they can't delete any item. They can also create, sort, rename and delete groups (the items stay on the list) and set travel mode. Applies to all assistants of this ID.
   - **Connect an assistant**: Claude, ChatGPT, Grok, Siri or another name. Every assistant gets its own secret key and shows up as its own participant (marked “AI”) – in the history, too (“Claude added 8 items”). The key is shown once; remove the assistant (here or under participants) to cut it off.
3. Add it to the assistant:

| Assistant | How |
|---|---|
| **Claude** (web, desktop, app) | Settings → Connectors → *Add custom connector* → name “ShopWiz”, paste the MCP address `https://<your-server>/mcp/swk_…` |
| **ChatGPT** | Settings → Apps & Connectors → turn on developer mode → *Create connector* → paste the MCP address, no authentication. Depends on the plan. |
| **Grok** | grok.com/connectors → *New connector* → *Custom* → paste the MCP address |
| **Siri** | Shortcuts app: *Dictate text* → *Get contents of URL*: `https://<your-server>/api/v1/lists/default/items`, method POST, header `Authorization: Bearer swk_…`, JSON body field `text` = dictated text. ShopWiz shows these steps when connecting. |
| **Other** (Home Assistant, scripts …) | MCP address, or the REST API with `Authorization: Bearer swk_…` – description at `/api/v1/openapi.json` |

**What assistants can do** (MCP tools / REST): `list_lists` (`GET /api/v1/lists`), `read_list` (`GET /api/v1/lists/{list}`), and with permission `add_items` (`POST …/{list}/items`, e.g. `{"text": "milk, bread and 200g minced meat"}` or `{"items": ["2 l milk", "!diapers"]}`), `check_items` (`POST …/{list}/check`), `update_item` (`PATCH …/{list}/items/{item}` – amount, note, priority, name, group, translation), `move_to_inactive` (`POST …/{list}/inactive` – takes items off the list into “Inactive”, never deletes them; `{"allChecked": true}` after shopping), `bring_back` (`POST …/{list}/bring-back` – puts inactive items back on the list with group, amount and note). `read_list` with `includeInactive` (`?inactive=1`) shows the inactive items; `add_items` with `forLater` puts new items straight into “Inactive”, and adding a name that is inactive brings it back.

Groups (categories) and travel mode: `add_groups` (`POST …/{list}/groups`), `order_groups` (`PUT …/{list}/groups`, e.g. the way through the shop), `order_items` (`PUT …/{list}/items/order`, `{"group": "Fruit", "items": ["kiwi", "apples"]}` – sorts the items of one group), `rename_group` (`PATCH …/{list}/groups/{group}`), `delete_group` (`DELETE …/{list}/groups/{group}` – items stay, restorable from the history), `set_travel_mode` (`PUT …/{list}/travel`, `{"country": "IT"}` or `{"off": true}`) and `set_translations` (`PUT …/{list}/translations`, `{"translations": [{"item": "milk", "text": "latte"}]}`). Items in `add_items` can carry a `group` (created if missing; an item already on the list moves there) and a `translation`. Translations written by an assistant count as typed by hand – machine translation never replaces them. So you can ask: “Sort the list into aisles for an Italian supermarket and translate everything.” `{list}` is the id, the name or `default` (the first list). Items added by an assistant behave like typed ones: same item → amount added, a checked one comes back, learned groups apply.

Never possible for assistants: deleting or renewing the ID, managing devices, changing the settings of the ID, deleting items for good. **Renewing the ID cuts all assistants.** Privacy: the assistant's provider sees the lists whenever you ask it about them; item names typed by others are passed on as data.

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

Let the proxy send `Strict-Transport-Security` (HSTS) so browsers never fall back to plain HTTP – Caddy does that by itself; nginx: `add_header Strict-Transport-Security "max-age=31536000" always;`.

## Configuration

All settings are environment variables. The defaults are fine for most setups.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port inside the container |
| `PUBLIC_URL` | *(empty)* | Public address, used for link previews and passkeys. Without it, the request's host is used. |
| `SPACE_TTL_DAYS` | `181` | Default for new IDs: delete after this many days without any active device (1–367) |
| `DEVICE_TTL_DAYS` | `30` | Remove devices after this many days without activity |
| `ACTIVITY_TTL_DAYS` | `14` | Keep history, deleted items and conflicts this long |
| `TRUST_PROXY` | `false` | `true` behind a reverse proxy in your own network (Docker, LAN) – **important**: the limits per address (ID guessing, logins, sync connections, translations) otherwise count everybody as the proxy's one address. Only the proxy's own entry in `X-Forwarded-For` is believed, never what a client writes there. Two proxies in a row (e.g. Cloudflare + nginx): `2`, or the proxies' addresses (`10.0.0.2, 173.245.48.0/20`). Leave it `false` when ShopWiz faces the internet directly. |
| `LOOKUP_LIMIT` | `30` | Unknown IDs a client address may try … |
| `LOOKUP_WINDOW_MIN` | `15` | … per this many minutes (protection against guessing IDs) |
| `CREATE_LIMIT` | `30` | New IDs per client address and hour |
| `SPACES_PER_DEVICE` | `0` | IDs a device may create itself (`0` = no limit). Only IDs it created and that still exist count – joining doesn't, deleting frees a place. |
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
| `TRANSLATE_LIMIT` | `300` | Item names per ID and hour sent to translation services (and 40 characters per name as a character budget; the address gets twice both) |
| `TRANSLATE_DAILY_CHARS` | `100000` | Characters per day the whole server sends to translation services – one quota for every ID (an ID's own key is not counted); `0` = no limit |
| `ENCRYPTION_KEY` | – | Encrypts what IDs keep secret on the server (their own translation API keys) – any long random text. Unset: a key is made once and kept as `encryption.key` in the data folder; back it up with the database. A lost key only loses those stored API keys |
| `LOG_LEVEL` | `warn` | `info`, `warn`, `error`, … |
| `SECURITY_LOG` | `false` | `true` writes one JSON line per security event with the client's address – see [Security log and CrowdSec](#security-log-and-crowdsec) |
| `SKINS_DIR` | `$DATA_DIR/skins` | Folder for your own skins (CSS files, see [Adding a skin](#adding-a-skin)) – read while running |
| `DATA_DIR` | `/data` | Where the database lives (in Docker: the volume) |

Settings of v0.2.0/0.2.1 keep working: `TRANSLATE_API_KEY` is used for the first listed service that has no own key, `TRANSLATE_URL` and `TRANSLATE_EMAIL` count as `LIBRETRANSLATE_URL` and `MYMEMORY_EMAIL`.

The optional administration has its own settings – see [Administration (optional)](#administration-optional).

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

Which version runs: `curl https://your-host/api/version` → `{"version":"v0.4.1","commit":"…","built":"…"}` (also in `/healthz` and in the app under Help). Images from `main` are named after the last release, e.g. `v0.4.1-2-g1a2b3c4` = two commits after v0.4.1. To pin a release, use the image tag (`ghcr.io/jake-double-one/shopwiz:0.4.1`) instead of `latest`.

## Security log and CrowdSec

ShopWiz doesn't track what anybody does – but a server should see who hammers at its door. `SECURITY_LOG: "true"` writes one JSON line to the container log for every security-relevant event, with the client's address: unknown IDs tried, limits hit, failed and successful admin logins, unknown assistant keys, abusive sync connections. Never anything about lists or items. Off by default.

```json
{"time":"2026-10-25T11:02:17.410Z","log":"shopwiz-security","event":"id_notfound","ip":"203.0.113.5","via":"rest","id":"K7QM2XPA9Z"}
```

| Event | When |
|---|---|
| `id_notfound`, `id_limited` | an unknown ID was tried (`via`: `rest`, `ws`, `transfer`); too many from one address |
| `create_limited`, `import_limited`, `translate_limited` | a limit was hit (new IDs per address, imports per ID, translation budget) |
| `ws_too_many`, `ws_flood`, `ws_slow_reader` | sync connections: more than 50 from one address, a flood of messages, a connection that stopped reading |
| `ai_key_invalid`, `ai_limited` | an unknown or revoked assistant key (`via`: `rest`, `mcp`); a key over its rate |
| `admin_login_failed`, `admin_limited` | a wrong password, setup code, promotion code or passkey (`method`); too many from one address |
| `admin_login`, `admin_setup`, `admin_passkey`, `admin_session_invalid` | an admin logged in (`method`, `role`), the main admin was set up, a passkey was registered; a sync connection with an admin session that isn't one |

Behind a reverse proxy `TRUST_PROXY` must be right, otherwise every line names the proxy. The lines are made for [CrowdSec](https://www.crowdsec.net/): the folder [`crowdsec/`](crowdsec/) has a parser, four scenarios (ID guessing, admin bruteforce, assistant key guessing, sync abuse), a collection and an acquisition example, with a short guide. fail2ban works just as well – the lines are plain JSON.

## Administration (optional)

> Not needed for running ShopWiz – and **off** unless you switch it on. If you use it only at home, or behind Authentik & co., you can skip this section.

Who runs a server open to others can see which IDs exist (size, last use), delete abandoned ones and help when something is wrong – at `https://your-host/admin`.

**Switching it on** (HTTPS required):

1. Set the variable **`ADMIN=on`** in the stack and update it.
2. The container's **log** shows a setup code (Portainer: container → shopwiz → Logs).
3. Open `https://your-host/admin`, enter the code, choose a user name and password. Done.

**Forgot the password?** Set `ADMIN=reset`, restart, set it up again with the new code from the log – then back to `ADMIN=on`.

More admins, passkeys and what members see of it: **[docs/ADMIN.md](docs/ADMIN.md)**.

## Privacy

- No accounts, no cookies, no analytics, no fingerprinting.
- No external requests from your device: fonts, icons, flags and the QR code library are served by ShopWiz itself.
- Travel mode only: the server sends item names (nothing else) to the configured translation service. Set `TRANSLATE_PROVIDER=none` to switch that off.
- Logs contain no IP addresses, IDs or tokens. Rate limiting only keeps counters in memory.
- Stored: list contents, the names you enter, and timestamps. Each device has a random secret token; only its hash is stored on the server.
- Expired IDs and inactive devices are deleted for good. Old IDs are never given out again.
- Strict security headers (Content Security Policy, `Referrer-Policy: no-referrer` so the ID never leaks via links).
- Link previews are neutral: a messenger fetching one learns neither the name of the ID nor its contents, nor whether the ID exists at all.
- With the optional [administration](#administration-optional) switched on, admins can open IDs. Members see it: settings and help say the server has an administration, and an admin inside an ID is shown in red as "Admin" in the participant list and in the history.

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

## Adding a skin

A skin is one CSS file with a few lines of header and its colors – see [`skins/README.md`](skins/README.md) for the format and an example to copy.

- **Into ShopWiz itself:** put the file into `skins/` (e.g. `skins/ocean.css`).
- **On your server, without rebuilding:** put it into `/data/skins` (or the folder in `SKINS_DIR`), e.g. with `- ./my-skins:/data/skins:ro` in Docker Compose. A file with the name of a built-in skin replaces it.

The server reads the skins while it runs: a new or changed file shows up in the app after a few seconds. It checks every skin against WCAG AA (text at least 4.5:1, checkbox borders at least 3:1) and writes shortfalls to the log; `npm test` makes sure the built-in skins pass.

## Adding a language

1. Copy `client/src/locales/en.json` to e.g. `fr.json` and translate the values (keep the `{placeholders}`). Keys ending in `_one` / `_other` are singular / plural.
2. Register it in `client/src/lib/i18n.svelte.js` in `LANGUAGES`.

Missing keys fall back to English.

## Third-party licenses

ShopWiz is built on these projects – thank you:

| Part | Project | License |
|---|---|---|
| App (in the browser) | [Svelte](https://svelte.dev) (with clsx, esm-env) | MIT |
| QR codes | [qrcode](https://github.com/soldair/node-qrcode) (with dijkstrajs) | MIT |
| QR scanner | [jsQR](https://github.com/cozmo/jsQR) | Apache-2.0 |
| Drag & drop | [SortableJS](https://github.com/SortableJS/Sortable) | MIT |
| Country flags | [flag-icons](https://github.com/lipis/flag-icons) © Panayiotis Lipiridis | MIT |
| Fonts | [Instrument Sans](https://github.com/Instrument/instrument-sans), [IBM Plex Mono](https://github.com/IBM/plex) (via Fontsource) | SIL Open Font License 1.1 |
| Server | [Fastify](https://fastify.dev) with @fastify/static and @fastify/websocket | MIT |
| AI assistants | [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [zod](https://zod.dev) | MIT |
| Passkeys (optional administration) | [SimpleWebAuthn](https://github.com/MasterKale/SimpleWebAuthn) (with @peculiar/x509 and asn1 packages, asn1js, @hexagon/base64, tiny-cbor, reflect-metadata, tsyringe, tslib) | MIT; asn1js BSD-3-Clause, reflect-metadata Apache-2.0, tslib 0BSD |

**Dependency audit:** every push runs `npm audit` for the packages that ship in the image (anything moderate or worse stops the build). A nightly workflow (`.github/workflows/audit.yml`) audits all packages again and scans the published image with Trivy – Alpine, Node and the bundled packages – and fails on known high or critical issues that have a fix. Dependabot opens weekly update pull requests for packages, actions and the base image.

The app ships the full license texts of everything that runs in the browser as `/licenses.txt` (Help → “Licenses of the software and fonts used”). The file is generated at build time from the packages in the bundle (`scripts/licenses.js`), so it stays complete when dependencies change. The server packages keep their license files in `node_modules` of the Docker image.

## Project structure

```
server/        Fastify app, WebSocket hub, SQLite schema and all list operations (core.js)
shared/        Code used by server and client: ID format, entry parsing
client/        Svelte app
  src/lib/       sync engine (offline queue, optimistic updates), actions, i18n
  src/components UI components
  src/locales/   translations
  public/        icons, manifest, service worker, link preview image
skins/         Skins – one CSS file each, read by the server at runtime (format in skins/README.md)
scripts/       Build helpers (third-party license list)
test/          Vitest tests
e2e/           Playwright tests
docs/          Screenshots and the original plan (German)
```
