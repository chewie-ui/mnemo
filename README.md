# Mnemo

Apprendre en jouant. Première brique : des cartes muettes façon Seterra — on te donne un nom, tu cliques au bon endroit.

Neuf modes par carte : **Pays** (cliquer sur la zone), **Drapeaux** (on montre le drapeau, on clique le pays), **Capitales** et **Villes** (cliquer sur le point), **Monuments** (lieux célèbres à cliquer, `src/data/monuments.js`), **Langues** (« Où parle-t-on le swahili ? » → cliquer un pays où elle est officielle, `src/data/languages.js`), **Monnaies** (« Quel pays paie en yen ? », `src/data/currencies.js`), **Fleuves** (cliquer sur le tracé), **Mers** (cliquer sur l’étendue d’eau). URL : `#/play/<région>/<mode>`.

Une section **Pays en détail** propose les subdivisions de plus de 170 pays (États, provinces, départements, cantons…) : `#/play/sub-<code>[-variante]`, par exemple `#/play/sub-br` ou `#/play/sub-fr-departements`.

Une section **Histoire** propose les États d'une époque (Europe et Monde en 1914, 1938, 1945, 1815, an 100, an 500). URL : `#/play/<carte>`, par exemple `#/play/europe-1914`.

## Lancer en local

```bash
npm install
npm run dev    # site sur http://localhost:5173 + API PHP sur 127.0.0.1:8080 (SQLite, rien à configurer)
               # (npm run web : Vite seul ; npm run api : PHP seul)
```

La configuration vient d'un fichier `.env` (voir `.env.example`), jamais versionné. Sans `.env`, l'API utilise SQLite dans `api/data/` — en local, ne crée donc pas de `.env` tant que tu n'as pas de vraie base MySQL (un `.env` avec les valeurs d'exemple casse l'API).

Sans l'API, le site fonctionne quand même : comptes désactivés, scores et mémos restent dans le navigateur.

## Comptes, stats et mémos

