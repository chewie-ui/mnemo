<?php
// Mémos : leçons (decks) et cartes question/réponse, avec l'état de révision espacée.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$uid = requireUser();

// Colonne « choices » (mauvaises réponses du QCM, JSON) ajoutée après coup :
// on la crée à la volée sur les bases existantes, SQLite comme MySQL.
function ensureChoicesColumn(): void {
  try {
    db()->query('SELECT choices FROM cards LIMIT 1');
  } catch (PDOException) {
    db()->exec('ALTER TABLE cards ADD COLUMN choices TEXT NULL');
  }
  // Rangement dans un dossier de la bibliothèque (voir library.php).
  try {
    db()->query('SELECT folder_id FROM decks LIMIT 1');
  } catch (PDOException) {
    db()->exec('ALTER TABLE decks ADD COLUMN folder_id ' . (str_starts_with(config()['dsn'], 'mysql:') ? 'INT UNSIGNED NULL' : 'INTEGER NULL'));
  }
}
ensureChoicesColumn();

// Partage entre amis : qui voit quelle leçon, l'état de révision de chacun sur les cartes
// des autres, et les meilleurs scores de quiz (classement).
function ensureShareTables(): void {
  $db = db();
  $mysql = str_starts_with(config()['dsn'], 'mysql:');
  $db->exec($mysql
    ? 'CREATE TABLE IF NOT EXISTS deck_shares (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, deck_id INT UNSIGNED NOT NULL, user_id INT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY (deck_id, user_id), INDEX (user_id),
        FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    : 'CREATE TABLE IF NOT EXISTS deck_shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT, deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (deck_id, user_id))');
  $db->exec($mysql
    ? 'CREATE TABLE IF NOT EXISTS card_reviews (
        user_id INT UNSIGNED NOT NULL, card_id INT UNSIGNED NOT NULL, due_at DATETIME NULL, interval_days FLOAT NOT NULL DEFAULT 0,
        ease FLOAT NOT NULL DEFAULT 2.5, reps SMALLINT UNSIGNED NOT NULL DEFAULT 0, PRIMARY KEY (user_id, card_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    : 'CREATE TABLE IF NOT EXISTS card_reviews (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        due_at TEXT NULL, interval_days REAL NOT NULL DEFAULT 0, ease REAL NOT NULL DEFAULT 2.5, reps INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, card_id))');
  $db->exec($mysql
    ? 'CREATE TABLE IF NOT EXISTS deck_scores (
        deck_id INT UNSIGNED NOT NULL, user_id INT UNSIGNED NOT NULL, best_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
        best_good SMALLINT UNSIGNED NOT NULL DEFAULT 0, best_total SMALLINT UNSIGNED NOT NULL DEFAULT 0, attempts INT UNSIGNED NOT NULL DEFAULT 0,
        last_at DATETIME NOT NULL, PRIMARY KEY (deck_id, user_id),
        FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    : 'CREATE TABLE IF NOT EXISTS deck_scores (
        deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        best_score INTEGER NOT NULL DEFAULT 0, best_good INTEGER NOT NULL DEFAULT 0, best_total INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0, last_at TEXT NOT NULL, PRIMARY KEY (deck_id, user_id))');
}
ensureShareTables();

// Amis acceptés de l'utilisateur : [id => ['id','name','avatar','trophies']].
function acceptedFriends(int $uid): array {
  $stmt = db()->prepare('SELECT u.id, u.name, u.avatar, u.trophies FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
    WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = ? ORDER BY u.name');
  $stmt->execute([$uid, $uid, $uid, 'accepted']);
  $out = [];
  foreach ($stmt as $r) $out[(int) $r['id']] = ['id' => (int) $r['id'], 'name' => $r['name'], 'avatar' => $r['avatar'], 'trophies' => (int) $r['trophies']];
  return $out;
}

// Leçon que l'utilisateur possède OU qu'un ami lui a partagée. Renvoie la ligne + 'owner_id'.
function readableDeck(int $uid, int $id): array {
  $stmt = db()->prepare('SELECT d.id, d.user_id AS owner_id, d.title, d.description, d.folder_id, d.created_at, d.updated_at,
      u.name AS owner_name, u.avatar AS owner_avatar
    FROM decks d JOIN users u ON u.id = d.user_id
    LEFT JOIN deck_shares s ON s.deck_id = d.id AND s.user_id = ?
    WHERE d.id = ? AND (d.user_id = ? OR s.id IS NOT NULL)');
  $stmt->execute([$uid, $id, $uid]);
  $deck = $stmt->fetch();
  if (!$deck) fail(404, 'Leçon introuvable.');
  return $deck;
}

function shareCount(int $deckId): int {
  $stmt = db()->prepare('SELECT COUNT(*) FROM deck_shares WHERE deck_id = ?');
  $stmt->execute([$deckId]);
  return (int) $stmt->fetchColumn();
}

// Classement d'une leçon : propriétaire + destinataires, meilleur score de quiz de chacun.
function leaderboard(int $deckId, int $ownerId): array {
  $stmt = db()->prepare('SELECT u.id, u.name, u.avatar, sc.best_score, sc.best_good, sc.best_total, sc.attempts, sc.last_at
    FROM (SELECT ? AS user_id UNION SELECT user_id FROM deck_shares WHERE deck_id = ?) p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN deck_scores sc ON sc.deck_id = ? AND sc.user_id = u.id
    ORDER BY (sc.best_score IS NULL), sc.best_score DESC, sc.last_at ASC, u.name');
  $stmt->execute([$ownerId, $deckId, $deckId]);
  return array_map(fn($r) => [
    'id' => (int) $r['id'], 'name' => $r['name'], 'avatar' => $r['avatar'], 'owner' => (int) $r['id'] === $ownerId,
    'score' => $r['best_score'] === null ? null : (int) $r['best_score'], 'good' => (int) ($r['best_good'] ?? 0), 'total' => (int) ($r['best_total'] ?? 0),
    'attempts' => (int) ($r['attempts'] ?? 0), 'lastAt' => $r['last_at'],
  ], $stmt->fetchAll());
}

// Liste de mauvaises réponses nettoyée : 5 maximum, 500 caractères chacune, sans doublon ni vide.
function cleanChoices(mixed $raw, string $back): array {
  $out = [];
  foreach (is_array($raw) ? $raw : [] as $c) {
    $t = text(is_string($c) ? $c : '', 500);
    if ($t === '' || $t === $back || in_array($t, $out, true)) continue;
    $out[] = $t;
    if (count($out) === 5) break;
  }
  return $out;
}

function ownedDeck(int $uid, int $id): array {
  $stmt = db()->prepare('SELECT id, title, description, folder_id, created_at, updated_at FROM decks WHERE id = ? AND user_id = ?');
  $stmt->execute([$id, $uid]);
  $deck = $stmt->fetch();
  if (!$deck) fail(404, 'Leçon introuvable.');
  return $deck;
}

function cardRow(array $r): array {
  return [
    'id' => (int) $r['id'], 'front' => $r['front'], 'back' => $r['back'],
    'wrong' => $r['choices'] ? (json_decode($r['choices'], true) ?: []) : [],
    'dueAt' => $r['due_at'], 'intervalDays' => (float) $r['interval_days'], 'ease' => (float) $r['ease'], 'reps' => (int) $r['reps'],
  ];
}

function deckWithCards(int $uid, int $id): array {
  $deck = readableDeck($uid, $id);
  $mine = (int) $deck['owner_id'] === $uid;
  if ($mine) {
    $stmt = db()->prepare('SELECT * FROM cards WHERE deck_id = ? ORDER BY position, id');
    $stmt->execute([$id]);
  } else {
    // Leçon d'un ami : mon propre état de révision, jamais le sien.
    $stmt = db()->prepare('SELECT c.id, c.deck_id, c.front, c.back, c.choices, c.position,
        r.due_at, COALESCE(r.interval_days, 0) AS interval_days, COALESCE(r.ease, 2.5) AS ease, COALESCE(r.reps, 0) AS reps
      FROM cards c LEFT JOIN card_reviews r ON r.card_id = c.id AND r.user_id = ? WHERE c.deck_id = ? ORDER BY c.position, c.id');
    $stmt->execute([$uid, $id]);
  }
  return [
    'id' => (int) $deck['id'], 'title' => $deck['title'], 'description' => $deck['description'],
    'folderId' => $mine && $deck['folder_id'] !== null ? (int) $deck['folder_id'] : null,
    'updatedAt' => $deck['updated_at'], 'cards' => array_map('cardRow', $stmt->fetchAll()),
    'mine' => $mine, 'sharedWith' => $mine ? shareCount($id) : 0,
    'owner' => ['id' => (int) $deck['owner_id'], 'name' => $deck['owner_name'], 'avatar' => $deck['owner_avatar']],
  ];
}

switch (action()) {
  case 'list': {
    $stmt = db()->prepare('SELECT d.id, d.title, d.description, d.folder_id, d.updated_at,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS cards,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND (c.due_at IS NULL OR c.due_at <= ?)) AS due,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.choices IS NOT NULL) AS qcm,
        (SELECT COUNT(*) FROM deck_shares s WHERE s.deck_id = d.id) AS shared_with
      FROM decks d WHERE d.user_id = ? ORDER BY d.updated_at DESC');
    $stmt->execute([gmdate('Y-m-d H:i:s'), $uid]);
    ok(['decks' => array_map(fn($r) => [
      'id' => (int) $r['id'], 'title' => $r['title'], 'description' => $r['description'], 'folderId' => $r['folder_id'] === null ? null : (int) $r['folder_id'],
      'updatedAt' => $r['updated_at'], 'cards' => (int) $r['cards'], 'due' => (int) $r['due'], 'qcm' => (int) $r['qcm'], 'sharedWith' => (int) $r['shared_with'],
    ], $stmt->fetchAll())]);
  }

  case 'get': {
    ok(['deck' => deckWithCards($uid, (int) ($_GET['id'] ?? 0))]);
  }

  // Crée ou met à jour une leçon entière (titre, description, cartes).
  // Les cartes existantes gardent leur id et leur état de révision ; les autres sont supprimées.
  case 'save': {
    $in = input();
    $title = text($in['title'] ?? '', 120);
    $description = text($in['description'] ?? '', 500);
    $cards = is_array($in['cards'] ?? null) ? $in['cards'] : [];
    if ($title === '') fail(422, 'Donne un titre à la leçon.');
    if (count($cards) > 500) fail(422, '500 cartes maximum par leçon.');
    $folderId = (int) ($in['folderId'] ?? 0);
    if ($folderId > 0) {
      $chk = db()->prepare('SELECT 1 FROM folders WHERE id = ? AND user_id = ?');
      $chk->execute([$folderId, $uid]);
      if (!$chk->fetch()) $folderId = 0;
    }
    $folder = $folderId > 0 ? $folderId : null;
    $db = db();
    $db->beginTransaction();
    $id = (int) ($in['id'] ?? 0);
    $now = gmdate('Y-m-d H:i:s');
    if ($id) {
      ownedDeck($uid, $id);
      if (array_key_exists('folderId', $in)) {
        $db->prepare('UPDATE decks SET title = ?, description = ?, folder_id = ?, updated_at = ? WHERE id = ?')->execute([$title, $description, $folder, $now, $id]);
      } else {
        $db->prepare('UPDATE decks SET title = ?, description = ?, updated_at = ? WHERE id = ?')->execute([$title, $description, $now, $id]);
      }
    } else {
      $db->prepare('INSERT INTO decks (user_id, title, description, folder_id) VALUES (?, ?, ?, ?)')->execute([$uid, $title, $description, $folder]);
      $id = (int) $db->lastInsertId();
    }
    $keep = [];
    $update = $db->prepare('UPDATE cards SET front = ?, back = ?, choices = ?, position = ? WHERE id = ? AND deck_id = ?');
    $insert = $db->prepare('INSERT INTO cards (deck_id, front, back, choices, position) VALUES (?, ?, ?, ?, ?)');
    foreach (array_values($cards) as $i => $card) {
      $front = text($card['front'] ?? '', 2000);
      $back = text($card['back'] ?? '', 2000);
      if ($front === '' || $back === '') continue;
      $wrong = cleanChoices($card['wrong'] ?? null, $back);
      $choices = $wrong ? json_encode($wrong, JSON_UNESCAPED_UNICODE) : null;
      $cardId = (int) ($card['id'] ?? 0);
      if ($cardId) {
        $update->execute([$front, $back, $choices, $i, $cardId, $id]);
        if ($update->rowCount() === 0) $cardId = 0;
      }
      if (!$cardId) {
        $insert->execute([$id, $front, $back, $choices, $i]);
        $cardId = (int) $db->lastInsertId();
      }
      $keep[] = $cardId;
    }
    if ($keep) {
      $marks = implode(',', array_fill(0, count($keep), '?'));
      $db->prepare("DELETE FROM cards WHERE deck_id = ? AND id NOT IN ($marks)")->execute([$id, ...$keep]);
    } else {
      $db->prepare('DELETE FROM cards WHERE deck_id = ?')->execute([$id]);
    }
    $db->commit();
    ok(['deck' => deckWithCards($uid, $id)]);
  }

  case 'delete': {
    $id = (int) (input()['id'] ?? 0);
    ownedDeck($uid, $id);
    db()->prepare('DELETE FROM cards WHERE deck_id = ?')->execute([$id]);
    db()->prepare('DELETE FROM decks WHERE id = ?')->execute([$id]);
    ok(['deleted' => $id]);
  }

  // Résultat d'une révision : le client calcule le nouvel état (même algorithme hors ligne).
  case 'review': {
    $in = input();
    $cardId = (int) ($in['cardId'] ?? 0);
    $stmt = db()->prepare('SELECT c.id, d.user_id AS owner_id FROM cards c JOIN decks d ON d.id = c.deck_id
      LEFT JOIN deck_shares s ON s.deck_id = d.id AND s.user_id = ?
      WHERE c.id = ? AND (d.user_id = ? OR s.id IS NOT NULL)');
    $stmt->execute([$uid, $cardId, $uid]);
    $card = $stmt->fetch();
    if (!$card) fail(404, 'Carte introuvable.');
    $dueAt = text($in['dueAt'] ?? '', 19);
    if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $dueAt)) fail(422, 'Date invalide.');
    $vals = [max(0, (float) ($in['intervalDays'] ?? 0)), max(1.3, (float) ($in['ease'] ?? 2.5)), max(0, (int) ($in['reps'] ?? 0))];
    if ((int) $card['owner_id'] === $uid) {
      db()->prepare('UPDATE cards SET due_at = ?, interval_days = ?, ease = ?, reps = ? WHERE id = ?')->execute([$dueAt, ...$vals, $cardId]);
    } else {
      $upd = db()->prepare('UPDATE card_reviews SET due_at = ?, interval_days = ?, ease = ?, reps = ? WHERE user_id = ? AND card_id = ?');
      $upd->execute([$dueAt, ...$vals, $uid, $cardId]);
      if ($upd->rowCount() === 0) {
        db()->prepare('INSERT INTO card_reviews (user_id, card_id, due_at, interval_days, ease, reps) VALUES (?, ?, ?, ?, ?, ?)')->execute([$uid, $cardId, $dueAt, ...$vals]);
      }
    }
    ok(['ok' => true]);
  }

  // ─── Partage entre amis ───
  // Amis avec qui la leçon est partagée + tous mes amis (pour la fenêtre de partage).
  case 'share-list': {
    $id = (int) ($_GET['id'] ?? 0);
    ownedDeck($uid, $id);
    $stmt = db()->prepare('SELECT user_id FROM deck_shares WHERE deck_id = ?');
    $stmt->execute([$id]);
    ok(['sharedWith' => array_map(fn($r) => (int) $r['user_id'], $stmt->fetchAll()), 'friends' => array_values(acceptedFriends($uid))]);
  }

  // Remplace la liste des destinataires (uniquement des amis acceptés).
  case 'share-set': {
    $in = input();
    $id = (int) ($in['id'] ?? 0);
    ownedDeck($uid, $id);
    $friends = acceptedFriends($uid);
    $ids = array_values(array_unique(array_filter(array_map('intval', (array) ($in['userIds'] ?? [])), fn($x) => isset($friends[$x]))));
    $db = db();
    $db->beginTransaction();
    $db->prepare('DELETE FROM deck_shares WHERE deck_id = ?')->execute([$id]);
    $ins = $db->prepare('INSERT INTO deck_shares (deck_id, user_id, created_at) VALUES (?, ?, ?)');
    foreach ($ids as $fid) $ins->execute([$id, $fid, gmdate('Y-m-d H:i:s')]);
    $db->commit();
    ok(['sharedWith' => $ids]);
  }

  // Leçons que des amis m'ont partagées.
  case 'shared': {
    $stmt = db()->prepare('SELECT d.id, d.title, d.description, d.updated_at, u.id AS owner_id, u.name AS owner_name, u.avatar AS owner_avatar, s.created_at AS shared_at,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS cards,
        (SELECT COUNT(*) FROM cards c LEFT JOIN card_reviews r ON r.card_id = c.id AND r.user_id = s.user_id WHERE c.deck_id = d.id AND (r.due_at IS NULL OR r.due_at <= ?)) AS due,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.choices IS NOT NULL) AS qcm,
        (SELECT best_score FROM deck_scores sc WHERE sc.deck_id = d.id AND sc.user_id = s.user_id) AS my_best
      FROM deck_shares s JOIN decks d ON d.id = s.deck_id JOIN users u ON u.id = d.user_id
      WHERE s.user_id = ? ORDER BY s.created_at DESC');
    $stmt->execute([gmdate('Y-m-d H:i:s'), $uid]);
    ok(['decks' => array_map(fn($r) => [
      'id' => (int) $r['id'], 'title' => $r['title'], 'description' => $r['description'], 'updatedAt' => $r['updated_at'], 'sharedAt' => $r['shared_at'],
      'cards' => (int) $r['cards'], 'due' => (int) $r['due'], 'qcm' => (int) $r['qcm'], 'myBest' => $r['my_best'] === null ? null : (int) $r['my_best'],
      'owner' => ['id' => (int) $r['owner_id'], 'name' => $r['owner_name'], 'avatar' => $r['owner_avatar']],
    ], $stmt->fetchAll())]);
  }

  // Résultat d'un quiz : on garde le meilleur, et on renvoie le classement à jour.
  case 'score': {
    $in = input();
    $id = (int) ($in['id'] ?? 0);
    $deck = readableDeck($uid, $id);
    $good = max(0, (int) ($in['good'] ?? 0));
    $total = max(1, (int) ($in['total'] ?? 0));
    $good = min($good, $total);
    $score = (int) round($good / $total * 100);
    $now = gmdate('Y-m-d H:i:s');
    $stmt = db()->prepare('SELECT best_score FROM deck_scores WHERE deck_id = ? AND user_id = ?');
    $stmt->execute([$id, $uid]);
    $prev = $stmt->fetchColumn();
    if ($prev === false) {
      db()->prepare('INSERT INTO deck_scores (deck_id, user_id, best_score, best_good, best_total, attempts, last_at) VALUES (?, ?, ?, ?, ?, 1, ?)')->execute([$id, $uid, $score, $good, $total, $now]);
    } elseif ($score > (int) $prev) {
      db()->prepare('UPDATE deck_scores SET best_score = ?, best_good = ?, best_total = ?, attempts = attempts + 1, last_at = ? WHERE deck_id = ? AND user_id = ?')->execute([$score, $good, $total, $now, $id, $uid]);
    } else {
      db()->prepare('UPDATE deck_scores SET attempts = attempts + 1 WHERE deck_id = ? AND user_id = ?')->execute([$id, $uid]);
    }
    ok(['score' => $score, 'best' => max($score, (int) $prev), 'isBest' => $prev === false || $score > (int) $prev, 'ranking' => leaderboard($id, (int) $deck['owner_id'])]);
  }

  case 'leaderboard': {
    $id = (int) ($_GET['id'] ?? 0);
    $deck = readableDeck($uid, $id);
    ok(['ranking' => leaderboard($id, (int) $deck['owner_id']), 'sharedWith' => shareCount($id)]);
  }

  // Copie d'une leçon partagée dans mes cours (à la racine), pour la modifier à ma guise.
  case 'copy': {
    $id = (int) (input()['id'] ?? 0);
    $deck = readableDeck($uid, $id);
    $db = db();
    $db->beginTransaction();
    $db->prepare('INSERT INTO decks (user_id, title, description) VALUES (?, ?, ?)')->execute([$uid, mb_substr($deck['title'], 0, 120), $deck['description']]);
    $newId = (int) $db->lastInsertId();
    $stmt = $db->prepare('SELECT front, back, choices, position FROM cards WHERE deck_id = ? ORDER BY position, id');
    $stmt->execute([$id]);
    $ins = $db->prepare('INSERT INTO cards (deck_id, front, back, choices, position) VALUES (?, ?, ?, ?, ?)');
    foreach ($stmt as $c) $ins->execute([$newId, $c['front'], $c['back'], $c['choices'], $c['position']]);
    $db->commit();
    ok(['deck' => deckWithCards($uid, $newId)]);
  }

  default:
    fail(404, 'Action inconnue.');
}
