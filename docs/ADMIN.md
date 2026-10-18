# Administration (optional)

🇩🇪 [Deutsche Version](ADMIN.de.md)

The administration is for people who run a ShopWiz server for others: see which IDs exist, clean up abandoned ones, help when something is wrong. **ShopWiz doesn't need it, and it is off by default.** If you use ShopWiz only at home (also by IP address) or behind Authentik & co., you can leave it off.

- [Switching it on](#switching-it-on)
- [Logging in](#logging-in)
- [More admins: devices by D-ID](#more-admins-devices-by-d-id)
- [What admins see and may do](#what-admins-see-and-may-do)
- [What members see](#what-members-see)
- [How it is protected](#how-it-is-protected)
- [Troubleshooting](#troubleshooting)

## Switching it on

1. Set up **HTTPS** (see the README, "HTTPS and reverse proxy") and set `PUBLIC_URL`, e.g. `https://shop.example.com`. Passkeys only work over HTTPS (or `localhost`) and belong to exactly that domain.
2. Create the password hash – the password itself is stored nowhere:

   ```bash
   docker run --rm -it ghcr.io/jake-double-one/shopwiz node server/admin-hash.js
   # without Docker:  node server/admin-hash.js
   # non-interactive:  echo -n 'my long password' | node server/admin-hash.js
   ```

   Output: `ADMIN_PASSWORD_HASH=scrypt:16384:8:1:…` (password of at least 12 characters; no `$`, so it goes into compose files as it is).
3. Set the settings and restart:

| Variable | Meaning |
|---|---|
| `ADMIN_USER` | User name of the main admin |
| `ADMIN_PASSWORD_HASH` | The hash from step 2 |
| `ADMIN_PASSWORD_LOGIN` | `off`: switch the password login off once the main admin has a passkey. Without one, the password stays on anyway – nobody locks themselves out. |

If one of the two is missing or the hash is invalid, the administration stays off (with a note in the log). Then `/api/admin/…` doesn't exist at all.

## Logging in

Open `https://your-host/admin`.

- **Main admin:** user name + password. Optionally, they set up a passkey under "Admins" and then log in with a touch – on any device. With a passkey, the password can be switched off with `ADMIN_PASSWORD_LOGIN=off`; it stays the emergency key (remove the variable = on again).
- **Device admins:** "Log in with passkey" – on their own device.

The login lives **only in this browser tab** and is stored nowhere – no cookie, nothing in the device's storage. Reloading means logging in again. It ends after 15 minutes without activity, after 8 hours at the latest, and when the server restarts.

## More admins: devices by D-ID

Every device has a **D-ID** (e.g. `K7M2Q-9XH4T`, called "D-ID" in every language). The app shows it under Settings → This device once the server has an administration. It is derived from the device's secret key but doesn't reveal it.

1. The person sends you their D-ID.
2. Administration → **Devices** → enter the D-ID (or use the device in the list) → **Make admin**. Only the main admin can do this.
3. The device gets a one-time notice "This device is an admin now" right away and has **24 hours** to set up a **passkey** (fingerprint, face or PIN of the device). Otherwise the promotion runs out.
4. From then on, the settings have an **Administration** button at the very bottom.

Rules:

- **Never only one factor:** a device admin always needs their D-ID (so: their device) **and** their passkey. A copied app session is not enough, and neither is a synced passkey on another device.
- **Exactly one passkey per promotion.** If somebody was faster (e.g. with a copied device key), the real device sees "A passkey was already set up for this device – but not here", and you see the passkey in the log and as a notice. Then: take the rights away and promote again.
- Taking admin rights away (Admins → "Take admin rights away") ends all sessions of that device at once.
- Synced passkeys (iCloud, Google, password managers) are allowed, as are passkeys kept on the device only – the overview shows which one it is.

## What admins see and may do

- **IDs:** name, ID, created, last used, number of lists, items, groups, devices and AI connections, estimated size in KB.
  - **Open** – with full access, like a member. Checking in at the shop and calling others are not available to admins.
  - **Delete for good** – members see "An admin of this server deleted it for good" right away; the ID is never given out again.
- **Devices:** all D-IDs with their device names and the IDs they are in.
- **Admins:** the main admin with their passkeys, device admins with their state ("waiting for passkey" / active) and kind of passkey.
- **Log:** logins, failed attempts (summed up), promotions, passkeys, opened and deleted IDs – without IP addresses. 180 days or at most 5000 entries.
- **Notices** for the main admin on the next visit: new passkeys, refused passkey setups, logins of device admins, failed attempts, deleted IDs.

Device admins may do everything except promoting and revoking admins.

## What members see

- In the settings and in the help: "This server has an administration. Admins can open IDs …"
- While an admin is in their ID, the participant list shows them **first, in red, as "Admin"** – whatever device it is. When the admin leaves the ID, they are gone.
- In the history: "**Admin** opened the ID", changes as "Admin".

## How it is protected

- Off unless switched on. The password only exists as a scrypt hash.
- Session in memory only (server and browser tab) – an infostealer copying browser data finds nothing it could use.
- What an admin sees in an ID is not stored on their device: no offline copy, no queue, no entry in "my IDs". The address stays `/admin`.
- Promoting, revoking, deleting and managing passkeys need a login within the last 5 minutes; otherwise a quick confirmation is asked for.
- Logging in: at most 10 failed attempts per address in 15 minutes; passwords are checked one at a time.
- The administration runs in the same app under a strict Content Security Policy (only its own scripts).

## Troubleshooting

| Problem | Solution |
|---|---|
| "The administration needs a secure connection" | Open it over HTTPS (or `localhost`). |
| Passkeys stopped working after a domain change | Passkeys belong to the domain: the main admin logs in with the password, device admins are promoted again. |
| Main admin's passkey lost and password switched off | Remove `ADMIN_PASSWORD_LOGIN`, restart, log in with the password. |
| Password forgotten | Create a new hash, replace `ADMIN_PASSWORD_HASH`, restart. |
| Admin device lost | Take its rights away. The new device has a new D-ID – promote it. |
| "This passkey belongs to another device" | The (synced) passkey is used on a device with another D-ID. Log in on the promoted device – or promote this one. |
| Browser data cleared | The device now has a new D-ID and is no admin any more – promote it again. |