- **Compte facultatif** (icône en haut à droite) : e-mail + mot de passe, session par cookie. Sans compte, meilleurs scores et leçons restent dans le navigateur (localStorage).
- **Stats** (`#/stats`) : chaque partie terminée est enregistrée pour un utilisateur connecté (carte, mode, score, temps, erreurs).
- **Campagne** (`#/campagne`) : 7 chapitres, 81 niveaux courts du plus simple au plus complet (`src/data/campaign.js`), étoiles (70 % / 90 % / sans faute), déblocage progressif, trophées par étoile et badge par chapitre ; progression locale + serveur (`api/campaign.php`).
- **Amis et défis** (`#/amis`) : ajout d'amis par pseudo, défis sur n'importe quelle carte : le lanceur attend dans une salle d'attente, l'ami reçoit une notification (bandeau + badge, relevé toutes les 10 s), accepte, et les deux passent par un écran VS avec compte à rebours avant la même partie (même ordre de questions grâce à une graine partagée, progression de l'adversaire relue toutes les 3 s, meilleur score puis meilleur temps). Classement par trophées (`api/friends.php`, `api/duels.php`, `src/duel-ui.js`).
- **Mes cours** (`#/memos`) : bibliothèque personnelle avec dossiers imbriqués (une matière, un chapitre…), **leçons** (cartes question → réponse, révision espacée SM-2 simplifiée dans `src/memos.js`, quiz QCM avec mauvaises réponses par carte) et **notes de cours** (texte avec titres, listes, gras, surligné, citations — `src/library.js`). Sans compte tout reste dans le navigateur ; avec un compte tout est synchronisé (`api/library.php`, `api/decks.php`).
- **IA** (`api/ai.php`, `src/ai-ui.js`) : « Leçon avec l’IA » génère un quiz (question, bonne réponse, trois mauvaises) à partir d’une synthèse collée ou d’un fichier PowerPoint / Word / PDF / texte (les .pptx/.docx sont lus dans le navigateur, seul le texte est envoyé ; un PDF est envoyé tel quel), et « Compléter avec l’IA » remplit une carte dans l’éditeur. Appel à l’API Claude (`claude-opus-5`) côté serveur : mettre `ANTHROPIC_API_KEY` dans le `.env` (sinon les boutons sont cachés) ; quota `AI_DAILY_LIMIT` par compte et par jour (40). En local sous Windows, `npm run dev` passe à PHP le bundle de certificats de Git pour le HTTPS.
- **Application mobile** : le site est installable (« Ajouter à l’écran d’accueil », manifeste + icônes générées par `node scripts/icons.mjs`), sans zoom, avec une barre d’onglets en bas sur téléphone.

## Déployer sur Infomaniak (PHP + MySQL)

1. Dans le manager Infomaniak, créer une base MySQL et exécuter `api/schema.mysql.sql` (phpMyAdmin → onglet SQL).
2. `npm run package` : construit le site et prépare `dist/` avec `dist/api/` (PHP, `.htaccess`, schémas).
3. Envoyer par FTP/SSH **tout le contenu de `dist/`** à la racine du site : `/index.html`, `/assets/…`, `/flags/…`, `/api/*.php`.
4. Sur le serveur, créer `/api/.env` à partir de `.env.example` : `DB_DSN` (hôte MySQL Infomaniak, nom de base), `DB_USER`, `DB_PASSWORD`, `APP_ORIGIN=https://ton-domaine`, et `MAIL_FROM=no-reply@ton-domaine` (adresse du domaine hébergé, pour les e-mails « mot de passe oublié » et de confirmation de nouvelle adresse envoyés via `mail()`). Si le site n’est pas à la racine du domaine, ajouter `APP_URL=https://ton-domaine/sous-dossier`. En local, aucun e-mail n’est envoyé : le lien est écrit dans `api/data/mail.log` et proposé directement dans la fenêtre.
5. Vérifier que PHP ≥ 8.1 est sélectionné pour le site et que HTTPS est actif (le cookie de session est marqué `secure`).

`.env`, `config.php`, `_bootstrap.php` et les schémas sont protégés par `api/.htaccess`. Pour mettre à jour le site : `npm run package` puis renvoyer `dist/` (le `.env` du serveur n'est pas touché).

## Structure

- `index.html` — les trois écrans (accueil, partie, résultats).
- `src/main.js` — routeur (`#/`, `#/play/<région>/<mode>`, `#/stats`, `#/memos`, `#/study/<id>`, `#/quiz/<id>`).
- `src/play.js` — écran de partie (HUD, réponses, résultats) ; `src/scores.js` — meilleurs scores local + serveur.
- `src/auth.js`, `src/account.js` — compte utilisateur et fenêtre de connexion ; `src/api.js` — appels à l'API.
- `src/memos.js`, `src/memos-ui.js` — leçons, répétition espacée, éditeur, révision, quiz ; `src/stats.js` — page stats.
- `api/` — backend PHP : `auth.php`, `games.php`, `decks.php`, `_bootstrap.php` (session, PDO), schémas MySQL et SQLite.
- `src/game.js` — logique d'une partie (ordre aléatoire, 3 essais, score).
- `src/map.js` — rendu SVG des cartes (D3 + TopoJSON), marqueurs pour les micro-États, zoom.
- `src/data/countries.js` — noms français + continent de chaque pays, États américains.
- `src/data/capitals.js` — capitales (pays et États américains) avec coordonnées.
- `src/data/cities.js` — grandes villes hors capitales, avec les cartes où elles sont demandées.
- `src/data/nature.js` — fleuves (segments Natural Earth à fusionner) et mers jouables, par carte.
- `src/data/history.js` — époques, cartes historiques et leurs cibles (nom du fichier source → nom affiché).
- `src/data/subdivisions.js` — exceptions pour les subdivisions (pays exclus, variantes par région, libellés).
- `public/flags/` — drapeaux SVG copiés depuis `flag-icons` (MIT) par `npm run data`.
- `src/data/generated/` — TopoJSON produits par `npm run data` (ne pas éditer à la main).
- `src/data/regions.js` — les cartes jouables et leur cadrage.
- `scripts/build-data.mjs` — filtre, fusionne, simplifie et découpe les données brutes de `raw/`.
- `src/style.css` — tokens de couleurs, composants, responsive.

## Règles du jeu

- 1er essai → vert, 2e → jaune, 3e → jaune pâle, raté 3 fois → révélé en rouge.
- Score = pourcentage de pays trouvés du premier coup. Le meilleur score (puis le meilleur temps) est gardé par carte.

## Données brutes

`raw/` n'est pas versionné (~11 Mo). Pour le reconstituer puis régénérer `src/data/generated/` :

```bash
mkdir -p raw && cd raw && for f in ne_50m_rivers_lake_centerlines ne_50m_geography_marine_polys ne_10m_admin_1_states_provinces; do curl -sLO "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/$f.geojson"; done && for y in 1914 1938 1945 1815 100 500; do curl -sLO "https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/world_$y.geojson"; done && cd .. && npm run data
```

`npm run data` accepte des étapes : `node scripts/build-data.mjs nature history admin1 flags`.

Sources : [Natural Earth](https://www.naturalearthdata.com/) (domaine public), [historical-basemaps](https://github.com/aourednik/historical-basemaps) (GPL-3.0, frontières approximatives), [flag-icons](https://github.com/lipis/flag-icons) (MIT).

## Ajouter du contenu

- **Une ville** : une ligne dans `src/data/cities.js` avec les cartes où elle apparaît (`'world'` pour le Monde).
- **Un fleuve / une mer** : une ligne dans `src/data/nature.js`, puis `npm run data`.
- **Une époque** : télécharger `world_<année>.geojson` dans `raw/`, décrire l'époque et ses cibles dans `src/data/history.js`, puis `npm run data` (le script signale les cibles introuvables).
- **Un pays en détail** : tout est automatique depuis Natural Earth ; pour exclure un pays, fusionner par région ou traduire des noms, voir `src/data/subdivisions.js`, puis `npm run data admin1`.
- **Une carte** : déclarer la région dans `src/data/regions.js` avec son `center` et sa `bbox` `[ouest, sud, est, nord]`, puis rattacher les pays au bon continent dans `countries.js`.
