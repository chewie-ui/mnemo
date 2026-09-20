// Mode campagne : des chapitres, des niveaux courts qui s'enchaînent du plus simple au plus
// complet. Un niveau = une carte, un mode, et (souvent) un sous-ensemble de cibles.
// `countries` : codes pays (voir countries.js) ; null = toutes les cibles de la carte.
// `targets` : ids de cibles explicites pour les modes non-pays (fleuves, mers, monuments).

const level = (id, title, region, mode, countries = null, extra = {}) => ({ id, title, region, mode, countries, ...extra });

export const CHAPTERS = [
  {
    id: 'europe',
    title: 'Europe',
    subtitle: 'De nos voisins aux micro-États',
    badge: 'Explorateur d’Europe',
    levels: [
      level('eu-1', 'Nos voisins', 'europe', 'countries', ['250', '724', '380', '276', '056', '756', '826']),
      level('eu-2', 'L’Ouest', 'europe', 'countries', ['250', '724', '620', '380', '276', '056', '528', '442', '756', '040', '826', '372']),
      level('eu-3', 'Le Nord', 'europe', 'countries', ['208', '578', '752', '246', '352', '233', '428', '440']),
      level('eu-4', 'Le Centre', 'europe', 'countries', ['616', '203', '703', '348', '040', '705', '191', '276']),
      level('eu-5', 'Les Balkans', 'europe', 'countries', ['191', '070', '688', '499', 'kosovo', '807', '008', '300', '100', '642']),
      level('eu-6', 'L’Est', 'europe', 'countries', ['643', '804', '112', '498', '642', '100', '616', '440', '428', '233']),
      level('eu-7', 'Les micro-États', 'europe', 'countries', ['020', '492', '674', '336', '438', '470', '442', '196']),
      level('eu-8', 'Toute l’Europe', 'europe', 'countries', null, { boss: true }),
      level('eu-9', 'Capitales de l’Ouest', 'europe', 'capitals', ['250', '724', '620', '380', '276', '056', '528', '442', '756', '040', '826', '372']),
      level('eu-10', 'Capitales du Nord et de l’Est', 'europe', 'capitals', ['208', '578', '752', '246', '352', '233', '428', '440', '616', '203', '703', '348', '643', '804', '112', '498', '642', '100']),
      level('eu-11', 'Toutes les capitales', 'europe', 'capitals', null, { boss: true }),
      level('eu-12', 'Drapeaux de l’Ouest', 'europe', 'flags', ['250', '724', '620', '380', '276', '056', '528', '442', '756', '040', '826', '372']),
      level('eu-13', 'Tous les drapeaux', 'europe', 'flags', null, { boss: true }),
      level('eu-14', 'Grands fleuves', 'europe', 'rivers', null, { targets: ['river:danube', 'river:rhin', 'river:seine', 'river:loire', 'river:rhone', 'river:volga', 'river:dniepr', 'river:elbe', 'river:tage', 'river:po'] }),
      level('eu-15', 'Mers d’Europe', 'europe', 'seas', null, { targets: ['sea:mer-mediterranee', 'sea:mer-du-nord', 'sea:mer-baltique', 'sea:mer-noire', 'sea:manche', 'sea:mer-adriatique', 'sea:mer-egee', 'sea:golfe-de-gascogne', 'sea:mer-de-norvege', 'sea:mer-d-irlande'] }),
    ],
  },
  {
    id: 'americas',
    title: 'Amériques',
    subtitle: 'Du Canada à la Patagonie',
    badge: 'Explorateur des Amériques',
    levels: [
      level('am-1', 'Les grands du Nord', 'north-america', 'countries', ['124', '840', '484']),
      level('am-2', 'Amérique centrale', 'north-america', 'countries', ['484', '320', '084', '340', '222', '558', '188', '591']),
      level('am-3', 'Grandes Antilles', 'north-america', 'countries', ['192', '332', '214', '388', '044']),
      level('am-4', 'Petites Antilles', 'north-america', 'countries', ['028', '659', '212', '662', '670', '308', '052', '780']),
      level('am-5', 'Toute l’Amérique du Nord', 'north-america', 'countries', null, { boss: true }),
      level('am-6', 'Amérique du Sud', 'south-america', 'countries', null),
      level('am-7', 'États de l’Ouest américain', 'usa', 'countries', null, { targets: ['06', '41', '53', '32', '04', '49', '16', '30', '56', '08', '35', '02', '15'] }),
      level('am-8', 'États du Centre', 'usa', 'countries', null, { targets: ['48', '40', '20', '31', '46', '38', '27', '19', '29', '05', '22', '28', '01', '47', '21', '17', '55', '26', '18', '39'] }),
      level('am-9', 'États de l’Est', 'usa', 'countries', null, { targets: ['12', '13', '45', '37', '51', '54', '24', '10', '34', '42', '36', '09', '44', '25', '50', '33', '23'] }),
      level('am-10', 'Les 50 États', 'usa', 'countries', null, { boss: true }),
      level('am-11', 'Capitales des Amériques', 'north-america', 'capitals', ['124', '840', '484', '192', '320', '188', '591', '388', '332', '214']),
      level('am-12', 'Capitales d’Amérique du Sud', 'south-america', 'capitals', null, { boss: true }),
    ],
  },
  {
    id: 'asia',
    title: 'Asie',
    subtitle: 'Le plus grand des continents',
    badge: 'Explorateur d’Asie',
    levels: [
      level('as-1', 'Les géants', 'asia', 'countries', ['156', '356', '392', '360', '682', '364', '792']),
      level('as-2', 'Extrême-Orient', 'asia', 'countries', ['156', '392', '410', '408', '158', '496']),
      level('as-3', 'Asie du Sud-Est', 'asia', 'countries', ['704', '764', '418', '116', '104', '458', '702', '360', '608', '096', '626']),
      level('as-4', 'Asie du Sud', 'asia', 'countries', ['356', '586', '050', '524', '064', '144', '462', '004']),
      level('as-5', 'Moyen-Orient', 'asia', 'countries', ['792', '760', '422', '376', '275', '400', '368', '364', '682', '414', '048', '634', '784', '512', '887']),
      level('as-6', 'Asie centrale et Caucase', 'asia', 'countries', ['398', '860', '795', '417', '762', '004', '268', '051', '031']),
      level('as-7', 'Toute l’Asie', 'asia', 'countries', null, { boss: true }),
      level('as-8', 'Capitales d’Extrême-Orient et du Sud-Est', 'asia', 'capitals', ['156', '392', '410', '408', '158', '496', '704', '764', '418', '116', '104', '458', '702', '360', '608']),
      level('as-9', 'Capitales du Moyen-Orient et du Sud', 'asia', 'capitals', ['792', '760', '422', '376', '400', '368', '364', '682', '784', '356', '586', '050', '524', '004']),
      level('as-10', 'Toutes les capitales', 'asia', 'capitals', null, { boss: true }),
      level('as-11', 'Drapeaux d’Asie', 'asia', 'flags', null, { boss: true }),
    ],
  },
  {
    id: 'africa',
    title: 'Afrique',
    subtitle: '54 pays à apprivoiser',
    badge: 'Explorateur d’Afrique',
    levels: [
      level('af-1', 'Le Nord', 'africa', 'countries', ['504', '012', '788', '434', '818', '729', '478']),
      level('af-2', 'L’Ouest', 'africa', 'countries', ['686', '270', '624', '324', '694', '430', '384', '288', '768', '204', '566', '854', '466', '562', '132']),
      level('af-3', 'Le Centre', 'africa', 'countries', ['120', '148', '140', '266', '226', '178', '180', '678', '024']),
      level('af-4', 'L’Est', 'africa', 'countries', ['231', '232', '262', '706', '404', '800', '834', '646', '108', '728']),
      level('af-5', 'Le Sud et les îles', 'africa', 'countries', ['710', '516', '072', '716', '894', '508', '454', '426', '748', '450', '480', '690', '174']),
      level('af-6', 'Toute l’Afrique', 'africa', 'countries', null, { boss: true }),
      level('af-7', 'Capitales du Nord et de l’Ouest', 'africa', 'capitals', ['504', '012', '788', '434', '818', '686', '384', '288', '566', '466', '562', '854', '324']),
      level('af-8', 'Toutes les capitales', 'africa', 'capitals', null, { boss: true }),
      level('af-9', 'Drapeaux d’Afrique', 'africa', 'flags', null, { boss: true }),
    ],
  },
  {
    id: 'oceania',
    title: 'Océanie',
    subtitle: 'Un océan d’îles',
    badge: 'Explorateur d’Océanie',
    levels: [
      level('oc-1', 'Les grands', 'oceania', 'countries', ['036', '554', '598']),
      level('oc-2', 'Toute l’Océanie', 'oceania', 'countries', null, { boss: true }),
      level('oc-3', 'Capitales d’Océanie', 'oceania', 'capitals', null),
    ],
  },
  {
    id: 'world',
    title: 'Monde',
    subtitle: 'Tout ce qui ne tient pas sur un continent',
    badge: 'Citoyen du monde',
    levels: [
      level('wo-1', 'Les 30 pays incontournables', 'world', 'countries', ['840', '124', '484', '076', '032', '826', '250', '276', '380', '724', '643', '792', '818', '566', '710', '404', '156', '392', '356', '360', '682', '364', '036', '554', '410', '764', '704', '586', '180', '170']),
      level('wo-2', 'Les océans et grandes mers', 'world', 'seas', null, { targets: ['sea:ocean-pacifique', 'sea:ocean-atlantique', 'sea:ocean-indien', 'sea:ocean-arctique', 'sea:ocean-austral', 'sea:mer-mediterranee', 'sea:mer-des-caraibes', 'sea:mer-rouge', 'sea:golfe-persique', 'sea:mer-de-chine-meridionale', 'sea:mer-du-japon', 'sea:golfe-du-mexique'] }),
      level('wo-3', 'Les grands fleuves', 'world', 'rivers', null, { targets: ['river:nil', 'river:amazone', 'river:mississippi', 'river:yangzi-chang-jiang', 'river:congo', 'river:danube', 'river:gange', 'river:mekong', 'river:volga', 'river:niger', 'river:parana', 'river:rhin'] }),
      level('wo-4', 'Monuments célèbres', 'world', 'monuments', null),
      level('wo-5', 'Les grandes langues', 'world', 'languages', null, { targets: ['lang:anglais', 'lang:francais', 'lang:espagnol', 'lang:arabe', 'lang:portugais', 'lang:russe', 'lang:chinois-mandarin', 'lang:allemand', 'lang:japonais', 'lang:hindi', 'lang:swahili', 'lang:italien'] }),
      level('wo-6', 'Les monnaies', 'world', 'currencies', null, { targets: ['cur:euro', 'cur:dollar-americain', 'cur:yen', 'cur:livre-sterling', 'cur:franc-suisse', 'cur:yuan', 'cur:roupie-indienne', 'cur:real', 'cur:franc-cfa', 'cur:rouble-russe', 'cur:dollar-canadien', 'cur:dollar-australien'] }),
      level('wo-7', 'Tous les pays du monde', 'world', 'countries', null, { boss: true }),
      level('wo-8', 'Tous les drapeaux', 'world', 'flags', null, { boss: true }),
    ],
  },
  {
    id: 'history',
    title: 'Histoire',
    subtitle: 'L’Europe au fil des siècles',
    badge: 'Voyageur du temps',
    levels: [
      level('hi-1', 'Rome à son apogée', 'mediterranean-100', 'countries', null),
      level('hi-2', 'Les royaumes barbares', 'europe-500', 'countries', null),
      level('hi-3', 'Après Napoléon (1815)', 'europe-1815', 'countries', null),
      level('hi-4', 'Veille de 1914', 'europe-1914', 'countries', null),
      level('hi-5', 'Veille de 1939', 'europe-1938', 'countries', null),
      level('hi-6', 'L’Europe de 1945', 'europe-1945', 'countries', null),
      level('hi-7', 'Le monde en 1914', 'world-1914', 'countries', null, { boss: true }),
    ],
  },
];

export const LEVELS = CHAPTERS.flatMap((c, ci) => c.levels.map((l, li) => ({ ...l, chapter: c.id, number: li + 1, chapterIndex: ci })));

export const levelById = (id) => LEVELS.find((l) => l.id === id);

// Étoiles : 1 = réussi (≥ 70 % du premier coup), 2 = ≥ 90 %, 3 = sans faute.
export function starsFor(stats) {
  if (stats.score >= 100 && stats.errors === 0) return 3;
  if (stats.score >= 90) return 2;
  if (stats.score >= 70) return 1;
  return 0;
}

export const STAR_TROPHIES = 2; // par nouvelle étoile
export const CHAPTER_TROPHIES = 20; // chapitre terminé (toutes les étoiles ≥ 1)
