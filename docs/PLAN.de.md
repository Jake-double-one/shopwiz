# ShopWiz – Planung

Gemeinsame Einkaufsliste für mehrere Personen. Kein Login, kein Tracking, Feierabend-Design.
Dieses Dokument ist der ursprüngliche Plan (umgesetzt in Version 1). Getroffene Entscheidungen stehen am Ende. Die aktuelle Doku steht in der [README](../README.md).

---

## 1. Grundbegriffe

| Begriff | Bedeutung |
|---|---|
| **Space** | Das, was hinter einer 10-stelligen ID steckt. Hat einen (nicht eindeutigen) Namen, ein Ablaufdatum und enthält **mehrere Listen**. Wer die ID kennt, ist drin. |
| **Liste** | Eine Einkaufsliste innerhalb eines Space (z. B. „Wocheneinkauf“, „Baumarkt“). Umschalten per Dropdown. |
| **Gruppe / Untergruppe** | Zwei frei benennbare Ebenen über dem Artikel, z. B. `Kühlwaren › Milchprodukte › Milch` oder `Rewe › Obst › Äpfel`. Beide Ebenen sind optional. |
| **Artikel** | Ein Eintrag mit Name, optional Menge/Einheit und Notiz. Kann abgehakt werden. |
| **Gerät** | Ein Browser, der den Space geöffnet hat. Hat einen selbst gewählten Namen („Jakes Handy“) und wird in der Teilnehmerliste angezeigt. |

## 2. Die ID

- **10 Zeichen, Crockford-Base32** (`0-9 A-Z` ohne `I L O U`) → keine Verwechslung von 0/O oder 1/I/l, ~1,1 Billiarden Kombinationen.
- Anzeige gruppiert und gut vorlesbar: `K7QM-2XPA-9F` (Bindestriche werden bei Eingabe ignoriert, Kleinbuchstaben akzeptiert).
- Erzeugung serverseitig mit kryptografischem Zufall, Eindeutigkeit per `UNIQUE`-Constraint in der Datenbank (bei Kollision neu würfeln).
- **Ablauf:** Ein Space wird gelöscht, wenn er **181 Tage** (Standard) lang kein aktives Gerät hatte. Der Zeitraum ist **pro Space in den Einstellungen änderbar, 7 bis 367 Tage**. Jede Aktivität eines Geräts setzt die Frist zurück. Ab 14 Tagen vor Ablauf zeigt die App einen Hinweis. Ein nächtlicher Job löscht abgelaufene Spaces vollständig.
- Da die ID gleichzeitig der Schlüssel ist: **Rate-Limiting** auf das Aufrufen fremder IDs (gegen Durchprobieren), ohne IPs dauerhaft zu speichern (nur im Arbeitsspeicher).
- Die ID liegt im `localStorage`. Ein kleiner **„Abmelden / ID vergessen“-Knopf** entfernt sie (mit Bestätigung und dem Hinweis, die ID vorher zu notieren/teilen). Zusätzlich merkt sich das Gerät zuletzt benutzte Spaces, damit man zwischen mehreren wechseln kann (ebenfalls einzeln löschbar).

## 3. Funktionen

### 3.1 Start
- Erster Aufruf: zwei Wege – **„Neue Liste anlegen“** (Name eingeben → ID wird erzeugt) oder **„ID eingeben / QR scannen“**.
- Link-Form: `https://shopwiz.example/K7QM2XPA9F` – öffnen genügt zum Beitreten.
- Beim ersten Beitreten: Gerätename vergeben (Vorschlag z. B. „Gerät 3“, jederzeit änderbar).

### 3.2 Listen
- Dropdown oben zum Wechseln, darin auch „+ Neue Liste“, Umbenennen, Löschen (mit Rückgängig).
- Fortschrittsanzeige pro Liste („7 / 12“) als schmale Leiste im Stil der `rail-track` aus dem Designsystem.

### 3.3 Gruppen & Mitlernen
- Zwei Ebenen: **Gruppe** und **Untergruppe**, beide optional. Wer keine Gruppen will, bekommt eine flache Liste.
- Gruppen auf- und zuklappbar, Reihenfolge per Drag & Drop (so kann man die Liste nach dem Weg durch den Laden sortieren).
- Artikel per Drag & Drop (Handy: lange drücken) oder über ein Menü „Verschieben nach…“ in andere (Unter-)Gruppen.
- **Gruppen-Modus pro Liste** (Einstellung der Liste):
  - **Eigene Gruppen** (Standard): Die Liste hat ihre eigenen Gruppen und lernt nur für sich.
  - **Gemeinsame Gruppen der ID**: Die Liste nutzt den gemeinsamen Gruppensatz des Space und dessen gemeinsames Gedächtnis. Alle Listen in diesem Modus teilen Gruppen und Gelerntes.
  - Beim Umschalten werden die vorhandenen Gruppen per Name übernommen bzw. zusammengeführt.
- **Mitlernen:** Jedes Gruppen-Set (Liste oder gemeinsam) hat ein „Gedächtnis“: *normalisierter Artikelname → Gruppe/Untergruppe*.
  - Wird „Milch“ zu „Kühlwaren“ hinzugefügt oder dorthin verschoben, merkt sich der Space das.
  - Beim nächsten Hinzufügen landet „Milch“ automatisch in „Kühlwaren“.
  - Wird „Milch“ verschoben, überschreibt die neue Position das Gedächtnis – sie bleibt dann dort.
  - Normalisierung: Kleinschreibung, Leerzeichen getrimmt, Mengenangaben am Anfang ignoriert („2 Milch“ → „milch“).
  - Das Gedächtnis speichert Gruppen-*Namen*, nicht interne IDs. Wird eine gelernte Gruppe gelöscht, wird sie beim nächsten Bedarf neu angelegt.

