# ShopWiz – Planung

Gemeinsame Einkaufsliste für mehrere Personen. Kein Login, kein Tracking, Feierabend-Design.
Dieses Dokument ist der Plan vor der Umsetzung. Offene Fragen stehen am Ende.

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
- **Ablauf:** gleitend – z. B. 180 Tage nach letzter Aktivität (per Umgebungsvariable einstellbar). Jede Nutzung verlängert. Ab 14 Tagen vor Ablauf zeigt die App einen Hinweis. Ein nächtlicher Job löscht abgelaufene Spaces vollständig.
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
- **Mitlernen:** Pro Space gibt es ein „Gedächtnis“: *normalisierter Artikelname → Gruppe/Untergruppe*.
  - Wird „Milch“ zu „Kühlwaren“ hinzugefügt oder dorthin verschoben, merkt sich der Space das.
  - Beim nächsten Hinzufügen landet „Milch“ automatisch in „Kühlwaren“.
  - Wird „Milch“ verschoben, überschreibt die neue Position das Gedächtnis – sie bleibt dann dort.
  - Normalisierung: Kleinschreibung, Leerzeichen getrimmt, Mengenangaben am Anfang ignoriert („2 Milch“ → „milch“).
  - Das Gedächtnis gilt für alle Listen eines Space und nutzt den Gruppen-*Namen*, nicht die interne ID – so funktioniert es auch in einer neuen Liste mit gleich benannten Gruppen (fehlende Gruppe wird bei Bedarf angelegt).

### 3.4 Artikel
- Schnelleingabe unten (am Handy daumenfreundlich), Enter fügt hinzu.
- Menge erkennen: „3 Äpfel“, „500g Hack“, „Milch x2“ → Menge + Name.
- **Autovervollständigung** aus allen jemals im Space genutzten Artikeln, sortiert nach Häufigkeit und Aktualität; zeigt die gelernte Gruppe als kleinen Hinweis mit an.
- Mehrere Zeilen einfügen (z. B. aus WhatsApp kopiert) → jede Zeile wird ein Artikel.
- **Abgehakt** = durchgestrichen, wandert ans Ende der Gruppe (oder in einen zuklappbaren Bereich „Erledigt“). Bleibt verfügbar, Antippen hakt wieder ab.
- „Erledigte entfernen“ räumt die Liste auf; die Artikel bleiben im Verlauf und damit in der Autovervollständigung.
- Jede Änderung zeigt eine kurze **Rückgängig**-Meldung.

### 3.5 Synchronisation
- **WebSocket** pro Space. Jede Änderung wird sofort optimistisch angezeigt, an den Server geschickt und an alle anderen Geräte verteilt (Ziel: < 1 s).
- Konflikte: pro Feld „letzte Änderung gewinnt“ mit Server-Zeitstempel – für Einkaufslisten ausreichend und gut nachvollziehbar.
- **Offline:** Änderungen werden lokal gepuffert (IndexedDB) und beim Wiederverbinden nachgesendet; danach holt sich das Gerät den aktuellen Stand. Wichtig für Funklöcher im Supermarkt.
- Fallback, falls WebSocket blockiert ist: periodisches Abfragen.

### 3.6 Teilnehmer / Geräte
- Jedes Gerät erzeugt einmalig ein zufälliges Geräte-Token (im `localStorage`) und vergibt sich einen Namen.
- Teilnehmerliste (z. B. als Leiste mit Kürzeln oben, aufklappbar) mit „zuletzt aktiv“ und einem grünen Punkt für „gerade online“.
- **Entfernen** möglich. Ehrlicher Hinweis: Ohne Login kann ein entferntes Gerät mit Link/ID jederzeit wieder beitreten – das Entfernen räumt also die Liste auf, ist aber keine Zugriffssperre. Wer jemanden wirklich aussperren will, braucht eine neue ID (siehe Ideen: „ID neu erzeugen“).
- Geräte ohne Aktivität seit **30 Tagen** werden automatisch entfernt; mit Link/ID kann man jederzeit wieder teilnehmen.
- Kleines Extra: Bei Artikeln steht dezent, wer sie hinzugefügt / abgehakt hat („von Jana“).

### 3.7 Teilen
- **QR-Code** (wird im Browser erzeugt, kein externer Dienst) – großflächig zum Abscannen am Handy.
- **Teilen-Knopf** über die Web-Share-API (öffnet das native Teilen-Menü → WhatsApp, Signal, Mail …) mit Titel = Name des Space/der Liste. Fallback: Link kopieren.
- **Link-Vorschau** für Messenger: Der Server liefert für `/<ID>` passende Open-Graph-Tags (`og:title` = Name der Liste, Beschreibung z. B. „Gemeinsame Einkaufsliste · 12 Artikel“, eigenes Vorschaubild).
- ID zusätzlich groß zum Abschreiben/Vorlesen.

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
spaces        id(PK, 10) · name · created_at · last_active_at · expires_at
lists         id · space_id · name · position · created_at
groups        id · list_id · parent_id(NULL = Ebene 1) · name · position · collapsed
items         id · list_id · group_id(NULL) · name · qty · unit · note · checked
              · checked_at · checked_by · added_by · position · updated_at · deleted_at
