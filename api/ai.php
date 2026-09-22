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
  // Groq : modèles ouverts, très rapides, ~1000 requêtes/jour en gratuit (openai/gpt-oss-20b si besoin de plus léger).
  'groq' => ['model' => 'openai/gpt-oss-120b', 'keyEnv' => 'GROQ_API_KEY', 'pdf' => false, 'base' => 'https://api.groq.com/openai/v1'],
  'openai' => ['model' => null, 'keyEnv' => 'OPENAI_API_KEY', 'pdf' => false, 'base' => 'https://api.openai.com/v1'],
];

// Réglages d'un fournisseur donné (clé, modèle, adresse).
function providerConfig(string $provider, callable $env, bool $first): ?array {
  $p = PROVIDERS[$provider] ?? null;
  // La clé peut venir de AI_API_KEY (fournisseur principal) ou de la variable dédiée.
  $key = $env($p['keyEnv'] ?? '') ?? ($first ? $env('AI_API_KEY') : null);
  if (!$p || !$key) return null;
  $model = $first ? $env('AI_MODEL', $p['model']) : $p['model'];
  if (!$model) return null;
  return [
    'provider' => $provider,
    'key' => $key,
    'model' => $model,
    'base' => rtrim(($first ? $env('AI_BASE_URL', $p['base'] ?? '') : ($p['base'] ?? '')) ?? '', '/'),
    'pdf' => $p['pdf'],
    'fallback' => $first ? $env('AI_FALLBACK_MODEL', $provider === 'gemini' ? 'gemini-3.8-flash' : null) : ($provider === 'gemini' ? 'gemini-3.8-flash' : null),
    'cainfo' => $env('CA_BUNDLE'),
  ];
}

