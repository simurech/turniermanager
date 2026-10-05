<?php
declare(strict_types=1);

/**
 * Einrichtung: Admin-Code, App-Name, Untertitel, Farben und Fristen.
 *
 * Terminal (empfohlen):  php setup.php [speicherverzeichnis]
 * Browser:               setup.php hochladen, sofort aufrufen und danach vom Server löschen.
 *
 * Der Admin-Code wird nur als Hash gespeichert. Ist die Installation schon eingerichtet, verweigert das Skript
 * die Arbeit. Zum Ändern config.php bearbeiten (siehe README) oder die Datei löschen und neu einrichten.
 */

const SETUP_DEFAULTS = [
    'appName' => 'Turnier Manager',
    'subline' => '★ WER IST DER FIFA GOTT? ★',
    'colors' => ['red' => '#c8372d', 'ink' => '#1d2b53', 'paper' => '#f2e8cf', 'green' => '#2f6b3a', 'mustard' => '#e8a921'],
    'guestHours' => 48,
    'finishedHours' => 12,
    'repoUrl' => '',
];
const COLOR_LABELS = [
    'red' => 'Hauptfarbe (Titel, Buttons, Warnungen)',
    'ink' => 'Textfarbe und Rahmen (dunkel)',
    'paper' => 'Hintergrund (hell)',
    'green' => 'Zweitfarbe (Sieger, Bestätigen)',
    'mustard' => 'Akzentfarbe (Marker, Hervorhebungen)',
];

function storage_candidates(?string $given): array
{
    $list = [];
    foreach ([$given, getenv('TM_STORAGE') ?: null] as $c) {
        if (is_string($c) && $c !== '') {
            $list[] = $c;
        }
    }
    $list[] = dirname(__DIR__) . '/tm-private';
    $list[] = __DIR__ . '/data';
    return $list;
}

/** Erstes beschreibbares Speicherverzeichnis (wie api.php). Ausserhalb des Webroots wenn möglich. */
function find_storage(?string $given): ?string
{
    foreach (storage_candidates($given) as $dir) {
        if (!is_dir($dir)) {
            @mkdir($dir, 0750, true);
        }
        if (!is_dir($dir) || !is_writable($dir)) {
            continue;
        }
        if (str_starts_with($dir, __DIR__ . '/') && !is_file($dir . '/.htaccess')) {
            @file_put_contents($dir . '/.htaccess', "Require all denied\n");
        }
        foreach (['tournaments', 'ratelimit'] as $sub) {
            if (!is_dir("$dir/$sub")) {
                @mkdir("$dir/$sub", 0750, true);
            }
        }
        return $dir;
    }
    return null;
}

function is_configured(string $dir): bool
{
    $file = $dir . '/config.php';
    if (!is_file($file)) {
        return false;
    }
    $c = include $file;
    return is_array($c) && is_string($c['admin_hash'] ?? null) && $c['admin_hash'] !== '';
}

function normalize_color(string $value): ?string
{
    $v = ltrim(trim($value), '#');
    if (preg_match('/\A[0-9a-fA-F]{3}\z/', $v) === 1) {
        $v = $v[0] . $v[0] . $v[1] . $v[1] . $v[2] . $v[2];
    }
    return preg_match('/\A[0-9a-fA-F]{6}\z/', $v) === 1 ? '#' . strtolower($v) : null;
}