### 3.4 Artikel
- Schnelleingabe unten (am Handy daumenfreundlich), Enter fügt hinzu.
- Menge erkennen: „3 Äpfel“, „500g Hack“, „Milch x2“ → Menge + Name.
- **Autovervollständigung** aus allen jemals im Space genutzten Artikeln, sortiert nach Häufigkeit und Aktualität; zeigt die gelernte Gruppe als kleinen Hinweis mit an.
- Mehrere Zeilen einfügen (z. B. aus WhatsApp kopiert) → jede Zeile wird ein Artikel.
- **Abgehakt** = durchgestrichen, wandert ans Ende der Gruppe (oder in einen zuklappbaren Bereich „Erledigt“). Bleibt verfügbar, Antippen hakt wieder ab.
- **Hinweis bei Doppelten** (nur innerhalb derselben Liste): „Milch steht schon drauf“ mit Optionen *Menge erhöhen* / *trotzdem hinzufügen*. Ist das Doppelte abgehakt, wird es stattdessen wieder aktiviert.
- „Erledigte entfernen“ räumt die Liste auf; die Artikel bleiben im Verlauf und damit in der Autovervollständigung.
- Jede Änderung zeigt eine kurze **Rückgängig**-Meldung.

### 3.5 Synchronisation
- **WebSocket** pro Space. Jede Änderung wird sofort optimistisch angezeigt, an den Server geschickt und an alle anderen Geräte verteilt (Ziel: < 1 s).
- **Offline:** Die App ist eine PWA und startet auch ohne Netz. Änderungen werden lokal gepuffert (localStorage) und beim Wiederverbinden nachgesendet; danach holt sich das Gerät den aktuellen Stand. Wichtig für Funklöcher im Supermarkt. Oben zeigt ein `hint` „Offline – 3 Änderungen warten“.

#### Konflikte (gleichzeitige Änderungen, auch nach Offline-Phasen)
Gesendet werden **einzelne Aktionen** („Milch abgehakt“, „Menge von Eiern = 10“), nie die ganze Liste. Dadurch kollidiert fast nichts: Wer offline Brot abhakt, während jemand anderes online Käse hinzufügt, bekommt am Ende beides.

Jede Aktion trägt den Zeitpunkt, an dem sie **auf dem Gerät** gemacht wurde (die Uhrzeit des Geräts wird beim Verbinden mit der Server-Uhr abgeglichen). Regeln:

| Fall | Ergebnis |
|---|---|
| Hinzufügen auf zwei Geräten | Beide Artikel kommen dazu. Gleicher Name in derselben Liste → werden zu einem Artikel zusammengeführt (Mengen addiert), mit Hinweis. |
| Gleiches Feld geändert (z. B. Menge, Name, Abhaken, Gruppe) | Vorläufig gilt die **zuletzt gemachte** Änderung (nicht die zuletzt angekommene). Zusätzlich erscheint eine **softe Meldung** „1 Konflikt“: Pro Kollision werden beide Werte mit Gerät und Uhrzeit gezeigt, und jeder Teilnehmer kann den richtigen Wert wählen (oder den aktuellen behalten). Reihenfolge-Änderungen (Sortierung) lösen keine Meldung aus. |
| Verschiedene Felder geändert (A hakt ab, B ändert Menge) | Beides wird übernommen. |
| Artikel gelöscht, anderes Gerät hat ihn offline geändert | Löschen gewinnt; die Änderung landet in der Historie und kann dort mit einem Tipp wiederhergestellt werden. |
| Gruppe gelöscht, offline wurde etwas hineingelegt | Artikel landet in „Ohne Gruppe“. |
| ID wurde inzwischen erneuert | Das Gerät zieht automatisch auf die neue ID um und sendet danach seine Änderungen. |
| Space wurde inzwischen gelöscht | Ausstehende Änderungen werden nicht verworfen, sondern in die Fortsetzungs-Liste übernommen (siehe 3.10). |

Nach dem Nachsenden zeigt die App kurz: „5 Änderungen synchronisiert, 1 überschrieben – Details“. Die Details stehen in der Historie.
- Fallback, falls WebSocket blockiert ist: periodisches Abfragen.

### 3.6 Teilnehmer / Geräte
- Jedes Gerät erzeugt einmalig ein zufälliges Geräte-Token (im `localStorage`) und vergibt sich einen Namen.
- Teilnehmerliste (z. B. als Leiste mit Kürzeln oben, aufklappbar) mit „zuletzt aktiv“ und einem grünen Punkt für „gerade online“.
- **Entfernen (Kick)** durch jeden Teilnehmer möglich. Die ID bleibt dabei gleich; das entfernte Gerät verliert seine Mitgliedschaft (und zieht bei „ID erneuern“ nicht mit um), kann aber mit Link/ID wieder beitreten. Wer jemanden wirklich aussperren will, nutzt danach „ID erneuern“.
- Geräte ohne Aktivität seit **30 Tagen** werden automatisch entfernt; mit Link/ID kann man jederzeit wieder teilnehmen.
- **„Ich bin im Laden“** (Schalter pro Gerät):
  - Die anderen sehen oben ein Banner „Jana kauft gerade ein“ – so weiß man, dass Nachträge *jetzt* noch mitgenommen werden, und zwei Leute kaufen nicht dasselbe.
  - Auf dem Gerät im Laden werden Artikel, die währenddessen hinzukommen, als **„neu“** hervorgehoben (plus kurzes Vibrieren, falls erlaubt).
  - Endet per Knopf, automatisch nach 60 Minuten ohne Aktivität oder wenn alles abgehakt ist.
  - Lässt sich mit dem **Bildschirm-an-Knopf** kombinieren, ist aber unabhängig davon.
