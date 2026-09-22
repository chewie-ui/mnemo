<?php
// IA : génération de quiz à partir d'un cours (texte ou PDF) et complétion d'une carte
// (réponse + mauvaises réponses). Plusieurs fournisseurs au choix dans le .env (AI_PROVIDER) :
// gemini (niveau gratuit), anthropic (Claude), mistral, groq, ou tout service « compatible OpenAI ».
// La clé ne sort jamais du serveur. Quota journalier par compte.
//
// Appels HTTP directs (curl) plutôt que des SDK : l'hébergement est déployé par simple copie
// de fichiers, sans Composer ni dossier vendor.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';

$uid = requireUser();
// Une génération peut prendre une minute (lecture du cours + retentatives).
set_time_limit(300);
// On libère tout de suite la session : sinon PHP la verrouille et TOUTES les autres requêtes de
// l'utilisateur (navigation, révisions, notifications) attendent la fin de l'appel à l'IA.
session_write_close();

const AI_MAX_TEXT = 120000; // caractères de cours acceptés par génération
const AI_MAX_PDF = 12 * 1024 * 1024; // octets (base64 décodé)

// Fournisseurs : modèle par défaut, clé attendue, lecture des PDF, adresse « compatible OpenAI ».
const PROVIDERS = [
  'gemini' => ['model' => 'gemini-3.6-flash', 'keyEnv' => 'GEMINI_API_KEY', 'pdf' => true],
  'anthropic' => ['model' => 'claude-opus-5', 'keyEnv' => 'ANTHROPIC_API_KEY', 'pdf' => true],
  'mistral' => ['model' => 'mistral-large-latest', 'keyEnv' => 'MISTRAL_API_KEY', 'pdf' => false, 'base' => 'https://api.mistral.ai/v1'],
  'groq' => ['model' => null, 'keyEnv' => 'GROQ_API_KEY', 'pdf' => false, 'base' => 'https://api.groq.com/openai/v1'],
  'openai' => ['model' => null, 'keyEnv' => 'OPENAI_API_KEY', 'pdf' => false, 'base' => 'https://api.openai.com/v1'],
];

