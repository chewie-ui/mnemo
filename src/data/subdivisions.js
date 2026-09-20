// Subdivisions de chaque pays (États, provinces, départements…), issues de
// Natural Earth « admin-1 » (domaine public) et préparées par scripts/build-data.mjs.
// Ce fichier ne décrit que les exceptions ; par défaut, un pays = ses unités admin-1.

// Pays exclus : découpage trop fin ou sans intérêt pour un quiz, ou carte dédiée ailleurs.
export const SKIP = new Set([
  'US', // carte États-Unis dédiée (encarts Alaska/Hawaï)
  'GB', // 232 districts, et les régions n'ont pas de nom français
  'UG', 'MT', 'AZ', 'MK', 'SC', 'CV', 'BS', // communes et districts minuscules
]);

// Cartes supplémentaires ou de remplacement pour un pays.
//   merge : regroupe les unités par le champ Natural Earth `region` (une carte par région).
//   filter : ne garde que certaines unités (par type_en).
//   names : traductions des noms de régions quand la source n'en a pas en français.
export const VARIANTS = {
  FR: [
    { suffix: 'departements', label: 'Départements', unit: 'départements', filter: (p) => p.type_en === 'Metropolitan department' },
    { suffix: 'regions', label: 'Régions', unit: 'régions', merge: 'region' },
  ],
  IT: [
    {
      suffix: 'regions', label: 'Régions', unit: 'régions', merge: 'region',
      names: {
        "Valle d'Aosta": "Vallée d'Aoste", Piemonte: 'Piémont', Lombardia: 'Lombardie', 'Trentino-Alto Adige': 'Trentin-Haut-Adige',
        Liguria: 'Ligurie', 'Emilia-Romagna': 'Émilie-Romagne', Veneto: 'Vénétie', 'Friuli-Venezia Giulia': 'Frioul-Vénétie Julienne',
        Toscana: 'Toscane', Umbria: 'Ombrie', Marche: 'Marches', Lazio: 'Latium', Abruzzo: 'Abruzzes', Molise: 'Molise',
        Campania: 'Campanie', Puglia: 'Pouilles', Basilicata: 'Basilicate', Calabria: 'Calabre', Sicilia: 'Sicile', Sardegna: 'Sardaigne',
      },
    },
    { suffix: 'provinces', label: 'Provinces', unit: 'provinces' },
  ],
  ES: [
    {
      suffix: 'communautes', label: 'Communautés autonomes', unit: 'communautés autonomes', merge: 'region',
      names: {
        'País Vasco': 'Pays basque', Cataluña: 'Catalogne', Aragón: 'Aragon', 'Foral de Navarra': 'Navarre', Galicia: 'Galice',
        'Castilla y León': 'Castille-et-León', 'Castilla-La Mancha': 'Castille-La Manche', Andalucía: 'Andalousie',
        Valenciana: 'Communauté valencienne', 'Islas Baleares': 'Îles Baléares', 'Canary Is.': 'Îles Canaries',
        Madrid: 'Communauté de Madrid', Murcia: 'Région de Murcie', Extremadura: 'Estrémadure',
        Cantabria: 'Cantabrie', Asturias: 'Asturies', 'La Rioja': 'La Rioja', Ceuta: 'Ceuta', Melilla: 'Melilla',
      },
    },
    { suffix: 'provinces', label: 'Provinces', unit: 'provinces' },
  ],
  SI: [{ suffix: 'regions', label: 'Régions', unit: 'régions', merge: 'region' }],
  LV: [{ suffix: 'regions', label: 'Régions', unit: 'régions', merge: 'region' }],
  PH: [{ suffix: 'regions', label: 'Régions', unit: 'régions', merge: 'region', clean: (n) => n.replace(/\s*\(.*\)$/, '') }],
};

// Libellé français du type d'unité, d'après `type_en` majoritaire. Surcharges par pays ensuite.
export const TYPE_LABELS = {
  State: ['États', 'État'],
  Province: ['Provinces', 'Province'],
  Department: ['Départements', 'Département'],
  Departamento: ['Départements', 'Département'],
  Region: ['Régions', 'Région'],
  County: ['Comtés', 'Comté'],
  Canton: ['Cantons', 'Canton'],
  Prefecture: ['Préfectures', 'Préfecture'],
  District: ['Districts', 'District'],
  Governorate: ['Gouvernorats', 'Gouvernorat'],
  Municipality: ['Municipalités', 'Municipalité'],
  'Autonomous Community': ['Communautés autonomes', 'Communauté autonome'],
  'Voivodeship|Province': ['Voïvodies', 'Voïvodie'],
  Emirate: ['Émirats', 'Émirat'],
  Parish: ['Paroisses', 'Paroisse'],
  Territory: ['Territoires', 'Territoire'],
  Republic: ['Sujets fédéraux', 'Sujet fédéral'],
  Oblast: ['Oblasts', 'Oblast'],
  Division: ['Divisions', 'Division'],
  Zone: ['Zones', 'Zone'],
  Commune: ['Communes', 'Commune'],
  Island: ['Îles', 'Île'],
  Atoll: ['Atolls', 'Atoll'],
  Wilaya: ['Wilayas', 'Wilaya'],
  Krai: ['Kraïs', 'Kraï'],
};

export const TYPE_OVERRIDES = {
  DE: ['Länder', 'Land'],
  AT: ['Länder', 'Land'],
  RU: ['Sujets fédéraux', 'Sujet fédéral'],
  UA: ['Oblasts', 'Oblast'],
  JP: ['Préfectures', 'Préfecture'],
  CN: ['Provinces', 'Province'],
  IN: ['États', 'État'],
  ES: ['Communautés autonomes', 'Communauté autonome'],
  BR: ['États', 'État'],
  MX: ['États', 'État'],
  AU: ['États', 'État'],
  CA: ['Provinces', 'Province'],
  CH: ['Cantons', 'Canton'],
  BE: ['Provinces', 'Province'],
  NL: ['Provinces', 'Province'],
  PL: ['Voïvodies', 'Voïvodie'],
  GR: ['Périphéries', 'Périphérie'],
  PT: ['Districts', 'District'],
  IE: ['Comtés', 'Comté'],
  DK: ['Régions', 'Région'],
  SE: ['Comtés', 'Comté'],
  NO: ['Comtés', 'Comté'],
  FI: ['Régions', 'Région'],
  TR: ['Provinces', 'Province'],
  EG: ['Gouvernorats', 'Gouvernorat'],
  MA: ['Régions', 'Région'],
  DZ: ['Wilayas', 'Wilaya'],
  TN: ['Gouvernorats', 'Gouvernorat'],
  AR: ['Provinces', 'Province'],
  CL: ['Régions', 'Région'],
  CO: ['Départements', 'Département'],
  PE: ['Régions', 'Région'],
  VE: ['États', 'État'],
  NG: ['États', 'État'],
  ZA: ['Provinces', 'Province'],
  KR: ['Provinces', 'Province'],
  VN: ['Provinces', 'Province'],
  TH: ['Provinces', 'Province'],
  ID: ['Provinces', 'Province'],
  PK: ['Provinces', 'Province'],
  SA: ['Provinces', 'Province'],
  IR: ['Provinces', 'Province'],
  AE: ['Émirats', 'Émirat'],
};

// Pays trop petits ou trop peu découpés pour un quiz.
export const MIN_UNITS = 4;
