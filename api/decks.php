<?php
// Mémos : leçons (decks) et cartes question/réponse, avec l'état de révision espacée.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$uid = requireUser();

function ownedDeck(int $uid, int $id): array {
  $stmt = db()->prepare('SELECT id, title, description, created_at, updated_at FROM decks WHERE id = ? AND user_id = ?');
  $stmt->execute([$id, $uid]);
  $deck = $stmt->fetch();
  if (!$deck) fail(404, 'Leçon introuvable.');
  return $deck;
}

function cardRow(array $r): array {
  return [
    'id' => (int) $r['id'], 'front' => $r['front'], 'back' => $r['back'],
    'dueAt' => $r['due_at'], 'intervalDays' => (float) $r['interval_days'], 'ease' => (float) $r['ease'], 'reps' => (int) $r['reps'],
  ];
}

function deckWithCards(int $uid, int $id): array {
  $deck = ownedDeck($uid, $id);
  $stmt = db()->prepare('SELECT * FROM cards WHERE deck_id = ? ORDER BY position, id');
  $stmt->execute([$id]);
  return [
    'id' => (int) $deck['id'], 'title' => $deck['title'], 'description' => $deck['description'],
    'updatedAt' => $deck['updated_at'], 'cards' => array_map('cardRow', $stmt->fetchAll()),
  ];
}

switch (action()) {
  case 'list': {
    $stmt = db()->prepare('SELECT d.id, d.title, d.description, d.updated_at,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS cards,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND (c.due_at IS NULL OR c.due_at <= ?)) AS due
      FROM decks d WHERE d.user_id = ? ORDER BY d.updated_at DESC');
    $stmt->execute([gmdate('Y-m-d H:i:s'), $uid]);
    ok(['decks' => array_map(fn($r) => [
      'id' => (int) $r['id'], 'title' => $r['title'], 'description' => $r['description'],
      'updatedAt' => $r['updated_at'], 'cards' => (int) $r['cards'], 'due' => (int) $r['due'],
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
    $db = db();
    $db->beginTransaction();
    $id = (int) ($in['id'] ?? 0);
    $now = gmdate('Y-m-d H:i:s');
    if ($id) {
      ownedDeck($uid, $id);
      $db->prepare('UPDATE decks SET title = ?, description = ?, updated_at = ? WHERE id = ?')->execute([$title, $description, $now, $id]);
    } else {
      $db->prepare('INSERT INTO decks (user_id, title, description) VALUES (?, ?, ?)')->execute([$uid, $title, $description]);
      $id = (int) $db->lastInsertId();
    }
    $keep = [];
    $update = $db->prepare('UPDATE cards SET front = ?, back = ?, position = ? WHERE id = ? AND deck_id = ?');
    $insert = $db->prepare('INSERT INTO cards (deck_id, front, back, position) VALUES (?, ?, ?, ?)');
    foreach (array_values($cards) as $i => $card) {
      $front = text($card['front'] ?? '', 2000);
      $back = text($card['back'] ?? '', 2000);
      if ($front === '' || $back === '') continue;
      $cardId = (int) ($card['id'] ?? 0);
      if ($cardId) {
        $update->execute([$front, $back, $i, $cardId, $id]);
        if ($update->rowCount() === 0) $cardId = 0;
      }
      if (!$cardId) {
        $insert->execute([$id, $front, $back, $i]);
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
    $stmt = db()->prepare('SELECT c.id FROM cards c JOIN decks d ON d.id = c.deck_id WHERE c.id = ? AND d.user_id = ?');
    $stmt->execute([$cardId, $uid]);
    if (!$stmt->fetch()) fail(404, 'Carte introuvable.');
    $dueAt = text($in['dueAt'] ?? '', 19);
    if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $dueAt)) fail(422, 'Date invalide.');
    db()->prepare('UPDATE cards SET due_at = ?, interval_days = ?, ease = ?, reps = ? WHERE id = ?')
      ->execute([$dueAt, max(0, (float) ($in['intervalDays'] ?? 0)), max(1.3, (float) ($in['ease'] ?? 2.5)), max(0, (int) ($in['reps'] ?? 0)), $cardId]);
    ok(['ok' => true]);
  }

  default:
    fail(404, 'Action inconnue.');
}