function aiConfig(): array {
  $env = fn(string $k, ?string $d = null) => (getenv($k) !== false && getenv($k) !== '') ? getenv($k) : $d;
  $provider = strtolower($env('AI_PROVIDER', '') ?? '');
  if (!isset(PROVIDERS[$provider])) {
    // Sans AI_PROVIDER : le premier fournisseur dont la clé est renseignée.
    $provider = 'gemini';
    foreach (PROVIDERS as $name => $p) {
      if ($env($p['keyEnv'])) {
        $provider = $name;
        break;
      }
    }
  }
  $p = PROVIDERS[$provider];
  return [
    'provider' => $provider,
    'key' => $env('AI_API_KEY', $env($p['keyEnv'])),
    'model' => $env('AI_MODEL', $p['model']),
    // Modèle de secours si le premier est saturé (503) ou limité (429) après quelques essais.
    'fallback' => $env('AI_FALLBACK_MODEL', $provider === 'gemini' ? 'gemini-3.8-flash' : null),
    'base' => rtrim($env('AI_BASE_URL', $p['base'] ?? '') ?? '', '/'),
    'pdf' => $p['pdf'],
    'limit' => max(1, (int) $env('AI_DAILY_LIMIT', '20')),
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
  if (!$cfg['key']) fail(503, 'L’IA n’est pas configurée sur ce serveur (clé d’API manquante dans le .env).');
  if (!$cfg['model']) fail(503, "Indique le modèle à utiliser (AI_MODEL) pour le fournisseur {$cfg['provider']}.");
  if (usedToday($uid) >= $cfg['limit']) fail(429, "Quota IA du jour atteint ({$cfg['limit']} générations). Réessaie demain.");
}

// Requête HTTP JSON vers un fournisseur ; renvoie [statut, corps décodé, corps brut].
// Sur 429/503 (saturation), on réessaie deux fois en attendant un peu, puis on bascule sur le
// modèle de secours s'il y en a un. $swap(modèle) adapte la requête au modèle de repli.
function httpJson(array $cfg, string $url, array $headers, array $payload, ?callable $swap = null): array {
  // Les offres gratuites sont souvent saturées (503) ou limitées à quelques requêtes par minute
  // (429) : on alterne entre le modèle demandé et le modèle de secours, avec des pauses qui
  // s'allongent, pendant une minute environ.
  $primary = [$url, $payload];
  $alt = ($cfg['fallback'] && $swap && $cfg['fallback'] !== $cfg['model']) ? $swap($cfg['fallback']) : null;
  // On reste court : quelqu'un attend devant son écran. Deux modèles, trois essais, ~7 s de pause
  // au maximum ; au-delà on rend la main avec un message clair plutôt que de faire patienter.
  $waits = [0, 2, 5];
  $last = null;
  $exhausted = []; // modèles dont le quota du jour est épuisé : inutile d'y revenir
  foreach ($waits as $i => $wait) {
    if ($wait) sleep($wait);
    $useAlt = $alt && ($i % 2 === 1 || in_array('primary', $exhausted, true));
    if ($useAlt && in_array('alt', $exhausted, true)) $useAlt = false;
    [$u, $p] = $useAlt ? $alt : $primary;
    $last = httpOnce($cfg, $u, $headers, $p);
    if ($last[0] !== 429 && $last[0] !== 503) return $last;
    $msg = is_array($last[1]) ? ($last[1]['error']['message'] ?? '') : '';
    if ($last[0] === 429 && stripos($msg, 'PerDay') !== false) {
      $exhausted[] = $useAlt ? 'alt' : 'primary';
      // Les deux modèles sont à sec pour aujourd'hui : inutile d'attendre.
      if (!$alt || count(array_unique($exhausted)) === 2) return $last;
    }
    error_log("ai: HTTP {$last[0]} (essai " . ($i + 1) . '/' . count($waits) . ')');
  }
  return $last;
}

function httpOnce(array $cfg, string $url, array $headers, array $payload): array {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 240,
    CURLOPT_HTTPHEADER => array_merge(['Content-Type: application/json'], $headers),
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
  return [$status, json_decode($raw, true), $raw];
}

// Erreurs communes à tous les fournisseurs, avec des messages compréhensibles.
function checkStatus(int $status, mixed $res, string $raw): void {
  $msg = is_array($res) ? ($res['error']['message'] ?? ($res['message'] ?? null)) : null;
  // Google renvoie un 400 pour une clé invalide, les autres un 401/403.
  if ($status === 401 || $status === 403 || ($status === 400 && $msg && stripos($msg, 'api key') !== false)) fail(503, 'Clé d’API IA refusée : vérifie la clé dans le .env.');
  if ($status === 404) fail(503, 'Modèle IA introuvable chez ce fournisseur : vérifie AI_MODEL.' . ($msg ? " ($msg)" : ''));
  if ($status === 429 && $msg && stripos($msg, 'PerDay') !== false) {
    fail(429, 'Quota gratuit de Google épuisé pour aujourd’hui (20 générations par jour et par modèle). Réessaie demain, change AI_MODEL, ou active la facturation dans Google AI Studio.');
  }
  if ($status === 429 || $status === 503) fail(429, 'Le service d’IA gratuit est saturé en ce moment (ou sa limite de quelques requêtes par minute est atteinte). Réessaie dans une minute ou deux.');
  if ($status >= 400 || !is_array($res)) {
    error_log('ai: HTTP ' . $status . ' ' . substr($raw, 0, 500));
    fail(502, 'L’IA a renvoyé une erreur (' . ($msg ?? "HTTP $status") . ').');
  }
}

// Le JSON demandé, même si le modèle l'a entouré de texte ou de ```.
function parseJsonText(string $text): array {
  $t = trim($text);
  $t = preg_replace('/^```(?:json)?\s*|\s*```$/', '', $t);
  $data = json_decode($t, true);
  if (!is_array($data) && preg_match('/\{.*\}/s', $t, $m)) $data = json_decode($m[0], true);
  if (!is_array($data)) fail(502, 'Réponse de l’IA illisible.');
  return $data;
}

// Gemini refuse les mots-clés JSON Schema qu'il ne connaît pas.
function stripSchema(array $schema): array {
  unset($schema['additionalProperties']);
  foreach ($schema as $k => $v) if (is_array($v)) $schema[$k] = stripSchema($v);
  return $schema;
}

// Pose la question au fournisseur configuré, avec une sortie JSON contrainte par $schema.
// $pdf : PDF en base64 (Gemini et Claude seulement), $text : la demande.
function askModel(array $cfg, string $system, string $text, ?string $pdf, array $schema, int $maxTokens = 16000): array {
  if ($pdf !== null && !$cfg['pdf']) fail(422, 'Ce fournisseur d’IA ne lit pas les PDF : colle le texte du cours, ou joins un .pptx/.docx.');
  switch ($cfg['provider']) {
    case 'anthropic': {
      $content = [];
      if ($pdf !== null) $content[] = ['type' => 'document', 'source' => ['type' => 'base64', 'media_type' => 'application/pdf', 'data' => $pdf]];
      $content[] = ['type' => 'text', 'text' => $text];
      $payload = [
        'model' => $cfg['model'],
        'max_tokens' => $maxTokens,
        'system' => $system,
        'messages' => [['role' => 'user', 'content' => $content]],
        'output_config' => ['effort' => 'medium', 'format' => ['type' => 'json_schema', 'schema' => $schema]],
      ];
      $url = 'https://api.anthropic.com/v1/messages';
      [$status, $res, $raw] = httpJson($cfg, $url, ['x-api-key: ' . $cfg['key'], 'anthropic-version: 2023-06-01'], $payload, fn($m) => [$url, ['model' => $m] + $payload]);
      checkStatus($status, $res, $raw);
      if (($res['stop_reason'] ?? '') === 'refusal') fail(422, 'L’IA a refusé ce contenu.');
      if (($res['stop_reason'] ?? '') === 'max_tokens') fail(422, 'Cours trop long pour une seule génération : découpe-le ou demande moins de questions.');
      $out = '';
      foreach ($res['content'] ?? [] as $block) if (($block['type'] ?? '') === 'text') $out .= $block['text'];
      return parseJsonText($out);
    }

    case 'gemini': {
      $parts = [];
      if ($pdf !== null) $parts[] = ['inlineData' => ['mimeType' => 'application/pdf', 'data' => $pdf]];
      $parts[] = ['text' => $text];
      $geminiUrl = fn(string $m) => 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($m) . ':generateContent';
      $payload = [
        'systemInstruction' => ['parts' => [['text' => $system]]],
        'contents' => [['role' => 'user', 'parts' => $parts]],
        'generationConfig' => ['responseMimeType' => 'application/json', 'responseJsonSchema' => stripSchema($schema), 'maxOutputTokens' => $maxTokens],
      ];
      [$status, $res, $raw] = httpJson($cfg, $geminiUrl($cfg['model']), ['x-goog-api-key: ' . $cfg['key']], $payload, fn($m) => [$geminiUrl($m), $payload]);
      checkStatus($status, $res, $raw);
      if (!empty($res['promptFeedback']['blockReason'])) fail(422, 'L’IA a refusé ce contenu.');
      $cand = $res['candidates'][0] ?? null;
      if (!$cand) fail(502, 'Réponse de l’IA vide.');
      $finish = $cand['finishReason'] ?? 'STOP';
      if ($finish === 'MAX_TOKENS') fail(422, 'Cours trop long pour une seule génération : découpe-le ou demande moins de questions.');
      if ($finish === 'SAFETY' || $finish === 'RECITATION') fail(422, 'L’IA a refusé ce contenu.');
      $out = '';
      foreach ($cand['content']['parts'] ?? [] as $part) $out .= $part['text'] ?? '';
      return parseJsonText($out);
    }

    // Mistral, Groq, OpenAI et tout service au même format « chat/completions ».
    default: {
      $payload = [
        'model' => $cfg['model'],
        'max_tokens' => $maxTokens,
        'messages' => [
          ['role' => 'system', 'content' => $system . "\n\nRéponds uniquement par un objet JSON respectant ce schéma :\n" . json_encode($schema, JSON_UNESCAPED_UNICODE)],
          ['role' => 'user', 'content' => $text],
        ],
        'response_format' => ['type' => 'json_object'],
      ];
      $url = $cfg['base'] . '/chat/completions';
      [$status, $res, $raw] = httpJson($cfg, $url, ['Authorization: Bearer ' . $cfg['key']], $payload, fn($m) => [$url, ['model' => $m] + $payload]);
      checkStatus($status, $res, $raw);
      $choice = $res['choices'][0] ?? null;
      if (!$choice) fail(502, 'Réponse de l’IA vide.');
      if (($choice['finish_reason'] ?? '') === 'length') fail(422, 'Cours trop long pour une seule génération : découpe-le ou demande moins de questions.');
      $out = $choice['message']['content'] ?? '';
      if (is_array($out)) $out = implode('', array_map(fn($p) => $p['text'] ?? '', $out));
      return parseJsonText((string) $out);
    }
  }
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
    ok(['enabled' => (bool) $cfg['key'] && (bool) $cfg['model'], 'provider' => $cfg['provider'], 'model' => $cfg['model'], 'pdf' => $cfg['pdf'], 'limit' => $cfg['limit'], 'used' => usedToday($uid)]);
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

    $ask = "Génère $count cartes de quiz" . ($title !== '' ? " pour la leçon « $title »" : '') . " à partir de ce cours.";
    if ($text !== '') $ask .= "\n\n<cours>\n$text\n</cours>";

    $data = askModel($cfg, GENERATE_SYSTEM, $ask, $pdf !== '' ? $pdf : null, CARDS_SCHEMA, 16000);
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
    $data = askModel($cfg, $system, $ask, null, $schema, 2000);
    consume($uid);
    $card = cleanCard(['question' => $front, 'answer' => $back !== '' ? $back : ($data['answer'] ?? ''), 'wrong' => $data['wrong'] ?? []]);
    if (!$card) fail(422, 'Pas de proposition pour cette question.');
    ok(['back' => $card['back'], 'wrong' => $card['wrong'], 'used' => usedToday($uid), 'limit' => $cfg['limit']]);
  }

  default:
    fail(404, 'Action inconnue.');
}
