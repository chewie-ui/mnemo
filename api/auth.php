<?php
// Comptes : inscription, connexion, déconnexion, utilisateur courant.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

function publicUser(array $row): array {
  return ['id' => (int) $row['id'], 'email' => $row['email'], 'name' => $row['name'], 'trophies' => (int) ($row['trophies'] ?? 0)];
}

const RESET_TTL = 3600; // un lien vaut une heure
const RESET_MAX_PER_HOUR = 3;

// Table ajoutée après coup : créée à la volée sur les bases existantes (SQLite comme MySQL).
function ensureResetTable(): void {
  $mysql = str_starts_with(config()['dsn'], 'mysql:');
  db()->exec($mysql
    ? 'CREATE TABLE IF NOT EXISTS password_resets (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id INT UNSIGNED NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL, used_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    : 'CREATE TABLE IF NOT EXISTS password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL, used_at TEXT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
}

const EMAIL_CHANGE_TTL = 86400; // un lien de confirmation vaut 24 h

function ensureEmailChangeTable(): void {
  $mysql = str_starts_with(config()['dsn'], 'mysql:');
  db()->exec($mysql
    ? 'CREATE TABLE IF NOT EXISTS email_changes (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id INT UNSIGNED NOT NULL, new_email VARCHAR(190) NOT NULL,
        token_hash CHAR(64) NOT NULL UNIQUE, expires_at DATETIME NOT NULL, used_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    : 'CREATE TABLE IF NOT EXISTS email_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, new_email TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
}

// Nouvelle adresse en attente de confirmation (ou null).
function pendingEmail(int $uid): ?string {
  ensureEmailChangeTable();
  $stmt = db()->prepare('SELECT new_email FROM email_changes WHERE user_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1');
  $stmt->execute([$uid, gmdate('Y-m-d H:i:s')]);
  $v = $stmt->fetchColumn();
  return $v === false ? null : $v;
}

// En production, mail() de l'hébergeur ; en local (SQLite, pas d'expéditeur), le message est
// écrit dans api/data/mail.log et le lien renvoyé au client pour pouvoir tester.
function sendMail(string $to, string $subject, string $body): bool {
  $from = config()['mailFrom'];
  $dev = !$from || str_starts_with(config()['dsn'], 'sqlite:');
  if ($dev) {
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) mkdir($dir, 0775, true);
    file_put_contents("$dir/mail.log", "[" . gmdate('c') . "] À : $to\nObjet : $subject\n\n$body\n\n", FILE_APPEND);
    return true;
  }
  $headers = [
    'From: Mnemo <' . $from . '>',
    'Reply-To: ' . $from,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  return mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, implode("\r\n", $headers));
}

// Adresse du site pour les liens : APP_URL / APP_ORIGIN en production, l'origine de la
// requête seulement en local (jamais une valeur envoyée par le client).
function siteUrl(): string {
  $cfg = config();
  if ($cfg['url']) return rtrim($cfg['url'], '/');
  $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
  if (str_starts_with($cfg['dsn'], 'sqlite:') && preg_match('#^https?://[\w.\-]+(:\d+)?$#', $origin)) return $origin;
  $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
  return $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
}

switch (action()) {
  case 'me': {
    $uid = currentUserId();
    if ($uid === null) ok(['user' => null]);
    $stmt = db()->prepare('SELECT id, email, name, trophies FROM users WHERE id = ?');
    $stmt->execute([$uid]);
    $row = $stmt->fetch();
    if (!$row) {
      session_destroy();
      ok(['user' => null]);
    }
    ok(['user' => publicUser($row), 'pendingEmail' => pendingEmail($uid)]);
  }

  case 'register': {
    $in = input();
    $email = mb_strtolower(text($in['email'] ?? '', 190));
    $name = text($in['name'] ?? '', 60);
    $password = (string) ($in['password'] ?? '');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail(422, 'Adresse e-mail invalide.');
    if (mb_strlen($name) < 2) fail(422, 'Choisis un pseudo d’au moins 2 caractères.');
    if (strlen($password) < 8) fail(422, 'Le mot de passe doit faire au moins 8 caractères.');
    $stmt = db()->prepare('SELECT id FROM users WHERE email = ?');
    $stmt->execute([$email]);
    if ($stmt->fetch()) fail(409, 'Un compte existe déjà avec cette adresse.');
    // Le pseudo sert à retrouver ses amis : il doit être unique.
    $stmt = db()->prepare('SELECT id FROM users WHERE LOWER(name) = LOWER(?)');
    $stmt->execute([$name]);
    if ($stmt->fetch()) fail(409, 'Ce pseudo est déjà pris.');
    $stmt = db()->prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)');
    $stmt->execute([$email, $name, password_hash($password, PASSWORD_DEFAULT)]);
    $id = (int) db()->lastInsertId();
    session_regenerate_id(true);
    $_SESSION['uid'] = $id;
    ok(['user' => ['id' => $id, 'email' => $email, 'name' => $name, 'trophies' => 0]], 201);
  }

  case 'login': {
    $in = input();
    $email = mb_strtolower(text($in['email'] ?? '', 190));
    $password = (string) ($in['password'] ?? '');
    $stmt = db()->prepare('SELECT id, email, name, trophies, password_hash FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $row = $stmt->fetch();
    // Même message dans les deux cas : on ne révèle pas si l'adresse existe.
    if (!$row || !password_verify($password, $row['password_hash'])) {
      usleep(300000);
      fail(401, 'Adresse ou mot de passe incorrect.');
    }
    if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT)) {
      db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $row['id']]);
    }
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $row['id'];
    ok(['user' => publicUser($row)]);
  }

  // Mot de passe oublié : on répond toujours pareil, qu'un compte existe ou non.
  case 'forgot': {
    $in = input();
    $email = mb_strtolower(text($in['email'] ?? '', 190));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail(422, 'Adresse e-mail invalide.');
    ensureResetTable();
    $stmt = db()->prepare('SELECT id, name FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();
    $out = ['ok' => true];
    if ($user) {
      $now = time();
      $recent = db()->prepare('SELECT COUNT(*) FROM password_resets WHERE user_id = ? AND created_at > ?');
      $recent->execute([(int) $user['id'], gmdate('Y-m-d H:i:s', $now - 3600)]);
      if ((int) $recent->fetchColumn() < RESET_MAX_PER_HOUR) {
        $token = bin2hex(random_bytes(32));
        db()->prepare('INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)')
          ->execute([(int) $user['id'], hash('sha256', $token), gmdate('Y-m-d H:i:s', $now + RESET_TTL), gmdate('Y-m-d H:i:s', $now)]);
        $link = siteUrl() . '/#/reset/' . $token;
        $body = "Bonjour {$user['name']},\n\nPour choisir un nouveau mot de passe Mnemo, ouvre ce lien (valable une heure) :\n$link\n\n"
          . "Si tu n'es pas à l'origine de cette demande, ignore simplement cet e-mail : ton mot de passe reste inchangé.\n";
        if (!sendMail($email, 'Mnemo — nouveau mot de passe', $body)) fail(500, 'Envoi de l’e-mail impossible pour le moment.');
        if (!config()['mailFrom'] || str_starts_with(config()['dsn'], 'sqlite:')) $out['debugLink'] = $link;
      }
    } else {
      usleep(300000);
    }
    ok($out);
  }

  // Nouveau mot de passe depuis le lien reçu : le lien est à usage unique et connecte directement.
  case 'reset': {
    $in = input();
    $token = text($in['token'] ?? '', 128);
    $password = (string) ($in['password'] ?? '');
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) fail(422, 'Lien invalide.');
    if (strlen($password) < 8) fail(422, 'Le mot de passe doit faire au moins 8 caractères.');
    ensureResetTable();
    $stmt = db()->prepare('SELECT r.id, r.user_id, r.expires_at, r.used_at FROM password_resets r WHERE r.token_hash = ?');
    $stmt->execute([hash('sha256', $token)]);
    $reset = $stmt->fetch();
    if (!$reset || $reset['used_at'] !== null || $reset['expires_at'] < gmdate('Y-m-d H:i:s')) fail(410, 'Ce lien a expiré ou a déjà servi. Refais une demande.');
    $db = db();
    $db->beginTransaction();
    $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), (int) $reset['user_id']]);
    $db->prepare('UPDATE password_resets SET used_at = ? WHERE id = ?')->execute([gmdate('Y-m-d H:i:s'), (int) $reset['id']]);
    $db->prepare('DELETE FROM password_resets WHERE user_id = ? AND id <> ?')->execute([(int) $reset['user_id'], (int) $reset['id']]);
    $db->commit();
    $stmt = $db->prepare('SELECT id, email, name, trophies FROM users WHERE id = ?');
    $stmt->execute([(int) $reset['user_id']]);
    $row = $stmt->fetch();
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $row['id'];
    ok(['user' => publicUser($row)]);
  }

  // Changement de pseudo : mêmes règles qu'à l'inscription (2 caractères minimum, unique).
  case 'rename': {
    $uid = requireUser();
    $name = text(input()['name'] ?? '', 60);
    if (mb_strlen($name) < 2) fail(422, 'Choisis un pseudo d’au moins 2 caractères.');
    $stmt = db()->prepare('SELECT id FROM users WHERE LOWER(name) = LOWER(?) AND id <> ?');
    $stmt->execute([$name, $uid]);
    if ($stmt->fetch()) fail(409, 'Ce pseudo est déjà pris.');
    db()->prepare('UPDATE users SET name = ? WHERE id = ?')->execute([$name, $uid]);
    $stmt = db()->prepare('SELECT id, email, name, trophies FROM users WHERE id = ?');
    $stmt->execute([$uid]);
    ok(['user' => publicUser($stmt->fetch())]);
  }

  // Changement d'adresse e-mail : mot de passe exigé, adresse valide et libre ; l'adresse ne
  // devient effective qu'après clic sur le lien envoyé à la nouvelle adresse.
  case 'email': {
    $uid = requireUser();
    $in = input();
    $email = mb_strtolower(text($in['email'] ?? '', 190));
    $password = (string) ($in['password'] ?? '');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail(422, 'Adresse e-mail invalide.');
    $stmt = db()->prepare('SELECT email, name, password_hash FROM users WHERE id = ?');
    $stmt->execute([$uid]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($password, $row['password_hash'])) {
      usleep(300000);
      fail(403, 'Mot de passe incorrect.');
    }
    if ($email === $row['email']) fail(422, 'C’est déjà ton adresse actuelle.');
    $stmt = db()->prepare('SELECT id FROM users WHERE email = ? AND id <> ?');
    $stmt->execute([$email, $uid]);
    if ($stmt->fetch()) fail(409, 'Un compte existe déjà avec cette adresse.');
    ensureEmailChangeTable();
    $now = time();
    $recent = db()->prepare('SELECT COUNT(*) FROM email_changes WHERE user_id = ? AND created_at > ?');
    $recent->execute([$uid, gmdate('Y-m-d H:i:s', $now - 3600)]);
    if ((int) $recent->fetchColumn() >= RESET_MAX_PER_HOUR) fail(429, 'Trop de demandes. Réessaie dans une heure.');
    // Une seule demande en cours : la nouvelle remplace les précédentes.
    db()->prepare('DELETE FROM email_changes WHERE user_id = ? AND used_at IS NULL')->execute([$uid]);
    $token = bin2hex(random_bytes(32));
    db()->prepare('INSERT INTO email_changes (user_id, new_email, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      ->execute([$uid, $email, hash('sha256', $token), gmdate('Y-m-d H:i:s', $now + EMAIL_CHANGE_TTL), gmdate('Y-m-d H:i:s', $now)]);
    $link = siteUrl() . '/#/confirm-email/' . $token;
    $body = "Bonjour {$row['name']},\n\nPour confirmer que cette adresse devient celle de ton compte Mnemo, ouvre ce lien (valable 24 heures) :\n$link\n\n"
      . "Si tu n'es pas à l'origine de cette demande, ignore cet e-mail : rien ne changera.\n";
    if (!sendMail($email, 'Mnemo — confirme ta nouvelle adresse', $body)) fail(500, 'Envoi de l’e-mail impossible pour le moment.');
    $out = ['pendingEmail' => $email];
    if (!config()['mailFrom'] || str_starts_with(config()['dsn'], 'sqlite:')) $out['debugLink'] = $link;
    ok($out);
  }

  // Annule la demande de changement d'adresse en cours.
  case 'cancel-email': {
    $uid = requireUser();
    ensureEmailChangeTable();
    db()->prepare('DELETE FROM email_changes WHERE user_id = ? AND used_at IS NULL')->execute([$uid]);
    ok(['ok' => true]);
  }

  // Clic sur le lien reçu à la nouvelle adresse : elle devient effective. Pas besoin d'être connecté.
  case 'confirm-email': {
    $token = text(input()['token'] ?? '', 128);
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) fail(422, 'Lien invalide.');
    ensureEmailChangeTable();
    $stmt = db()->prepare('SELECT id, user_id, new_email, expires_at, used_at FROM email_changes WHERE token_hash = ?');
    $stmt->execute([hash('sha256', $token)]);
    $change = $stmt->fetch();
    if (!$change || $change['used_at'] !== null || $change['expires_at'] < gmdate('Y-m-d H:i:s')) fail(410, 'Ce lien a expiré ou a déjà servi. Refais la demande depuis les réglages.');
    $stmt = db()->prepare('SELECT id FROM users WHERE email = ? AND id <> ?');
    $stmt->execute([$change['new_email'], (int) $change['user_id']]);
    if ($stmt->fetch()) fail(409, 'Un compte utilise déjà cette adresse.');
    $db = db();
    $db->beginTransaction();
    $db->prepare('UPDATE users SET email = ? WHERE id = ?')->execute([$change['new_email'], (int) $change['user_id']]);
    $db->prepare('UPDATE email_changes SET used_at = ? WHERE id = ?')->execute([gmdate('Y-m-d H:i:s'), (int) $change['id']]);
    $db->prepare('DELETE FROM email_changes WHERE user_id = ? AND id <> ?')->execute([(int) $change['user_id'], (int) $change['id']]);
    ensureResetTable();
    $db->prepare('DELETE FROM password_resets WHERE user_id = ?')->execute([(int) $change['user_id']]);
    $db->commit();
    ok(['email' => $change['new_email'], 'userId' => (int) $change['user_id']]);
  }

  // Changement depuis les réglages : l'ancien mot de passe est exigé.
  case 'password': {
    $uid = requireUser();
    $in = input();
    $current = (string) ($in['current'] ?? '');
    $password = (string) ($in['password'] ?? '');
    if (strlen($password) < 8) fail(422, 'Le nouveau mot de passe doit faire au moins 8 caractères.');
    $stmt = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
    $stmt->execute([$uid]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($current, $row['password_hash'])) {
      usleep(300000);
      fail(403, 'Mot de passe actuel incorrect.');
    }
    if ($current === $password) fail(422, 'Choisis un mot de passe différent de l’actuel.');
    db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $uid]);
    ensureResetTable();
    db()->prepare('DELETE FROM password_resets WHERE user_id = ?')->execute([$uid]);
    session_regenerate_id(true);
    ok(['ok' => true]);
  }

  // Suppression du compte : mot de passe exigé, tout ce qui appartient à l'utilisateur part avec
  // (parties, leçons, amis, défis, campagne). Suppressions explicites : on ne compte pas sur les cascades.
  case 'delete': {
    $uid = requireUser();
    $password = (string) (input()['password'] ?? '');
    $stmt = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
    $stmt->execute([$uid]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($password, $row['password_hash'])) {
      usleep(300000);
      fail(403, 'Mot de passe incorrect.');
    }
    ensureResetTable();
    $db = db();
    $db->beginTransaction();
    ensureEmailChangeTable();
    $db->prepare('DELETE FROM email_changes WHERE user_id = ?')->execute([$uid]);
    $db->prepare('DELETE FROM password_resets WHERE user_id = ?')->execute([$uid]);
    $db->prepare('DELETE FROM campaign_progress WHERE user_id = ?')->execute([$uid]);
    $db->prepare('DELETE FROM duel_results WHERE user_id = ? OR duel_id IN (SELECT id FROM duels WHERE challenger_id = ? OR opponent_id = ?)')->execute([$uid, $uid, $uid]);
    $db->prepare('DELETE FROM duels WHERE challenger_id = ? OR opponent_id = ?')->execute([$uid, $uid]);
    $db->prepare('DELETE FROM friendships WHERE user_id = ? OR friend_id = ?')->execute([$uid, $uid]);
    $db->prepare('DELETE FROM cards WHERE deck_id IN (SELECT id FROM decks WHERE user_id = ?)')->execute([$uid]);
    $db->prepare('DELETE FROM decks WHERE user_id = ?')->execute([$uid]);
    $db->prepare('DELETE FROM games WHERE user_id = ?')->execute([$uid]);
    $db->prepare('DELETE FROM users WHERE id = ?')->execute([$uid]);
    $db->commit();
    $_SESSION = [];
    session_destroy();
    setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => '/']);
    ok(['deleted' => true]);
  }

  case 'logout': {
    $_SESSION = [];
    session_destroy();
    setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => '/']);
    ok(['user' => null]);
  }

  default:
    fail(404, 'Action inconnue.');
}