function luminance(string $hex): float
{
    $channel = static function (int $v): float {
        $c = $v / 255;
        return $c <= 0.03928 ? $c / 12.92 : (($c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * $channel((int) hexdec(substr($hex, 1, 2))) + 0.7152 * $channel((int) hexdec(substr($hex, 3, 2))) + 0.0722 * $channel((int) hexdec(substr($hex, 5, 2)));
}

function contrast(string $a, string $b): float
{
    [$hi, $lo] = [max(luminance($a), luminance($b)), min(luminance($a), luminance($b))];
    return ($hi + 0.05) / ($lo + 0.05);
}

/** Hinweise zu schlecht lesbaren Farbkombinationen. Sie verhindern nichts. */
function color_warnings(array $c): array
{
    $out = [];
    if (contrast($c['ink'], $c['paper']) < 4.5) {
        $out[] = 'Textfarbe und Hintergrund haben wenig Kontrast, der Text wird schwer lesbar.';
    }
    foreach (['red' => 'Hauptfarbe', 'green' => 'Zweitfarbe', 'ink' => 'Textfarbe'] as $key => $label) {
        if (contrast($c['paper'], $c[$key]) < 3) {
            $out[] = "Heller Text auf der $label ($c[$key]) ist schwer lesbar, die Buttons werden blass.";
        }
    }
    return $out;
}

/** Prüft die Eingaben. Gibt [bereinigte Werte, Fehlerliste] zurück. */
function clean_input(array $in): array
{
    $errors = [];
    $d = SETUP_DEFAULTS;
    $name = trim((string) ($in['appName'] ?? ''));
    $name = $name === '' ? $d['appName'] : $name;
    if (mb_strlen($name) > 40) {
        $errors[] = 'Der App-Name darf höchstens 40 Zeichen lang sein.';
    }
    $subline = trim((string) ($in['subline'] ?? $d['subline']));
    if (mb_strlen($subline) > 60) {
        $errors[] = 'Der Untertitel darf höchstens 60 Zeichen lang sein.';
    }
    $colors = [];
    foreach (COLOR_LABELS as $key => $label) {
        $raw = trim((string) ($in['colors'][$key] ?? ''));
        $c = $raw === '' ? $d['colors'][$key] : normalize_color($raw);
        if ($c === null) {
            $errors[] = "„$label“: bitte einen Farbwert wie #c8372d angeben.";
            $c = $d['colors'][$key];
        }
        $colors[$key] = $c;
    }
    $hours = [];
    foreach (['guestHours' => 'Gast-Turniere', 'finishedHours' => 'Abgeschlossene Turniere'] as $key => $label) {
        $raw = trim((string) ($in[$key] ?? ''));
        if ($raw === '') {
            $hours[$key] = $d[$key];
        } elseif (preg_match('/\A\d{1,5}\z/', $raw) === 1 && (int) $raw <= 24 * 365) {
            $hours[$key] = (int) $raw;
        } else {
            $errors[] = "$label: bitte eine ganze Zahl Stunden angeben (0 = nie).";
            $hours[$key] = $d[$key];
        }
    }
    $repo = trim((string) ($in['repoUrl'] ?? ''));
    if ($repo !== '' && preg_match('#\Ahttps://[^\s<>"\']{3,200}\z#', $repo) !== 1) {
        $errors[] = 'Der Link zum Quellcode muss mit https:// beginnen.';
        $repo = '';
    }
    $code = (string) ($in['adminCode'] ?? '');
    if (mb_strlen($code) < 12) {
        $errors[] = 'Der Admin-Code braucht mindestens 12 Zeichen.';
    }
    if (($in['adminCode2'] ?? $code) !== $code) {
        $errors[] = 'Die beiden Admin-Codes sind nicht gleich.';
    }
    return [['appName' => $name, 'subline' => $subline, 'colors' => $colors, 'guestHours' => $hours['guestHours'], 'finishedHours' => $hours['finishedHours'], 'repoUrl' => $repo, 'adminCode' => $code], $errors];
}

function write_config(string $dir, array $c): void
{
    $data = [
        'admin_hash' => password_hash($c['adminCode'], PASSWORD_BCRYPT),
        'appName' => $c['appName'],
        'subline' => $c['subline'],
        'colors' => $c['colors'],
        'guestHours' => $c['guestHours'],
        'finishedHours' => $c['finishedHours'],
        'repoUrl' => $c['repoUrl'],
    ];
    $file = $dir . '/config.php';
    $tmp = $file . '.tmp';
    umask(0077);
    if (file_put_contents($tmp, "<?php\nreturn " . var_export($data, true) . ";\n") === false) {
        throw new RuntimeException("Konnte $tmp nicht schreiben.");
    }
    chmod($tmp, 0600);
    if (!rename($tmp, $file)) {
        throw new RuntimeException("Konnte $file nicht speichern.");
    }
}

/** Ersetzt in einem Muster-Ersatztext Zeichen, die preg_replace sonst als Rückverweis liest. */
function literal(string $s): string
{
    return strtr($s, ['\\' => '\\\\', '$' => '\\$']);
}

/** Schreibt Name und Farben in site.webmanifest und index.html (falls im selben Ordner vorhanden). Gibt die Meldungen zurück. */
function patch_site(string $webroot, array $c, ?string $baseUrl): array
{
    $notes = [];
    $short = mb_strlen($c['appName']) <= 12 ? $c['appName'] : (explode(' ', $c['appName'])[0] ?: $c['appName']);
    $manifest = $webroot . '/site.webmanifest';
    if (is_file($manifest) && is_writable($manifest)) {
        $m = json_decode((string) file_get_contents($manifest), true);
        if (is_array($m)) {
            $m['name'] = $c['appName'];
            $m['short_name'] = $short;
            $m['theme_color'] = $c['colors']['ink'];
            $m['background_color'] = $c['colors']['paper'];
            file_put_contents($manifest, json_encode($m, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
            $notes[] = 'site.webmanifest aktualisiert.';
        }
    }
    $index = $webroot . '/index.html';
    if (is_file($index) && is_writable($index)) {
        $html = (string) file_get_contents($index);
        $esc = literal(htmlspecialchars($c['appName'], ENT_QUOTES));
        $html = preg_replace('#<title>.*?</title>#s', '<title>' . $esc . '</title>', $html) ?? $html;
        $html = preg_replace('#(<meta property="og:title" content=")[^"]*(")#', '${1}' . $esc . '${2}', $html) ?? $html;
        $html = preg_replace('#(<meta name="theme-color" content=")[^"]*(")#', '${1}' . $c['colors']['ink'] . '${2}', $html) ?? $html;
        if ($baseUrl !== null) {
            $image = literal(htmlspecialchars(rtrim($baseUrl, '/'), ENT_QUOTES)) . '/android-chrome-512x512.png';
            $html = preg_replace('#(<meta property="og:image" content=")[^"]*(")#', '${1}' . $image . '${2}', $html) ?? $html;
        }
        file_put_contents($index, $html);
        $notes[] = 'index.html aktualisiert.';
    }
    return $notes;
}

// ------------------------------------------------------------------ Terminal

function cli_ask(string $question, string $default = '', bool $secret = false): string
{
    fwrite(STDOUT, $question . ($default !== '' ? " [$default]" : '') . ': ');
    $tty = function_exists('stream_isatty') && stream_isatty(STDIN);
    if ($secret && $tty) {
        system('stty -echo 2>/dev/null');
    }
    $line = fgets(STDIN);
    if ($secret && $tty) {
        system('stty echo 2>/dev/null');
        fwrite(STDOUT, "\n");
    }
    $line = $line === false ? '' : trim($line);
    return $line === '' ? $default : $line;
}

function run_cli(array $argv): int
{
    $dir = find_storage($argv[1] ?? null);
    if ($dir === null) {
        fwrite(STDERR, "Kein beschreibbares Speicherverzeichnis gefunden. Gib eines an: php setup.php /pfad/zum/speicher\n");
        return 1;
    }
    if (is_configured($dir)) {
        fwrite(STDERR, "Schon eingerichtet ($dir/config.php). Zum Ändern die Datei bearbeiten oder löschen (siehe README).\n");
        return 1;
    }
    $d = SETUP_DEFAULTS;
    fwrite(STDOUT, "Einrichtung. Mit Enter übernimmst du den Wert in [Klammern].\nSpeicher: $dir\n\n");
    do {
        $in = ['adminCode' => cli_ask('Admin-Code (mind. 12 Zeichen, wird nicht angezeigt)', '', true)];
        $in['adminCode2'] = cli_ask('Admin-Code wiederholen', '', true);
        $in['appName'] = cli_ask('Name der App', $d['appName']);
        $in['subline'] = cli_ask('Untertitel auf der Startseite (- = keiner)', $d['subline']);
        if ($in['subline'] === '-') {
            $in['subline'] = '';
        }
        fwrite(STDOUT, "\nFarben als Hex-Wert (z. B. #c8372d):\n");
        foreach (COLOR_LABELS as $key => $label) {
            $in['colors'][$key] = cli_ask('  ' . $label, $d['colors'][$key]);
        }
        fwrite(STDOUT, "\nFristen in Stunden (0 = nie):\n");
        $in['guestHours'] = cli_ask('  Turniere von Gästen (ohne Admin-Code) löschen nach', (string) $d['guestHours']);
        $in['finishedHours'] = cli_ask('  Abgeschlossene Turniere für Gäste sichtbar', (string) $d['finishedHours']);
        $in['repoUrl'] = cli_ask('Link zum Quellcode (optional, wird Gästen als Hinweis zum Selbst-Hosten gezeigt)', '');
        $base = cli_ask('Adresse dieser Seite (z. B. https://turnier.example.ch, optional, für die Link-Vorschau)', '');
        [$clean, $errors] = clean_input($in);
        foreach ($errors as $e) {
            fwrite(STDERR, "  ✗ $e\n");
        }
        if ($errors) {
            if (!function_exists('stream_isatty') || !stream_isatty(STDIN)) {
                return 1;
            }
            fwrite(STDOUT, "\nBitte noch einmal.\n\n");
        }
    } while ($errors);
    foreach (color_warnings($clean['colors']) as $w) {
        fwrite(STDOUT, "  ⚠ $w\n");
    }
    write_config($dir, $clean);
    fwrite(STDOUT, "\nGespeichert: $dir/config.php\n");
    foreach (patch_site(getenv('TM_WEBROOT') ?: __DIR__, $clean, $base !== '' ? $base : null) as $n) {
        fwrite(STDOUT, "$n\n");
    }
    fwrite(STDOUT, "Fertig. Wenn setup.php auf einem Server liegt: jetzt löschen.\n");
    return 0;
}

// ------------------------------------------------------------------ Browser

function h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

function page(string $title, string $body): never
{
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex');
    echo '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' . h($title) . '</title>'
        . '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px 16px;color:#1d2b53}h1{font-size:24px}label{display:block;margin:14px 0 4px;font-weight:600}input{width:100%;padding:10px;font:inherit;border:2px solid #1d2b53;border-radius:6px;box-sizing:border-box}input[type=color]{padding:2px;height:44px}.row{display:grid;grid-template-columns:1fr 56px;gap:8px;align-items:end}small{color:#5d6685}.err{background:#fde8e6;border:2px solid #c8372d;padding:10px;border-radius:6px;margin:12px 0}.ok{background:#e4f3e7;border:2px solid #2f6b3a;padding:10px;border-radius:6px;margin:12px 0}.warn{background:#fff4d6;border:2px solid #e8a921;padding:10px;border-radius:6px;margin:12px 0}button{margin-top:22px;padding:12px 20px;font:inherit;font-weight:700;background:#c8372d;color:#fff;border:2px solid #1d2b53;border-radius:6px;cursor:pointer}</style>'
        . '</head><body>' . $body . '</body></html>';
    exit;
}

function run_web(): never
{
    $dir = find_storage(null);
    if ($dir === null) {
        http_response_code(500);
        page('Einrichtung', '<h1>Einrichtung nicht möglich</h1><p class="err">Kein beschreibbares Speicherverzeichnis gefunden. Der Ordner neben dem Webroot (<code>tm-private</code>) oder <code>data</code> muss für PHP beschreibbar sein.</p>');
    }
    if (is_configured($dir)) {
        http_response_code(403);
        page('Schon eingerichtet', '<h1>Schon eingerichtet</h1><p>Diese Installation ist fertig konfiguriert. <strong>Bitte lösche <code>setup.php</code> vom Server.</strong></p>');
    }
    $d = SETUP_DEFAULTS;
    $in = $_SERVER['REQUEST_METHOD'] === 'POST' ? $_POST : [];
    $errors = [];
    if ($in) {
        [$clean, $errors] = clean_input($in);
        if (!$errors) {
            try {
                write_config($dir, $clean);
            } catch (Throwable $e) {
                page('Einrichtung', '<h1>Fehler</h1><p class="err">' . h($e->getMessage()) . '</p>');
            }
            $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
            $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
            $base = preg_match('/\A[A-Za-z0-9.\-:]+\z/', $host) === 1 ? "$scheme://$host" : null;
            $notes = patch_site(__DIR__, $clean, $base);
            $warn = '';
            foreach (color_warnings($clean['colors']) as $w) {
                $warn .= '<div class="warn">⚠ ' . h($w) . '</div>';
            }
            $removed = @unlink(__FILE__);
            page('Fertig', '<h1>Fertig ✓</h1><div class="ok">Die Einrichtung ist gespeichert.</div>' . $warn . '<p>' . h(implode(' ', $notes)) . '</p>'
                . ($removed ? '<p><code>setup.php</code> wurde automatisch gelöscht.</p>' : '<p class="err"><strong>Bitte lösche <code>setup.php</code> jetzt vom Server</strong> (es konnte nicht automatisch entfernt werden).</p>')
                . '<p><a href="/">Zur App</a> · Mit dem Admin-Code meldest du dich auf der Startseite ganz unten an.</p>');
        }
    }
    $val = static fn(string $k, string $def = '') => h((string) ($in[$k] ?? $def));
    $color = static function (string $key, string $label) use ($in, $d): string {
        $v = h((string) ($in['colors'][$key] ?? $d['colors'][$key]));
        return '<label for="c-' . $key . '">' . h($label) . '</label><div class="row"><input id="c-' . $key . '" name="colors[' . $key . ']" value="' . $v . '" pattern="#?[0-9a-fA-F]{3,6}" aria-label="' . h($label) . ' als Hex-Wert">'
            . '<input type="color" value="' . $v . '" aria-hidden="true" tabindex="-1" oninput="document.getElementById(\'c-' . $key . '\').value=this.value"></div>';
    };
    $body = '<h1>Einrichtung</h1><p>Lege den Admin-Code fest und passe die App an. Alles lässt sich später in <code>config.php</code> ändern.</p>';
    foreach ($errors as $e) {
        $body .= '<div class="err">' . h($e) . '</div>';
    }
    $body .= '<form method="post" autocomplete="off">'
        . '<label for="ac">Admin-Code (mindestens 12 Zeichen)</label><input id="ac" type="password" name="adminCode" minlength="12" required>'
        . '<label for="ac2">Admin-Code wiederholen</label><input id="ac2" type="password" name="adminCode2" minlength="12" required>'
        . '<label for="an">Name der App</label><input id="an" name="appName" maxlength="40" value="' . $val('appName', $d['appName']) . '">'
        . '<label for="sl">Untertitel auf der Startseite</label><input id="sl" name="subline" maxlength="60" value="' . $val('subline', $d['subline']) . '"><small>Leer lassen für keinen Untertitel.</small>';
    foreach (COLOR_LABELS as $key => $label) {
        $body .= $color($key, $label);
    }
    $body .= '<label for="gh">Turniere von Gästen löschen nach (Stunden, 0 = nie)</label><input id="gh" name="guestHours" inputmode="numeric" value="' . $val('guestHours', (string) $d['guestHours']) . '"><small>Gäste sind alle ohne Admin-Code. Deine eigenen Turniere bleiben immer.</small>'
        . '<label for="fh">Abgeschlossene Turniere für Gäste sichtbar (Stunden, 0 = nie)</label><input id="fh" name="finishedHours" inputmode="numeric" value="' . $val('finishedHours', (string) $d['finishedHours']) . '">'
        . '<label for="ru">Link zum Quellcode (optional)</label><input id="ru" name="repoUrl" type="url" placeholder="https://github.com/…" value="' . $val('repoUrl') . '"><small>Wird Gästen als Hinweis zum Selbst-Hosten gezeigt.</small>'
        . '<button type="submit">Einrichten</button></form>';
    page('Einrichtung', $body);
}

if (PHP_SAPI === 'cli') {
    if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
        exit(run_cli($argv));
    }
} else {
    run_web();
}