- **Bildschirm bleibt an:** eigener Knopf (Wake-Lock), standardmäßig aus, nur sichtbar, wenn der Browser es unterstützt.

### 3.6a Historie
- Pro Liste ein **zugeklappter** Bereich „Verlauf“: wer hat wann was hinzugefügt, abgehakt, geändert, gelöscht – mit „Wiederherstellen“ bei gelöschten Artikeln.
- Wird automatisch geleert: Einträge älter als **14 Tage** (einstellbar per Umgebungsvariable) werden gelöscht.
- Unabhängig davon die **Rückgängig**-Meldung direkt nach jeder Aktion.

### 3.7 Teilen
- **QR-Code** (wird im Browser erzeugt, kein externer Dienst) – großflächig zum Abscannen am Handy.
- **Teilen-Knopf** über die Web-Share-API (öffnet das native Teilen-Menü → WhatsApp, Signal, Mail …) mit Titel = Name des Space/der Liste. Fallback: Link kopieren.
- **Link-Vorschau** für Messenger: Der Server liefert für `/<ID>` Open-Graph-Tags mit eigenem Vorschaubild. Seit v0.5.3 neutral (nur „ShopWiz“, kein Name der ID, kein Füllstand, keine ID in `og:url`): Messenger-Server, die die Vorschau holen, erfahren nichts über die Liste.
- ID zusätzlich groß zum Abschreiben/Vorlesen.
- **Kamera-Knopf zum QR-Scannen** (Startseite und „Space wechseln“). Nutzt die eingebaute `BarcodeDetector`-API und fällt auf eine lokal gebündelte Bibliothek (`jsQR`) zurück, weil iOS-Safari und Firefox die API nicht haben. **Der Knopf erscheint nur unter HTTPS**; ohne HTTPS wird er ausgeblendet (ebenso das native Teilen-Menü → dann „Link kopieren“).

### 3.8 Startseite ohne gespeicherte ID
- Es gibt nur zwei Aktionen: **„Neue Liste erzeugen“** und **„ID einfügen“** (mit Kamera-Knopf). Die App braucht keine weitere Zugangssperre, die ID ist der Schutz.

### 3.9 ID erneuern & Übertragen
- **ID erneuern:** Es wird eine neue ID erzeugt, die alte wird sofort ungültig und alle Inhalte bleiben erhalten. **Alle Mitglieds-Geräte ziehen automatisch um** (live über WebSocket, oder beim nächsten Öffnen über ihr Geräte-Token). Wer nur den alten Link hat, aber kein Mitglied ist, erhält „ID ungültig“.
- **In andere ID übertragen:** Artikel oder ganze Gruppen lassen sich in eine andere bekannte ID verschieben oder kopieren. Ziel-ID eingeben oder aus den gemerkten IDs wählen, dann die Ziel-Liste auswählen. Fehlende Gruppen werden im Ziel angelegt.

### 3.10 ID löschen
- Knopf in den Einstellungen mit **doppelter Bestätigung** (zweiter Schritt: Namen des Space eintippen).
- Danach ist der Space gesperrt. Öffnet ein **Mitglieds-Gerät** ihn, erscheint: „Diese Liste wurde von *Jake* gelöscht“ mit dem Angebot **„Mit neuer ID fortsetzen“** – das legt einen neuen Space mit einer Kopie der Inhalte an. Ein bloßer Link-Besitzer ohne Mitgliedschaft sieht nur „ID existiert nicht“.
- Sobald das letzte Mitglieds-Gerät abgelaufen ist (spätestens nach 30 Tagen), werden die Daten endgültig gelöscht. Dann ist nichts mehr fortsetzbar oder übertragbar.

### 3.11 Sprachen
- Hauptsprache **Englisch**, zusätzlich **Deutsch** von Anfang an.
- Alle Texte liegen in Sprachdateien (`locales/en.json`, `locales/de.json`); eine neue Sprache = eine neue Datei.
- Jedes Gerät wählt seine Sprache selbst (Startwert: Browsersprache, sonst Englisch). Gespeichert lokal im Gerät.
- Inhalte (Artikel-, Gruppen-, Listen-, Gerätenamen) bleiben genau so, wie sie eingegeben wurden – es wird nichts übersetzt.
- Auch die Link-Vorschau (Open Graph) hat Englisch als Standard.

## 4. Datenschutz / „ohne Tracking“

- Keine Analytics, keine Cookies, kein Fingerprinting.
- **Keine externen Anfragen:** Schriften (Instrument Sans, IBM Plex Mono) werden selbst ausgeliefert statt über Google Fonts; keine CDNs.
- Server-Logs ohne IP-Adressen; Rate-Limiting nur im Speicher.
- Datensparsamkeit: gespeichert werden nur Listeninhalte, Namen und Zeitstempel. Abgelaufene Spaces und inaktive Geräte werden hart gelöscht.
- Strenge Sicherheits-Header (CSP, `Referrer-Policy: no-referrer`, damit die ID nicht über Referrer abfließt).

## 5. Design (Feierabend-Designsystem v2)

Übernahme der Tokens 1:1:

- Farben: `--bg #E9EDE6`, `--surface #FBFCF9`, `--surface-2 #E1E7DD`, `--ink #16211B`, `--muted #5C6B60`, `--line #CAD4C5`, `--dusk #4B45A8` (Akzent/Fokus), `--sun #D9920B` (Hauptaktion), `--alert #A33A22` – plus die dunklen Varianten.
- Schriften: **Instrument Sans** für Text, **IBM Plex Mono** für Überschriften, IDs, Mengen, Eyebrows.
- Bausteine: Karten (Radius 18 px, weicher Schatten), Chips (999 px) für Gruppenfilter/Gerätenamen, `hint`-Kästen für Hinweise (Ablauf, offline), aufklappbare `details.card` für Gruppen, Themeswitch Hell/Dunkel/Auto.
- Mobil zuerst, max. Breite ~780 px, große Tippflächen.

