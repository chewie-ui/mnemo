<?php
// Socle commun de l'API : config, base de données, session, réponses JSON.
// Chaque point d'entrée (auth.php, games.php, decks.php) commence par `require __DIR__ . '/_bootstrap.php';`.

declare(strict_types=1);

// Une erreur PHP ne doit jamais s'afficher : elle partirait dans la réponse JSON et révélerait
// les chemins du serveur. On journalise, et on répond proprement.
ini_set('display_errors', '0');
error_reporting(E_ALL);

set_exception_handler(function (Throwable $e): void {
  error_log('api: ' . $e);
  if (!headers_sent()) {
    header('Content-Type: application/json; charset=utf-8', true, 500);
  }
  echo json_encode(['error' => 'Erreur interne du serveur. Regarde les journaux PHP de l’hébergement.'], JSON_UNESCAPED_UNICODE);
  exit;
});

register_shutdown_function(function (): void {
  $err = error_get_last();
  if (!$err || !in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) return;
  if (!headers_sent()) header('Content-Type: application/json; charset=utf-8', true, 500);
  echo json_encode(['error' => 'Erreur interne du serveur. Regarde les journaux PHP de l’hébergement.'], JSON_UNESCAPED_UNICODE);
});

// Lu une seule fois par requête (config.php déclare des fonctions : pas de double require).
function config(): array {
  static $config = null;
  return $config ??= require __DIR__ . '/config.php';
}
$config = config();

// ─── Session (cookie HttpOnly, SameSite=Lax : le navigateur ne l'envoie pas depuis un autre site) ───
session_set_cookie_params([
  'lifetime' => 60 * 60 * 24 * 90,
  'path' => '/',
  'secure' => !empty($_SERVER['HTTPS']),
  'httponly' => true,
  'samesite' => 'Lax',
]);
session_name('mnemo');
session_start();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// ─── Garde-fou CSRF : un site tiers ne peut pas ajouter cet en-tête sans passer par CORS ───
if ($_SERVER['REQUEST_METHOD'] !== 'GET' && ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') {
  fail(403, 'Requête refusée.');
}
if (!empty($config['origin']) && !empty($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] !== $config['origin']) {
  fail(403, 'Origine inconnue.');
}

// ─── Base de données ───
function db(): PDO {
  static $pdo = null;
  if ($pdo) return $pdo;
  $config = config();
  try {
    $pdo = new PDO($config['dsn'], $config['user'], $config['password'], [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
      PDO::ATTR_EMULATE_PREPARES => false,
    ]);
  } catch (PDOException $e) {
    error_log('db: ' . $e->getMessage() . ' (dsn: ' . preg_replace('/(password|pwd)=[^;]*/i', '$1=***', $config['dsn']) . ')');
    $sqlite = str_starts_with($config['dsn'], 'sqlite:');
    fail(503, $sqlite
      ? 'Base de données non configurée : crée le fichier api/.env avec les identifiants MySQL (voir .env.example).'
      : 'Connexion à la base de données impossible : vérifie les identifiants dans api/.env.');
  }
  if (str_starts_with($config['dsn'], 'sqlite:')) {
    // En local, le schéma se crée tout seul.
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec(file_get_contents(__DIR__ . '/schema.sqlite.sql'));
  } else {
    // Première visite sur une base MySQL vide : on crée les tables (plus besoin de passer par
    // phpMyAdmin). Les instructions sont des CREATE TABLE IF NOT EXISTS : rien n'est écrasé.
    try {
      $pdo->query('SELECT 1 FROM users LIMIT 1');
    } catch (PDOException) {
      runSchema($pdo, __DIR__ . '/schema.mysql.sql');
    }
  }
  // Colonnes ajoutées après coup : créées sur les bases existantes, SQLite comme MySQL.
  try {
    $pdo->query('SELECT avatar FROM users LIMIT 1');
  } catch (PDOException) {
    $pdo->exec('ALTER TABLE users ADD COLUMN avatar VARCHAR(40) NULL');
  }
  return $pdo;
}

// Exécute un fichier .sql instruction par instruction (les commentaires « -- » sont ignorés).
function runSchema(PDO $pdo, string $file): void {
  if (!is_file($file)) return;
  $sql = preg_replace('/^s*--.*$/m', '', file_get_contents($file));
  foreach (explode(';', $sql) as $statement) {
    $statement = trim($statement);
    if ($statement === '') continue;
    try {
      $pdo->exec($statement);
    } catch (PDOException $e) {
      error_log('schema: ' . $e->getMessage());
    }
  }
}

// ─── Réponses ───
function ok(mixed $data = null, int $status = 200): never {
  http_response_code($status);
  echo json_encode($data ?? new stdClass(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function fail(int $status, string $message, array $extra = []): never {
  http_response_code($status);
  echo json_encode(['error' => $message] + $extra, JSON_UNESCAPED_UNICODE);
  exit;
}

// Corps JSON de la requête, tableau vide si absent.
function input(): array {
  static $body = null;
  if ($body === null) {
    $raw = file_get_contents('php://input');
    $body = $raw ? (json_decode($raw, true) ?? []) : [];
    if (!is_array($body)) $body = [];
  }
  return $body;
}

function action(): string {
  return (string) ($_GET['action'] ?? input()['action'] ?? '');
}

function currentUserId(): ?int {
  return isset($_SESSION['uid']) ? (int) $_SESSION['uid'] : null;
}

function requireUser(): int {
  $uid = currentUserId();
  if ($uid === null) fail(401, 'Connecte-toi pour continuer.');
  return $uid;
}

// Texte nettoyé et borné (les champs libres viennent de l'utilisateur).
function text(mixed $value, int $max): string {
  $value = is_string($value) ? trim($value) : '';
  return mb_substr($value, 0, $max);
}
