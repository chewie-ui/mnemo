<?php
// Défis entre amis : même carte, même ordre de questions (seed), chacun joue quand il veut
// (ou en même temps : la progression de l'autre est relue régulièrement).
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$uid = requireUser();

const DUEL_WIN_TROPHIES = 5;

const DUEL_SELECT = 'SELECT d.*, c.name AS challenger_name, c.trophies AS challenger_trophies, o.name AS opponent_name, o.trophies AS opponent_trophies
    FROM duels d JOIN users c ON c.id = d.challenger_id JOIN users o ON o.id = d.opponent_id';

function duelRow(int $uid, int $id): array {
  $stmt = db()->prepare(DUEL_SELECT . ' WHERE d.id = ? AND (d.challenger_id = ? OR d.opponent_id = ?)');
  $stmt->execute([$id, $uid, $uid]);
  $d = $stmt->fetch();
  if (!$d) fail(404, 'Défi introuvable.');
  return $d;
}

function results(int $duelId): array {
  $stmt = db()->prepare('SELECT user_id, progress, score, time_ms, errors, finished_at FROM duel_results WHERE duel_id = ?');
  $stmt->execute([$duelId]);
  $out = [];
  foreach ($stmt as $r) {
    $out[(int) $r['user_id']] = [
      'progress' => (int) $r['progress'], 'score' => $r['score'] === null ? null : (int) $r['score'],
      'timeMs' => $r['time_ms'] === null ? null : (int) $r['time_ms'], 'errors' => $r['errors'] === null ? null : (int) $r['errors'],
      'finished' => $r['finished_at'] !== null,
    ];
  }
  return $out;
}

function publicDuel(int $uid, array $d): array {
  $res = results((int) $d['id']);
  $isChallenger = (int) $d['challenger_id'] === $uid;
  $otherId = $isChallenger ? (int) $d['opponent_id'] : (int) $d['challenger_id'];
  $empty = ['progress' => 0, 'score' => null, 'timeMs' => null, 'errors' => null, 'finished' => false];
  return [
    'id' => (int) $d['id'], 'region' => $d['region'], 'mode' => $d['mode'], 'seed' => (int) $d['seed'], 'status' => $d['status'],
    'createdAt' => $d['created_at'], 'isChallenger' => $isChallenger,
    'opponent' => [
      'id' => $otherId,
      'name' => $isChallenger ? $d['opponent_name'] : $d['challenger_name'],
      'trophies' => (int) ($isChallenger ? $d['opponent_trophies'] : $d['challenger_trophies']),
    ],
    'self' => [
      'id' => $uid,
      'name' => $isChallenger ? $d['challenger_name'] : $d['opponent_name'],
      'trophies' => (int) ($isChallenger ? $d['challenger_trophies'] : $d['opponent_trophies']),
    ],
    'me' => $res[$uid] ?? $empty, 'them' => $res[$otherId] ?? $empty,
    'winnerId' => $d['winner_id'] === null ? null : (int) $d['winner_id'],
  ];
}

// Le défi est-il jouable maintenant ? Seulement une fois accepté par l'adversaire.
function playable(int $uid, array $d): bool {
  return $d['status'] === 'accepted';
}

