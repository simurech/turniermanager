# Turnier Manager

Webapp für das jährliche Fussball-Turnier (zum Beispiel FIFA mit Freunden): Spielplan, Tabelle, K.O.-Runde, Siegerfoto, Archiv, Statistik, Computer-Tipps und Wettquoten. Smartphone zuerst, installierbar (PWA), mit TV-Ansicht.

Live-Beispiel: <https://turniermanager.urech.dev>

- **Frontend:** Vite + React 18, reines CSS (Retro-Fussball-Design).
- **Backend:** eine PHP-Datei (`public/api.php`), Turniere liegen als JSON-Dateien im Speicherordner. **Keine Datenbank.**
- **Zugriff:** Jedes Turnier hat einen 4-stelligen PIN zum Eintragen (24 h auf dem Gerät gemerkt). Dazu gibt es einen globalen **Admin-Code** (30 Tage gemerkt). Zuschauen geht ohne alles.

## Admin und Gäste

| | Admin (mit Admin-Code) | Gast (ohne Admin-Code) |
| --- | --- | --- |
| Turnier erstellen | ja, keine Begrenzung | ja, 5 pro Tag und Adresse |
| Aufbewahrung | für immer | wird nach **48 Stunden gelöscht** (einstellbar) |
| Vorjahr als Basis | direkt aus der Liste | über die **Export-Datei** des letzten Turniers |
| Turniere bearbeiten, PIN anzeigen, löschen | ja | nein |

Gäste sehen bei der Erstellung, wann ihr Turnier gelöscht wird. Nach dem Abschluss bietet die App den **Export** an (Datei zum Wiederimportieren, dazu die Ergebnisse als Text). Beim nächsten Turnier importiert der Gast die Datei und bekommt Spieler, Statistik, Tipps und Quoten wieder. Die Datei enthält auch die früheren Jahre (bis zu 5 Turniere).

Wer seine Turniere dauerhaft behalten will, hostet die App selbst und ist dann Admin. Das geht mit jedem Webhosting mit PHP (siehe unten).

## Selbst hosten

**Voraussetzungen:** Webhosting mit **PHP 8.1 oder neuer** (mit `gd`-Erweiterung, Apache mit `mod_rewrite`, z. B. jedes normale Shared Hosting) und eine eigene (Sub-)Domain mit HTTPS. Ein Betrieb in einem Unterordner (`example.ch/turnier/`) wird nicht unterstützt.

