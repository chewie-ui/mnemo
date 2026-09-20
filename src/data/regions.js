import { COUNTRIES, US_STATES, ISO2 } from './countries.js';
import { CAPITALS, US_CAPITALS } from './capitals.js';
import { CITIES } from './cities.js';
import { RIVERS, SEAS, seaLabel, slug } from './nature.js';
import { HISTORY_MAPS } from './history.js';
import ADMIN1_INDEX from './generated/admin1-index.json';
import { LANGUAGES, withArticle, capitalize } from './languages.js';
import { CURRENCIES } from './currencies.js';
import { MONUMENTS } from './monuments.js';

// Une région = une carte jouable.
// kind 'countries' : cible = pays d'un continent (ou tous si continent = null).
//   center : point de vue de la projection azimutale, bbox : [ouest, sud, est, nord] cadré à l'écran.
// kind 'states' : cible = les 50 États américains (projection dédiée dans map.js).
// kind 'history' : États d'une époque (voir history.js), même cadrage qu'une carte moderne.

export const REGIONS = [
  { id: 'world', name: 'Monde', kind: 'countries', continent: null },
  { id: 'europe', name: 'Europe', kind: 'countries', continent: 'europe', center: [15, 54], bbox: [-24, 34, 45, 71] },
  { id: 'africa', name: 'Afrique', kind: 'countries', continent: 'africa', center: [20, 2], bbox: [-20, -36, 55, 38] },
  { id: 'asia', name: 'Asie', kind: 'countries', continent: 'asia', center: [90, 32], bbox: [26, -11, 150, 58] },
  { id: 'north-america', name: 'Amérique du Nord', kind: 'countries', continent: 'north-america', center: [-95, 40], bbox: [-168, 6, -52, 74] },
  { id: 'south-america', name: 'Amérique du Sud', kind: 'countries', continent: 'south-america', center: [-60, -20], bbox: [-84, -57, -34, 14] },
  { id: 'oceania', name: 'Océanie', kind: 'countries', continent: 'oceania', center: [160, -18], bbox: [112, -48, 190, 12] },
  { id: 'usa', name: 'États-Unis', kind: 'states' },
];

export const HISTORY_REGIONS = HISTORY_MAPS.map((m) => {
  const base = m.view === 'custom' ? { center: m.center, bbox: m.bbox } : REGIONS.find((r) => r.id === m.view);
  return { ...m, kind: 'history', continent: m.view === 'world' ? null : 'history', center: base.center, bbox: base.bbox };
});

// Subdivisions d'un pays (kind 'admin1') : une carte par entrée de l'index généré.
export const SUBDIVISION_REGIONS = ADMIN1_INDEX.map((m) => ({
  id: `sub-${m.id}`,
  kind: 'admin1',
  file: m.id,
  name: `${m.country} — ${m.label}`,
  country: m.country,
  label: m.label,
  unit: m.unit,
  continent: 'admin1',
  center: m.center,
  bbox: m.bbox,
  units: m.units,
}));

// Six façons de jouer chaque carte.
// 'countries' : cliquer sur une zone. 'flags' : idem, mais on montre un drapeau.
// 'capitals' / 'cities' : un point. 'rivers' : un tracé. 'seas' : une étendue d'eau.
export const MODES = ['countries', 'flags', 'capitals', 'cities', 'monuments', 'languages', 'currencies', 'rivers', 'seas'];

export function modeLabel(region, mode) {
  if (mode === 'flags') return 'Drapeaux';
  if (mode === 'languages') return 'Langues';
  if (mode === 'currencies') return 'Monnaies';
  if (mode === 'monuments') return 'Monuments';
  if (mode === 'capitals') return 'Capitales';
  if (mode === 'cities') return 'Villes';
  if (mode === 'rivers') return 'Fleuves';
  if (mode === 'seas') return 'Mers';
  if (region.kind === 'admin1') return region.label;
  return region.kind === 'states' || region.kind === 'history' ? 'États' : 'Pays';
}