## 6. Technik

| Bereich | Vorschlag | Warum |
|---|---|---|
| Backend | **Node.js + Fastify** mit `@fastify/websocket` | Ein Prozess für API, WebSocket und statische Dateien |
| Datenbank | **SQLite** (`better-sqlite3`, WAL-Modus) | Keine Extra-Container, eine Datei im Volume, für diesen Anwendungsfall mehr als schnell genug |
| Frontend | **Svelte + Vite**, als **PWA** | Klein, schnell, installierbar auf dem Homescreen, offlinefähig |
| QR-Code | `qrcode` (lokal gebündelt) | Kein externer Dienst |
| Drag & Drop | `svelte-dnd-action` o. Ä. | Touch-tauglich |
| Tests | Vitest (Logik), Playwright (End-to-End inkl. Sync mit zwei Browsern) | |

### Datenmodell (Entwurf)

```
spaces        uid(PK, intern) · public_id(UNIQUE, 10) · name · ttl_days(≤367) · last_active_at
              · created_at · deleted_at · deleted_by
retired_ids   public_id(PK) · space_uid · reason(renewed|deleted)   (alte IDs nie neu vergeben)
lists         id · space_uid · name · position · group_mode(own|shared) · created_at · deleted_at
groups        id · space_uid · list_id(NULL = gemeinsames Set) · parent_id(NULL = Ebene 1)
              · name · position
items         id · list_id · group_id(NULL) · name · norm_name · qty · unit · note · checked
              · checked_by · added_by · position · deleted_at
              · field_ts (JSON: Zeitpunkt der letzten Änderung je Feld, für Konfliktregeln)
memory        space_uid · list_id(NULL = gemeinsam) · norm_name · group_name · subgroup_name · updated_at
suggestions   space_uid · norm_name · display_name · use_count · last_used_at   (Autovervollständigung)
activity      id · list_id · device_name · action · payload · created_at     (Verlauf, 14 Tage)
devices       token_hash · space_uid · name · last_seen_at · shopping_until · created_at
```
Interne `uid` statt der öffentlichen ID als Schlüssel → „ID erneuern“ ändert nur ein Feld.

### Docker
- Ein Image (mehrstufiger Build), läuft als unprivilegierter Benutzer.
- `docker-compose.yml` fertig für **Portainer-Stacks**: ein Service, ein benanntes Volume für `/data`, Healthcheck, Umgebungsvariablen (`PUBLIC_URL`, `SPACE_TTL_DAYS=181` (Standard für neue Spaces, max. 367), `DEVICE_TTL_DAYS=30`, `ACTIVITY_TTL_DAYS=14`, `PORT`). Der Port wird direkt veröffentlicht, ein Reverse Proxy ist optional (für HTTPS/Kamera aber empfohlen).
- Ohne Docker startbar mit `npm install && npm run build && npm start`.

## 7. Umfang Version 1 / später

**Version 1:** Offline-Modus mit Konfliktregeln, „Ich bin im Laden“, Bildschirm-an-Knopf, Verlauf (zugeklappt, 14 Tage), Rückgängig, mehrzeiliges Einfügen, Hinweis bei Doppelten (pro Liste), ID erneuern, ID löschen mit Fortsetzen, Übertragen in andere ID (verschieben/kopieren), Englisch + Deutsch.

**Später möglich:** Stammliste/Vorlagen, Laden-Reihenfolge pro Laden, Export/Import als Text, Mengen-Schnelltasten (+/–).

Bewusst **nicht** geplant: Preise/Budget, Rezepte, Benutzerkonten, Push-Benachrichtigungen (bräuchten externe Push-Dienste → widerspricht „ohne Tracking“).

## 8. Umsetzungsschritte

1. Grundgerüst: Repo-Struktur, Fastify + SQLite, Svelte + Vite, Dockerfile, `docker-compose.yml`.
2. Spaces & IDs: Anlegen, Beitreten, Ablauf, Aufräum-Job, localStorage + Reset-Knopf.
3. Listen & Artikel: CRUD, Dropdown, Abhaken, Schnelleingabe mit Mengen-Erkennung.
4. Gruppen (2 Ebenen), Drag & Drop, Mitlernen, Autovervollständigung.
5. Echtzeit-Sync per WebSocket, Offline-Puffer.
6. Geräte & Teilnehmer: Namen, Anzeige, Entfernen, 30-Tage-Aufräumen.
7. Teilen: QR-Code, Web Share, Open-Graph-Vorschau.
8. ID erneuern / löschen / fortsetzen, Übertragen in andere ID.
9. Historie, „Ich bin im Laden“, Wake-Lock.
10. Sprachen (en/de), Design-Feinschliff, Hell/Dunkel, PWA-Manifest, Tests, README.

## 9. Entscheidungen

