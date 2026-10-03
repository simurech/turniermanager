<?php
declare(strict_types=1);

/**
 * Turnier Manager API.
 *
 * Lesen ist öffentlich (list, load). Schreiben braucht den Turnier-PIN (Header X-Pin)
 * oder den globalen Admin-Code (Header X-Admin). Der Speicher liegt wenn möglich
 * ausserhalb des Webroots (../tm-private), sonst in ./data mit Zugriffssperre.
 */

date_default_timezone_set('Europe/Zurich');

const ID_ALPHABET = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789';
const MAX_BODY_BYTES = 262144;
const MAX_PHOTO_BYTES = 1500000;
const PIN_MAX_FAILS = 5;
const PIN_WINDOW = 600;
const CREATE_PER_IP_PER_DAY = 5;
const CREATE_GLOBAL_PER_DAY = 50;
const EMPTY_TOURNAMENT_DAYS = 3;
const PHASES = ['setup', 'group', 'knockout', 'finished'];
const DATA_KEYS = ['name', 'config', 'players', 'matches', 'standings', 'knockoutMatches', 'phase', 'winner', 'loser'];

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');

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
        if (is_dir($candidate) && is_writable($candidate)) {
            if (str_starts_with($candidate, __DIR__ . '/') && !file_exists($candidate . '/.htaccess')) {
                @file_put_contents($candidate . '/.htaccess', "Require all denied\n");
            }
            foreach (['tournaments', 'ratelimit'] as $sub) {
                if (!is_dir("$candidate/$sub")) {
                    @mkdir("$candidate/$sub", 0750, true);
                }
            }
            return $dir = $candidate;
        }
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
    $raw = @file_get_contents(tournament_path($id));
    if ($raw === false) {
        return null;
    }
    $doc = json_decode($raw, true);
    return is_array($doc) ? $doc : null;
}

