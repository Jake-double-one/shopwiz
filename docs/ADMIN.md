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
- [Without the browser](#without-the-browser-advanced)

## Switching it on

1. Set up **HTTPS** (see the README, "HTTPS and reverse proxy") and preferably set `PUBLIC_URL`, e.g. `https://shop.example.com`. Passkeys only work over HTTPS (or `localhost`) and belong to exactly that domain.
2. Set the variable **`ADMIN=on`** (Portainer: stack → Environment) and update the stack.
3. On start, ShopWiz writes a **setup code** into its log (Portainer: container → shopwiz → Logs):

   ```
   =================================================================
     ShopWiz administration – setup code:  K7QM-2XPA-9FHT
     Open https://shop.example.com/admin and enter it there.
   =================================================================
   ```

4. Open `https://your-host/admin`, enter the code, choose a **user name** and **password** (at least 12 characters). That is the main admin. The code works once; only a scrypt hash of the password is stored.

Without the code nobody can take over the setup – not even whoever happens to open `/admin` first. Only who can read the server's log sees the code.

## Logging in

Open `https://your-host/admin`.

- **Main admin:** user name + password. Optionally, they set up a passkey under "Admins" and then log in with a touch – on any device. With a passkey, the password login can be switched off there, too.
- **Device admins:** "Log in with passkey" – on their own device.

The login lives **only in this browser tab** and is stored nowhere – no cookie, nothing in the device's storage. Reloading or leaving the administration means logging in again. It ends after 15 minutes without activity, after 8 hours at the latest, and when the server restarts.

## More admins: devices by D-ID

Every device has a **D-ID** (e.g. `K7M2Q-9XH4T`, called "D-ID" in every language). The app shows it under Settings → This device once the server has an administration. It is derived from the device's secret key but doesn't reveal it.

1. The person sends you their D-ID.
2. Administration → **Devices** → enter the D-ID (or use the device in the list) → **Make admin**. Only the main admin can do this. You get a **promotion code** (e.g. `7KQ2-XM4P`) – pass it on by chat or in person; it is also shown under "Admins" until it is used.
3. The device gets a one-time notice "This device is an admin now" right away and has **24 hours** to enter the promotion code and set up a **passkey** (fingerprint, face or PIN of the device). Otherwise the promotion runs out.
4. From then on, the settings have an **Administration** button at the very bottom.

Rules:

- **Never only one factor:** a device admin always needs their D-ID (so: their device) **and** their passkey. A copied app session is not enough, and neither is a synced passkey on another device.
- **The promotion code protects the promotion:** someone who copied the device's key (an infostealer) can't set up a passkey without it. Once the passkey is set up, the promotion belongs to exactly this device's key – not just to anything with the same D-ID.
- **Exactly one passkey per promotion.** If a passkey shows up that wasn't yours, you see it in the log and as a notice. Then: take the rights away and promote again – with a new code.
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
| No setup code in the log | Is `ADMIN=on` set? The code only appears while no main admin is set up. To set it up again: `ADMIN=reset`. |
| Password forgotten, passkey lost | Set `ADMIN=reset`, restart, set it up again with the new code from the log (the main admin's passkeys are deleted on the way, and don't log in while the code is pending), then back to `ADMIN=on`. Device admins stay. |
| "The administration needs a secure connection" | Open it over HTTPS (or `localhost`). |
| Passkeys stopped working after a domain change | Passkeys belong to the domain: the main admin logs in with the password, device admins are promoted again. |
| Admin device lost | Take its rights away. The new device has a new D-ID – promote it. |
| "This passkey belongs to another device" | The (synced) passkey is used on a device with another D-ID. Log in on the promoted device – or promote this one. |
| Browser data cleared | The device now has a new D-ID and is no admin any more – promote it again. |

## Without the browser (advanced)

Instead of the setup code, the main admin can be given by settings: set `ADMIN_USER` and `ADMIN_PASSWORD_HASH` (the hash comes from `node server/admin-hash.js` in the container). Then there is no code, and the two settings apply instead of the setup in the browser.

The main admin's passkeys and the "password off" switch belong to the credential they were set up under. A changed `ADMIN_PASSWORD_HASH` (or a switch to the setup code) resets them – the main admin logs in with the new password and sets the passkey up again. The same happens on the first start after an upgrade from 0.5.3 or older when a main passkey exists: the server cannot tell which credential it belongs to, so it starts over.