1. Eine ID = ein Space mit mehreren Listen.
2. Gruppen gelten pro Liste; pro Liste einstellbar, ob sie stattdessen die gemeinsamen Gruppen der ID nutzt. Übertragen in andere IDs: verschieben und kopieren (3.9).
3. Ablauf nach 181 Tagen ohne aktives Gerät, pro Space einstellbar bis 367 Tage.
4. Jeder Teilnehmer darf alles (Einstellungen, Ablauf, Kick, Erneuern, Löschen). Kick ändert die ID nicht; „ID erneuern“ zieht alle Mitglieds-Geräte automatisch um.
5. Die App bleibt offen, ohne vorgeschaltete Zugangssperre. Ohne gespeicherte ID gibt es nur „Neue Liste erzeugen“ und „ID einfügen“, dazu einen Kamera-Knopf zum QR-Scannen.
6. Löschen mit doppelter Bestätigung; Mitglieder können mit neuer ID fortsetzen, bis das letzte Gerät abgelaufen ist.
7. Englisch als Hauptsprache, Deutsch dazu, Sprache pro Gerät, Texte in Sprachdateien.
8. Kamera-Knopf nur unter HTTPS.

## 10. KI-Anbindung (MCP) und REST-Schnittstelle – umgesetzt (v0.3), Anleitung in der README

**Ziel:** KI-Assistenten und Sprachassistenten können Listen lesen und – wenn erlaubt – bearbeiten:
„Plan mir Essen für die Woche und schreib die Zutaten auf die Einkaufsliste“, „Was steht noch für den Baumarkt drauf?“, „Hey Siri, Milch auf die Liste“.

### 10.1 Grundidee: Jede KI ist ein eigenes Gerät
- In den Einstellungen: **„KI / Assistent verbinden“** → Name eingeben (z. B. „Claude“, „Grok“, „ChatGPT“, „Siri“) → ShopWiz erzeugt **einen eigenen geheimen Verbindungslink bzw. Schlüssel pro KI**.
- Die KI erscheint bei den Teilnehmern unter diesem Namen (mit kleinem KI-Kennzeichen), ihre Aktionen stehen im Verlauf („Claude hat 8 Artikel hinzugefügt“), alles ist rückgängig zu machen und synchronisiert live.
- Jede Verbindung ist **einzeln widerrufbar** (wie ein Gerät entfernen). Der Link ist unabhängig vom Teilen-Link und von der ID selbst; „ID erneuern“ trennt alle KI-Verbindungen (sie müssen neu verbunden werden).
- Inaktive KI-Verbindungen verfallen wie Geräte nach 30 Tagen ohne Nutzung (`DEVICE_TTL_DAYS`).

### 10.2 Rechte: pro ID einstellbar
- Einstellung pro ID: **„KI darf: nur lesen“** oder **„lesen und schreiben“** (Standard: nur lesen).
- Gilt für alle KI-Verbindungen dieser ID; serverseitig erzwungen (schreibende Werkzeuge/Endpunkte antworten mit „nur Lesen erlaubt“).
- Nie erlaubt, unabhängig von der Einstellung: ID löschen/erneuern, Geräte oder KI-Verbindungen verwalten, Einstellungen ändern, Artikel endgültig löschen.

### 10.3 Werkzeuge / Funktionen (MCP und REST gleich)

| Funktion | Recht | Zweck |
|---|---|---|
| Listen anzeigen | lesen | Listen der ID mit Name, Anzahl offen/erledigt, Reisemodus |
| Liste lesen | lesen | Offene und erledigte Artikel mit Menge, Notiz, Gruppe (optional inaktive) |
| Artikel hinzufügen | schreiben | Mehrere auf einmal, Schnelleingabe wie „200g Hack“, gelernte Gruppe, Doppelte werden zusammengeführt |
| Abhaken / zurücknehmen | schreiben | Per Name oder ID |
| Artikel ändern | schreiben | Menge, Notiz, Gruppe |
| Entfernen | schreiben | Schiebt auf „inaktiv“ (nie endgültig löschen) |

Intern laufen alle Funktionen über die vorhandenen Operationen (`store.applyOp`) – dieselben Regeln, Konflikterkennung, Verlauf und Live-Sync wie bei Menschen.

### 10.4 Anbindung je Assistent

| Assistent | Weg |
|---|---|
| **Claude** (Web, Desktop, App) | Remote-MCP: Endpunkt `https://<server>/mcp` (Streamable HTTP) als „Custom Connector“ eintragen, Verbindungsschlüssel im Link |
| **ChatGPT** | MCP-Connector (sofern im Konto verfügbar) oder als Custom GPT mit „Actions“ über die REST-Schnittstelle (OpenAPI-Beschreibung unter `/api/v1/openapi.json`) |
| **Grok** | MCP, sofern die App/API Remote-MCP unterstützt; sonst REST |
| **Siri** | Apple **Kurzbefehle**: Diktat → „Inhalt von URL abrufen“ (POST an die REST-Schnittstelle). ShopWiz liefert eine Anleitung bzw. einen fertigen Kurzbefehl zum Importieren („Auf die Einkaufsliste“, „Was steht auf der Liste?“) |
| **Home Assistant, Skripte, sonstige** | REST |

Vor der Umsetzung prüfen: aktueller Stand der MCP-Unterstützung bei ChatGPT und Grok (ändert sich schnell), Authentifizierungs-Anforderungen der Claude-Connectoren (geheimer Link vs. OAuth).

### 10.5 REST-Schnittstelle
- Versioniert unter `/api/v1/…`, Authentifizierung per `Authorization: Bearer <KI-Schlüssel>`; der Schlüssel bestimmt ID, Namen und Rechte.
- Einfache, gut dokumentierte JSON-Endpunkte, z. B.:
  - `GET /api/v1/lists`
  - `GET /api/v1/lists/{list}/items`
  - `POST /api/v1/lists/{list}/items` (`{"items": ["2 Milch", "200g Hack"]}` oder strukturiert)
  - `POST /api/v1/lists/{list}/items/{item}/check`
