<?php
declare(strict_types=1);

/**
 * Turnier Manager API.
 *
 * Lesen ist öffentlich (list, load). Schreiben braucht den Turnier-PIN (Header X-Pin)
 * oder den globalen Admin-Code (Header X-Admin). Der Speicher liegt wenn möglich
 * ausserhalb des Webroots (../tm-private), sonst in ./data mit Zugriffssperre.
 *
 * Fehler werden nie als PHP-Text ausgegeben, sondern geloggt und als JSON gemeldet.
 */

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);
date_default_timezone_set('Europe/Zurich');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');

set_error_handler(static function (int $no, string $message, string $file, int $line): bool {
    error_log("api.php [$no] $message in $file:$line");
    return true; // Warnungen werden geloggt und nie in die Antwort geschrieben
});
set_exception_handler(static function (Throwable $e): void {
    error_log('api.php exception: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        http_response_code(500);
    }
    echo json_encode(['error' => 'Interner Fehler. Bitte erneut versuchen.']);
});
register_shutdown_function(static function (): void {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        error_log("api.php fatal: {$e['message']} in {$e['file']}:{$e['line']}");
        if (!headers_sent()) {
            http_response_code(500);
        }
        echo json_encode(['error' => 'Interner Fehler. Bitte erneut versuchen.']);
    }
});

const ID_ALPHABET = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789';
const MAX_BODY_BYTES = 262144;
const MAX_PHOTO_BYTES = 1500000;
const MAX_PHOTO_PIXELS = 16000000;
const MAX_PHOTO_SIDE = 8000;
const EMPTY_TOURNAMENT_DAYS = 60;
const PHASES = ['setup', 'group', 'knockout', 'finished'];
const DATA_KEYS = ['name', 'config', 'players', 'matches', 'standings', 'knockoutMatches', 'phase', 'winner', 'loser'];

/** Grenzen für Fehlversuche: pro Adresse in 10 Minuten, pro Adresse und Tag, insgesamt pro Tag. */
const PIN_LIMITS = ['ip10' => 10, 'ipDay' => 30, 'allDay' => 100];
const ADMIN_LIMITS = ['ip10' => 8, 'ipDay' => 40, 'allDay' => 200];

/** Grenzwerte lassen sich für Tests über Umgebungsvariablen anheben. */
function env_limit(string $name, int $default): int
{
    $value = getenv($name);
    return ($value !== false && ctype_digit($value)) ? (int) $value : $default;
}

/** Wie lange ein Turnier eines Gasts (ohne Admin-Code) erhalten bleibt (Sekunden). */
function guest_seconds(): int
{
    return env_limit('TM_GUEST_HOURS', app_config()['guestHours']) * 3600;
}

/** Ob ein Gast-Turnier abgelaufen ist. Turniere des Admins haben kein Ablaufdatum. */
function is_expired(array $t): bool
{
    if (empty($t['expiresAt'])) {
        return false;
    }
    $until = strtotime((string) $t['expiresAt']);
    return $until !== false && $until <= time();
}

/** Wie lange ein abgeschlossenes Turnier für Gäste sichtbar bleibt (Sekunden). */
function finished_visible_seconds(): int
{
    return env_limit('TM_FINISHED_HOURS', app_config()['finishedHours']) * 3600;
}

/** Zeitpunkt, bis zu dem ein abgeschlossenes Turnier für Gäste sichtbar ist, sonst null (unbegrenzt oder nicht abgeschlossen). */
function visible_until(array $t): ?int
{
    if (($t['phase'] ?? '') !== 'finished' || !empty($t['pinned']) || finished_visible_seconds() === 0) {
        return null; // 0 Stunden = nie ausblenden
    }
    $since = strtotime((string) ($t['finishedAt'] ?? $t['updatedAt'] ?? ''));
    return $since === false ? null : $since + finished_visible_seconds();
}

/** Ob das Turnier in der öffentlichen Liste erscheint: nicht manuell versteckt und, wenn abgeschlossen, nicht länger als 12 Stunden her. */
function is_public(array $t): bool
{
    if (!empty($t['hidden'])) {
        return false;
    }
    $until = visible_until($t);
    return $until === null || time() < $until;
}

function fail(int $status, string $message, array $extra = []): never
{
    http_response_code($status);
    echo json_encode(['error' => $message] + $extra, JSON_UNESCAPED_UNICODE);
    exit;
}

