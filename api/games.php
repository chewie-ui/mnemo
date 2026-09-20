<?php
// Parties jouées : enregistrement d'un résultat, meilleurs scores, statistiques.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$uid = requireUser();

switch (action()) {
  // Un résultat de partie. Le client envoie ce que l'écran de fin affiche.
  case 'save': {
    $in = input();
    $region = text($in['region'] ?? '', 60);
    $mode = text($in['mode'] ?? '', 20);
    $score = (int) ($in['score'] ?? -1);
    $timeMs = (int) ($in['timeMs'] ?? -1);
    $errors = (int) ($in['errors'] ?? -1);
    $total = (int) ($in['total'] ?? 0);
    if ($region === '' || $mode === '' || $score < 0 || $score > 100 || $timeMs < 0 || $errors < 0 || $total < 1) {
      fail(422, 'Résultat incomplet.');
    }
    // Trophées : 1 par tranche de 10 % du premier coup, +2 pour un sans-faute, ×2 sur une grande carte.
    $trophies = intdiv($score, 10) + ($errors === 0 && $score === 100 ? 2 : 0);
    if ($total >= 40) $trophies *= 2;
    $stmt = db()->prepare('INSERT INTO games (user_id, region, mode, score, time_ms, errors, total, trophies) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    $stmt->execute([$uid, $region, $mode, $score, $timeMs, $errors, $total, $trophies]);
    db()->prepare('UPDATE users SET trophies = trophies + ? WHERE id = ?')->execute([$trophies, $uid]);
    ok(['id' => (int) db()->lastInsertId(), 'trophies' => $trophies], 201);
  }

  // Meilleur score par carte et mode : { "europe|countries": { score, timeMs } }.
  case 'bests': {
    $stmt = db()->prepare('SELECT region, mode, score, time_ms FROM games WHERE user_id = ? ORDER BY score DESC, time_ms ASC');
    $stmt->execute([$uid]);
    $bests = [];
    foreach ($stmt as $row) {
      $key = $row['region'] . '|' . $row['mode'];
      if (!isset($bests[$key])) $bests[$key] = ['score' => (int) $row['score'], 'timeMs' => (int) $row['time_ms']];
    }
    ok(['bests' => $bests ?: new stdClass()]);
  }

  // Vue d'ensemble pour la page « Mes stats ».
  case 'stats': {
    $stmt = db()->prepare('SELECT COUNT(*) AS games, COALESCE(SUM(time_ms), 0) AS time_ms, COALESCE(AVG(score), 0) AS avg_score FROM games WHERE user_id = ?');
    $stmt->execute([$uid]);
    $totals = $stmt->fetch();

    $stmt = db()->prepare('SELECT region, mode, COUNT(*) AS games, MAX(score) AS best, AVG(score) AS avg_score, MIN(time_ms) AS best_time FROM games WHERE user_id = ? GROUP BY region, mode ORDER BY games DESC, best DESC');
    $stmt->execute([$uid]);
    $perMap = array_map(fn($r) => [
      'region' => $r['region'], 'mode' => $r['mode'], 'games' => (int) $r['games'],
      'best' => (int) $r['best'], 'avg' => (int) round((float) $r['avg_score']), 'bestTime' => (int) $r['best_time'],
    ], $stmt->fetchAll());

    $stmt = db()->prepare('SELECT region, mode, score, time_ms, errors, total, played_at FROM games WHERE user_id = ? ORDER BY id DESC LIMIT 20');
    $stmt->execute([$uid]);
    $recent = array_map(fn($r) => [
      'region' => $r['region'], 'mode' => $r['mode'], 'score' => (int) $r['score'], 'timeMs' => (int) $r['time_ms'],
      'errors' => (int) $r['errors'], 'total' => (int) $r['total'], 'playedAt' => $r['played_at'],
    ], $stmt->fetchAll());

    $me = db()->prepare('SELECT trophies FROM users WHERE id = ?');
    $me->execute([$uid]);
    ok([
      'trophies' => (int) $me->fetchColumn(),
      'games' => (int) $totals['games'],
      'timeMs' => (int) $totals['time_ms'],
      'avgScore' => (int) round((float) $totals['avg_score']),
      'perMap' => $perMap,
      'recent' => $recent,
    ]);
  }

  default:
    fail(404, 'Action inconnue.');
}