// Unité pour « 46 pays », « 50 États », « 38 villes »…
export function unitLabel(region, mode, count) {
  const plural = count > 1;
  if (mode === 'flags') return plural ? 'drapeaux' : 'drapeau';
  if (mode === 'languages') return plural ? 'langues' : 'langue';
  if (mode === 'currencies') return plural ? 'monnaies' : 'monnaie';
  if (mode === 'monuments') return plural ? 'monuments' : 'monument';
  if (mode === 'capitals') return plural ? 'capitales' : 'capitale';
  if (mode === 'cities') return plural ? 'villes' : 'ville';
  if (mode === 'rivers') return plural ? 'fleuves' : 'fleuve';
  if (mode === 'seas') return plural ? 'mers' : 'mer';
  if (region.kind === 'admin1') return plural ? region.unit[0].toLowerCase() : region.unit[1].toLowerCase();
  if (region.kind === 'states' || region.kind === 'history') return plural ? 'États' : 'État';
  return 'pays';
}

const inRegion = (region, countryId) => !region.continent || COUNTRIES[countryId]?.c === region.continent;

// Cibles d'une partie : { id, name } pour les zones et tracés, + { lat, lon, state? } pour les points.
export function targetsFor(region, mode = 'countries') {
  if (region.kind === 'history') {
    if (mode !== 'countries') return [];
    return Object.entries(region.targets).map(([en, fr]) => ({ id: `h:${slug(en)}`, name: fr }));
  }
  if (region.kind === 'admin1') {
    if (mode !== 'countries') return [];
    return region.units.map(([id, name]) => ({ id: `a:${id}`, name }));
  }
  // Une langue (ou une monnaie) = tous les pays de la carte concernés ; cliquer l'un d'eux suffit.
  if (mode === 'languages' || mode === 'currencies') {
    if (region.kind !== 'countries') return [];
    const source = mode === 'languages' ? LANGUAGES : CURRENCIES;
    const groups = new globalThis.Map();
    for (const [id, value] of Object.entries(source)) {
      if (!inRegion(region, id)) continue;
      for (const item of [].concat(value)) {
        if (!groups.has(item)) groups.set(item, []);
        groups.get(item).push(id);
      }
    }
    const prefix = mode === 'languages' ? 'lang' : 'cur';
    const prompt = (item) => (mode === 'languages' ? { label: 'Où parle-t-on', text: `${withArticle(item)} ?` } : { label: 'Quel pays paie en', text: `${item} ?` });
    return [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'fr'))
      .map(([item, ids]) => ({ id: `${prefix}:${slug(item)}`, name: capitalize(item), ids, prompt: prompt(item) }));
  }
  if (mode === 'monuments') {
    return MONUMENTS.filter((x) => x.regions.includes(region.id)).map((x) => ({ id: `mon:${slug(x.name)}`, name: x.name, lat: x.lat, lon: x.lon, state: x.state }));
  }
  if (mode === 'flags') {
    if (region.kind !== 'countries') return [];
    return Object.entries(COUNTRIES)
      .filter(([id]) => inRegion(region, id))
      .map(([id, c]) => ({ id, name: c.fr, flag: ISO2[id] }));
  }
  if (mode === 'rivers') {
    return RIVERS.filter((r) => r.regions.includes(region.id)).map((r) => ({ id: `river:${slug(r.name)}`, name: r.name }));
  }
  if (mode === 'seas') {
    return Object.entries(SEAS)
      .filter(([, regions]) => regions.includes(region.id))
      .map(([name]) => ({ id: `sea:${slug(name)}`, name: seaLabel(name) }));
  }
  if (mode === 'capitals') {
    if (region.kind === 'states') {
      return Object.entries(US_CAPITALS).map(([state, [name, lat, lon]]) => ({ id: `cap:${state}`, name, lat, lon, state }));
    }
    return Object.entries(CAPITALS)
      .filter(([countryId]) => inRegion(region, countryId))
      .map(([countryId, [name, lat, lon]]) => ({ id: `cap:${countryId}`, name, lat, lon }));
  }
  if (mode === 'cities') {
    return CITIES.filter((city) => city.regions.includes(region.id)).map((city) => ({
      id: `city:${slug(city.name)}`,
      name: city.name,
      lat: city.lat,
      lon: city.lon,
      state: city.state,
    }));
  }
  if (region.kind === 'states') {
    return Object.entries(US_STATES).map(([id, name]) => ({ id, name }));
  }
  return Object.entries(COUNTRIES)
    .filter(([id]) => inRegion(region, id))
    .map(([id, c]) => ({ id, name: c.fr }));
}

export function regionById(id) {
  return REGIONS.find((r) => r.id === id) ?? HISTORY_REGIONS.find((r) => r.id === id) ?? SUBDIVISION_REGIONS.find((r) => r.id === id);
}