- `{list}` darf auch der Listenname sein („Wocheneinkauf“) – praktisch für Sprachassistenten; ohne Angabe die zuletzt genutzte bzw. erste Liste.
- OpenAPI-Beschreibung für ChatGPT-Actions und eigene Tools.

### 10.6 Sicherheit und Datenschutz
- Standardmäßig **aus**: `AI_ENABLED=false` (bzw. `MCP_ENABLED`/`API_ENABLED`) – wer es nicht will, hat keinen offenen Endpunkt.
- Schlüssel werden wie Geräte-Token nur als Hash gespeichert; Anzeige nur einmal beim Anlegen (mit Kopieren-Knopf und QR-Code).
- Mengenbegrenzung pro Schlüssel (Anfragen pro Minute) wie bei der ID-Suche.
- **Prompt Injection**: Artikelnamen stammen auch von anderen Teilnehmern. Deshalb nur Listen-Funktionen innerhalb dieser einen ID, nichts Unumkehrbares, Ausgaben klar als Daten gekennzeichnet.
- Die KI sieht Listeninhalte nur, wenn jemand sie bewusst verbindet und fragt – passt zu „ohne Tracking“. In der Hilfe/README klar erklären, dass der jeweilige KI-Anbieter dann die abgefragten Listen sieht.

### 10.7 Offene Punkte
- Darf die KI auch Gruppen anlegen und den Reisemodus/Übersetzungen nutzen?
- Kurzbefehl für Siri als Datei mitliefern oder nur Anleitung?
- Soll eine KI-Verbindung auf einzelne Listen beschränkt werden können?

### 10.8 Umsetzungsschritte (Vorschlag)
1. KI-Verbindungen: Datenmodell (Schlüssel-Hash, Name, Rechte über die ID), Einstellungen-UI, Anzeige bei Teilnehmern, Widerrufen.
2. REST `/api/v1` + OpenAPI + Tests.
3. MCP-Endpunkt `/mcp` (offizielles SDK, Streamable HTTP) auf denselben Funktionen + Tests.
4. Anleitungen: Claude, ChatGPT, Grok, Siri-Kurzbefehl, Home Assistant (README + Hilfe).

## 11. Listenverbund – umgesetzt

**Problem:** Mehrere Lebensmittelläden in einer ID (z. B. Lidl, Conad 1, Conad 2). 400 g Hackfleisch sollen in *einem* dieser Läden gekauft werden – egal in welchem. Ein Baumarkt soll davon nichts sehen. Eine Laden-Auswahl bei jedem Artikel wäre im Laden zu umständlich.

**Lösung:** Listen lassen sich zu einem **Listenverbund** zusammenschließen. Ein Artikel im Verbund ist *ein* gemeinsamer Bedarf, der in allen Listen des Verbunds steht – kein Kopieren, kein Doppelt-Abhaken.

### 11.1 Einrichten
- Listenmenü → „Listenverbund“: alle anderen Listen der ID zum Abhaken. Lidl anhaken in Conad 1 → beide bilden einen Verbund.
- Die Einstellung gilt für alle Beteiligten: Hakt man in Lidl Conad 1 und Conad 2 an, zeigt auch Conad 2 Lidl und Conad 1 als verbunden. Eine Liste gehört zu höchstens einem Verbund.
- Neben dem Listennamen zeigt ein Ketten-Symbol, dass die Liste im Verbund ist.

### 11.2 Hinzufügen
- In einer verbundenen Liste geht jeder neue Artikel standardmäßig an den ganzen Verbund.
- Neben dem Prioritäts-Knopf ein Ketten-Knopf: an = im Verbund, aus = nur diese Liste („Nur Conad“). Wie der Prioritäts-Knopf gilt er für den nächsten Artikel und springt danach auf die Grundeinstellung zurück.
- **Deutlich sichtbar:** aktiv = kräftig grün hinterlegte Kette mit „Verbund“ (Skin-Farbe `--ok`, in allen Skins auf Kontrast geprüft); aus = neutral wie die übrigen Knöpfe. Man soll vor dem Hinzufügen sehen, wohin der Artikel geht.
- **Grundeinstellung pro Gerät** (Einstellungen → Dieses Gerät → „Neue Artikel im Listenverbund“): „in alle verbundenen Listen“ (Standard, Opt-out) oder „nur in diese Liste“ (Opt-in).
- Listen ohne Verbund zeigen den Knopf nicht – für sie ändert sich nichts.
- Bereits vorhandener Artikel (gleicher Name) im Verbund → wie heute: Menge erhöhen bzw. wieder aktivieren statt Duplikat.

### 11.3 Im Laden
- Ein gemeinsamer Artikel hat *einen* Status. In Lidl abgehakt → in Conad ebenfalls abgehakt (durchgestrichen, am Gruppenende) mit grünem Etikett „bei Lidl gekauft“. Er bleibt abgehakt in der Liste – nach „Inaktiv“ kommt er erst wie bisher über „Einkauf abschließen“ oder „Abgehakte zu ‚Inaktiv‘ verschieben“, dann für alle. Haken wieder weg (egal wo) → überall offen, Etikett weg. „Abgehaktes ausblenden“ blendet ihn wie jeden abgehakten Artikel aus.
- Gruppen und Reihenfolge bleiben pro Laden (bei Lidl „Fleischtheke“, bei Conad „Macelleria“). ShopWiz lernt die Platzierung pro Liste wie heute; kennt ein Laden den Artikel noch nicht, steht er dort zunächst ohne Gruppe.
- Inaktive Artikel sind ebenfalls gemeinsam (gemeinsames Stammsortiment); „Nur hier“-Artikel bleiben auch inaktiv nur in ihrer Liste.
- „Einkauf abschließen“ schiebt die in *diesem* Laden abgehakten gemeinsamen Artikel nach „Inaktiv“ – damit für alle.
- Artikeldetails: „Gilt für: ☑ Lidl ☑ Conad 1 ☑ Conad 2“ bzw. „Nur hier“ umschaltbar; ein kleines Ketten-Zeichen am Artikel zeigt „gemeinsam“.

