# ShopWiz

**Geteilte Einkaufslisten ohne Anmeldung und ohne Tracking.**
Liste erzeugen, die 10-stellige ID (oder einen QR-Code) teilen – und alle kaufen mit. In Echtzeit, auf jedem Gerät, auch bei schlechtem Empfang im Supermarkt.

🇬🇧 [English version](README.md) (maßgeblich)

<p>
  <img src="docs/screenshots/list.png" width="240" alt="Eine Einkaufsliste mit Gruppen und Artikeln">
  <img src="docs/screenshots/list-dark.png" width="240" alt="Dieselbe Liste auf einem zweiten Gerät im Dunkelmodus">
  <img src="docs/screenshots/share.png" width="240" alt="Teilen-Dialog mit QR-Code und ID">
</p>

---

## Inhalt

- [Funktionen](#funktionen)
- [So funktioniert es](#so-funktioniert-es)
- [Installation mit Docker / Portainer](#installation-mit-docker--portainer)
- [HTTPS und Reverse Proxy](#https-und-reverse-proxy)
- [Einstellungen](#einstellungen)
- [Ohne Docker starten](#ohne-docker-starten)
- [Backup und Update](#backup-und-update)
- [Datenschutz](#datenschutz)
- [Entwicklung](#entwicklung)
- [Sprache hinzufügen](#sprache-hinzufügen)

## Funktionen

| | |
|---|---|
| **Kein Login** | Eine 10-stellige ID ist der Schlüssel zu deinen Listen. Sie wird auf dem Gerät gespeichert und lässt sich mit einem Tipp wieder entfernen. |
| **Mehrere Listen pro ID** | Per Dropdown zwischen Listen wechseln (z. B. „Wocheneinkauf“, „Baumarkt“). |
| **Gruppen, die mitlernen** | Die Liste nach Gruppen sortieren (z. B. *Bäcker*, *Kühlwaren*). Milch einmal in „Kühlwaren“ – ab dann landet sie automatisch dort, bis du sie woandershin schiebst. |
| **Live-Synchronisation** | Änderungen erscheinen innerhalb einer Sekunde auf allen Geräten. |
| **Offline nutzbar** | Änderungen werden auf dem Gerät gespeichert und später gesendet. Wurde dasselbe Feld gleichzeitig geändert, erscheint eine softe Meldung, in der man den richtigen Wert wählt. |
| **Autovervollständigung** | Alles, was je hinzugefügt wurde, wird beim Tippen vorgeschlagen – inklusive gelernter Gruppe. |
| **Mengen-Knöpfe** | Auf Tablet und Computer stehen − und + direkt neben der Menge (g/ml in 100er-Schritten). Auf dem Handy ändert man die Menge im Bearbeiten-Dialog des Artikels. |
| **Schlaue Eingabe** | `2 Milch`, `500g Hack`, `Milch x2` werden in Menge und Name zerlegt. Mehrere eingefügte Zeilen ergeben mehrere Artikel. |
| **Hinweis bei Doppelten** | „Milch steht schon drauf“ → Menge erhöhen oder trotzdem hinzufügen. Abgehakte Artikel werden einfach wieder aktiviert. |
| **Abgehaktes bleibt** | Wandert ans Ende der Gruppe und kann wieder aktiviert werden. |
| **Inaktive Artikel** | Eine eingeklappte „Schattenliste“ am Ende jeder Liste, mit denselben Gruppen wie die Liste: Dinge, die gerade nicht gebraucht werden, und Gruppen ohne Artikel. „Erledigte entfernen“ schiebt Abgehaktes dorthin; ein Tipp holt es zurück auf die Liste. |
| **Adresse des Ladens** | Optional bekommt eine Liste die Adresse ihres Ladens – neben dem Listennamen erscheint dann „Navigation starten“ (auf dem Handy nur als Pfeil). |
| **Backup & Import** | Listen als Markdown-Datei herunterladen, in jedem Texteditor bearbeiten und wieder importieren – in dieselbe ID (ohne Duplikate) oder als neue ID. |
| **Teilnehmer** | Jedes Gerät gibt sich einen Namen. Die Details eines Artikels zeigen, wer ihn hinzugefügt oder abgehakt hat. Geräte können entfernt werden. |
| **„Ich bin im Laden“** | Die anderen sehen, dass du gerade einkaufst. Was währenddessen dazukommt, wird bei dir hervorgehoben. |
| **Sich im Laden finden** | In großen Läden sieht jeder Eingecheckte, wo die anderen sind (die Gruppe ihres zuletzt abgehakten Artikels). Ein **Rufen**-Knopf schickt eines von vier festen Signalen – „Wo bist du?“, „Komm zu mir“, „Treffen an der Kasse“, „Ich bin fertig“ – kein Chat. |
| **Bildschirm anlassen** | Optionaler Knopf, damit das Handy beim Einkaufen nicht sperrt. |
| **Verlauf** | Wer hat was gemacht, mit „Wiederherstellen“ für gelöschte Artikel. Wird nach 14 Tagen automatisch geleert. |
| **Rückgängig** | Jede Aktion lässt sich sofort rückgängig machen. |
| **Teilen** | QR-Code, natives Teilen-Menü mit ordentlichem Titel und Link-Vorschau in Messengern. Ein Kamera-Knopf scannt QR-Codes. |
| **Kopieren / Verschieben** | Artikel und ganze Gruppen in eine andere Liste oder eine andere ID übertragen. |
| **ID erneuern** | Neue ID, die alte funktioniert nicht mehr. Alle teilnehmenden Geräte ziehen automatisch mit um. |
| **ID löschen** | Für alle, mit doppelter Bestätigung. Teilnehmer können mit einer Kopie unter neuer ID weitermachen. |
| **Sprachen** | Englisch und Deutsch, pro Gerät wählbar. Deine Einträge werden nie übersetzt. |
| **Hell & Dunkel** | Folgt dem System oder pro Gerät einstellbar. Design: *Feierabend-Designsystem v2*. |
| **Eingebaute Hilfe** | Ein (?) in der Kopfzeile (und „So funktioniert ShopWiz“ auf der Startseite) erklärt alle Funktionen in kurzen Themen – offline und in der Sprache des Geräts. Neue Nutzer bekommen einmalig einen Hinweis. |
| **Installierbar** | Läuft als App auf dem Homescreen (PWA). |

## So funktioniert es

### Die ID

- Eine ID sieht so aus: `K7QM-2XPA-9F` – 10 Zeichen, ohne leicht verwechselbare Zeichen (kein `O`/`0`, `I`/`1`, `L`).
- **Wer die ID kennt, kann die Listen öffnen und ändern.** Behandle sie wie einen Schlüssel.
- Der Link `https://dein-server/K7QM2XPA9F` öffnet die Listen direkt.
- Jede ID hat einen Namen (muss nicht einmalig sein) und kann mehrere Listen enthalten.
- **Ablauf:** Eine ID wird samt allen Daten gelöscht, wenn sie **181 Tage lang kein aktives Gerät** hatte. Pro ID in den Einstellungen änderbar (7–367 Tage).

### Geräte und Teilnehmer

- Beim ersten Öffnen gibst du deinem Gerät einen Namen („Jakes Handy“).
- Die Teilnehmerzeile zeigt alle; ein grüner Punkt heißt „gerade online“.
- Jeder Teilnehmer kann Geräte entfernen. Ohne Login ist das keine Sperre – mit der ID kann man wieder beitreten. Wer jemanden wirklich aussperren will, nutzt **Einstellungen → ID erneuern**.
- Geräte ohne Aktivität seit **30 Tagen** werden automatisch entfernt und können jederzeit mit Link oder ID wieder teilnehmen.

### Gruppen und Mitlernen

- Jede Liste hat standardmäßig eigene Gruppen. Unter **Listen-Optionen → Gruppen** kann eine Liste stattdessen die **gemeinsamen Gruppen der ID** nutzen – dann teilen sich alle Listen in diesem Modus Gruppen und Gelerntes.
- Mit **+** an einer Gruppe fügst du direkt dort hinzu, oder du ziehst Artikel am Griff (⋮⋮) in eine andere Gruppe.
- ShopWiz merkt sich zu jedem Artikelnamen die letzte Gruppe. Beim nächsten Hinzufügen landet er automatisch dort.

### Inaktive Artikel (Schattenliste)

Am Ende jeder Liste gibt es den eingeklappten Bereich **Inaktive Artikel**:

- **Erledigte entfernen** verschiebt Abgehaktes dorthin – nichts geht verloren. Gruppe, Menge und Notiz bleiben erhalten.
- Ein Tipp auf einen inaktiven Artikel (oder sein **+**) holt ihn unabgehakt zurück auf die Liste.
- Dinge, die noch nicht gebraucht werden, direkt dort hinzufügen – oder Artikel am Griff hinein- und herausziehen.
- Wer den Namen eines inaktiven Artikels normal eintippt, holt ihn zurück, statt ein Duplikat anzulegen.
- Die Liste selbst zeigt nur Gruppen, in denen Artikel stehen. Wird der letzte Artikel einer Gruppe inaktiv, wandert die Gruppe mit nach unten (weiter unter ihrem Namen) und kommt zurück, sobald einer ihrer Artikel wieder auf der Liste steht. Leere Gruppen warten dort ebenfalls – einen Artikel schiebt man über seine Details hinein. Eine neu angelegte Gruppe ist leer, deshalb zielt die Eingabezeile direkt auf sie: Der nächste getippte Artikel landet dort.
- Inaktive Artikel zählen nicht zum Fortschritt. **Alle inaktiven löschen** löscht sie wirklich (14 Tage über den Verlauf wiederherstellbar).

### Adresse und Navigation

In den **Listen-Optionen** kann die Adresse des Ladens eingetragen werden (oder ein Karten-Link). Neben dem Listennamen erscheint dann **Navigation starten** – auf Tablet und Computer ausgeschrieben, auf dem Handy als Pfeil. Er öffnet die Karten-App des Geräts: Android bietet die installierten Navi-Apps an, iPhone/Mac nutzen Apple Karten, andere Geräte Google Maps im Browser. Erst beim Antippen wird ein Kartendienst geöffnet.

### Backup und Import als Datei

**Einstellungen → Backup & Import** (auch in den Listen-Optionen):

- **Exportieren** lädt eine Markdown-Datei (`.md`) herunter – alle Listen der ID oder nur die aktuelle Liste. Funktioniert auch offline.
- **Importieren** nimmt so eine Datei, beliebiges Markdown oder einfachen Text mit einem Artikel pro Zeile – Datei auswählen oder Text einfügen.
  - **In diese ID:** Listen und Gruppen werden über den Namen zugeordnet; ein Artikel, der schon auf der Liste steht, wird nicht doppelt angelegt (sagt die Datei, dass er gebraucht wird, und er ist abgehakt oder inaktiv, wird er wieder aktiviert). Artikel ohne Listen-Überschrift landen in der aktuellen Liste.
  - **Als neue ID:** legt eine neue ID mit den importierten Listen an. Das geht auch direkt auf der Startseite („Datei als neue Liste importieren“).

Das Format lässt sich leicht von Hand schreiben:

```markdown
# Zuhause                        ← Name der ID (optional)
## Wocheneinkauf                 ← Liste
> 📍 Via Roma 1, Olbia           ← Adresse des Ladens (optional)
- [ ] Brot                       ← offener Artikel ohne Gruppe
### Kühlwaren                    ← Gruppe
- [ ] 2 l Milch // laktosefrei   ← Menge, Name, Notiz nach //
- [x] Butter                     ← abgehakt
- [-] Feta                       ← inaktiv
```

Einfache Zeilen wie `Milch`, `- 2 Brot` oder `* Äpfel` funktionieren auch. Ein Name, der mit einer Zahl beginnt und keine Menge hat, steht in Anführungszeichen (`"4711 Kölnisch Wasser"`).

### Sich im Laden wiederfinden

Läden können groß sein, und wer sich aufteilt, verliert sich. Solange man eingecheckt ist (**Ich bin im Laden**):

- Im Banner der anderen im Laden steht, **wo sie gerade sind**: die Gruppe des zuletzt abgehakten Artikels („Jana kauft gerade ein – bei Obst & Gemüse · gerade eben“). Kein GPS – die Gruppen der Liste sind die Karte.
- Sobald mindestens eine weitere Person im Laden ist, erscheint neben „Ich bin im Laden“ der Knopf **Rufen** (auf dem Handy nur als Pfeil). Er schickt ein festes Signal an alle im Laden oder an eine Person:
  - **Wo bist du?** – das andere Handy vibriert und zeigt eine Karte; ein Tipp antwortet „Bin bei *Bäcker*“ (der eigene letzte Ort), „Komm zur Kasse“ oder eine gewählte Gruppe.
  - **Komm zu mir – *Kühlwaren*** – mit dem eigenen letzten Ort (oder einer gewählten Gruppe).
  - **Treffen an der Kasse** · **Ich bin fertig**
- Wird der letzte Artikel abgehakt, bekommen alle anderen im Laden „Alles im Wagen – Treffen an der Kasse?“.

Freitext gibt es bewusst nicht, damit es nie ein Chat wird. Signale werden nicht gespeichert und kommen nur an, solange ShopWiz offen ist – „Bildschirm anlassen“ hilft.

### Synchronisation und Konflikte

- Jede Änderung wird als kleine Aktion („Milch abgehakt“) gesendet, nie die ganze Liste. Offline-Änderungen warten und werden bei Verbindung nachgesendet.
- Haben zwei Geräte **dasselbe Feld** desselben Artikels gleichzeitig geändert, gilt vorläufig die neueste Änderung, und es erscheint „1 gleichzeitige Änderung prüfen“. Jeder kann den richtigen Wert wählen oder den aktuellen behalten.
- Wurde ein Artikel gelöscht, während jemand ihn offline geändert hat, gewinnt das Löschen – die Änderung steht im Verlauf und der Artikel kann dort wiederhergestellt werden.

### Knöpfe in den Einstellungen

| Knopf | Was passiert |
|---|---|
| **Deine ID** | Verdeckt angezeigt; das Auge blendet sie ein, Antippen kopiert sie. |
| **ID im Passwortmanager speichern** | Bietet die ID deinem Passwortmanager an (Name der ID als Benutzername, ID als Passwort). Das ID-Feld auf der Startseite kann er auch ausfüllen. |
| **ID auf diesem Gerät vergessen** | Der „Reset-Knopf“: entfernt die ID und ihre zwischengespeicherten Daten nur von diesem Gerät. Auf dem Server wird nichts gelöscht. |
| **ID erneuern** | Neue ID, alte ungültig. Teilnehmende Geräte ziehen mit um; wer nur den alten Link hat, verliert den Zugang. |
| **ID für alle löschen** | Fragt zweimal (Namen eintippen). Teilnehmer sehen dann „Diese Liste wurde gelöscht“ und können mit einer Kopie unter neuer ID weitermachen. Ist das letzte Gerät abgelaufen, ist alles endgültig weg. |

## Installation mit Docker / Portainer

ShopWiz ist ein einzelner Container mit einem einzelnen Volume. Ein eigener Datenbank-Container ist nicht nötig (SQLite).

### Portainer (Stacks)

1. **Stacks → Add stack**.
2. Entweder
   - **Repository**: auf dieses Git-Repository zeigen. Portainer baut das Image aus dem `Dockerfile`, oder
   - **Web editor**: den Inhalt von [`docker-compose.yml`](docker-compose.yml) einfügen. Dann wird das fertige Image `ghcr.io/jake-double-one/shopwiz:latest` genutzt, das die CI bei jedem Push auf `main` veröffentlicht. Ist das Repository privat, ist auch das Image privat: entweder das Paket auf GitHub öffentlich machen oder in Portainer unter **Registries** `ghcr.io` mit einem Token hinterlegen.
3. `PUBLIC_URL` auf die Adresse setzen, unter der die App erreichbar ist (z. B. `https://shop.example.com`).
4. Deployen. Die App lauscht auf Port **8080**.

### Docker Compose (Kommandozeile)

```bash
git clone https://github.com/jake-double-one/shopwiz.git
cd shopwiz
docker compose up -d --build
```

Dann <http://localhost:8080> öffnen.

Die Compose-Datei startet den Container bereits gehärtet: schreibgeschütztes Dateisystem, keine Linux-Capabilities, `no-new-privileges`, kein Root-Benutzer und ein Healthcheck.

## HTTPS und Reverse Proxy

ShopWiz läuft auch über einfaches HTTP, aber **Browser erlauben Kamera (QR-Scan), natives Teilen-Menü, Bildschirm-anlassen und die Offline-App nur über HTTPS**. Ohne HTTPS werden diese Knöpfe ausgeblendet, stattdessen gibt es „Link kopieren“.

ShopWiz hinter den vorhandenen Reverse Proxy stellen und `TRUST_PROXY=true` setzen (damit die Mengenbegrenzung echte Client-Adressen sieht). Der Proxy muss **WebSockets** auf `/ws` durchreichen.

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

**Nginx Proxy Manager:** beim Proxy-Host „Websockets Support“ aktivieren.

**Traefik:** WebSockets funktionieren ohne weitere Einstellung.

## Einstellungen

Alle Einstellungen sind Umgebungsvariablen. Die Standardwerte passen für die meisten Fälle.

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `8080` | Port im Container |
| `PUBLIC_URL` | *(leer)* | Öffentliche Adresse, für Link-Vorschauen. Ohne Angabe wird der Host der Anfrage genutzt. |
| `SPACE_TTL_DAYS` | `181` | Standard für neue IDs: Löschen nach so vielen Tagen ohne aktives Gerät (1–367) |
| `DEVICE_TTL_DAYS` | `30` | Geräte nach so vielen Tagen ohne Aktivität entfernen |
| `ACTIVITY_TTL_DAYS` | `14` | So lange bleiben Verlauf, gelöschte Artikel und Konflikte erhalten |
| `TRUST_PROXY` | `false` | `true` hinter einem Reverse Proxy |
| `LOOKUP_LIMIT` | `30` | So viele unbekannte IDs darf eine Adresse probieren … |
| `LOOKUP_WINDOW_MIN` | `15` | … pro so vielen Minuten (Schutz gegen das Erraten von IDs) |
| `CREATE_LIMIT` | `30` | Neue IDs pro Adresse und Stunde |
| `LOG_LEVEL` | `warn` | `info`, `warn`, `error`, … |
| `DATA_DIR` | `/data` | Ort der Datenbank (in Docker: das Volume) |

## Ohne Docker starten

Benötigt **Node.js 22.13 oder neuer** (ShopWiz nutzt das eingebaute `node:sqlite`).

```bash
npm ci
npm run build
npm start          # http://localhost:8080, Daten in ./data
```

## Backup und Update

Alle Daten liegen in einer SQLite-Datenbank im Volume (`/data/shopwiz.db`).

```bash
# konsistentes Backup im laufenden Betrieb
docker exec shopwiz node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/shopwiz.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker cp shopwiz:/data/backup.db ./shopwiz-backup.db
```

Update: In Portainer **Pull and redeploy** (Web editor) bzw. neu bauen (Repository). Auf der Kommandozeile: `git pull && docker compose up -d --build`. Das Datenbankschema wird automatisch angelegt.

## Datenschutz

- Keine Konten, keine Cookies, keine Analyse, kein Fingerprinting.
- Keine externen Anfragen: Schriften, Icons und die QR-Code-Bibliothek liefert ShopWiz selbst aus.
- Logs enthalten keine IP-Adressen, IDs oder Tokens. Die Mengenbegrenzung zählt nur im Arbeitsspeicher.
- Gespeichert werden: Listeninhalte, die eingegebenen Namen und Zeitstempel. Jedes Gerät hat ein zufälliges geheimes Token; auf dem Server liegt nur dessen Hash.
- Abgelaufene IDs und inaktive Geräte werden endgültig gelöscht. Alte IDs werden nie neu vergeben.
- Strenge Sicherheits-Header (Content Security Policy, `Referrer-Policy: no-referrer`, damit die ID nie über Links abfließt).

## Entwicklung

```bash
npm ci
npm run dev        # Server auf :8080 + Vite-Dev-Server auf :5173 mit Hot Reload
```

| Befehl | Was er tut |
|---|---|
| `npm test` | Unit- und Integrationstests (Vitest) für Eingabe-Parsing, Sync-Logik, Konflikte und den WebSocket-Server |
| `npm run test:e2e` | End-to-End-Tests im echten Browser (Playwright): zwei Geräte, Offline + Konflikte, Erneuern, Löschen, Übertragen, … Vorher `npm run build`. |
| `npm run check` | Svelte-Compiler- und Barrierefreiheits-Prüfungen |
| `npm run build` | Baut den Client nach `dist/` |

**Technik:** Node.js + Fastify + WebSockets + SQLite auf dem Server, Svelte 5 + Vite als installierbare PWA im Client.

## Sprache hinzufügen

1. `client/src/locales/en.json` z. B. nach `fr.json` kopieren und die Werte übersetzen (die `{Platzhalter}` behalten). Schlüssel mit `_one` / `_other` sind Einzahl / Mehrzahl.
2. In `client/src/lib/i18n.svelte.js` unter `LANGUAGES` eintragen.

Fehlende Schlüssel fallen auf Englisch zurück.

Der ursprüngliche Plan liegt unter [`docs/PLAN.de.md`](docs/PLAN.de.md).
