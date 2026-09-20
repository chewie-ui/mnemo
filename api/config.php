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

return [
  'dsn' => $env('DB_DSN', 'sqlite:' . __DIR__ . '/data/mnemo.sqlite'),
  'user' => $env('DB_USER'),
  'password' => $env('DB_PASSWORD'),
  // Origine du site en production (https://…) : les requêtes venues d'ailleurs sont refusées.
  'origin' => $env('APP_ORIGIN'),
  // Adresse complète du site (liens dans les e-mails) ; par défaut l'origine.
  'url' => $env('APP_URL', $env('APP_ORIGIN')),
  // Expéditeur des e-mails (réinitialisation du mot de passe).
  'mailFrom' => $env('MAIL_FROM'),
];
