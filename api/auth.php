<?php
// Comptes : inscription, connexion, déconnexion, utilisateur courant.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

function publicUser(array $row): array {
  return ['id' => (int) $row['id'], 'email' => $row['email'], 'name' => $row['name'], 'trophies' => (int) ($row['trophies'] ?? 0)];
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
    ok(['user' => publicUser($row)]);
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

  case 'logout': {
    $_SESSION = [];
    session_destroy();
    setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => '/']);
    ok(['user' => null]);
  }

  default:
    fail(404, 'Action inconnue.');
}
