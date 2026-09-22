<?php
// Campagne : progression par niveau (étoiles), trophées pour chaque nouvelle étoile
// et pour un chapitre terminé. Le client envoie la liste des niveaux du chapitre pour
// que le serveur puisse constater qu'il est complet.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$uid = requireUser();

const STAR_TROPHIES = 2;
const CHAPTER_TROPHIES = 20;

switch (action()) {
  case 'list': {
    $stmt = db()->prepare('SELECT level_id, stars, score, time_ms FROM campaign_progress WHERE user_id = ?');
    $stmt->execute([$uid]);
    $progress = [];
    foreach ($stmt as $r) {
      $progress[$r['level_id']] = ['stars' => (int) $r['stars'], 'score' => (int) $r['score'], 'timeMs' => (int) $r['time_ms']];
    }
    ok(['progress' => $progress ?: new stdClass()]);
  }

  // Résultat d'un niveau : on garde le meilleur, on paie les étoiles gagnées en plus.
  case 'save': {
    $in = input();
    $levelId = text($in['levelId'] ?? '', 40);
    $stars = max(0, min(3, (int) ($in['stars'] ?? 0)));
    $score = max(0, min(100, (int) ($in['score'] ?? 0)));
    $timeMs = max(0, (int) ($in['timeMs'] ?? 0));
    $chapterLevels = array_values(array_filter(array_map(fn($x) => text($x, 40), (array) ($in['chapterLevels'] ?? []))));
    if ($levelId === '') fail(422, 'Niveau inconnu.');

    $db = db();
    $db->beginTransaction();
    $stmt = $db->prepare('SELECT stars, score, time_ms FROM campaign_progress WHERE user_id = ? AND level_id = ?');
    $stmt->execute([$uid, $levelId]);
    $prev = $stmt->fetch();
    $prevStars = $prev ? (int) $prev['stars'] : 0;
    $now = gmdate('Y-m-d H:i:s');
    if (!$prev) {
      $db->prepare('INSERT INTO campaign_progress (user_id, level_id, stars, score, time_ms, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$uid, $levelId, $stars, $score, $timeMs, $now]);
    } elseif ($stars > $prevStars || ($stars === $prevStars && ($score > (int) $prev['score'] || ($score === (int) $prev['score'] && $timeMs < (int) $prev['time_ms'])))) {
      $db->prepare('UPDATE campaign_progress SET stars = ?, score = ?, time_ms = ?, updated_at = ? WHERE user_id = ? AND level_id = ?')
        ->execute([max($stars, $prevStars), $score, $timeMs, $now, $uid, $levelId]);
    }
    $newStars = max(0, $stars - $prevStars);
    $trophies = $newStars * STAR_TROPHIES;

    // Chapitre terminé pour la première fois ? (tous ses niveaux ont au moins une étoile)
    $chapterDone = false;
    if ($newStars > 0 && $prevStars === 0 && $chapterLevels) {
      $marks = implode(',', array_fill(0, count($chapterLevels), '?'));
      $stmt = $db->prepare("SELECT COUNT(*) FROM campaign_progress WHERE user_id = ? AND stars > 0 AND level_id IN ($marks)");
      $stmt->execute([$uid, ...$chapterLevels]);
      if ((int) $stmt->fetchColumn() === count($chapterLevels)) {
        $chapterDone = true;
        $trophies += CHAPTER_TROPHIES;
      }
    }
    if ($trophies > 0) $db->prepare('UPDATE users SET trophies = trophies + ? WHERE id = ?')->execute([$trophies, $uid]);
    $db->commit();
    ok(['stars' => max($stars, $prevStars), 'newStars' => $newStars, 'trophies' => $trophies, 'chapterDone' => $chapterDone]);
  }

  default:
    fail(404, 'Action inconnue.');
}