### 11.4 Verbinden: vorhandene Artikel
- Beim Verbinden einmalige Frage „Bestehende Artikel im Verbund teilen?“ (Standard: ja).
- Gleicher Name in mehreren Listen → **zusammenführen** zu einem Artikel: größere Menge (nicht die Summe – es ist derselbe Bedarf), Notizen zusammengefügt, offen schlägt abgehakt/inaktiv, wichtig schlägt normal. Danach Hinweis „N doppelte Artikel zusammengeführt“ mit Rückgängig.
- „Nein“: vorhandene Artikel bleiben „nur hier“, nur neue werden geteilt.

### 11.5 Trennen
- Verlässt eine Liste den Verbund, bekommt sie eine eigene, unabhängige Kopie aller gemeinsamen Artikel (mit Status, Menge, Notiz, Priorität, ihrer Gruppe). Der Rest des Verbunds behält die gemeinsamen Artikel. Niemand verliert etwas.
- Später wieder verbinden → Zusammenführen wie in 11.4.
- Bleibt nur eine Liste übrig, löst sich der Verbund auf.

### 11.6 Technik
- `lists.link_id`: Kennung des Verbunds (NULL = keiner).
- Artikel behalten ihre Ursprungsliste (`items.list_id`) und bekommen `items.shared` (im Verbund sichtbar) und `items.checked_in` (Liste, in der abgehakt wurde → „bei Lidl gekauft“).
- Ansicht einer Liste = eigene Artikel + gemeinsame Artikel der anderen Verbund-Listen.
- Gruppe/Reihenfolge pro Laden: Spalte `items.places` (`{listId: {groupId, pos}}`) für gemeinsame Artikel in den anderen Listen – so reist die Platzierung mit dem Artikel durch Sync und Rückgängig; das bestehende Lernen pro Liste liefert die erste Platzierung.
- Neue Operationen: `list.link` (Verbund setzen, mit Zusammenführen), `list.linkUndo` (nimmt ein Verbinden samt Zusammenführen zurück), `list.unlink` (mit Kopien), `item.set` um `shared` und die Liste erweitert, in der geändert wurde (`listId`: Platz in diesem Laden, „bei … gekauft“). Alles über die vorhandenen Operationen: Verlauf, Rückgängig, Live-Sync, Offline-Konflikte.
- Mitziehen: Backup (`> 🔗 Lidl, Conad 1` unter der Liste, `↯` bzw. Markierung für „nur hier“), Teilen als Text, Fokus-Modus, Suche, Übertragen in andere ID, KI-Schnittstelle („zu allen Lebensmittel-Listen hinzufügen“ ergibt sich von selbst; `read_list` zeigt den Verbund).

### 11.7 Umsetzungsschritte
1. Datenmodell + Operationen `list.link`/`list.unlink` mit Zusammenführen und Kopien, Tests.
2. Anzeige: gemeinsame Artikel in allen Verbund-Listen, gemeinsamer Status, „bei … gekauft“, Ketten-Symbol am Listennamen und am Artikel.
3. Hinzufügen-Leiste: Ketten-Knopf (Standard an), Artikeldetails „Gilt für“.
4. Gruppen/Reihenfolge pro Laden.
5. Backup, Teilen als Text, KI-Schnittstelle, Hilfe, README, E2E-Tests (zwei Geräte, zwei Läden).

## 12. Administration (optional)

**Ziel:** Wer einen Server betreibt, soll sehen, welche IDs es gibt, aufräumen und bei Problemen helfen können – ohne dass die Administration selbst zur Schwachstelle wird. Sicherheit und Datenschutz gehen vor Komfort, aber nichts davon soll im Alltag nerven.

**Optional und standardmäßig aus.** Wer sie nicht braucht (z. B. nur zu Hause per IP-Adresse, oder hinter Authentik), merkt nichts davon. Aktiv nur mit `ADMIN=on` – sonst antworten alle Admin-Adressen mit 404. **Einrichten im Browser:** Beim Start steht ein einmaliger Einrichtungscode im Log (Portainer: ein Klick); damit legt man unter `/admin` Benutzername und Passwort des Haupt-Admins fest. `ADMIN=reset` richtet ihn neu ein (Passwort vergessen, Passkey weg). Eine Kommandozeile ist nicht nötig.

### 12.1 Wer ist Admin?
- **Haupt-Admin:** Benutzername + Passwort, festgelegt bei der Einrichtung im Browser; gespeichert wird nur ein scrypt-Hash (alternativ fest per `ADMIN_USER` + `ADMIN_PASSWORD_HASH`). Der Haupt-Admin ist an kein Gerät gebunden und braucht keinen Passkey; er kann sich zusätzlich einen einrichten.
- **Weitere Admins = Geräte:** Jedes Gerät hat eine **D-ID** (in allen Sprachen „D-ID“), abgeleitet aus dem Geräte-Schlüssel, aber ohne Rückschluss darauf. Sie steht in den Einstellungen, sobald der Server eine Administration hat.
- Der Haupt-Admin **ernennt** eine D-ID zum Admin. Das Gerät bekommt einen einmaligen Hinweis zum Wegklicken (wie die Ruf-Karten) und muss **innerhalb von 24 Stunden** einen Passkey einrichten – sonst verfällt die Ernennung.
- **Nie nur ein Faktor:** Ein Geräte-Admin braucht immer D-ID **und** Passkey (Fingerabdruck, Gesicht, PIN des Geräts). Ein kopierter Geräte-Schlüssel reicht nicht, ein Passkey allein auch nicht.
- **Ernennungscode** (seit dem Security-Audit): Beim Ernennen bekommt der Haupt-Admin einen Code, den er der Person auf anderem Weg gibt; ohne ihn kein Passkey – ein gestohlener Geräte-Schlüssel allein reicht nicht. Nach der Einrichtung ist die Ernennung an den vollen Schlüssel-Hash des Geräts gebunden, nicht nur an die 50-Bit-D-ID.
- Pro Ernennung lässt sich genau ein Passkey einrichten. War jemand schneller (z. B. mit einem gestohlenen Geräte-Schlüssel), sieht das echte Gerät „Passkey wurde bereits eingerichtet – warst du das nicht?“, und der Haupt-Admin sieht es im Protokoll und kann die Ernennung zurücknehmen.
- Nur der Haupt-Admin ernennt und entzieht Admins.

