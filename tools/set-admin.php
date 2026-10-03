<?php
// Setzt den globalen Admin-Code. Aufruf auf dem Server:
//   php set-admin.php <speicherverzeichnis>
// Der Code wird ohne Echo von der Tastatur gelesen und nur als Hash gespeichert.
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit(1);
}
$dir = $argv[1] ?? '';
if ($dir === '' || !is_dir($dir)) {
    fwrite(STDERR, "Verwendung: php set-admin.php <speicherverzeichnis>\n");
    exit(1);
}
fwrite(STDOUT, 'Neuer Admin-Code (mind. 12 Zeichen): ');
system('stty -echo 2>/dev/null');
$code = trim((string) fgets(STDIN));
system('stty echo 2>/dev/null');
fwrite(STDOUT, "\n");
if (mb_strlen($code) < 12) {
    fwrite(STDERR, "Zu kurz, mindestens 12 Zeichen.\n");
    exit(1);
}
$file = rtrim($dir, '/') . '/config.php';
$php = "<?php\nreturn " . var_export(['admin_hash' => password_hash($code, PASSWORD_BCRYPT)], true) . ";\n";
file_put_contents($file, $php);
chmod($file, 0600);
fwrite(STDOUT, "Admin-Code gespeichert in $file\n");
