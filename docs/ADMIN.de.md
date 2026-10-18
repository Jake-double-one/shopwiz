# Administration (optional)

🇬🇧 [English version](ADMIN.md)

Die Administration ist für alle, die einen ShopWiz-Server für andere betreiben: sehen, welche IDs es gibt, verwaiste aufräumen, bei Problemen helfen. **Für den Betrieb ist sie nicht nötig und standardmäßig aus.** Wer ShopWiz nur zu Hause nutzt (auch per IP-Adresse) oder hinter Authentik & Co. betreibt, braucht sie nicht.

- [Einschalten](#einschalten)
- [Anmelden](#anmelden)
- [Weitere Admins: Geräte per D-ID](#weitere-admins-geräte-per-d-id)
- [Was Admins sehen und dürfen](#was-admins-sehen-und-dürfen)
- [Was Teilnehmer sehen](#was-teilnehmer-sehen)
- [Wie sie geschützt ist](#wie-sie-geschützt-ist)
- [Probleme lösen](#probleme-lösen)

## Einschalten

1. **HTTPS** einrichten (siehe README, „HTTPS und Reverse Proxy“) und `PUBLIC_URL` setzen, z. B. `https://shop.example.com`. Passkeys funktionieren nur über HTTPS (oder `localhost`) und gehören zu genau dieser Domain.
2. Passwort-Hash erzeugen – das Passwort selbst steht nirgends:

   ```bash
   docker run --rm -it ghcr.io/jake-double-one/shopwiz node server/admin-hash.js
   # ohne Docker:  node server/admin-hash.js
   # nicht interaktiv:  echo -n 'mein langes Passwort' | node server/admin-hash.js
   ```

   Ausgabe: `ADMIN_PASSWORD_HASH=scrypt:16384:8:1:…` (mindestens 12 Zeichen Passwort; ohne `$`, also problemlos in Compose-Dateien).
3. Einstellungen setzen und neu starten:

| Variable | Bedeutung |
|---|---|
| `ADMIN_USER` | Benutzername des Haupt-Admins |
| `ADMIN_PASSWORD_HASH` | Der Hash aus Schritt 2 |
| `ADMIN_PASSWORD_LOGIN` | `off`: Anmelden mit Passwort abschalten, sobald der Haupt-Admin einen Passkey hat. Hat er keinen, bleibt das Passwort trotzdem an – niemand sperrt sich aus. |

Fehlt eins von beiden oder ist der Hash ungültig, bleibt die Administration aus (mit Hinweis im Log). Dann gibt es `/api/admin/…` gar nicht.

## Anmelden

`https://dein-host/admin` öffnen.

- **Haupt-Admin:** Benutzername + Passwort. Optional richtet er sich unter „Admins“ zusätzlich einen Passkey ein und meldet sich dann mit einem Fingerdruck an – auf jedem Gerät. Mit Passkey lässt sich das Passwort per `ADMIN_PASSWORD_LOGIN=off` abschalten; es bleibt der Notschlüssel (Variable entfernen = wieder an).
- **Geräte-Admins:** „Mit Passkey anmelden“ – auf ihrem eigenen Gerät.

Die Anmeldung gilt **nur in diesem Browser-Tab** und wird nirgends gespeichert – kein Cookie, nichts im Gerätespeicher. Neu laden heißt neu anmelden. Sie endet nach 15 Minuten ohne Aktivität, spätestens nach 8 Stunden, und beim Neustart des Servers.

## Weitere Admins: Geräte per D-ID

Jedes Gerät hat eine **D-ID** (z. B. `K7M2Q-9XH4T`, in allen Sprachen „D-ID“). Sie steht in der App unter Einstellungen → Dieses Gerät, sobald der Server eine Administration hat. Sie ist aus dem geheimen Geräte-Schlüssel abgeleitet, verrät ihn aber nicht.

1. Die Person schickt dir ihre D-ID.
2. Administration → **Geräte** → D-ID eintragen (oder beim Gerät in der Liste) → **Zum Admin ernennen**. Nur der Haupt-Admin kann das.
3. Das Gerät bekommt sofort einen einmaligen Hinweis „Dieses Gerät ist jetzt Admin“ und hat **24 Stunden**, einen **Passkey** einzurichten (Fingerabdruck, Gesicht oder PIN des Geräts). Sonst verfällt die Ernennung.
4. Danach erscheint in den Einstellungen ganz unten der Knopf **Administration**.

Regeln:

- **Nie nur ein Faktor:** Ein Geräte-Admin braucht immer seine D-ID (also sein Gerät) **und** seinen Passkey. Eine kopierte App-Sitzung reicht nicht, ein synchronisierter Passkey auf einem anderen Gerät auch nicht.
- **Pro Ernennung genau ein Passkey.** War jemand schneller (etwa mit einem kopierten Geräte-Schlüssel), sieht das echte Gerät „Für dieses Gerät wurde schon ein Passkey eingerichtet – aber nicht hier“, und du siehst den Passkey im Protokoll und als Hinweis. Dann: Rechte entziehen und neu ernennen.
- Rechte entziehen (Admins → „Admin-Rechte entziehen“) beendet sofort alle Sitzungen dieses Geräts.
- Erlaubt sind synchronisierte Passkeys (iCloud, Google, Passwortmanager) und solche, die nur auf dem Gerät liegen – die Übersicht zeigt, welcher es ist.

## Was Admins sehen und dürfen

- **IDs:** Name, ID, erstellt, zuletzt benutzt, Anzahl Listen, Artikel, Gruppen, Geräte und KI-Verbindungen, geschätzte Größe in KB.
  - **Öffnen** – mit Vollzugriff, wie ein Teilnehmer. Einchecken im Laden und Rufen gibt es für Admins nicht.
  - **Endgültig löschen** – die Teilnehmer sehen sofort „Ein Admin dieses Servers hat sie endgültig gelöscht“; die ID wird nie wieder vergeben.
- **Geräte:** alle D-IDs mit ihren Gerätenamen und den IDs, in denen sie sind.
- **Admins:** Haupt-Admin mit Passkeys, Geräte-Admins mit Status („wartet auf Passkey“ / aktiv) und Passkey-Art.
- **Protokoll:** Anmeldungen, Fehlversuche (zusammengefasst), Ernennungen, Passkeys, geöffnete und gelöschte IDs – ohne IP-Adressen. 180 Tage bzw. höchstens 5000 Einträge.
- **Hinweise** für den Haupt-Admin beim nächsten Besuch: neue Passkeys, abgelehnte Passkey-Einrichtungen, Anmeldungen von Geräte-Admins, Fehlversuche, gelöschte IDs.

Geräte-Admins dürfen alles außer Admins ernennen und entziehen.

## Was Teilnehmer sehen

- In den Einstellungen und in der Hilfe: „Dieser Server hat eine Administration. Admins können IDs öffnen …“
- Solange ein Admin in ihrer ID ist, steht er in der Teilnehmerliste **ganz vorne, rot, als „Admin“** – egal mit welchem Gerät. Verlässt er die ID, verschwindet er.
- Im Verlauf: „**Admin** hat die ID geöffnet“, Änderungen als „Admin“.

## Wie sie geschützt ist

- Aus, solange nicht eingeschaltet. Das Passwort liegt nur als scrypt-Hash vor.
- Sitzung nur im Arbeitsspeicher (Server und Browser-Tab) – ein Infostealer, der Browserdaten kopiert, findet nichts Brauchbares.
- Was ein Admin in einer ID sieht, wird auf seinem Gerät nicht gespeichert: kein Offline-Stand, keine Warteschlange, kein Eintrag in „Meine IDs“. Die Adresse bleibt `/admin`.
- Ernennen, Entziehen, Löschen und Passkeys verwalten verlangen eine Anmeldung innerhalb der letzten 5 Minuten, sonst wird kurz noch einmal bestätigt.
- Anmelden: höchstens 10 Fehlversuche pro Adresse in 15 Minuten; Passwörter werden nacheinander geprüft.
- Die Administration läuft in derselben App unter strenger Content Security Policy (nur eigene Skripte).

## Probleme lösen

| Problem | Lösung |
|---|---|
| „Die Administration braucht eine sichere Verbindung“ | Über HTTPS (oder `localhost`) aufrufen. |
| Passkey geht nach Domainwechsel nicht mehr | Passkeys gehören zur Domain: Haupt-Admin meldet sich mit Passwort an, Geräte-Admins neu ernennen. |
| Haupt-Admin-Passkey weg und Passwort abgeschaltet | `ADMIN_PASSWORD_LOGIN` entfernen, neu starten, mit Passwort anmelden. |
| Passwort vergessen | Neuen Hash erzeugen, `ADMIN_PASSWORD_HASH` ersetzen, neu starten. |
| Admin-Gerät verloren | Rechte entziehen. Das neue Gerät hat eine neue D-ID – neu ernennen. |
| „Dieser Passkey gehört zu einem anderen Gerät“ | Der (synchronisierte) Passkey wird auf einem Gerät mit anderer D-ID benutzt. Auf dem ernannten Gerät anmelden – oder dieses Gerät ernennen. |
| Browserdaten gelöscht | Das Gerät hat damit eine neue D-ID und ist kein Admin mehr – neu ernennen. |