memory        space_id · norm_name · group_name · subgroup_name · updated_at   (PK: space_id+norm_name)
history       space_id · norm_name · display_name · use_count · last_used_at   (Autovervollständigung)
devices       token_hash · space_id · name · last_seen_at · created_at
```

### Docker
- Ein Image (mehrstufiger Build), läuft als unprivilegierter Benutzer.
- `docker-compose.yml` fertig für **Portainer-Stacks**: ein Service, ein benanntes Volume für `/data`, Healthcheck, Umgebungsvariablen (`PUBLIC_URL`, `SPACE_TTL_DAYS=180`, `DEVICE_TTL_DAYS=30`, `PORT`), Beispiel-Labels für Traefik/Reverse-Proxy auskommentiert.
- Ohne Docker startbar mit `npm install && npm run build && npm start`.

## 7. Weitere Ideen (Vorschläge – bitte aussuchen)

**Empfohlen für Version 1 (klein, aber großer Nutzen):**
1. **Offline-Modus** – im Laden ist oft kein Netz.
2. **„Wer kauft gerade?“** – Gerät tippt „Ich bin im Laden“, die anderen sehen es und wissen, dass Nachträge jetzt noch ankommen.
3. **Wer hat was hinzugefügt/abgehakt** – dezent am Artikel.
4. **Rückgängig** für jede Aktion.
5. **Mehrzeiliges Einfügen** aus Chats.
6. **Bildschirm bleibt an** beim Einkaufen (Wake-Lock-Schalter).
7. **ID neu erzeugen** – falls ein Link in falsche Hände geraten ist: neue ID, alte wird ungültig, Inhalte bleiben.

**Später möglich:**
8. **Stammliste / Vorlagen** – „Wocheneinkauf“ mit einem Tipp in die aktuelle Liste übernehmen.
9. **Laden-Reihenfolge** – pro Liste gespeicherte Gruppenreihenfolge (z. B. für Rewe vs. Aldi).
10. **Export / Import** als Text (zum Weiterleiten oder als Sicherung).
11. **Mengen-Schnelltasten** (+/–) direkt am Artikel.
12. **Hinweis bei Doppelten** – „Milch steht schon drauf“ statt zweitem Eintrag.

Bewusst **nicht** geplant, um es einfach zu halten: Preise/Budget, Rezepte, Benutzerkonten, Push-Benachrichtigungen (bräuchten externe Push-Dienste → widerspricht „ohne Tracking“).

## 8. Umsetzungsschritte

1. Grundgerüst: Repo-Struktur, Fastify + SQLite, Svelte + Vite, Dockerfile, `docker-compose.yml`.
2. Spaces & IDs: Anlegen, Beitreten, Ablauf, Aufräum-Job, localStorage + Reset-Knopf.
3. Listen & Artikel: CRUD, Dropdown, Abhaken, Schnelleingabe mit Mengen-Erkennung.
4. Gruppen (2 Ebenen), Drag & Drop, Mitlernen, Autovervollständigung.
5. Echtzeit-Sync per WebSocket, Offline-Puffer.
6. Geräte & Teilnehmer: Namen, Anzeige, Entfernen, 30-Tage-Aufräumen.
7. Teilen: QR-Code, Web Share, Open-Graph-Vorschau.
8. Design-Feinschliff, Hell/Dunkel, PWA-Manifest, Tests, README.

## 9. Offene Fragen

1. **Geltungsbereich der ID:** Mein Vorschlag: *eine ID = ein Space mit mehreren Listen* (geteilt wird immer der ganze Space). Alternative: jede Liste hat ihre eigene ID, und das Dropdown wechselt zwischen gemerkten IDs. Was ist gewünscht?
2. **Gruppen:** Gelten Gruppen pro Liste (Vorschlag) oder einheitlich für den ganzen Space?
3. **Ablaufdatum:** Gleitend 180 Tage nach letzter Nutzung in Ordnung, oder fester Zeitraum ab Erstellung?
4. **Welche Ideen aus Abschnitt 7** sollen in Version 1?
5. **Domain / Reverse Proxy:** Läuft es hinter einem vorhandenen Proxy (Traefik, Nginx Proxy Manager, Caddy)? Dann bereite ich die Compose-Datei passend vor.
