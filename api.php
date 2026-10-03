<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('X-XSS-Protection: 1; mode=block');
header('Referrer-Policy: strict-origin-when-cross-origin');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$dataDir = './data/';

if (!is_dir($dataDir)) {
    if (!mkdir($dataDir, 0750, true)) {
        http_response_code(500);
        echo json_encode(['error' => 'Konnte Datenverzeichnis nicht erstellen']);
        exit;
    }
}

function generateTournamentId() {
    $chars = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789';
    do {
        $id = '';
        for ($i = 0; $i < 6; $i++) {
            $id .= $chars[random_int(0, strlen($chars) - 1)];
        }
    } while (file_exists("./data/{$id}.json"));
    return $id;
}

function validateTournamentId($id) {
    return preg_match('/^[A-Z2-9]{6}$/', $id);
}

function sanitizeInput($data) {
    if (is_array($data)) {
        return array_map('sanitizeInput', $data);
    }
    return is_string($data) ? htmlspecialchars(trim($data), ENT_QUOTES, 'UTF-8') : $data;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? '';
    
    switch ($action) {
        case 'load':
            $id = $_GET['id'] ?? '';
            
            if (!validateTournamentId($id)) {
                http_response_code(400);
                echo json_encode(['error' => 'Ungültige Turnier-ID']);
                exit;
            }
            
            $filename = $dataDir . $id . '.json';
            
            if (!file_exists($filename)) {
                http_response_code(404);
                echo json_encode(['error' => 'Turnier nicht gefunden']);
                exit;
            }
            
            $data = file_get_contents($filename);
            if ($data === false) {
                http_response_code(500);
                echo json_encode(['error' => 'Fehler beim Laden des Turniers']);
                exit;
            }
            
            echo $data;
            break;
            
        case 'list':
            $files = glob($dataDir . '*.json');
            $tournaments = [];
            
            foreach ($files as $file) {
                $id = basename($file, '.json');
                $data = json_decode(file_get_contents($file), true);
                if ($data) {
                    $tournaments[] = [
                        'id' => $id,
                        'lastUpdated' => $data['lastUpdated'] ?? '',
                        'phase' => $data['phase'] ?? 'setup',
                        'playerCount' => count($data['players'] ?? [])
                    ];
                }
            }
            
            usort($tournaments, function($a, $b) {
                return strcmp($b['lastUpdated'], $a['lastUpdated']);
            });
            
            echo json_encode($tournaments);
            break;
            
        default:
            http_response_code(400);
            echo json_encode(['error' => 'Unbekannte Aktion']);
    }
    
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (json_last_error() !== JSON_ERROR_NONE) {
        http_response_code(400);
        echo json_encode(['error' => 'Ungültiges JSON']);
        exit;
    }
    
    $action = $input['action'] ?? '';
    
    switch ($action) {
        case 'create':
            $id = $input['id'] ?? '';
            
            if (!validateTournamentId($id)) {
                http_response_code(400);
                echo json_encode(['error' => 'Ungültige Turnier-ID']);
                exit;
            }
            
            $filename = $dataDir . $id . '.json';
            
            if (file_exists($filename)) {
                http_response_code(409);
                echo json_encode(['error' => 'Turnier existiert bereits']);
                exit;
            }
            
            $tournamentData = [
                'config' => sanitizeInput($input['config'] ?? []),
                'players' => sanitizeInput($input['players'] ?? []),
                'matches' => sanitizeInput($input['matches'] ?? []),
                'standings' => sanitizeInput($input['standings'] ?? []),
                'knockoutMatches' => sanitizeInput($input['knockoutMatches'] ?? []),
                'phase' => sanitizeInput($input['phase'] ?? 'setup'),
                'winner' => sanitizeInput($input['winner'] ?? null),
                'loser' => sanitizeInput($input['loser'] ?? null),
                'lastUpdated' => date('Y-m-d H:i:s')
            ];
            
            $jsonData = json_encode($tournamentData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
            
            if (file_put_contents($filename, $jsonData) === false) {
                http_response_code(500);
                echo json_encode(['error' => 'Fehler beim Speichern']);
                exit;
            }
            
            echo json_encode(['success' => true, 'id' => $id]);
            break;
            
        case 'update':
            $id = $input['id'] ?? '';
            
            if (!validateTournamentId($id)) {
                http_response_code(400);
                echo json_encode(['error' => 'Ungültige Turnier-ID']);
                exit;
            }
            
            $filename = $dataDir . $id . '.json';
            
            if (!file_exists($filename)) {
                http_response_code(404);
                echo json_encode(['error' => 'Turnier nicht gefunden']);
                exit;
            }
            
            $tournamentData = [
                'config' => sanitizeInput($input['config'] ?? []),
                'players' => sanitizeInput($input['players'] ?? []),
                'matches' => sanitizeInput($input['matches'] ?? []),
                'standings' => sanitizeInput($input['standings'] ?? []),
                'knockoutMatches' => sanitizeInput($input['knockoutMatches'] ?? []),
                'phase' => sanitizeInput($input['phase'] ?? 'setup'),
                'winner' => sanitizeInput($input['winner'] ?? null),
                'loser' => sanitizeInput($input['loser'] ?? null),
                'lastUpdated' => date('Y-m-d H:i:s')
            ];
            
            $jsonData = json_encode($tournamentData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
            
            if (file_put_contents($filename, $jsonData) === false) {
                http_response_code(500);
                echo json_encode(['error' => 'Fehler beim Speichern']);
                exit;
            }
            
            echo json_encode(['success' => true]);
            break;
            
        default:
            http_response_code(400);
            echo json_encode(['error' => 'Unbekannte Aktion']);
    }
    
} else {
    http_response_code(405);
    echo json_encode(['error' => 'Methode nicht erlaubt']);
}
?>