function write_tournament(array $doc): void
{
    $path = tournament_path($doc['id']);
    $tmp = $path . '.tmp';
    $json = json_encode($doc, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    if ($json === false || file_put_contents($tmp, $json) === false || !rename($tmp, $path)) {
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

function rate_file(string $key): string
{
    return storage_dir() . '/ratelimit/' . hash('sha256', $key) . '.json';
}

/** @return list<int> Zeitstempel innerhalb des Fensters */
function rate_hits(string $key, int $window): array
{
    $raw = @file_get_contents(rate_file($key));
    $hits = $raw ? json_decode($raw, true) : [];
    $limit = time() - $window;
    return array_values(array_filter(is_array($hits) ? $hits : [], fn($t) => is_int($t) && $t > $limit));
}

function rate_add(string $key, int $window): void
{
    $hits = rate_hits($key, $window);
    $hits[] = time();
    file_put_contents(rate_file($key), json_encode($hits), LOCK_EX);
}

function rate_clear(string $key): void
{
    @unlink(rate_file($key));
}

function rate_block_if_exceeded(string $key, int $max, int $window, string $message): void
{
    $hits = rate_hits($key, $window);
    if (count($hits) >= $max) {
        $retry = max(1, $window - (time() - min($hits)));
        header("Retry-After: $retry");
        fail(429, $message, ['retryAfter' => $retry]);
    }
}

function client_ip(): string
{
    $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if ($forwarded !== '') {
        $first = trim(explode(',', $forwarded)[0]);
        if (filter_var($first, FILTER_VALIDATE_IP)) {
            return $first;
        }
    }
    return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
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

/**
 * Prüft die mitgesendeten Zugangsdaten. Gibt 'admin', 'pin' oder null zurück
 * (null = nichts mitgesendet). Falsche Angaben zählen als Fehlversuch.
 * $t = null prüft nur den Admin-Code.
 */
function authenticate(?array $t): ?string
{
    $admin = $_SERVER['HTTP_X_ADMIN'] ?? '';
    $pin = $_SERVER['HTTP_X_PIN'] ?? '';
    $adminKey = 'admin';
    $pinKey = $t ? 'pin:' . $t['id'] : null;

    if ($admin !== '') {
        rate_block_if_exceeded($adminKey, PIN_MAX_FAILS, PIN_WINDOW, 'Zu viele Fehlversuche. Bitte kurz warten.');
        $hash = admin_hash();
        if ($hash !== null && password_verify($admin, $hash)) {
            rate_clear($adminKey);
            return 'admin';
        }
        rate_add($adminKey, PIN_WINDOW);
    }
    if ($pin !== '' && $t !== null) {
        rate_block_if_exceeded($pinKey, PIN_MAX_FAILS, PIN_WINDOW, 'Zu viele Fehlversuche. Bitte kurz warten.');
        if (preg_match('/\A\d{4}\z/', $pin) === 1 && password_verify($pin, $t['pinHash'])) {
            rate_clear($pinKey);
            return 'pin';
        }
        rate_add($pinKey, PIN_WINDOW);
    }
    if ($admin !== '' || $pin !== '') {
        fail(403, 'Falscher PIN oder Admin-Code');
    }
    return null;
}

function require_role(array $t, bool $adminOnly = false): string
{
    $role = authenticate($t);
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

// ---------------------------------------------------------------- Ausgabe

function public_view(array $t): array
{
    unset($t['pinHash']);
    $t['hasPhoto'] = !empty($t['photoVersion']);
    return $t;
}

function summary(array $t, bool $isAdmin): array
{
    $players = $t['players'] ?? [];
    $name = fn($i) => is_int($i) && isset($players[$i]['name']) ? $players[$i]['name'] : null;
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
    ];
    if ($isAdmin) {
        $row['hidden'] = !empty($t['hidden']);
    }
    return $row;
}

function all_tournaments(): array
{
    $result = [];
    foreach (glob(storage_dir() . '/tournaments/*.json') ?: [] as $file) {
        $doc = json_decode((string) @file_get_contents($file), true);
        if (is_array($doc) && isset($doc['id'])) {
            $result[] = $doc;
        }
    }
    return $result;
}

function delete_tournament(string $id): void
{
    @unlink(tournament_path($id));
    @unlink(photo_dir() . "/$id.jpg");
}

/** Löscht leere Turniere (nie ein Spiel eingetragen) nach einigen Tagen. Läuft höchstens einmal pro Tag. */
function cleanup_empty(): void
{
    $marker = storage_dir() . '/cleanup.marker';
    if (is_file($marker) && filemtime($marker) > time() - 86400) {
        return;
    }
    touch($marker);
    $limit = time() - EMPTY_TOURNAMENT_DAYS * 86400;
    foreach (all_tournaments() as $t) {
        $hasResults = false;
        foreach (array_merge($t['matches'] ?? [], $t['knockoutMatches'] ?? []) as $m) {
            if (is_array($m) && isset($m['homeGoals'])) {
                $hasResults = true;
                break;
            }
        }
        if (!$hasResults && ($t['phase'] ?? 'setup') !== 'finished' && strtotime($t['updatedAt']) < $limit) {
            delete_tournament($t['id']);
        }
    }
}

// ---------------------------------------------------------------- Aktionen

function action_list(): never
{
    $isAdmin = false;
    if (($_SERVER['HTTP_X_ADMIN'] ?? '') !== '') {
        $isAdmin = authenticate(null) === 'admin';
    }
    with_lock('cleanup_empty');
    $rows = [];
    foreach (all_tournaments() as $t) {
        if (!empty($t['hidden']) && !$isAdmin) {
            continue;
        }
        $rows[] = summary($t, $isAdmin);
    }
    usort($rows, fn($a, $b) => strcmp($b['createdAt'], $a['createdAt']));
    respond(['tournaments' => $rows, 'isAdmin' => $isAdmin]);
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
        if (!valid_id($previousId) || ($previous = read_tournament($previousId)) === null) {
            fail(404, 'Vorgänger-Turnier nicht gefunden');
        }
        if (!$isAdmin) {
            // Vorgänger-PIN prüfen, mit demselben Fehlversuch-Schutz.
            $_SERVER['HTTP_X_PIN'] = (string) ($body['previousPin'] ?? '');
            if (authenticate($previous) !== 'pin') {
                fail(401, 'PIN des Vorgängers erforderlich');
            }
        }
    }

    if (!$isAdmin) {
        rate_block_if_exceeded('create:' . client_ip(), CREATE_PER_IP_PER_DAY, 86400, 'Zu viele neue Turniere heute. Bitte morgen erneut versuchen.');
        rate_block_if_exceeded('create:all', CREATE_GLOBAL_PER_DAY, 86400, 'Heute wurden zu viele Turniere erstellt. Bitte später erneut versuchen.');
    }

    $pin = generate_pin();
    $result = with_lock(function () use ($data, $previousId, $pin) {
        $now = date('c');
        $doc = $data + ['phase' => 'setup'];
        $doc += [
            'id' => generate_id(),
            'version' => 1,
            'createdAt' => $now,
            'updatedAt' => $now,
            'previousId' => $previousId,
            'hidden' => false,
            'pinHash' => password_hash($pin, PASSWORD_BCRYPT),
        ];
        write_tournament($doc);
        return $doc;
    });
    if (!$isAdmin) {
        rate_add('create:' . client_ip(), 86400);
        rate_add('create:all', 86400);
    }
    respond(['success' => true, 'id' => $result['id'], 'pin' => $pin, 'version' => 1], 201);
}

function action_update(): never
{
    $body = read_body();
    $id = $body['id'] ?? '';
    if (!valid_id($id)) {
        fail(400, 'Ungültige Turnier-ID');
    }
    $data = validate_data($body['data'] ?? null);
    $version = $body['version'] ?? null;
    if (!is_int($version)) {
        fail(400, 'Version fehlt');
    }

    $result = with_lock(function () use ($id, $data, $version) {
        $t = read_tournament($id);
        if ($t === null) {
            fail(404, 'Turnier nicht gefunden');
        }
        require_role($t);
        if ($t['version'] !== $version) {
            fail(409, 'Das Turnier wurde inzwischen geändert', ['current' => public_view($t)]);
        }
        foreach (DATA_KEYS as $key) {
            unset($t[$key]);
        }
        $t = $data + $t;
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
    $id = $body['id'] ?? '';
    if (!valid_id($id)) {
        fail(400, 'Ungültige Turnier-ID');
    }
    $response = with_lock(function () use ($id, $kind, $body) {
        $t = read_tournament($id);
        if ($t === null) {
            fail(404, 'Turnier nicht gefunden');
        }
        require_role($t, true);
        $out = ['success' => true];
        if ($kind === 'delete') {
            delete_tournament($id);
            return $out;
        }
        if ($kind === 'hide') {
            $t['hidden'] = (bool) ($body['hidden'] ?? true);
        } elseif ($kind === 'reset_pin') {
            $out['pin'] = generate_pin();
            $t['pinHash'] = password_hash($out['pin'], PASSWORD_BCRYPT);
        }
        $t['version']++;
        $t['updatedAt'] = date('c');
        write_tournament($t);
        return $out;
    });
    respond($response);
}

/** Siegerfoto: wird neu als JPEG kodiert (entfernt EXIF/Zusatzdaten) und auf max. 1200 px verkleinert. */
function action_photo(): never
{
    $id = $_GET['id'] ?? '';
    if (!valid_id($id) || ($t = read_tournament($id)) === null) {
        fail(404, 'Turnier nicht gefunden');
    }
    require_role($t);

    $file = $_FILES['photo'] ?? null;
    if (!$file || $file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
        fail(400, 'Kein Foto empfangen');
    }
    if ($file['size'] > MAX_PHOTO_BYTES) {
        fail(413, 'Foto zu gross (max. 1.5 MB)');
    }
    $info = @getimagesize($file['tmp_name']);
    $source = null;
    if ($info !== false) {
        $source = match ($info[2]) {
            IMAGETYPE_JPEG => @imagecreatefromjpeg($file['tmp_name']),
            IMAGETYPE_PNG => @imagecreatefrompng($file['tmp_name']),
            IMAGETYPE_WEBP => @imagecreatefromwebp($file['tmp_name']),
            default => null,
        };
    }
    if (!$source) {
        fail(400, 'Nur JPEG, PNG oder WebP erlaubt');
    }
    [$w, $h] = [imagesx($source), imagesy($source)];
    $scale = min(1, 1200 / max($w, $h));
    $target = imagecreatetruecolor((int) round($w * $scale), (int) round($h * $scale));
    imagefill($target, 0, 0, imagecolorallocate($target, 255, 255, 255));
    imagecopyresampled($target, $source, 0, 0, 0, 0, imagesx($target), imagesy($target), $w, $h);
    if (!imagejpeg($target, photo_dir() . "/$id.jpg", 82)) {
        fail(500, 'Foto konnte nicht gespeichert werden');
    }

    $photoVersion = with_lock(function () use ($id) {
        $t = read_tournament($id);
        $t['photoVersion'] = time();
        $t['version']++;
        $t['updatedAt'] = date('c');
        write_tournament($t);
        return $t['photoVersion'];
    });
    respond(['success' => true, 'photoVersion' => $photoVersion]);
}

// ---------------------------------------------------------------- Routing

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($method === 'GET') {
    match ($action) {
        'list' => action_list(),
        'load' => action_load(),
        default => fail(400, 'Unbekannte Aktion'),
    };
}
if ($method === 'POST') {
    match ($action) {
        'create' => action_create(),
        'update' => action_update(),
        'verify' => action_verify(),
        'admin_check' => action_admin_check(),
        'delete', 'hide', 'reset_pin' => action_admin_change($action),
        'photo' => action_photo(),
        default => fail(400, 'Unbekannte Aktion'),
    };
}
fail(405, 'Methode nicht erlaubt');