// La liste des fournisseurs utilisables, dans l'ordre : celui demandé d'abord, puis tous ceux
// dont une clé est renseignée. Quand l'un est à sec (quota du jour) ou saturé, on passe au suivant.
function aiConfig(): array {
  $env = fn(string $k, ?string $d = null) => ($k !== '' && getenv($k) !== false && getenv($k) !== '') ? getenv($k) : $d;
  $wanted = array_filter(array_map('trim', explode(',', strtolower($env('AI_PROVIDERS', $env('AI_PROVIDER', '')) ?? ''))));
  $order = array_values(array_unique([...$wanted, ...array_keys(PROVIDERS)]));
  $chain = [];
  foreach ($order as $name) {
    $cfg = providerConfig($name, $env, count($chain) === 0 && (!$wanted || $name === $wanted[0]));
    if ($cfg) $chain[] = $cfg;
  }
  return [
    'chain' => $chain,
    'limit' => max(1, (int) $env('AI_DAILY_LIMIT', '30')),
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
  if (!$cfg['chain']) fail(503, 'L’IA n’est pas configurée sur ce serveur (clé d’API manquante dans le .env).');
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
  if ($status === 200) return;
  // Google renvoie un 400 pour une clé invalide, les autres un 401/403.
  if ($status === 401 || $status === 403 || ($status === 400 && $msg && stripos($msg, 'api key') !== false)) fail(503, 'Clé d’API IA refusée : vérifie la clé dans le .env.');
  if ($status === 404) fail(503, 'Modèle IA introuvable chez ce fournisseur : vérifie AI_MODEL.' . ($msg ? " ($msg)" : ''));
  if ($status === 429 && $msg && stripos($msg, 'PerDay') !== false) {
    throw new AiUnavailable('Quota gratuit épuisé pour aujourd’hui chez ce fournisseur — réessaie demain ou ajoute une autre clé dans le .env.');
  }
  if ($status === 429 || $status === 503) throw new AiUnavailable('Service d’IA saturé ou limite par minute atteinte — réessaie dans une minute.');
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

// Essaie chaque fournisseur de la chaîne jusqu'à ce que l'un réponde. Un fournisseur à sec
// (quota du jour) ou saturé passe la main au suivant ; la dernière erreur est renvoyée.
function askModel(array $all, string $system, string $text, ?string $pdf, array $schema, int $maxTokens = 16000): array {
  $chain = $all['chain'];
  if ($pdf !== null) {
    $chain = array_values(array_filter($chain, fn($c) => $c['pdf']));
    if (!$chain) fail(422, 'Aucun fournisseur d’IA configuré ne lit les PDF : colle le texte du cours, ou joins un .pptx/.docx.');
  }
  $last = null;
  foreach ($chain as $i => $cfg) {
    try {
      return askOne($cfg, $system, $text, $pdf, $schema, $maxTokens);
    } catch (AiUnavailable $e) {
      error_log("ai: {$cfg['provider']} indisponible (" . $e->getMessage() . ')');
      $last = $e;
    }
  }
  fail(429, ($last?->getMessage() ?? 'Service d’IA indisponible.') . (count($chain) > 1 ? ' (tous les fournisseurs configurés ont été essayés)' : ''));
}

// Exception interne : ce fournisseur ne peut pas répondre maintenant, essayer le suivant.
class AiUnavailable extends RuntimeException {}

function askOne(array $cfg, string $system, string $text, ?string $pdf, array $schema, int $maxTokens = 16000): array {
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
    ok([
      'enabled' => (bool) $cfg['chain'],
      'providers' => array_map(fn($c) => ['provider' => $c['provider'], 'model' => $c['model']], $cfg['chain']),
      'provider' => $cfg['chain'][0]['provider'] ?? null,
      'model' => $cfg['chain'][0]['model'] ?? null,
      'pdf' => (bool) array_filter($cfg['chain'], fn($c) => $c['pdf']),
      'limit' => $cfg['limit'],
      'used' => usedToday($uid),
    ]);
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

  // Une ou plusieurs questions → réponse et trois mauvaises réponses. Plusieurs cartes en un
  // seul appel : une seule unité de quota, même pour dix cartes.
  case 'suggest': {
    $cfg = aiConfig();
    ensureUsageTable();
    requireQuota($uid, $cfg);
    $in = input();
    $title = text($in['title'] ?? '', 120);
    $cards = [];
    foreach ((array) ($in['cards'] ?? [['front' => $in['front'] ?? '', 'back' => $in['back'] ?? '']]) as $c) {
      $front = text((string) ($c['front'] ?? ''), 300);
      if ($front === '') continue;
      $cards[] = ['front' => $front, 'back' => text((string) ($c['back'] ?? ''), 500)];
      if (count($cards) === 30) break;
    }
    if (!$cards) fail(422, 'Écris d’abord la question.');

    $schema = [
      'type' => 'object',
      'properties' => ['cards' => ['type' => 'array', 'items' => [
        'type' => 'object',
        'properties' => ['question' => ['type' => 'string'], 'answer' => ['type' => 'string'], 'wrong' => ['type' => 'array', 'items' => ['type' => 'string']]],
        'required' => ['question', 'answer', 'wrong'],
        'additionalProperties' => false,
      ]]],
      'required' => ['cards'],
      'additionalProperties' => false,
    ];
    $system = 'Tu aides un étudiant à compléter ses cartes de révision' . ($title !== '' ? " de la leçon « $title »" : '') . ".\n"
      . "Pour chaque carte : reprends la question à l'identique dans « question », donne la bonne réponse dans « answer » "
      . "(courte, 120 caractères maximum, exacte ; si une réponse est déjà fournie, recopie-la telle quelle) et exactement trois "
      . "mauvaises réponses plausibles, du même type et de la même longueur que la bonne, jamais vraies ni synonymes. "
      . 'Réponds dans la langue des questions, et traite toutes les cartes.';
    $ask = "Complète ces cartes :\n" . implode("\n", array_map(
      fn($c, $i) => ($i + 1) . '. Question : ' . $c['front'] . ($c['back'] !== '' ? "\n   Bonne réponse (à recopier) : " . $c['back'] : ''),
      $cards,
      array_keys($cards),
    ));

    $data = askModel($cfg, $system, $ask, null, $schema, 800 + 400 * count($cards));
    consume($uid);
    // On rapproche chaque proposition de la carte d'origine (par position, sinon par question).
    $out = [];
    $props = array_values(array_filter((array) ($data['cards'] ?? []), 'is_array'));
    foreach ($cards as $i => $card) {
      $p = $props[$i] ?? null;
      if (!$p || mb_strtolower(text((string) ($p['question'] ?? ''), 300)) !== mb_strtolower($card['front'])) {
        foreach ($props as $cand) {
          if (mb_strtolower(text((string) ($cand['question'] ?? ''), 300)) === mb_strtolower($card['front'])) {
            $p = $cand;
            break;
          }
        }
      }
      if (!$p) continue;
      $clean = cleanCard(['question' => $card['front'], 'answer' => $card['back'] !== '' ? $card['back'] : ($p['answer'] ?? ''), 'wrong' => $p['wrong'] ?? []]);
      if ($clean) $out[] = ['front' => $card['front'], 'back' => $clean['back'], 'wrong' => $clean['wrong']];
    }
    if (!$out) fail(422, 'Pas de proposition pour ces questions.');
    // Compatibilité : une seule carte demandée → même forme qu'avant.
    $single = !isset($in['cards']);
    ok(($single ? ['back' => $out[0]['back'], 'wrong' => $out[0]['wrong']] : []) + ['cards' => $out, 'used' => usedToday($uid), 'limit' => $cfg['limit']]);
  }

  default:
    fail(404, 'Action inconnue.');
}
