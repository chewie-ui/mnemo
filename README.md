# Mnemo

Apprendre en jouant. Première brique : des cartes muettes façon Seterra — on te donne un nom, tu cliques au bon endroit.

Neuf modes par carte : **Pays** (cliquer sur la zone), **Drapeaux** (on montre le drapeau, on clique le pays), **Capitales** et **Villes** (cliquer sur le point), **Monuments** (lieux célèbres à cliquer, `src/data/monuments.js`), **Langues** (« Où parle-t-on le swahili ? » → cliquer un pays où elle est officielle, `src/data/languages.js`), **Monnaies** (« Quel pays paie en yen ? », `src/data/currencies.js`), **Fleuves** (cliquer sur le tracé), **Mers** (cliquer sur l’étendue d’eau). URL : `#/play/<région>/<mode>`.

Une section **Pays en détail** propose les subdivisions de plus de 170 pays (États, provinces, départements, cantons…) : `#/play/sub-<code>[-variante]`, par exemple `#/play/sub-br` ou `#/play/sub-fr-departements`.

Une section **Histoire** propose les États d'une époque (Europe et Monde en 1914, 1938, 1945, 1815, an 100, an 500). URL : `#/play/<carte>`, par exemple `#/play/europe-1914`.

## Lancer en local

```bash
npm install
npm run api    # API PHP sur http://127.0.0.1:8080 (PHP 8.1+ requis) — SQLite par défaut, rien à configurer
npm run dev    # site sur http://localhost:5173, /api renvoyé vers PHP
```

La configuration vient d'un fichier `.env` (voir `.env.example`), jamais versionné. Sans `.env`, l'API utilise SQLite dans `api/data/` — en local, ne crée donc pas de `.env` tant que tu n'as pas de vraie base MySQL (un `.env` avec les valeurs d'exemple casse l'API).

Sans l'API, le site fonctionne quand même : comptes désactivés, scores et mémos restent dans le navigateur.

## Comptes, stats et mémos

- **Compte facultatif** (icône en haut à droite) : e-mail + mot de passe, session par cookie. Sans compte, meilleurs scores et leçons restent dans le navigateur (localStorage).
- **Stats** (`#/stats`) : chaque partie terminée est enregistrée pour un utilisateur connecté (carte, mode, score, temps, erreurs).
- **Amis et défis** (`#/amis`) : ajout d'amis par pseudo, défis sur n'importe quelle carte : le lanceur attend dans une salle d'attente, l'ami reçoit une notification (bandeau + badge, relevé toutes les 10 s), accepte, et les deux passent par un écran VS avec compte à rebours avant la même partie (même ordre de questions grâce à une graine partagée, progression de l'adversaire relue toutes les 3 s, meilleur score puis meilleur temps). Classement par trophées (`api/friends.php`, `api/duels.php`, `src/duel-ui.js`).
- **Mémos** (`#/memos`) : leçons de cartes question → réponse, révision par répétition espacée (SM-2 simplifié, `src/memos.js`) et quiz à choix multiples dès 4 cartes.

## Déployer sur Infomaniak (PHP + MySQL)

1. Dans le manager Infomaniak, créer une base MySQL et exécuter `api/schema.mysql.sql` (phpMyAdmin → onglet SQL).
2. `npm run package` : construit le site et prépare `dist/` avec `dist/api/` (PHP, `.htaccess`, schémas).
3. Envoyer par FTP/SSH **tout le contenu de `dist/`** à la racine du site : `/index.html`, `/assets/…`, `/flags/…`, `/api/*.php`.
4. Sur le serveur, créer `/api/.env` à partir de `.env.example` : `DB_DSN` (hôte MySQL Infomaniak, nom de base), `DB_USER`, `DB_PASSWORD`, `APP_ORIGIN=https://ton-domaine`.
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
