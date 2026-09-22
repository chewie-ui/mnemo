<?php
// IA : génération de quiz à partir d'un cours (texte ou PDF) et complétion d'une carte
// (réponse + mauvaises réponses). Appelle l'API Claude d'Anthropic côté serveur avec la clé
// du .env (ANTHROPIC_API_KEY) : la clé ne sort jamais du serveur. Quota journalier par compte.
//
// Appel HTTP direct (curl) plutôt que le SDK PHP officiel : l'hébergement est déployé par
// simple copie de fichiers, sans Composer ni dossier vendor.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$uid = requireUser();

const AI_MAX_TEXT = 120000; // caractères de cours acceptés par génération
const AI_MAX_PDF = 12 * 1024 * 1024; // octets (base64 décodé)

function aiConfig(): array {
  $env = fn(string $k, ?string $d = null) => (getenv($k) !== false && getenv($k) !== '') ? getenv($k) : $d;
  return [
    'key' => $env('ANTHROPIC_API_KEY'),
    'model' => $env('AI_MODEL', 'claude-opus-5'),
    'limit' => max(1, (int) $env('AI_DAILY_LIMIT', '40')),
    'cainfo' => $env('CA_BUNDLE'),
  ];
}

function ensureUsageTable(): void {
  $mysql = str_starts_with(config()['dsn'], 'mysql:');
  db()->exec($mysql
    ? 'CREATE TABLE IF NOT EXISTS ai_usage (user_id INT UNSIGNED NOT NULL, day CHAR(10) NOT NULL, count INT UNSIGNED NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    : 'CREATE TABLE IF NOT EXISTS ai_usage (user_id INTEGER NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))');
}

function usedToday(int $uid): int {
  $stmt = db()->prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?');
  $stmt->execute([$uid, gmdate('Y-m-d')]);
  $v = $stmt->fetchColumn();
  return $v === false ? 0 : (int) $v;
}

function consume(int $uid): void {
  $day = gmdate('Y-m-d');
  $upd = db()->prepare('UPDATE ai_usage SET count = count + 1 WHERE user_id = ? AND day = ?');
  $upd->execute([$uid, $day]);
  if ($upd->rowCount() === 0) db()->prepare('INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1)')->execute([$uid, $day]);
}

function requireQuota(int $uid, array $cfg): void {
  if (!$cfg['key']) fail(503, 'L’IA n’est pas configurée sur ce serveur (ANTHROPIC_API_KEY manquante dans le .env).');
  if (usedToday($uid) >= $cfg['limit']) fail(429, "Quota IA du jour atteint ({$cfg['limit']} générations). Réessaie demain.");
}

// Appel à POST /v1/messages avec une sortie JSON contrainte par un schéma. Renvoie le JSON décodé.
function askClaude(array $cfg, string $system, array $userContent, array $schema, int $maxTokens = 16000): array {
  $payload = [
    'model' => $cfg['model'],
    'max_tokens' => $maxTokens,
    'system' => $system,
    'messages' => [['role' => 'user', 'content' => $userContent]],
    'output_config' => ['effort' => 'medium', 'format' => ['type' => 'json_schema', 'schema' => $schema]],
  ];
  $ch = curl_init('https://api.anthropic.com/v1/messages');
  curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 240,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-api-key: ' . $cfg['key'], 'anthropic-version: 2023-06-01'],
    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
  ]);
  if ($cfg['cainfo']) curl_setopt($ch, CURLOPT_CAINFO, $cfg['cainfo']);
  $raw = curl_exec($ch);
  if ($raw === false) {
    $err = curl_error($ch);
    curl_close($ch);
    error_log("ai: curl error: $err");
    fail(502, 'Impossible de joindre l’IA pour le moment.');
  }
  $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  curl_close($ch);
  $res = json_decode($raw, true);
  if ($status === 401) fail(503, 'Clé d’API IA refusée : vérifie ANTHROPIC_API_KEY.');
  if ($status === 429) fail(429, 'L’IA est saturée, réessaie dans une minute.');
  if ($status >= 400 || !is_array($res)) {
    error_log('ai: HTTP ' . $status . ' ' . substr($raw, 0, 500));
    fail(502, 'L’IA a renvoyé une erreur (' . ($res['error']['message'] ?? "HTTP $status") . ').');
  }
  if (($res['stop_reason'] ?? '') === 'refusal') fail(422, 'L’IA a refusé ce contenu.');
  if (($res['stop_reason'] ?? '') === 'max_tokens') fail(422, 'Cours trop long pour une seule génération : découpe-le ou demande moins de questions.');
  $text = '';
  foreach ($res['content'] ?? [] as $block) {
    if (($block['type'] ?? '') === 'text') {
      $text = $block['text'];
      break;
    }
  }
  $data = json_decode($text, true);
  if (!is_array($data)) fail(502, 'Réponse de l’IA illisible.');
  return $data;
}