1. **Fertige Version holen.** Am einfachsten ohne Node.js: auf der Seite [Releases](https://github.com/simurech/turniermanager/releases) das ZIP der neuesten Version herunterladen und entpacken. Oder selbst bauen (einmalig **Node.js 18+** auf deinem Rechner):
   ```bash
   git clone https://github.com/simurech/turniermanager.git && cd turniermanager
   npm ci
   npm run build        # erzeugt dist/
   ```
2. **Hochladen:** den **Inhalt** des ZIPs bzw. von `dist/` in den Webroot der (Sub-)Domain kopieren (inklusive der versteckten Datei `.htaccess`).
3. **Einrichten** (einmalig). Entweder im Terminal auf dem Server (empfohlen):
   ```bash
   cd /pfad/zum/webroot
   php setup.php
   ```
   oder im Browser: `https://deine-domain/setup.php` aufrufen, Formular ausfüllen. Das Skript löscht sich danach selbst. **Ruf die Seite sofort nach dem Hochladen auf**, bis zur Einrichtung kann sie jeder ausfüllen.
4. Fertig. Auf der Startseite ganz unten mit dem Admin-Code anmelden und ein Turnier erstellen.

Das Skript fragt:

| Frage | Bedeutung |
| --- | --- |
| Admin-Code | Mindestens 12 Zeichen. Wird nur als Hash gespeichert. |
| Name der App | Erscheint auf der Startseite, im Browser-Tab und bei der Installation auf dem Handy. |
| Untertitel | Zeile unter dem Namen. Leer lassen für keinen. |
| Fünf Farben | Haupt-, Text-/Rahmen-, Hintergrund-, Zweit- und Akzentfarbe. Alle anderen Töne (Karten, Tabellenzeilen, Rahmen) werden daraus abgeleitet. Bei schlecht lesbaren Kombinationen warnt das Skript. |
| Fristen | Nach wie vielen Stunden Gast-Turniere gelöscht werden und wie lange abgeschlossene Turniere für Gäste sichtbar bleiben. `0` = nie. |
| Link zum Quellcode | Optional. Wird Gästen bei der Erstellung als Hinweis zum Selbst-Hosten gezeigt. |

### Einstellungen später ändern

Die Einstellungen stehen in `config.php` im Speicherordner (standardmässig `tm-private/` **neben** dem Webroot, sonst `data/`). Die Datei lässt sich von Hand bearbeiten, die Änderungen gelten sofort:

```php
<?php
return [
    'admin_hash'    => '$2y$10$…',            // nicht von Hand ändern, stattdessen config.php löschen und setup.php erneut ausführen
    'appName'       => 'Turnier Manager',
    'subline'       => '★ WER IST DER FIFA GOTT? ★',
    'colors'        => ['red' => '#c8372d', 'ink' => '#1d2b53', 'paper' => '#f2e8cf', 'green' => '#2f6b3a', 'mustard' => '#e8a921'],
    'guestHours'    => 48,                    // Gast-Turniere löschen nach N Stunden (0 = nie)
    'finishedHours' => 12,                    // abgeschlossene Turniere für Gäste sichtbar (0 = immer)
    'repoUrl'       => '',                    // optional
];
```

Fehlt ein Wert oder ist er ungültig, gilt der Standardwert. Den Namen im Browser-Tab und in `site.webmanifest` schreibt das Einrichtungsskript in `index.html` und `site.webmanifest`. Ändert man den Namen später von Hand, dort auch anpassen. Den Admin-Code ändert man, indem man `config.php` löscht und `setup.php` neu hochlädt und ausführt.

### Aktualisieren

Neue Version bauen und den Inhalt von `dist/` erneut hochladen. **Den Speicherordner (`tm-private/`) und `photos/*.jpg` nie überschreiben oder löschen**, dort liegen alle Turniere und die Einstellungen. Name und Farben der App stammen aus `config.php` und bleiben deshalb erhalten. Nur `index.html` und `site.webmanifest` werden überschrieben und zeigen danach wieder den Standardnamen im Seitentitel und bei der Installation auf dem Handy. Trage dort den Namen von Hand wieder ein oder führe `php setup.php /pfad/zum/speicher` nach dem Löschen von `config.php` erneut aus. Vor jedem Update ein Backup des Webroots und des Speicherordners anlegen.

## Neue Version veröffentlichen

Ein Tag wie `v2.1.0` auf `main` löst die GitHub Action aus (`.github/workflows/release.yml`). Sie führt die Tests aus, baut die App und hängt das fertige ZIP an die Veröffentlichung. Bei jedem Push läuft ausserdem `ci.yml` mit Tests und Build.

```bash
git tag v2.1.0 && git push origin v2.1.0
```

## Entwicklung

```bash
npm install
mkdir -p /tmp/tm && TM_STORAGE=/tmp/tm php -S 127.0.0.1:8000 -t public   # API (Terminal 1)
npm run dev                                                               # App auf http://127.0.0.1:5173 (Terminal 2)
php public/setup.php /tmp/tm                                              # Admin-Code und Einstellungen für die Entwicklung
```

## Tests

```bash
npm test            # Unit-Tests (Logik, Statistik, Export, Konfiguration) und API-Tests (PHP-Server mit temporärem Speicher)
npm run test:unit   # nur die Unit-Tests
```

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `src/lib/tournament.js` | Spielplan, Tabelle, K.O.-Runde, Endrangliste und alle Änderungen (`applyOp`) |
| `src/lib/stats.js` | Form, Computer-Tipp, Direktvergleich, Wettquoten (Simulation), Ewige Tabelle |
| `src/lib/sync.js` | Laden, Polling, Speichern, Konflikte (Änderungen werden auf den neuen Serverstand gelegt) |
| `src/lib/auth.js` | PIN (24 h) und Admin-Code (30 Tage) auf dem Gerät |
| `src/lib/config.js` | Name, Untertitel, Farben und Fristen der Installation (vom Server, auf dem Gerät gemerkt) |
| `src/lib/exportFile.js` | Export und Import eines abgeschlossenen Turniers als Datei |
| `src/components/` | Oberfläche: Start, Erstellen, Turnier, Statistik, Abschluss, TV-Ansicht |
| `public/api.php` | API: `config`, `list`, `load`, `create`, `update`, `verify`, `photo`, Admin-Aktionen |
| `public/setup.php` | Einrichtung (Terminal oder Browser), sperrt sich nach der Einrichtung |
| `public/sw.js`, `public/site.webmanifest` | Offline-Hülle und App-Installation |
| `design-mockups/` | Die beiden Design-Entwürfe (Retro und Stadion) |

## Spielregeln im Code

- **Tabelle:** 3 Punkte pro Sieg, 1 pro Remis. Bei Punktgleichheit entweder Tordifferenz oder direkter Vergleich (Mini-Tabelle), danach Tore, Gegentore, Siege, Niederlagen und die Eingabereihenfolge.
- **K.O.:** Halbfinale 1 gegen 4 und 2 gegen 3, Finale, optional Spiel um Platz 3. Unentschieden gibt es im K.O. nicht.
- **Verlierer-Runde** (Plätze 5 bis n der Gruppentabelle): Bei 7 Spielern spielen Platz 5 und 6 gegeneinander. Der **Verlierer** dieses Spiels muss im **Verlierer-Final** gegen Platz 7 antreten. Bei 6 Spielern spielen 5 und 6 direkt das Verlierer-Final. Bei 8 Spielern gibt es zwei Verlierer-Halbfinals (5 gegen 8, 6 gegen 7), deren Verlierer das Verlierer-Final spielen. Bei 5 Spielern gibt es keine Verlierer-Runde.
- **Turnier-Verlierer** ist, wer das Verlierer-Final verliert (letzter Platz der Endrangliste).
- **Änderungen nach dem K.O.-Start:** K.O.-Ergebnisse gelten nur, solange dieselben zwei Spieler antreten. Sonst werden sie als veraltet markiert und müssen neu eingetragen werden.
- **Quoten:** Das Restturnier wird 1500-mal mit Poisson-verteilten Toren simuliert. Quote = 0.92 / Wahrscheinlichkeit. Vorjahre zählen schwächer als das laufende Turnier.

## Turnier nachträglich bearbeiten (Admin)

Der Admin sieht auf der Turnierseite „✏️ Bearbeiten“. Dort lassen sich Turnier-, Spieler- und Teamnamen ändern, die Marker (👑 amtierender Meister, 🥈 Zweiter, 🍋 Verlierer) setzen und die Regeln anpassen: „Bei Punktgleichheit“ bis zum Abschluss, „Spiel um Platz 3“ nur vor dem Start der K.O.-Runde. Die Rückrunde lässt sich in der Gruppenphase nachträglich ergänzen (die Rückspiele werden angehängt, bisherige Ergebnisse bleiben, nicht rückgängig zu machen). Spieleranzahl und Fernseher stehen mit dem Spielplan fest. Die Änderungen laufen als Operationen (`rename`, `renamePlayer`, `setMarkers`, `setConfig`) durch dieselbe Speicherung wie Ergebnisse.

## Sicherheit

- Der Admin-Code wird nur als bcrypt-Hash gespeichert. Der Turnier-PIN steht lesbar im privaten Speicher, damit der Admin ihn jederzeit abrufen kann (`get_pin`). Er wird nie an Besucher ausgeliefert.
- Fehlversuche werden pro Besucher-Adresse und pro Turnier gezählt (10 in 10 Minuten, 30 pro Tag, 100 pro Tag insgesamt). Die Zählung ist atomar, gleichzeitige Anfragen umgehen sie nicht. Ein neuer PIN hebt die Sperre auf.
- Erstellen ist pro Adresse (5) und insgesamt (50) pro Tag begrenzt. Der Admin ist ausgenommen. Gezählt wird die echte Adresse (`REMOTE_ADDR`), `X-Forwarded-For` wird ignoriert.
- Leere Turniere (nie ein Ergebnis eingetragen) werden nach 60 Tagen aufgeräumt.
- Turniere von Gästen tragen ein Ablaufdatum (`expiresAt`, standardmässig 48 Stunden nach der Erstellung). Danach liefert der Server sie nicht mehr aus und löscht sie samt Foto beim nächsten Aufräumen (höchstens alle 5 Minuten). Turniere des Admins haben keins. Die Frist lässt sich für Tests mit `TM_GUEST_HOURS` überschreiben.
- Gäste übernehmen ein früheres Turnier nur über die Export-Datei. Deren Inhalt wird serverseitig geprüft (höchstens 5 abgeschlossene Turniere, nur bekannte Felder) und im neuen Turnier als `history` gespeichert. Sie betrifft nur Statistik und Tipps dieses einen Turniers.
- Abgeschlossene Turniere sind für Gäste standardmässig 12 Stunden nach dem Abschluss in der Liste sichtbar (`finishedAt`), danach nur noch für den Admin. Der Admin blendet sie mit „Einblenden“ wieder dauerhaft ein (`pinned`). Ein erneuter Abschluss startet die 12 Stunden neu. Über den Link bleibt ein ausgeblendetes Turnier erreichbar. Die Dauer lässt sich für Tests mit `TM_FINISHED_HOURS` ändern.
- Der Speicher liegt ausserhalb des Webroots (`../tm-private`). Ist das nicht möglich, liegt er in `public/data` mit Zugriffssperre.
- Fotos werden serverseitig neu als JPEG kodiert (max. 1200 px). Dabei fallen EXIF-Daten wie der Standort weg.

## Lizenz

[MIT](LICENSE). Du darfst den Code frei nutzen, ändern und selbst hosten.