### 12.2 Schutz gegen Diebstahl von Sitzungen (Infostealer)
- **Admin-Sitzung nur im Arbeitsspeicher des Tabs** – kein Cookie, nichts im Gerätespeicher. Ein Stealer, der Browserdaten kopiert, findet nichts. Neu laden = neu anmelden (mit Passkey ein Fingerdruck). Auch der Server hält Sitzungen nur im Speicher.
- Ablauf: 15 Minuten ohne Aktivität, höchstens 8 Stunden.
- Geräte-Admin-Sitzungen gelten nur zusammen mit dem Geräte-Schlüssel dieses Geräts.
- **Erneute Bestätigung** für Ernennen/Entziehen und ID löschen: Wer sich in den letzten 5 Minuten angemeldet hat, braucht nichts weiter, sonst Passkey bzw. Passwort. („Wenn es nervt, ändern wir es.“)
- **Passwort als Notschlüssel:** In der Administration lässt sich die Passwort-Anmeldung abschalten, sobald der Haupt-Admin einen Passkey hat. Wiederherstellung: `ADMIN=reset`.
- Login gegen Durchprobieren gesichert (Fehlversuche pro Adresse begrenzt, scrypt läuft nur einzeln).
- Passkeys brauchen HTTPS (oder `localhost`) und gelten nur für die Domain. Synchronisierte Passkeys (iCloud, Google, Passwortmanager) sind erlaubt.

### 12.3 Was der Admin sieht und darf
- **IDs:** Name, ID, erstellt, zuletzt benutzt, Anzahl Listen/Artikel/Gruppen/Geräte, geschätzte Größe in KB. Öffnen (Vollzugriff), endgültig löschen.
- **Geräte:** D-IDs mit ihren Gerätenamen und den IDs, in denen sie sind; zum Admin ernennen.
- **Admins:** Haupt-Admin-Passkeys, Geräte-Admins mit Status (wartet auf Passkey / aktiv), Passkey-Art (synchronisiert / gerätegebunden); entziehen.
- **Protokoll** aller Admin-Aktionen (ohne IP-Adressen) und **Warnhinweise** für den Haupt-Admin beim nächsten Login: neuer Passkey, Ernennung, Fehlversuche.

### 12.4 Admin in einer ID
- Vollzugriff wie ein Teilnehmer. Solange ein Admin in der ID ist, steht er in der Teilnehmerliste ganz vorne, **rot** und als „Admin“ (egal welches Gerät). Verlässt er die ID, verschwindet er.
- Im Verlauf: „Admin hat die ID geöffnet“, Änderungen als „Admin“.
- Nichts davon landet auf dem Admin-Gerät: kein Offline-Stand, keine Warteschlange, kein Eintrag in „Meine IDs“.
- Persönliches bleibt gesperrt: Einchecken im Laden, Signale, Rufen.

### 12.5 Transparenz
- Hat der Server eine Administration, steht das in Einstellungen und Hilfe: Admins können IDs öffnen – man sieht es in der Teilnehmerliste und im Verlauf.

### 12.6 IDs pro Gerät
- `SPACES_PER_DEVICE` (Standard 0 = unbegrenzt): wie viele IDs ein Gerät selbst anlegen darf. Gezählt werden nur selbst angelegte, noch bestehende IDs – Beitreten zählt nicht, Löschen gibt einen Platz frei, Erneuern belegt keinen. Admins sind ausgenommen.
- Kein zusätzliches Limit pro IP-Adresse (Studentenwohnheime!); das bestehende `CREATE_LIMIT` (neue IDs pro Adresse und Stunde) bleibt unverändert.

### 12.7 Bewusst nicht
- Kein eigener Admin-Port, kein Login über Proxy-Header, keine Einladungscodes, keine Pflicht zu gerätegebundenen Passkeys, kein DBSC, keine Benachrichtigung per E-Mail/Push.

### 12.8 Technik
- Tabellen `admins` (D-ID, Status, Ablauf der Ernennung), `admin_keys` (Passkeys: Haupt-Admin oder D-ID), `admin_log`, `admin_meta`; Spalte `spaces.created_by`.
- `/api/admin/*` (Status, Login, Passkey, Übersicht, Ernennen, Entziehen, ID löschen); Admin-Sitzung im Header, nur im Speicher.
- WebAuthn über `@simplewebauthn/server` / `@simplewebauthn/browser`.
- WebSocket: `hello` mit Admin-Sitzung → Anwesenheit „admin“, Operationen mit dem Absender „Admin“.
- README: eigener, abgesetzter Abschnitt mit Verweis auf `docs/ADMIN.md` / `docs/ADMIN.de.md`, damit die normale Anleitung einfach bleibt.