function respond(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

// ---------------------------------------------------------------- Speicher

function storage_dir(): string
{
    static $dir = null;
    if ($dir !== null) {
        return $dir;
    }
    $candidates = [];
    if (($env = getenv('TM_STORAGE')) !== false && $env !== '') {
        $candidates[] = $env;
    }
    $candidates[] = dirname(__DIR__) . '/tm-private';
    $candidates[] = __DIR__ . '/data';

    foreach ($candidates as $candidate) {
        if (!is_dir($candidate)) {
            @mkdir($candidate, 0750, true);
        }
        if (!is_dir($candidate) || !is_writable($candidate)) {
            continue;
        }
        if (str_starts_with($candidate, __DIR__ . '/') && !file_exists($candidate . '/.htaccess')) {
            @file_put_contents($candidate . '/.htaccess', "Require all denied\n");
        }
        foreach (['tournaments', 'ratelimit'] as $sub) {
            if (!is_dir("$candidate/$sub")) {
                @mkdir("$candidate/$sub", 0750, true);
            }
            if (!is_dir("$candidate/$sub") || !is_writable("$candidate/$sub")) {
                continue 2;
            }
        }
        return $dir = $candidate;
    }
    fail(500, 'Speicherverzeichnis nicht beschreibbar');
}

function photo_dir(): string
{
    $dir = getenv('TM_PHOTOS') ?: __DIR__ . '/photos';
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    return $dir;
}

function with_lock(callable $fn): mixed
{
    $handle = fopen(storage_dir() . '/.lock', 'c');
    if ($handle === false || !flock($handle, LOCK_EX)) {
        fail(500, 'Sperre fehlgeschlagen');
    }
    try {
        return $fn();
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

function tournament_path(string $id): string
{
    return storage_dir() . "/tournaments/$id.json";
}

function valid_id(mixed $id): bool
{
    return is_string($id) && preg_match('/\A[A-NP-Z2-9]{6}\z/', $id) === 1;
}

function read_tournament(string $id): ?array
{
    $path = tournament_path($id);
    if (!is_file($path)) {
        return null;
    }
    $raw = file_get_contents($path);
    $doc = $raw === false ? null : json_decode($raw, true);
    if (!is_array($doc)) {
        error_log("api.php: Turnierdatei $id ist unlesbar oder beschädigt");
        fail(500, 'Turnierdatei konnte nicht gelesen werden');
    }
    return is_expired($doc) ? null : $doc; // abgelaufene Gast-Turniere gelten als gelöscht, auch bevor sie aufgeräumt sind
}

function write_tournament(array $doc): void
{
    $path = tournament_path($doc['id']);
    $tmp = $path . '.tmp';
    $json = json_encode($doc, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    if ($json === false || file_put_contents($tmp, $json) === false || !rename($tmp, $path)) {
        @unlink($tmp);
        fail(500, 'Fehler beim Speichern');
    }
}

function generate_id(): string
{
    do {
        $id = '';
        for ($i = 0; $i < 6; $i++) {
            $id .= ID_ALPHABET[random_int(0, strlen(ID_ALPHABET) - 1)];
        }
    } while (file_exists(tournament_path($id)));
    return $id;
}

function generate_pin(): string
{
    return str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT);
}

// ---------------------------------------------------------------- Rate-Limit

/** Führt $fn mit dem Inhalt einer Rate-Limit-Datei unter exklusiver Sperre aus und speichert die Änderungen. */
function rate_update(string $name, callable $fn): mixed
{
    $path = storage_dir() . '/ratelimit/' . preg_replace('/[^A-Za-z0-9_-]/', '_', $name) . '.json';
    $handle = fopen($path, 'c+');
    if ($handle === false || !flock($handle, LOCK_EX)) {
        error_log("api.php: Rate-Limit-Datei $name nicht beschreibbar");
        fail(500, 'Speicher nicht beschreibbar');
    }
    try {
        $raw = stream_get_contents($handle);
        $state = $raw ? json_decode($raw, true) : [];
        if (!is_array($state)) {
            $state = [];
        }
        $result = $fn($state);
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($state));
        fflush($handle);
        return $result;
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

/** @param list<array{0:int,1:string}> $entries */
function prune_entries(array $entries, int $now, int $window): array
{
    return array_values(array_filter($entries, static fn($e) => is_array($e) && ($e[0] ?? 0) > $now - $window));
}

function client_ip(): string
{
    // Auf dem Hosting ist REMOTE_ADDR die echte Adresse. X-Forwarded-For ist fälschbar und wird ignoriert.
    return (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
}

function ip_key(): string
{
    return substr(sha1(client_ip()), 0, 16);
}

/**
 * Prüft Zugangsdaten mit Fehlversuch-Zähler. Der Versuch wird vor der Prüfung gezählt (atomar unter Sperre),
 * damit gleichzeitige Anfragen das Limit nicht umgehen können. Bei Erfolg wird er wieder abgezogen.
 */
function guarded_check(string $file, array $limits, callable $verify): bool
{
    $ip = ip_key();
    $token = bin2hex(random_bytes(6));
    $wait = rate_update($file, static function (array &$s) use ($ip, $limits, $token): int {
        $now = time();
        $s['all'] = prune_entries($s['all'] ?? [], $now, 86400);
        foreach (($s['ips'] ?? []) as $key => $list) {
            $s['ips'][$key] = prune_entries($list, $now, 86400);
            if (!$s['ips'][$key]) {
                unset($s['ips'][$key]);
            }
        }
        $mine = $s['ips'][$ip] ?? [];
        $recent = array_values(array_filter($mine, static fn($e) => $e[0] > $now - 600));
        $wait = 0;
        if (count($recent) >= $limits['ip10']) {
            $wait = max($wait, min(array_column($recent, 0)) + 600 - $now);
        }
        if (count($mine) >= $limits['ipDay']) {
            $wait = max($wait, min(array_column($mine, 0)) + 86400 - $now);
        }
        if (count($s['all']) >= $limits['allDay']) {
            $wait = max($wait, min(array_column($s['all'], 0)) + 86400 - $now);
        }
        if ($wait > 0) {
            return $wait;
        }
        $s['ips'][$ip][] = [$now, $token];
        $s['all'][] = [$now, $token];
        return 0;
    });
    if ($wait > 0) {
        header("Retry-After: $wait");
        fail(429, 'Zu viele Fehlversuche. Bitte später erneut versuchen.', ['retryAfter' => $wait]);
    }
    $ok = (bool) $verify();
    if ($ok) {
        rate_update($file, static function (array &$s) use ($ip, $token): void {
            $drop = static fn(array $list): array => array_values(array_filter($list, static fn($e) => ($e[1] ?? '') !== $token));
            $s['all'] = $drop($s['all'] ?? []);
            if (isset($s['ips'][$ip])) {
                $s['ips'][$ip] = $drop($s['ips'][$ip]);
            }
        });
    }
    return $ok;
}

/** Zählt ein neues Turnier. Gibt die Wartezeit in Sekunden zurück, 0 wenn erlaubt. */
function create_slot(): int
{
    $perIp = env_limit('TM_CREATE_PER_IP', 5);
    $global = env_limit('TM_CREATE_GLOBAL', 50);
    $ip = ip_key();
    return rate_update('create', static function (array &$s) use ($ip, $perIp, $global): int {
        $now = time();
        $s['all'] = prune_entries($s['all'] ?? [], $now, 86400);
        foreach (($s['ips'] ?? []) as $key => $list) {
            $s['ips'][$key] = prune_entries($list, $now, 86400);
            if (!$s['ips'][$key]) {
                unset($s['ips'][$key]);
            }
        }
        $mine = $s['ips'][$ip] ?? [];
        $wait = 0;
        if (count($mine) >= $perIp) {
            $wait = max($wait, min(array_column($mine, 0)) + 86400 - $now);
        }
        if (count($s['all']) >= $global) {
            $wait = max($wait, min(array_column($s['all'], 0)) + 86400 - $now);
        }
        if ($wait > 0) {
            return $wait;
        }
        $s['ips'][$ip][] = [$now, ''];
        $s['all'][] = [$now, ''];
        return 0;
    });
}

// ---------------------------------------------------------------- Auth

function admin_hash(): ?string
{
    $file = storage_dir() . '/config.php';
    if (!is_file($file)) {
        return null;
    }
    $config = include $file;
    return is_array($config) && is_string($config['admin_hash'] ?? null) ? $config['admin_hash'] : null;
}

const DEFAULT_COLORS = ['paper' => '#f2e8cf', 'ink' => '#1d2b53', 'red' => '#c8372d', 'green' => '#2f6b3a', 'mustard' => '#e8a921'];

/**
 * Einstellungen aus config.php (vom Einrichtungsskript geschrieben) mit Standardwerten. Fehlt ein Wert oder ist er ungültig,
 * gilt der Standard. So läuft die App auch mit einer alten config.php, die nur den Admin-Hash enthält.
 */
function app_config(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }
    $file = storage_dir() . '/config.php';
    $raw = is_file($file) ? include $file : [];
    $raw = is_array($raw) ? $raw : [];
    $text = static fn(mixed $v, string $default, int $max): string => is_string($v) && trim($v) !== '' && mb_strlen($v) <= $max ? trim($v) : $default;
    $hours = static fn(mixed $v, int $default): int => is_int($v) && $v >= 0 && $v <= 24 * 365 ? $v : $default;
    $colors = [];
    foreach (DEFAULT_COLORS as $name => $default) {
        $v = $raw['colors'][$name] ?? null;
        $colors[$name] = is_string($v) && preg_match('/\A#[0-9a-fA-F]{6}\z/', $v) === 1 ? strtolower($v) : $default;
    }
    $repo = $raw['repoUrl'] ?? '';
    return $cfg = [
        'appName' => $text($raw['appName'] ?? null, 'Turnier Manager', 40),
        'subline' => is_string($raw['subline'] ?? null) && mb_strlen($raw['subline']) <= 60 ? trim($raw['subline']) : '★ WER IST DER FIFA GOTT? ★',
        'colors' => $colors,
        'guestHours' => $hours($raw['guestHours'] ?? null, 48),
        'finishedHours' => $hours($raw['finishedHours'] ?? null, 12),
        'repoUrl' => is_string($repo) && preg_match('#\Ahttps://[^\s<>"\']{3,200}\z#', $repo) === 1 ? $repo : '',
    ];
}

function verify_pin(array $t, string $pin): bool
{
    if (is_string($t['pin'] ?? null)) {
        return hash_equals($t['pin'], $pin);
    }
    // ältere Turniere ohne lesbaren PIN
    return is_string($t['pinHash'] ?? null) && password_verify($pin, $t['pinHash']);
}

/** Ändert sich, sobald der PIN eines Turniers neu gesetzt wird. */
function pin_fingerprint(array $t): string
{
    return ($t['pin'] ?? '') . '|' . ($t['pinHash'] ?? '');
}

function check_pin(array $t, string $pin): bool
{
    return guarded_check('pin-' . $t['id'], PIN_LIMITS, static fn() => preg_match('/\A\d{4}\z/', $pin) === 1 && verify_pin($t, $pin));
}

function check_admin(string $code): bool
{
    return guarded_check('admin', ADMIN_LIMITS, static function () use ($code): bool {
        $hash = admin_hash();
        return $hash !== null && password_verify($code, $hash);
    });
}

/**
 * Prüft die mitgesendeten Zugangsdaten. Gibt 'admin', 'pin' oder null zurück (null = nichts mitgesendet).
 * Ist nichts davon gültig, endet die Anfrage mit 403. Ein gültiger PIN macht einen veralteten Admin-Code
 * unschädlich, weil der PIN zuerst geprüft wird (ausser $adminFirst).
 * $t = null prüft nur den Admin-Code.
 */
function authenticate(?array $t, bool $adminFirst = false): ?string
{
    $admin = (string) ($_SERVER['HTTP_X_ADMIN'] ?? '');
    $pin = (string) ($_SERVER['HTTP_X_PIN'] ?? '');
    $tryPin = $t !== null && $pin !== '';
    $tryAdmin = $admin !== '';
    if (!$tryPin && !$tryAdmin) {
        return null;
    }
    foreach ($adminFirst ? ['admin', 'pin'] : ['pin', 'admin'] as $kind) {
        if ($kind === 'pin' && $tryPin && check_pin($t, $pin)) {
            return 'pin';
        }
        if ($kind === 'admin' && $tryAdmin && check_admin($admin)) {
            return 'admin';
        }
    }
    fail(403, 'Falscher PIN oder Admin-Code');
}

function require_role(array $t, bool $adminOnly = false): string
{
    $role = authenticate($t, $adminOnly);
    if ($role === null) {
        fail(401, $adminOnly ? 'Admin-Code erforderlich' : 'PIN erforderlich');
    }
    if ($adminOnly && $role !== 'admin') {
        fail(403, 'Nur mit Admin-Code erlaubt');
    }
    return $role;
}

// ---------------------------------------------------------------- Eingaben

function read_body(): array
{
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
    if ($raw === false || strlen($raw) > MAX_BODY_BYTES) {
        fail(413, 'Anfrage zu gross');
    }
    $data = json_decode($raw, true, 16);
    if (!is_array($data)) {
        fail(400, 'Ungültiges JSON');
    }
    return $data;
}

function check_value(mixed $value, int $depth = 0): void
{
    if ($depth > 8) {
        fail(400, 'Daten zu tief verschachtelt');
    }
    if (is_string($value)) {
        if (mb_strlen($value) > 120 || str_contains($value, "\0")) {
            fail(400, 'Text zu lang oder ungültig');
        }
    } elseif (is_array($value)) {
        if (count($value) > 300) {
            fail(400, 'Liste zu lang');
        }
        foreach ($value as $key => $item) {
            if (is_string($key) && preg_match('/\A[A-Za-z0-9_\-]{1,40}\z/', $key) !== 1) {
                fail(400, 'Ungültiger Feldname');
            }
            check_value($item, $depth + 1);
        }
    } elseif (is_float($value) && !is_finite($value)) {
        fail(400, 'Ungültige Zahl');
    } elseif (!is_int($value) && !is_float($value) && !is_bool($value) && $value !== null) {
        fail(400, 'Ungültiger Wert');
    }
}

/** Prüft die Turnierdaten und gibt nur erlaubte Felder zurück. */
function validate_data(mixed $data): array
{
    if (!is_array($data)) {
        fail(400, 'Turnierdaten fehlen');
    }
    $clean = [];
    foreach (DATA_KEYS as $key) {
        if (array_key_exists($key, $data)) {
            $clean[$key] = $data[$key];
        }
    }
    check_value($clean);

    foreach (['config', 'players', 'matches', 'standings', 'knockoutMatches'] as $key) {
        if (isset($clean[$key]) && !is_array($clean[$key])) {
            fail(400, "Feld $key muss eine Liste oder ein Objekt sein");
        }
    }
    if (isset($clean['players']) && count($clean['players']) > 8) {
        fail(400, 'Maximal 8 Spieler');
    }
    if (isset($clean['phase']) && !in_array($clean['phase'], PHASES, true)) {
        fail(400, 'Ungültige Phase');
    }
    if (isset($clean['name']) && !is_string($clean['name'])) {
        fail(400, 'Name muss Text sein');
    }
    foreach (['winner', 'loser'] as $key) {
        if (isset($clean[$key]) && !is_int($clean[$key])) {
            fail(400, "Feld $key muss eine Zahl oder leer sein");
        }
    }
    return $clean;
}

/** Vorgänger-Turniere aus einer Export-Datei (höchstens 5). Es bleiben nur die Felder, die Statistik und Tipp brauchen. */
function clean_history(mixed $history): array
{
    if ($history === null) {
        return [];
    }
    if (!is_array($history) || !array_is_list($history) || count($history) > 5) {
        fail(400, 'Ungültiger Export (Vorgänger)');
    }
    $result = [];
    foreach ($history as $entry) {
        $doc = validate_data($entry);
        if (($doc['phase'] ?? '') !== 'finished' || !isset($doc['players'], $doc['matches'])) {
            fail(400, 'Der Export enthält ein Turnier, das nicht abgeschlossen ist');
        }
        foreach (['createdAt', 'finishedAt'] as $key) {
            if (isset($entry[$key]) && is_string($entry[$key]) && strlen($entry[$key]) <= 40) {
                $doc[$key] = $entry[$key];
            }
        }
        $result[] = $doc;
    }
    return $result;
}

function body_id(array $body): string
{
    $id = $body['id'] ?? '';
    if (!valid_id($id)) {
        fail(400, 'Ungültige Turnier-ID');
    }
    return $id;
}

// ---------------------------------------------------------------- Ausgabe

function public_view(array $t): array
{
    unset($t['pinHash'], $t['pin']);
    $t['hasPhoto'] = !empty($t['photoVersion']);
    return $t;
}

function summary(array $t, bool $isAdmin): array
{
    $players = $t['players'] ?? [];
    $name = static fn($i) => is_int($i) && isset($players[$i]['name']) ? $players[$i]['name'] : null;
    $row = [
        'id' => $t['id'],
        'name' => $t['name'] ?? '',
        'createdAt' => $t['createdAt'],
        'updatedAt' => $t['updatedAt'],
        'phase' => $t['phase'] ?? 'setup',
        'playerCount' => count($players),
        'winnerName' => $name($t['winner'] ?? null),
        'loserName' => $name($t['loser'] ?? null),
        'hasPhoto' => !empty($t['photoVersion']),
        'photoVersion' => $t['photoVersion'] ?? null,
        'previousId' => $t['previousId'] ?? null,
        'expiresAt' => $t['expiresAt'] ?? null,
    ];
    if ($isAdmin) {
        $public = is_public($t);
        $until = visible_until($t);
        $row['hidden'] = !$public;
        $row['hiddenReason'] = $public ? null : (!empty($t['hidden']) ? 'manual' : 'auto');
        $row['visibleUntil'] = $public && $until !== null ? date('c', $until) : null;
    }
    return $row;
}

function all_tournaments(bool $withExpired = false): array
{
    $result = [];
    foreach (glob(storage_dir() . '/tournaments/*.json') ?: [] as $file) {
        $raw = file_get_contents($file);
        $doc = $raw === false ? null : json_decode($raw, true);
        if (is_array($doc) && isset($doc['id'])) {
            if ($withExpired || !is_expired($doc)) {
                $result[] = $doc;
            }
        } else {
            error_log('api.php: überspringe unlesbare Datei ' . basename($file));
        }
    }
    return $result;
}

function remove_file(string $path): void
{
    if (is_file($path) && !unlink($path)) {
        error_log("api.php: konnte $path nicht löschen");
        fail(500, 'Datei konnte nicht gelöscht werden');
    }
}

function delete_tournament(string $id): void
{
    remove_file(tournament_path($id));
    remove_file(photo_dir() . "/$id.jpg");
}

/** Löscht abgelaufene Gast-Turniere samt Foto. Läuft höchstens alle 5 Minuten, beim Auflisten und Erstellen. */
function purge_expired(): void
{
    $marker = storage_dir() . '/expire.marker';
    if (is_file($marker) && filemtime($marker) > time() - 300) {
        return;
    }
    with_lock(static function () use ($marker): void {
        touch($marker);
        foreach (all_tournaments(true) as $t) {
            if (is_expired($t)) {
                error_log("api.php: lösche abgelaufenes Gast-Turnier {$t['id']} (ablauf {$t['expiresAt']})");
                delete_tournament($t['id']);
            }
        }
    });
}

/**
 * Räumt höchstens einmal pro Tag auf: Turniere, in denen nie ein Spiel eingetragen wurde und die seit
 * langer Zeit unverändert sind, sowie alte Rate-Limit- und Zwischendateien.
 */
function cleanup_empty(): void
{
    $marker = storage_dir() . '/cleanup.marker';
    if (is_file($marker) && filemtime($marker) > time() - 86400) {
        return;
    }
    with_lock(static function () use ($marker): void {
        if (is_file($marker) && filemtime($marker) > time() - 86400) {
            return;
        }
        touch($marker);
        $limit = time() - EMPTY_TOURNAMENT_DAYS * 86400;
        foreach (all_tournaments() as $t) {
            $updated = strtotime((string) ($t['updatedAt'] ?? ''));
            if ($updated === false) {
                continue; // ohne gültiges Datum nie automatisch löschen
            }
            $hasResults = false;
            foreach (array_merge($t['matches'] ?? [], $t['knockoutMatches'] ?? []) as $m) {
                if (is_array($m) && isset($m['homeGoals'])) {
                    $hasResults = true;
                    break;
                }
            }
            if (!$hasResults && ($t['phase'] ?? 'setup') !== 'finished' && $updated < $limit) {
                error_log("api.php: lösche leeres Turnier {$t['id']} (zuletzt geändert {$t['updatedAt']})");
                delete_tournament($t['id']);
            }
        }
        foreach (glob(storage_dir() . '/ratelimit/*') ?: [] as $file) {
            if (filemtime($file) < time() - 3 * 86400) {
                @unlink($file);
            }
        }
        foreach (glob(storage_dir() . '/tournaments/*.tmp') ?: [] as $file) {
            if (filemtime($file) < time() - 3600) {
                @unlink($file);
            }
        }
    });
}

// ---------------------------------------------------------------- Aktionen

function action_list(): never
{
    $isAdmin = false;
    if (($_SERVER['HTTP_X_ADMIN'] ?? '') !== '') {
        $isAdmin = authenticate(null) === 'admin';
    }
    purge_expired();
    cleanup_empty();
    $rows = [];
    foreach (all_tournaments() as $t) {
        if (!$isAdmin && !is_public($t)) {
            continue;
        }
        $rows[] = summary($t, $isAdmin);
    }
    usort($rows, static fn($a, $b) => (strtotime($b['createdAt']) ?: 0) <=> (strtotime($a['createdAt']) ?: 0));
    respond(['tournaments' => $rows, 'isAdmin' => $isAdmin]);
}

/** Öffentlich: Name, Untertitel, Farben und Fristen dieser Installation. */
function action_config(): never
{
    $c = app_config();
    $c['guestHours'] = intdiv(guest_seconds(), 3600);
    $c['finishedHours'] = intdiv(finished_visible_seconds(), 3600);
    respond($c);
}

function action_load(): never
{
    $id = $_GET['id'] ?? '';
    if (!valid_id($id)) {
        fail(400, 'Ungültige Turnier-ID');
    }
    $t = read_tournament($id);
    if ($t === null) {
        fail(404, 'Turnier nicht gefunden');
    }
    respond(public_view($t));
}

function action_verify(): never
{
    $id = $_GET['id'] ?? '';
    if (!valid_id($id) || ($t = read_tournament($id)) === null) {
        fail(404, 'Turnier nicht gefunden');
    }
    $role = require_role($t);
    respond(['ok' => true, 'role' => $role]);
}

function action_admin_check(): never
{
    if (authenticate(null) !== 'admin') {
        fail(401, 'Admin-Code erforderlich');
    }
    respond(['ok' => true, 'role' => 'admin']);
}

function action_create(): never
{
    $body = read_body();
    $data = validate_data($body['data'] ?? null);
    $isAdmin = authenticate(null) === 'admin';

    $previousId = $body['previousId'] ?? null;
    if ($previousId !== null) {
        // Gäste übernehmen ein früheres Turnier nur über die Export-Datei. Läuft nichts ab (Fristen aus), gilt wie früher der PIN des Vorgängers.
        if (!$isAdmin && guest_seconds() > 0) {
            fail(403, 'Als Gast kann ein früheres Turnier nur über die Export-Datei übernommen werden.');
        }
        if (!valid_id($previousId) || ($previous = read_tournament($previousId)) === null) {
            fail(404, 'Vorgänger-Turnier nicht gefunden');
        }
        if (!$isAdmin) {
            $previousPin = $body['previousPin'] ?? null;
            if (!is_string($previousPin) || $previousPin === '') {
                fail(401, 'PIN des Vorgängers erforderlich');
            }
            if (!check_pin($previous, $previousPin)) {
                fail(403, 'Falscher PIN des Vorgängers');
            }
        }
    }
    $history = clean_history($body['history'] ?? null);

    if (!$isAdmin) {
        $wait = create_slot();
        if ($wait > 0) {
            header("Retry-After: $wait");
            fail(429, 'Es wurden heute schon zu viele Turniere erstellt. Bitte später erneut versuchen.', ['retryAfter' => $wait]);
        }
    }

    purge_expired();
    $pin = generate_pin();
    $expiresAt = $isAdmin || guest_seconds() === 0 ? null : date('c', time() + guest_seconds());
    $doc = with_lock(static function () use ($data, $previousId, $pin, $history, $expiresAt): array {
        $now = date('c');
        $doc = $data + ['phase' => 'setup'];
        $doc += [
            'id' => generate_id(),
            'version' => 1,
            'createdAt' => $now,
            'updatedAt' => $now,
            'previousId' => $previousId,
            'hidden' => false,
            'pin' => $pin,
        ];
        if ($history) {
            $doc['history'] = $history;
        }
        if ($expiresAt !== null) {
            $doc['expiresAt'] = $expiresAt;
        }
        write_tournament($doc);
        return $doc;
    });
    respond(['success' => true, 'id' => $doc['id'], 'pin' => $pin, 'version' => 1, 'expiresAt' => $expiresAt], 201);
}

function action_update(): never
{
    $body = read_body();
    $id = body_id($body);
    $t0 = read_tournament($id);
    if ($t0 === null) {
        fail(404, 'Turnier nicht gefunden');
    }
    require_role($t0);
    $data = validate_data($body['data'] ?? null);
    $version = $body['version'] ?? null;
    if (!is_int($version)) {
        fail(400, 'Version fehlt');
    }

    $result = with_lock(static function () use ($id, $t0, $data, $version): array {
        $t = read_tournament($id);
        if ($t === null) {
            fail(404, 'Turnier nicht gefunden');
        }
        if (pin_fingerprint($t) !== pin_fingerprint($t0)) {
            fail(403, 'Der PIN wurde inzwischen geändert');
        }
        if ($t['version'] !== $version) {
            fail(409, 'Das Turnier wurde inzwischen geändert', ['current' => public_view($t)]);
        }
        $wasFinished = ($t['phase'] ?? '') === 'finished';
        foreach (DATA_KEYS as $key) {
            unset($t[$key]);
        }
        $t = $data + $t;
        if (($t['phase'] ?? '') === 'finished') {
            if (!$wasFinished) {
                // Neu abgeschlossen: die 12 Stunden Sichtbarkeit beginnen jetzt, eine frühere Freigabe gilt nicht mehr
                $t['finishedAt'] = date('c');
                unset($t['pinned']);
            }
        } else {
            unset($t['finishedAt'], $t['pinned']);
        }
        $t['version']++;
        $t['updatedAt'] = date('c');
        write_tournament($t);
        return $t;
    });
    respond(['success' => true, 'version' => $result['version'], 'updatedAt' => $result['updatedAt']]);
}

function action_admin_change(string $kind): never
{
    $body = read_body();
    $id = body_id($body);
    $t0 = read_tournament($id);
    if ($t0 === null) {
        fail(404, 'Turnier nicht gefunden');
    }
    require_role($t0, true);

    $response = with_lock(static function () use ($id, $kind, $body): array {
        $t = read_tournament($id);
        if ($t === null) {
            fail(404, 'Turnier nicht gefunden');
        }
        $out = ['success' => true];
        if ($kind === 'delete') {
            delete_tournament($id);
            return $out;
        }
        if ($kind === 'hide') {
            $hide = (bool) ($body['hidden'] ?? true);
            $t['hidden'] = $hide;
            if ($hide) {
                unset($t['pinned']);
            } elseif (($t['phase'] ?? '') === 'finished') {
                $t['pinned'] = true; // vom Admin eingeblendet: bleibt sichtbar, auch nach Ablauf der 12 Stunden
            }
        } elseif ($kind === 'reset_pin') {
            $out['pin'] = generate_pin();
            $t['pin'] = $out['pin'];
            unset($t['pinHash']);
            @unlink(storage_dir() . '/ratelimit/pin-' . $id . '.json'); // aufgehobene Sperre für den neuen PIN
        }
        $t['version']++;
        $t['updatedAt'] = date('c');
        write_tournament($t);
        return $out;
    });
    respond($response);
}

/** Der Admin kann den PIN eines Turniers jederzeit abrufen. Ältere Turniere haben ihn nicht gespeichert (dann null). */
function action_get_pin(): never
{
    $body = read_body();
    $id = body_id($body);
    $t = read_tournament($id);
    if ($t === null) {
        fail(404, 'Turnier nicht gefunden');
    }
    require_role($t, true);
    respond(['pin' => is_string($t['pin'] ?? null) ? $t['pin'] : null]);
}

/** Siegerfoto: wird neu als JPEG kodiert (entfernt EXIF/Zusatzdaten) und auf max. 1200 px verkleinert. */
function action_photo(): never
{
    $id = $_GET['id'] ?? '';
    if (!valid_id($id) || ($t0 = read_tournament($id)) === null) {
        fail(404, 'Turnier nicht gefunden');
    }
    require_role($t0);

    $file = $_FILES['photo'] ?? null;
    if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file((string) $file['tmp_name'])) {
        fail(400, 'Kein Foto empfangen');
    }
    if ($file['size'] > MAX_PHOTO_BYTES) {
        fail(413, 'Foto zu gross (max. 1.5 MB)');
    }
    $info = @getimagesize($file['tmp_name']);
    if ($info === false || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP], true)) {
        fail(400, 'Nur JPEG, PNG oder WebP erlaubt');
    }
    // Vor dem Dekodieren prüfen: kleine Dateien können riesige Bilder enthalten
    if ($info[0] * $info[1] > MAX_PHOTO_PIXELS || max($info[0], $info[1]) > MAX_PHOTO_SIDE) {
        fail(413, 'Das Foto hat zu viele Pixel. Bitte ein kleineres Bild wählen.');
    }
    $source = match ($info[2]) {
        IMAGETYPE_JPEG => @imagecreatefromjpeg($file['tmp_name']),
        IMAGETYPE_PNG => @imagecreatefrompng($file['tmp_name']),
        default => @imagecreatefromwebp($file['tmp_name']),
    };
    if (!$source) {
        fail(400, 'Das Bild konnte nicht gelesen werden');
    }
    [$w, $h] = [imagesx($source), imagesy($source)];
    $scale = min(1, 1200 / max($w, $h));
    $target = imagecreatetruecolor((int) round($w * $scale), (int) round($h * $scale));
    imagefill($target, 0, 0, imagecolorallocate($target, 255, 255, 255));
    imagecopyresampled($target, $source, 0, 0, 0, 0, imagesx($target), imagesy($target), $w, $h);

    // Erst in eine Zwischendatei schreiben, dann unter Sperre atomar an den Platz verschieben
    $tmp = photo_dir() . "/$id.tmp." . bin2hex(random_bytes(4));
    if (!imagejpeg($target, $tmp, 82)) {
        @unlink($tmp);
        fail(500, 'Foto konnte nicht gespeichert werden');
    }
    $photoVersion = with_lock(static function () use ($id, $t0, $tmp): int {
        $t = read_tournament($id);
        if ($t === null) {
            @unlink($tmp);
            fail(404, 'Turnier nicht gefunden');
        }
        if (pin_fingerprint($t) !== pin_fingerprint($t0)) {
            @unlink($tmp);
            fail(403, 'Der PIN wurde inzwischen geändert');
        }
        if (!rename($tmp, photo_dir() . "/$id.jpg")) {
            @unlink($tmp);
            fail(500, 'Foto konnte nicht gespeichert werden');
        }
        $t['photoVersion'] = max(time(), ((int) ($t['photoVersion'] ?? 0)) + 1);
        $t['version']++;
        $t['updatedAt'] = date('c');
        write_tournament($t);
        return $t['photoVersion'];
    });
    respond(['success' => true, 'photoVersion' => $photoVersion]);
}

// ---------------------------------------------------------------- Routing

$method = $_SERVER['REQUEST_METHOD'];
$action = is_string($_GET['action'] ?? null) ? $_GET['action'] : '';

if ($method === 'GET') {
    match ($action) {
        'list' => action_list(),
        'load' => action_load(),
        'config' => action_config(),
        default => fail(400, 'Unbekannte Aktion'),
    };
}
if ($method === 'POST') {
    match ($action) {
        'create' => action_create(),
        'update' => action_update(),
        'verify' => action_verify(),
        'admin_check' => action_admin_check(),
        'get_pin' => action_get_pin(),
        'delete', 'hide', 'reset_pin' => action_admin_change($action),
        'photo' => action_photo(),
        default => fail(400, 'Unbekannte Aktion'),
    };
}
fail(405, 'Methode nicht erlaubt');
