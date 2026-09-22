<?php
// Configuration lue depuis un fichier .env (jamais versionné) : api/.env en priorité,
// sinon .env à la racine du projet. Sans .env, on tourne en local sur SQLite.
declare(strict_types=1);

function loadEnv(string $file): void {
  if (!is_file($file)) return;
  foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    $line = trim($line);
    if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) continue;
    [$key, $value] = explode('=', $line, 2);
    $key = trim($key);
    $value = trim($value);
    // Valeurs entre guillemets acceptées : DB_PASSWORD="mot de passe"
    if (strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'") && $value[-1] === $value[0]) {
      $value = substr($value, 1, -1);
    }
    if (getenv($key) === false) putenv("$key=$value");
  }
}

loadEnv(__DIR__ . '/.env');
loadEnv(dirname(__DIR__) . '/.env');

$env = fn(string $key, ?string $default = null) => (getenv($key) !== false && getenv($key) !== '') ? getenv($key) : $default;

// La base peut etre decrite de deux facons :
//  - DB_DSN complet ;
//  - ou serveur + nom + identifiants separes, y compris sous les noms utilises par Infomaniak
//    (DB_SERVER_CLIENT / DB_NAME_CLIENT / DB_USER_CLIENT / DB_PASS_CLIENT) : on assemble le DSN.
$host = $env('DB_HOST', $env('DB_SERVER_CLIENT'));
$name = $env('DB_NAME', $env('DB_NAME_CLIENT'));
$dsn = $env('DB_DSN');
if (!$dsn && $host && $name) $dsn = "mysql:host=$host;dbname=$name;charset=utf8mb4";

return [
  'dsn' => $dsn ?? 'sqlite:' . __DIR__ . '/data/mnemo.sqlite',
  'user' => $env('DB_USER', $env('DB_USER_CLIENT')),
  'password' => $env('DB_PASSWORD', $env('DB_PASS_CLIENT')),
  // Origine du site en production (https://…) : les requêtes venues d'ailleurs sont refusées.
  'origin' => $env('APP_ORIGIN'),
  // APP_DEBUG=1 : les erreurs renvoient le détail technique (à n'activer que le temps d'un diagnostic).
  'debug' => $env('APP_DEBUG') === '1',
  // Adresse complète du site (liens dans les e-mails) ; par défaut l'origine.
  'url' => $env('APP_URL', $env('APP_ORIGIN')),
  // Expéditeur des e-mails (réinitialisation du mot de passe).
  'mailFrom' => $env('MAIL_FROM'),
];
