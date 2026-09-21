<?php
// Bibliothèque de cours : dossiers imbriqués, leçons (decks) rangées dedans, et notes de cours (texte).
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$uid = requireUser();

// Tables ajoutées après coup : créées à la volée sur les bases existantes (SQLite comme MySQL).
function ensureLibrary(): void {
  $db = db();
  $mysql = str_starts_with(config()['dsn'], 'mysql:');
  $db->exec($mysql
    ? 'CREATE TABLE IF NOT EXISTS folders (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id INT UNSIGNED NOT NULL, parent_id INT UNSIGNED NULL,
        name VARCHAR(120) NOT NULL, position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    : 'CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, parent_id INTEGER NULL,
        name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  $db->exec($mysql
    ? 'CREATE TABLE IF NOT EXISTS notes (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id INT UNSIGNED NOT NULL, folder_id INT UNSIGNED NULL,
        title VARCHAR(160) NOT NULL, body MEDIUMTEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    : 'CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, folder_id INTEGER NULL,
        title TEXT NOT NULL, body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  try {
    $db->query('SELECT folder_id FROM decks LIMIT 1');
  } catch (PDOException) {
    $db->exec('ALTER TABLE decks ADD COLUMN folder_id ' . ($mysql ? 'INT UNSIGNED NULL' : 'INTEGER NULL'));
  }
}
ensureLibrary();

// Un dossier de l'utilisateur, ou 404.
function ownedFolder(int $uid, int $id): array {
  $stmt = db()->prepare('SELECT id, parent_id, name FROM folders WHERE id = ? AND user_id = ?');
  $stmt->execute([$id, $uid]);
  $f = $stmt->fetch();
  if (!$f) fail(404, 'Dossier introuvable.');
  return $f;
}

// null (racine) ou l'id d'un dossier qui existe bien chez l'utilisateur.
function folderIdOrNull(int $uid, mixed $raw): ?int {
  $id = (int) ($raw ?? 0);
  if ($id <= 0) return null;
  ownedFolder($uid, $id);
  return $id;
}

// Vrai si $candidate est $folderId ou un de ses descendants (pour refuser de déplacer un dossier dans lui-même).
function isInside(int $uid, int $folderId, ?int $candidate): bool {
  $stmt = db()->prepare('SELECT parent_id FROM folders WHERE id = ? AND user_id = ?');
  for ($guard = 0; $candidate !== null && $guard < 64; $guard++) {
    if ($candidate === $folderId) return true;
    $stmt->execute([$candidate, $uid]);
    $parent = $stmt->fetchColumn();
    $candidate = $parent === false || $parent === null ? null : (int) $parent;
  }
  return false;
}

function noteRow(array $r, bool $withBody = false): array {
  $out = [
    'id' => (int) $r['id'], 'folderId' => $r['folder_id'] === null ? null : (int) $r['folder_id'],
    'title' => $r['title'], 'updatedAt' => $r['updated_at'],
    'excerpt' => mb_substr(trim(preg_replace('/\s+/u', ' ', preg_replace(['/^#+\s*/mu', '/^\s*(?:[-*>]|\d+[.)])\s+/mu', '/\*\*|==|`|\*/u', '/^-{3,}$/mu'], '', $r['body']))), 0, 140),
  ];
  if ($withBody) $out['body'] = $r['body'];
  return $out;
}

switch (action()) {
  // Toute la bibliothèque en un appel : dossiers, leçons (résumé) et notes (résumé).
  case 'tree': {
    $db = db();
    $stmt = $db->prepare('SELECT id, parent_id, name, updated_at FROM folders WHERE user_id = ? ORDER BY position, name');
    $stmt->execute([$uid]);
    $folders = array_map(fn($r) => ['id' => (int) $r['id'], 'parentId' => $r['parent_id'] === null ? null : (int) $r['parent_id'], 'name' => $r['name'], 'updatedAt' => $r['updated_at']], $stmt->fetchAll());
    $stmt = $db->prepare('SELECT d.id, d.title, d.description, d.folder_id, d.updated_at,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS cards,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND (c.due_at IS NULL OR c.due_at <= ?)) AS due,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.choices IS NOT NULL) AS qcm
      FROM decks d WHERE d.user_id = ? ORDER BY d.updated_at DESC');
    $stmt->execute([gmdate('Y-m-d H:i:s'), $uid]);
    $decks = array_map(fn($r) => [
      'id' => (int) $r['id'], 'title' => $r['title'], 'description' => $r['description'], 'folderId' => $r['folder_id'] === null ? null : (int) $r['folder_id'],
      'updatedAt' => $r['updated_at'], 'cards' => (int) $r['cards'], 'due' => (int) $r['due'], 'qcm' => (int) $r['qcm'],
    ], $stmt->fetchAll());
    $stmt = $db->prepare('SELECT id, folder_id, title, body, updated_at FROM notes WHERE user_id = ? ORDER BY updated_at DESC');
    $stmt->execute([$uid]);
    $notes = array_map(fn($r) => noteRow($r), $stmt->fetchAll());
    ok(['folders' => $folders, 'decks' => $decks, 'notes' => $notes]);
  }

  case 'folder-save': {
    $in = input();
    $name = text($in['name'] ?? '', 120);
    if ($name === '') fail(422, 'Donne un nom au dossier.');
    $id = (int) ($in['id'] ?? 0);
    $now = gmdate('Y-m-d H:i:s');
    if ($id) {
      ownedFolder($uid, $id);
      // Le parent n'est modifié que s'il est fourni (renommage seul possible).
      if (array_key_exists('parentId', $in)) {
        $parent = folderIdOrNull($uid, $in['parentId']);
        if ($parent !== null && isInside($uid, $id, $parent)) fail(422, 'Un dossier ne peut pas aller dans lui-même.');
        db()->prepare('UPDATE folders SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?')->execute([$name, $parent, $now, $id]);
      } else {
        db()->prepare('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?')->execute([$name, $now, $id]);
      }
    } else {
      $parent = folderIdOrNull($uid, $in['parentId'] ?? null);
      db()->prepare('INSERT INTO folders (user_id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')->execute([$uid, $parent, $name, $now, $now]);
      $id = (int) db()->lastInsertId();
    }
    $f = ownedFolder($uid, $id);
    ok(['folder' => ['id' => (int) $f['id'], 'parentId' => $f['parent_id'] === null ? null : (int) $f['parent_id'], 'name' => $f['name']]]);
  }

  // Supprime un dossier ; ce qu'il contenait remonte dans son parent (rien n'est perdu).
  case 'folder-delete': {
    $id = (int) (input()['id'] ?? 0);
    $f = ownedFolder($uid, $id);
    $parent = $f['parent_id'] === null ? null : (int) $f['parent_id'];
    $db = db();
    $db->beginTransaction();
    $db->prepare('UPDATE folders SET parent_id = ? WHERE parent_id = ? AND user_id = ?')->execute([$parent, $id, $uid]);
    $db->prepare('UPDATE decks SET folder_id = ? WHERE folder_id = ? AND user_id = ?')->execute([$parent, $id, $uid]);
    $db->prepare('UPDATE notes SET folder_id = ? WHERE folder_id = ? AND user_id = ?')->execute([$parent, $id, $uid]);
    $db->prepare('DELETE FROM folders WHERE id = ?')->execute([$id]);
    $db->commit();
    ok(['deleted' => $id]);
  }

  // Déplace une leçon, une note ou un dossier dans un autre dossier (null = racine).
  case 'move': {
    $in = input();
    $type = text($in['type'] ?? '', 10);
    $id = (int) ($in['id'] ?? 0);
    $target = folderIdOrNull($uid, $in['folderId'] ?? null);
    if ($type === 'folder') {
      ownedFolder($uid, $id);
      if ($target !== null && isInside($uid, $id, $target)) fail(422, 'Un dossier ne peut pas aller dans lui-même.');
      db()->prepare('UPDATE folders SET parent_id = ?, updated_at = ? WHERE id = ? AND user_id = ?')->execute([$target, gmdate('Y-m-d H:i:s'), $id, $uid]);
    } elseif ($type === 'deck') {
      $stmt = db()->prepare('UPDATE decks SET folder_id = ? WHERE id = ? AND user_id = ?');
      $stmt->execute([$target, $id, $uid]);
      if ($stmt->rowCount() === 0) fail(404, 'Leçon introuvable.');
    } elseif ($type === 'note') {
      $stmt = db()->prepare('UPDATE notes SET folder_id = ? WHERE id = ? AND user_id = ?');
      $stmt->execute([$target, $id, $uid]);
      if ($stmt->rowCount() === 0) fail(404, 'Note introuvable.');
    } else {
      fail(422, 'Type inconnu.');
    }
    ok(['ok' => true]);
  }

  case 'note-get': {
    $stmt = db()->prepare('SELECT id, folder_id, title, body, updated_at FROM notes WHERE id = ? AND user_id = ?');
    $stmt->execute([(int) ($_GET['id'] ?? 0), $uid]);
    $r = $stmt->fetch();
    if (!$r) fail(404, 'Note introuvable.');
    ok(['note' => noteRow($r, true)]);
  }

  case 'note-save': {
    $in = input();
    $title = text($in['title'] ?? '', 160);
    $body = (string) ($in['body'] ?? '');
    if ($title === '') fail(422, 'Donne un titre à la note.');
    if (strlen($body) > 200000) fail(422, 'Note trop longue (200 000 caractères maximum).');
    $folder = folderIdOrNull($uid, $in['folderId'] ?? null);
    $id = (int) ($in['id'] ?? 0);
    $now = gmdate('Y-m-d H:i:s');
    if ($id) {
      $stmt = db()->prepare('UPDATE notes SET title = ?, body = ?, folder_id = ?, updated_at = ? WHERE id = ? AND user_id = ?');
      $stmt->execute([$title, $body, $folder, $now, $id, $uid]);
      if ($stmt->rowCount() === 0 && !db()->prepare('SELECT 1 FROM notes WHERE id = ? AND user_id = ?')->execute([$id, $uid])) fail(404, 'Note introuvable.');
    } else {
      db()->prepare('INSERT INTO notes (user_id, folder_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')->execute([$uid, $folder, $title, $body, $now, $now]);
      $id = (int) db()->lastInsertId();
    }
    $stmt = db()->prepare('SELECT id, folder_id, title, body, updated_at FROM notes WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $uid]);
    $r = $stmt->fetch();
    if (!$r) fail(404, 'Note introuvable.');
    ok(['note' => noteRow($r, true)]);
  }

  case 'note-delete': {
    $id = (int) (input()['id'] ?? 0);
    $stmt = db()->prepare('DELETE FROM notes WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $uid]);
    if ($stmt->rowCount() === 0) fail(404, 'Note introuvable.');
    ok(['deleted' => $id]);
  }

  default:
    fail(404, 'Action inconnue.');
}
