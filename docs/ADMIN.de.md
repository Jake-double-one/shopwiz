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
- [Ohne Browser einrichten](#ohne-browser-einrichten-für-fortgeschrittene)

## Einschalten

1. **HTTPS** einrichten (siehe README, „HTTPS und Reverse Proxy“) und am besten `PUBLIC_URL` setzen, z. B. `https://shop.example.com`. Passkeys funktionieren nur über HTTPS (oder `localhost`) und gehören zu genau dieser Domain.
2. Die Variable **`ADMIN=on`** setzen (Portainer: Stack → Environment) und den Stack aktualisieren.
3. Beim Start schreibt ShopWiz einen **Einrichtungscode** ins Log (Portainer: Container → shopwiz → Logs):

   ```
   =================================================================
     ShopWiz administration – setup code:  K7QM-2XPA-9FHT
     Open https://shop.example.com/admin and enter it there.
   =================================================================
   ```

4. `https://dein-host/admin` öffnen, Code eingeben, **Benutzername** und **Passwort** (mindestens 12 Zeichen) festlegen. Das ist der Haupt-Admin. Der Code gilt nur einmal; gespeichert wird nur ein scrypt-Hash des Passworts.

Ohne Code kann niemand die Einrichtung übernehmen – auch nicht, wer zufällig zuerst `/admin` aufruft. Den Code sieht nur, wer das Log des Servers lesen kann.

## Anmelden

`https://dein-host/admin` öffnen.

- **Haupt-Admin:** Benutzername + Passwort. Optional richtet er sich unter „Admins“ zusätzlich einen Passkey ein und meldet sich dann mit einem Fingerdruck an – auf jedem Gerät. Mit Passkey lässt sich dort auch die Passwort-Anmeldung abschalten.
- **Geräte-Admins:** „Mit Passkey anmelden“ – auf ihrem eigenen Gerät.

Die Anmeldung gilt **nur in diesem Browser-Tab** und wird nirgends gespeichert – kein Cookie, nichts im Gerätespeicher. Neu laden oder die Administration verlassen heißt neu anmelden. Sie endet nach 15 Minuten ohne Aktivität, spätestens nach 8 Stunden, und beim Neustart des Servers.

## Weitere Admins: Geräte per D-ID

Jedes Gerät hat eine **D-ID** (z. B. `K7M2Q-9XH4T`, in allen Sprachen „D-ID“). Sie steht in der App unter Einstellungen → Dieses Gerät, sobald der Server eine Administration hat. Sie ist aus dem geheimen Geräte-Schlüssel abgeleitet, verrät ihn aber nicht.

1. Die Person schickt dir ihre D-ID.
2. Administration → **Geräte** → D-ID eintragen (oder beim Gerät in der Liste) → **Zum Admin ernennen**. Nur der Haupt-Admin kann das. Du bekommst einen **Ernennungscode** (z. B. `7KQ2-XM4P`) – gib ihn per Chat oder persönlich weiter; bis er benutzt ist, steht er auch unter „Admins“.
3. Das Gerät bekommt sofort einen einmaligen Hinweis „Dieses Gerät ist jetzt Admin“ und hat **24 Stunden**, den Ernennungscode einzugeben und einen **Passkey** einzurichten (Fingerabdruck, Gesicht oder PIN des Geräts). Sonst verfällt die Ernennung.
4. Danach erscheint in den Einstellungen ganz unten der Knopf **Administration**.

Regeln:

- **Nie nur ein Faktor:** Ein Geräte-Admin braucht immer seine D-ID (also sein Gerät) **und** seinen Passkey. Eine kopierte App-Sitzung reicht nicht, ein synchronisierter Passkey auf einem anderen Gerät auch nicht.
- **Der Ernennungscode schützt die Ernennung:** Wer den Geräte-Schlüssel kopiert hat (Infostealer), kann ohne ihn keinen Passkey einrichten. Ist der Passkey eingerichtet, gehört die Ernennung genau zum Schlüssel dieses Geräts – nicht bloß zu allem mit derselben D-ID.
- **Pro Ernennung genau ein Passkey.** Taucht ein Passkey auf, der nicht deiner war, siehst du ihn im Protokoll und als Hinweis. Dann: Rechte entziehen und neu ernennen – mit neuem Code.
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
| Kein Einrichtungscode im Log | Steht `ADMIN=on`? Der Code erscheint nur, solange noch kein Haupt-Admin eingerichtet ist. Zum Neu-Einrichten: `ADMIN=reset`. |
| Passwort vergessen, Passkey weg | `ADMIN=reset` setzen, neu starten, mit dem neuen Code aus dem Log neu einrichten (die Passkeys des Haupt-Admins werden dabei gelöscht und melden nicht mehr an, solange der Code offen ist), danach wieder `ADMIN=on`. Geräte-Admins bleiben. |
| „Die Administration braucht eine sichere Verbindung“ | Über HTTPS (oder `localhost`) aufrufen. |
| Passkey geht nach Domainwechsel nicht mehr | Passkeys gehören zur Domain: Haupt-Admin meldet sich mit Passwort an, Geräte-Admins neu ernennen. |
| Admin-Gerät verloren | Rechte entziehen. Das neue Gerät hat eine neue D-ID – neu ernennen. |
| „Dieser Passkey gehört zu einem anderen Gerät“ | Der (synchronisierte) Passkey wird auf einem Gerät mit anderer D-ID benutzt. Auf dem ernannten Gerät anmelden – oder dieses Gerät ernennen. |
| Browserdaten gelöscht | Das Gerät hat damit eine neue D-ID und ist kein Admin mehr – neu ernennen. |

## Ohne Browser einrichten (für Fortgeschrittene)

Statt Einrichtungscode lässt sich der Haupt-Admin auch fest vorgeben: `ADMIN_USER` und `ADMIN_PASSWORD_HASH` setzen (den Hash erzeugt `node server/admin-hash.js` im Container). Dann gibt es keinen Code, und die beiden Variablen gelten statt der Einrichtung im Browser.

Die Passkeys des Haupt-Admins und der Schalter „Passwort aus“ gehören zu dem Zugang, unter dem sie eingerichtet wurden. Ein geänderter `ADMIN_PASSWORD_HASH` (oder der Wechsel zum Einrichtungscode) setzt sie zurück – der Haupt-Admin meldet sich mit dem neuen Passwort an und richtet den Passkey neu ein. Dasselbe passiert beim ersten Start nach einem Update von 0.5.3 oder älter, wenn ein Haupt-Passkey existiert: Der Server kann nicht wissen, zu welchem Zugang er gehört, und fängt neu an.
