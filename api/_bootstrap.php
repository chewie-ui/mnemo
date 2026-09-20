<?php
// Socle commun de l'API : config, base de données, session, réponses JSON.
// Chaque point d'entrée (auth.php, games.php, decks.php) commence par `require __DIR__ . '/_bootstrap.php';`.

declare(strict_types=1);

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
  $pdo = new PDO($config['dsn'], $config['user'], $config['password'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
  ]);
  if (str_starts_with($config['dsn'], 'sqlite:')) {
    // En local, le schéma se crée tout seul.
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec(file_get_contents(__DIR__ . '/schema.sqlite.sql'));
  }
  return $pdo;
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