// Nettoyage d'une carte générée : longueurs, doublons, 3 mauvaises réponses maximum distinctes.
function cleanCard(array $c): ?array {
  $front = text((string) ($c['question'] ?? ''), 300);
  $back = text((string) ($c['answer'] ?? ''), 500);
  if ($front === '' || $back === '') return null;
  $wrong = [];
  foreach ((array) ($c['wrong'] ?? []) as $w) {
    $t = text((string) $w, 500);
    if ($t === '' || mb_strtolower($t) === mb_strtolower($back) || in_array($t, $wrong, true)) continue;
    $wrong[] = $t;
    if (count($wrong) === 3) break;
  }
  return ['front' => $front, 'back' => $back, 'wrong' => $wrong];
}

const CARDS_SCHEMA = [
  'type' => 'object',
  'properties' => [
    'cards' => [
      'type' => 'array',
      'items' => [
        'type' => 'object',
        'properties' => [
          'question' => ['type' => 'string'],
          'answer' => ['type' => 'string'],
          'wrong' => ['type' => 'array', 'items' => ['type' => 'string']],
        ],
        'required' => ['question', 'answer', 'wrong'],
        'additionalProperties' => false,
      ],
    ],
  ],
  'required' => ['cards'],
  'additionalProperties' => false,
];

const GENERATE_SYSTEM = <<<'TXT'
Tu es un enseignant qui prépare des quiz de révision à partir du cours fourni par un étudiant.
Tu produis des cartes question → réponse, chacune avec trois mauvaises réponses pour un QCM.

Règles :
- Rédige dans la langue du cours (français par défaut). Tutoie, pas de préambule.
- Couvre l'ensemble du cours, du plus important au plus secondaire, sans te répéter : définitions, notions clés, dates, chiffres, auteurs, mécanismes, exemples marquants.
- Chaque question est autonome (compréhensible sans le cours), précise et sans ambiguïté ; pas de « laquelle de ces propositions… », pas de vrai/faux.
- La réponse est courte (un mot, une expression ou une phrase brève, 120 caractères maximum) et strictement exacte d'après le cours.
- Les trois mauvaises réponses sont plausibles, du même type et de la même longueur que la bonne réponse, tirées de préférence d'autres notions du cours ; jamais évidentes, jamais vraies, jamais des variantes de la bonne réponse.
- Exactement le nombre de cartes demandé, ou moins si le cours est trop court pour rester pertinent.
TXT;

