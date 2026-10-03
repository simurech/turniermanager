# Turnier Manager

Webapp für das jährliche Fussball-Turnier: Spielplan, Tabelle, K.O.-Runde, Archiv, Statistik und Wettquoten.
Live: <https://turniermanager.urech.dev>

- **Frontend:** Vite + React 18, reines CSS (Retro-Fussball-Design), Smartphone zuerst, installierbar (PWA).
- **Backend:** eine PHP-Datei (`public/api.php`), Turniere liegen als JSON-Dateien im Speicherordner. Keine Datenbank.
- **Schutz:** Jedes Turnier hat einen 4-stelligen PIN (24 h auf dem Gerät gemerkt), dazu gibt es einen globalen Admin-Code (30 Tage gemerkt).

## Entwicklung

```bash
npm install
mkdir -p /tmp/tm && TM_STORAGE=/tmp/tm php -S 127.0.0.1:8000 -t public   # API (Terminal 1)
npm run dev                                                               # App auf http://127.0.0.1:5173 (Terminal 2)
```

Admin-Code für die Entwicklung setzen: `php tools/set-admin.php /tmp/tm`

## Tests

```bash
npm test            # 65 Unit-Tests (Logik, Statistik, PIN-Speicher) und 13 API-Tests
npm run test:unit   # nur die Unit-Tests
```

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `src/lib/tournament.js` | Spielplan, Tabelle, K.O.-Runde, Endrangliste und alle Änderungen (`applyOp`) |
| `src/lib/stats.js` | Form, Computer-Tipp, Direktvergleich, Wettquoten (Simulation), Ewige Tabelle |
| `src/lib/sync.js` | Laden, Polling, Speichern, Konflikte (Änderungen werden auf den neuen Serverstand gelegt) |
| `src/lib/auth.js` | PIN (24 h) und Admin-Code (30 Tage) auf dem Gerät |
| `src/components/` | Oberfläche: Start, Erstellen, Turnier, Statistik, Abschluss, TV-Ansicht |
| `public/api.php` | API: `list`, `load`, `create`, `update`, `verify`, `photo`, Admin-Aktionen |
| `public/sw.js`, `public/site.webmanifest` | Offline-Hülle und App-Installation |
| `tools/set-admin.php` | Setzt den Admin-Code auf dem Server (nur als Hash gespeichert) |
| `design-mockups/` | Die beiden Design-Entwürfe, `legacy-index.html` ist die alte App |

## Spielregeln im Code

- **Tabelle:** 3 Punkte pro Sieg, 1 pro Remis. Bei Punktgleichheit entweder Tordifferenz oder direkter Vergleich (Mini-Tabelle), danach Tore, Gegentore, Siege, Niederlagen und die Eingabereihenfolge.
- **K.O.:** Halbfinale 1 gegen 4 und 2 gegen 3, Finale, optional Spiel um Platz 3. Unentschieden gibt es im K.O. nicht.
- **Verlierer-Runde** (Plätze 5 bis n der Gruppentabelle): Bei 7 Spielern spielen Platz 5 und 6 gegeneinander. Der **Verlierer** dieses Spiels muss im **Verlierer-Final** gegen Platz 7 antreten. Bei 6 Spielern spielen 5 und 6 direkt das Verlierer-Final. Bei 8 Spielern gibt es zwei Verlierer-Halbfinals (5 gegen 8, 6 gegen 7), deren Verlierer das Verlierer-Final spielen. Bei 5 Spielern gibt es keine Verlierer-Runde.
- **Turnier-Verlierer** ist, wer das Verlierer-Final verliert (letzter Platz der Endrangliste).
- **Änderungen nach dem K.O.-Start:** K.O.-Ergebnisse gelten nur, solange dieselben zwei Spieler antreten. Sonst werden sie als veraltet markiert und müssen neu eingetragen werden.
- **Quoten:** Das Restturnier wird 1500-mal mit Poisson-verteilten Toren simuliert. Quote = 0.92 / Wahrscheinlichkeit. Vorjahre zählen schwächer als das laufende Turnier.

## Sicherheit

- PIN und Admin-Code werden nur als bcrypt-Hash gespeichert. Nach 5 Fehlversuchen in 10 Minuten wird gesperrt.
- Erstellen ist pro IP (5) und insgesamt (50) pro Tag begrenzt. Der Admin ist ausgenommen.
- Der Speicher liegt ausserhalb des Webroots (`../tm-private`). Ist das nicht möglich, liegt er in `public/data` mit Zugriffssperre.
- Fotos werden serverseitig neu als JPEG kodiert (max. 1200 px). Dabei fallen EXIF-Daten wie der Standort weg.

## Deployment (Hostinger)

1. `npm run build` erzeugt `dist/` (inklusive `api.php`, `.htaccess`, Icons, `sw.js`).
2. Den Inhalt von `dist/` nach `~/domains/turniermanager.urech.dev/public_html/` kopieren. **Den Ordner `data/` und `photos/*.jpg` nie überschreiben oder löschen.**
3. Einmalig den Admin-Code setzen: `php tools/set-admin.php ~/domains/turniermanager.urech.dev/tm-private` (Datei `tools/set-admin.php` vorher hochladen und danach löschen).
4. Prüfen: Startseite öffnen, Turnier anlegen, PIN testen, Foto hochladen.

Vor jedem Deployment ein Backup der alten Dateien auf dem Server anlegen (`cp -r public_html public_html_backup_DATUM`).
