<?php
// Amis : recherche par pseudo, demandes, acceptation, suppression, classement.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$uid = requireUser();

// La paire est toujours rangée (petit id, grand id) : une seule ligne par duo.
function pair(int $a, int $b): array {
  return $a < $b ? [$a, $b] : [$b, $a];
}

function friendRow(array $r, int $uid): array {
  return [
    'id' => (int) $r['id'], 'name' => $r['name'], 'trophies' => (int) $r['trophies'],
    'status' => $r['status'], 'incoming' => $r['status'] === 'pending' && (int) $r['requested_by'] !== $uid,
  ];
}

// Toutes les relations de l'utilisateur, avec le pseudo et les trophées de l'autre.
// (CASE plutôt que IF/IIF, et des « ? » : portable MySQL / SQLite sans émulation de requêtes.)
function relations(int $uid): array {
  $stmt = db()->prepare('SELECT u.id, u.name, u.trophies, f.status, f.requested_by
    FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
    WHERE f.user_id = ? OR f.friend_id = ? ORDER BY u.trophies DESC, u.name');
  $stmt->execute([$uid, $uid, $uid]);
  return array_map(fn($r) => friendRow($r, $uid), $stmt->fetchAll());
}

switch (action()) {
  case 'list': {
    $me = db()->prepare('SELECT id, name, trophies FROM users WHERE id = ?');
    $me->execute([$uid]);
    $meRow = $me->fetch();
    ok(['friends' => relations($uid), 'me' => ['id' => $uid, 'name' => $meRow['name'], 'trophies' => (int) $meRow['trophies']]]);
  }

  // Pseudos qui commencent par le texte tapé (hors soi-même), 10 max.
  case 'search': {
    $q = text($_GET['q'] ?? '', 60);
    if (mb_strlen($q) < 2) ok(['users' => []]);
    $stmt = db()->prepare('SELECT id, name, trophies FROM users WHERE LOWER(name) LIKE LOWER(?) AND id <> ? ORDER BY name LIMIT 10');
    $stmt->execute([str_replace(['%', '_'], ['\\%', '\\_'], $q) . '%', $uid]);
    $known = [];
    foreach (relations($uid) as $r) $known[$r['id']] = $r['status'];
    ok(['users' => array_map(fn($r) => [
      'id' => (int) $r['id'], 'name' => $r['name'], 'trophies' => (int) $r['trophies'], 'status' => $known[(int) $r['id']] ?? null,
    ], $stmt->fetchAll())]);
  }

  case 'request': {
    $other = (int) (input()['userId'] ?? 0);
    if ($other === $uid || $other <= 0) fail(422, 'Utilisateur invalide.');
    $exists = db()->prepare('SELECT id FROM users WHERE id = ?');
    $exists->execute([$other]);
    if (!$exists->fetch()) fail(404, 'Utilisateur introuvable.');
    [$a, $b] = pair($uid, $other);
    $stmt = db()->prepare('SELECT status, requested_by FROM friendships WHERE user_id = ? AND friend_id = ?');
    $stmt->execute([$a, $b]);
    $row = $stmt->fetch();
    if ($row) {
      // L'autre m'avait déjà demandé : accepter directement.
      if ($row['status'] === 'pending' && (int) $row['requested_by'] !== $uid) {
        db()->prepare('UPDATE friendships SET status = ? WHERE user_id = ? AND friend_id = ?')->execute(['accepted', $a, $b]);
        ok(['status' => 'accepted']);
      }
      ok(['status' => $row['status']]);
    }
    db()->prepare('INSERT INTO friendships (user_id, friend_id, requested_by) VALUES (?, ?, ?)')->execute([$a, $b, $uid]);
    ok(['status' => 'pending'], 201);
  }

  case 'accept': {
    $other = (int) (input()['userId'] ?? 0);
    [$a, $b] = pair($uid, $other);
    $stmt = db()->prepare('UPDATE friendships SET status = ? WHERE user_id = ? AND friend_id = ? AND status = ? AND requested_by <> ?');
    $stmt->execute(['accepted', $a, $b, 'pending', $uid]);
    if ($stmt->rowCount() === 0) fail(404, 'Aucune demande en attente.');
    ok(['status' => 'accepted']);
  }

  // Refuser une demande ou retirer un ami : même geste.
  case 'remove': {
    $other = (int) (input()['userId'] ?? 0);
    [$a, $b] = pair($uid, $other);
    db()->prepare('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?')->execute([$a, $b]);
    ok(['removed' => $other]);
  }

  // Classement : moi et mes amis acceptés, par trophées.
  case 'leaderboard': {
    $rows = array_values(array_filter(relations($uid), fn($r) => $r['status'] === 'accepted'));
    $me = db()->prepare('SELECT id, name, trophies FROM users WHERE id = ?');
    $me->execute([$uid]);
    $meRow = $me->fetch();
    $rows[] = ['id' => $uid, 'name' => $meRow['name'], 'trophies' => (int) $meRow['trophies'], 'status' => 'me', 'incoming' => false];
    usort($rows, fn($x, $y) => $y['trophies'] <=> $x['trophies'] ?: strcmp($x['name'], $y['name']));
    ok(['ranking' => $rows]);
  }

  default:
    fail(404, 'Action inconnue.');
}