switch (action()) {
  case 'status': {
    $cfg = aiConfig();
    ensureUsageTable();
    ok(['enabled' => (bool) $cfg['key'], 'limit' => $cfg['limit'], 'used' => usedToday($uid), 'model' => $cfg['model']]);
  }

  // Cours (texte et/ou PDF en base64) → cartes de quiz.
  case 'generate': {
    $cfg = aiConfig();
    ensureUsageTable();
    requireQuota($uid, $cfg);
    $in = input();
    $text = trim((string) ($in['text'] ?? ''));
    $title = text($in['title'] ?? '', 120);
    $count = max(3, min(40, (int) ($in['count'] ?? 15)));
    $pdf = (string) ($in['pdf'] ?? '');
    if (mb_strlen($text) > AI_MAX_TEXT) fail(422, 'Cours trop long (' . AI_MAX_TEXT . ' caractères maximum) : découpe-le en plusieurs leçons.');
    if ($pdf !== '') {
      $bin = base64_decode($pdf, true);
      if ($bin === false || !str_starts_with($bin, '%PDF')) fail(422, 'Fichier PDF invalide.');
      if (strlen($bin) > AI_MAX_PDF) fail(422, 'PDF trop lourd (12 Mo maximum).');
    }
    if ($text === '' && $pdf === '') fail(422, 'Colle le contenu du cours ou joins un fichier.');

    $content = [];
    if ($pdf !== '') $content[] = ['type' => 'document', 'source' => ['type' => 'base64', 'media_type' => 'application/pdf', 'data' => $pdf]];
    $ask = "Génère $count cartes de quiz" . ($title !== '' ? " pour la leçon « $title »" : '') . " à partir de ce cours.";
    if ($text !== '') $ask .= "\n\n<cours>\n$text\n</cours>";
    $content[] = ['type' => 'text', 'text' => $ask];

    $data = askClaude($cfg, GENERATE_SYSTEM, $content, CARDS_SCHEMA, 16000);
    consume($uid); // compte seulement les appels qui ont abouti
    $cards = [];
    $seen = [];
    foreach ((array) ($data['cards'] ?? []) as $c) {
      $card = is_array($c) ? cleanCard($c) : null;
      if (!$card) continue;
      $k = mb_strtolower($card['front']);
      if (isset($seen[$k])) continue;
      $seen[$k] = true;
      $cards[] = $card;
    }
    if (!$cards) fail(422, 'L’IA n’a rien pu extraire de ce contenu.');
    ok(['cards' => array_slice($cards, 0, $count), 'used' => usedToday($uid), 'limit' => $cfg['limit']]);
  }

  // Une question → sa réponse et trois mauvaises réponses (éditeur de leçon).
  case 'suggest': {
    $cfg = aiConfig();
    ensureUsageTable();
    requireQuota($uid, $cfg);
    $in = input();
    $front = text($in['front'] ?? '', 300);
    $back = text($in['back'] ?? '', 500);
    $title = text($in['title'] ?? '', 120);
    if ($front === '') fail(422, 'Écris d’abord la question.');
    $schema = [
      'type' => 'object',
      'properties' => ['answer' => ['type' => 'string'], 'wrong' => ['type' => 'array', 'items' => ['type' => 'string']]],
      'required' => ['answer', 'wrong'],
      'additionalProperties' => false,
    ];
    $system = "Tu aides un étudiant à compléter une carte de révision" . ($title !== '' ? " de la leçon « $title »" : '') . ".\n"
      . "Réponds dans la langue de la question. La réponse est courte (120 caractères maximum), exacte et précise. "
      . "Donne exactement trois mauvaises réponses plausibles, du même type et de la même longueur que la bonne, jamais vraies ni synonymes de la bonne réponse.";
    $ask = $back !== ''
      ? "Question : $front\nBonne réponse (à garder telle quelle dans « answer ») : $back\nPropose trois mauvaises réponses."
      : "Question : $front\nDonne la bonne réponse et trois mauvaises réponses.";
    $data = askClaude($cfg, $system, [['type' => 'text', 'text' => $ask]], $schema, 2000);
    consume($uid);
    $card = cleanCard(['question' => $front, 'answer' => $back !== '' ? $back : ($data['answer'] ?? ''), 'wrong' => $data['wrong'] ?? []]);
    if (!$card) fail(422, 'Pas de proposition pour cette question.');
    ok(['back' => $card['back'], 'wrong' => $card['wrong'], 'used' => usedToday($uid), 'limit' => $cfg['limit']]);
  }

  default:
    fail(404, 'Action inconnue.');
}