switch (action()) {
  case 'create': {
    $in = input();
    $opponent = (int) ($in['opponentId'] ?? 0);
    $region = text($in['region'] ?? '', 60);
    $mode = text($in['mode'] ?? '', 20);
    if ($opponent <= 0 || $opponent === $uid || $region === '' || $mode === '') fail(422, 'Défi incomplet.');
    [$a, $b] = $uid < $opponent ? [$uid, $opponent] : [$opponent, $uid];
    $stmt = db()->prepare('SELECT id FROM friendships WHERE user_id = ? AND friend_id = ? AND status = ?');
    $stmt->execute([$a, $b, 'accepted']);
    if (!$stmt->fetch()) fail(403, 'Vous devez être amis pour vous défier.');
    $seed = random_int(1, 2_000_000_000);
    db()->prepare('INSERT INTO duels (challenger_id, opponent_id, region, mode, seed) VALUES (?, ?, ?, ?, ?)')->execute([$uid, $opponent, $region, $mode, $seed]);
    $id = (int) db()->lastInsertId();
    $ins = db()->prepare('INSERT INTO duel_results (duel_id, user_id) VALUES (?, ?)');
    $ins->execute([$id, $uid]);
    $ins->execute([$id, $opponent]);
    ok(['duel' => publicDuel($uid, duelRow($uid, $id))], 201);
  }

  case 'list': {
    $stmt = db()->prepare(DUEL_SELECT . ' WHERE d.challenger_id = ? OR d.opponent_id = ? ORDER BY d.id DESC LIMIT 50');
    $stmt->execute([$uid, $uid]);
    ok(['duels' => array_map(fn($d) => publicDuel($uid, $d), $stmt->fetchAll())]);
  }

  // Invitations en attente pour moi (notification) et défis acceptés que je n'ai pas encore joués.
  case 'inbox': {
    $stmt = db()->prepare(DUEL_SELECT . ' WHERE d.opponent_id = ? AND d.status = ? ORDER BY d.id DESC LIMIT 10');
    $stmt->execute([$uid, 'pending']);
    $invites = array_map(fn($d) => publicDuel($uid, $d), $stmt->fetchAll());
    $stmt = db()->prepare(DUEL_SELECT . ' JOIN duel_results r ON r.duel_id = d.id AND r.user_id = ?
      WHERE (d.challenger_id = ? OR d.opponent_id = ?) AND d.status = ? AND r.finished_at IS NULL ORDER BY d.id DESC LIMIT 10');
    $stmt->execute([$uid, $uid, $uid, 'accepted']);
    $ready = array_map(fn($d) => publicDuel($uid, $d), $stmt->fetchAll());
    ok(['invites' => $invites, 'ready' => $ready]);
  }

  // Le lanceur retire son invitation tant qu'elle n'est pas acceptée.
  case 'cancel': {
    $d = duelRow($uid, (int) (input()['id'] ?? 0));
    if ((int) $d['challenger_id'] !== $uid || $d['status'] !== 'pending') fail(409, 'Ce défi ne peut plus être annulé.');
    db()->prepare('DELETE FROM duel_results WHERE duel_id = ?')->execute([$d['id']]);
    db()->prepare('DELETE FROM duels WHERE id = ?')->execute([$d['id']]);
    ok(['cancelled' => (int) $d['id']]);
  }

  case 'get': {
    ok(['duel' => publicDuel($uid, duelRow($uid, (int) ($_GET['id'] ?? 0)))]);
  }

  case 'accept': {
    $d = duelRow($uid, (int) (input()['id'] ?? 0));
    if ((int) $d['opponent_id'] !== $uid || $d['status'] !== 'pending') fail(409, 'Ce défi ne peut plus être accepté.');
    db()->prepare('UPDATE duels SET status = ? WHERE id = ?')->execute(['accepted', $d['id']]);
    ok(['duel' => publicDuel($uid, duelRow($uid, (int) $d['id']))]);
  }

  case 'decline': {
    $d = duelRow($uid, (int) (input()['id'] ?? 0));
    if ($d['status'] !== 'pending') fail(409, 'Ce défi ne peut plus être refusé.');
    db()->prepare('UPDATE duels SET status = ? WHERE id = ?')->execute(['declined', $d['id']]);
    ok(['duel' => publicDuel($uid, duelRow($uid, (int) $d['id']))]);
  }

  // Avancement en cours de partie (nombre de réponses données), relu par l'adversaire.
  case 'progress': {
    $in = input();
    $d = duelRow($uid, (int) ($in['id'] ?? 0));
    if (!playable($uid, $d)) fail(409, 'Défi terminé.');
    db()->prepare('UPDATE duel_results SET progress = ?, updated_at = ? WHERE duel_id = ? AND user_id = ? AND finished_at IS NULL')
      ->execute([max(0, (int) ($in['progress'] ?? 0)), gmdate('Y-m-d H:i:s'), $d['id'], $uid]);
    ok(['duel' => publicDuel($uid, $d)]);
  }

  // Résultat final : compte aussi comme une partie normale (stats, trophées) ; le gagnant
  // est celui qui a le meilleur score, puis le meilleur temps.
  case 'finish': {
    $in = input();
    $d = duelRow($uid, (int) ($in['id'] ?? 0));
    if (!playable($uid, $d)) fail(409, 'Défi terminé.');
    $score = (int) ($in['score'] ?? -1);
    $timeMs = (int) ($in['timeMs'] ?? -1);
    $errors = (int) ($in['errors'] ?? -1);
    $total = (int) ($in['total'] ?? 0);
    if ($score < 0 || $score > 100 || $timeMs < 0 || $errors < 0 || $total < 1) fail(422, 'Résultat incomplet.');
    $current = results((int) $d['id'])[$uid] ?? null;
    if ($current && $current['finished']) fail(409, 'Tu as déjà joué ce défi.');
    $db = db();
    $db->beginTransaction();
    $now = gmdate('Y-m-d H:i:s');
    $db->prepare('UPDATE duel_results SET progress = ?, score = ?, time_ms = ?, errors = ?, updated_at = ?, finished_at = ? WHERE duel_id = ? AND user_id = ?')
      ->execute([$total, $score, $timeMs, $errors, $now, $now, $d['id'], $uid]);
    $trophies = intdiv($score, 10) + ($errors === 0 && $score === 100 ? 2 : 0);
    if ($total >= 40) $trophies *= 2;
    $db->prepare('INSERT INTO games (user_id, region, mode, score, time_ms, errors, total, trophies) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      ->execute([$uid, $d['region'], $d['mode'], $score, $timeMs, $errors, $total, $trophies]);
    $db->prepare('UPDATE users SET trophies = trophies + ? WHERE id = ?')->execute([$trophies, $uid]);

    $res = results((int) $d['id']);
    $both = count(array_filter($res, fn($r) => $r['finished'])) === 2;
    $winner = null;
    if ($both) {
      [$x, $y] = array_keys($res);
      $rx = $res[$x];
      $ry = $res[$y];
      if ($rx['score'] !== $ry['score']) $winner = $rx['score'] > $ry['score'] ? $x : $y;
      elseif ($rx['timeMs'] !== $ry['timeMs']) $winner = $rx['timeMs'] < $ry['timeMs'] ? $x : $y;
      $db->prepare('UPDATE duels SET status = ?, winner_id = ? WHERE id = ?')->execute(['finished', $winner, $d['id']]);
      if ($winner !== null) $db->prepare('UPDATE users SET trophies = trophies + ? WHERE id = ?')->execute([DUEL_WIN_TROPHIES, $winner]);
    }
    $db->commit();
    ok(['duel' => publicDuel($uid, duelRow($uid, (int) $d['id'])), 'trophies' => $trophies]);
  }

  default:
    fail(404, 'Action inconnue.');
}
