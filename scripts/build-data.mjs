// Prépare les données « Nature » et « Histoire » : lit les GeoJSON bruts de raw/,
// ne garde que ce qui est joué, fusionne les morceaux d'un même objet, simplifie
// et écrit des TopoJSON légers dans src/data/generated/.
//
//   node scripts/build-data.mjs [nature] [history] [admin1] [flags]   (tout par défaut)
//
// Sources : Natural Earth 50m/10m (domaine public), historical-basemaps (GPL-3.0), flag-icons (MIT).

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { topology } from 'topojson-server';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { feature } from 'topojson-client';
import { geoArea, geoCentroid, geoContains } from 'd3-geo';
import polygonClipping from 'polygon-clipping';
import landTopo from 'world-atlas/land-50m.json' with { type: 'json' };
import countriesTopo from 'world-atlas/countries-50m.json' with { type: 'json' };
import { RIVERS, SEAS, slug } from '../src/data/nature.js';
import { ERAS } from '../src/data/history.js';
import { COUNTRIES, ISO2 } from '../src/data/countries.js';
import { SKIP, VARIANTS, TYPE_LABELS, TYPE_OVERRIDES, MIN_UNITS } from '../src/data/subdivisions.js';

const only = new Set(process.argv.slice(2));
const wants = (step) => only.size === 0 || only.has(step);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = (file) => JSON.parse(readFileSync(path.join(root, 'raw', file), 'utf8'));
const outDir = path.join(root, 'src', 'data', 'generated');
mkdirSync(outDir, { recursive: true });

function bbox(coords) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]);
      y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]);
    } else c.forEach(walk);
  };
  walk(coords);
  return [x0, y0, x1, y1];
}

const inside = ([x0, y0, x1, y1], [w, s, e, n]) => x0 >= w && x1 <= e && y0 >= s && y1 <= n;

// Éclate une géométrie en ses morceaux élémentaires (LineString ou Polygon).
function pieces(geometry) {
  if (!geometry) return [];
  const { type, coordinates } = geometry;
  if (type === 'LineString' || type === 'Polygon') return [{ type, coordinates }];
  if (type === 'MultiLineString') return coordinates.map((c) => ({ type: 'LineString', coordinates: c }));
  if (type === 'MultiPolygon') return coordinates.map((c) => ({ type: 'Polygon', coordinates: c }));
  if (type === 'GeometryCollection') return geometry.geometries.flatMap(pieces);
  return [];
}

// D3 lit les polygones sur la sphère : un anneau extérieur doit tourner dans le sens
// horaire, sinon il désigne « tout le globe sauf la zone ». Les fichiers sources ne
// respectent pas toujours cette convention, on remet chaque anneau dans le bon sens.
function rewind(rings) {
  return rings.map((ring, i) => {
    const area = geoArea({ type: 'Polygon', coordinates: [ring] });
    const wantsBig = i > 0; // un trou tourne dans l'autre sens que son contour
    return (area > 2 * Math.PI) === wantsBig ? ring : ring.slice().reverse();
  });
}

function multi(kind, parts) {
  if (kind === 'LineString') return { type: 'MultiLineString', coordinates: parts.map((p) => p.coordinates) };
  return { type: 'MultiPolygon', coordinates: parts.map((p) => rewind(p.coordinates)) };
}

// La simplification peut tordre un îlot en anneau dégénéré (nœud papillon) que D3
// lirait comme « toute la sphère » : on retire ces anneaux minuscules à l'aire aberrante.
function dropDegenerateRings(features) {
  for (const f of features) {
    if (f.geometry.type !== 'MultiPolygon') continue;
    f.geometry.coordinates = f.geometry.coordinates
      .map((rings) =>
        rings.filter((ring) => {
          if (ring.length < 4) return false;
          const [x0, y0, x1, y1] = bbox(ring);
          const tiny = (x1 - x0) * (y1 - y0) < 1;
          return !(tiny && geoArea({ type: 'Polygon', coordinates: [ring] }) > Math.PI);
        }),
      )
      .filter((rings) => rings.length > 0);
  }
  return features;
}

// GeoJSON → TopoJSON simplifié. `keep` : fraction des points conservés (0–1).
function toTopo(features, keep) {
  let topo = topology({ layer: { type: 'FeatureCollection', features } }, 1e5);
  topo = presimplify(topo);
  topo = simplify(topo, quantile(topo, keep));
  const cleaned = dropDegenerateRings(feature(topo, topo.objects.layer).features);
  return topology({ layer: { type: 'FeatureCollection', features: cleaned } }, 1e5);
}

function write(name, topo) {
  const json = JSON.stringify(topo);
  writeFileSync(path.join(outDir, name), json);
  console.log(`${name.padEnd(20)} ${(json.length / 1024).toFixed(0).padStart(5)} Ko`);
}

// ─── Fleuves ───
if (wants('nature')) {
  const src = raw('ne_50m_rivers_lake_centerlines.geojson');
  const features = [];
  for (const river of RIVERS) {
    const parts = src.features
      .filter((f) => river.ne.includes(f.properties.name))
      .flatMap((f) => pieces(f.geometry))
      .filter((p) => p.coordinates.length > 1 && inside(bbox(p.coordinates), river.bbox));
    if (parts.length === 0) console.warn(`  ! fleuve sans tracé : ${river.name}`);
    features.push({ type: 'Feature', id: slug(river.name), properties: { name: river.name }, geometry: multi('LineString', parts) });
  }
  write('rivers.json', toTopo(features, 0.5));
}

// ─── Mers et océans ───
if (wants('nature')) {
  const src = raw('ne_50m_geography_marine_polys.geojson');
  const features = [];
  for (const name of Object.keys(SEAS)) {
    const parts = src.features.filter((f) => f.properties.name_fr === name).flatMap((f) => pieces(f.geometry));
    if (parts.length === 0) console.warn(`  ! mer introuvable : ${name}`);
    features.push({ type: 'Feature', id: slug(name), properties: { name }, geometry: multi('Polygon', parts) });
  }
  write('seas.json', toTopo(features, 0.25));
}

// ─── Histoire ───
// La source dessine les États en aplats grossiers : ils débordent sur la mer et
// oublient les îles et les franges côtières. On découpe chaque État par les terres
// émergées actuelles, puis on rattache chaque bout de terre orphelin à l'État qui
// possédait le pays moderne correspondant (Lesbos → Grèce, pas Turquie).
// polygon-clipping raisonne à plat en lon/lat : un anneau qui saute de 180 à -180
// (Eurasie par la Tchoukotka, Alaska par les Aléoutiennes) est illisible pour lui.
// On « déroule » ces anneaux (longitudes continues, au-delà de ±180) pendant les
// calculs, et on les renroule à la fin pour D3.
function unwrapRing(ring) {
  let offset = 0;
  let prev = ring[0][0];
  const out = ring.map(([x, y]) => {
    if (x - prev > 180) offset -= 360;
    else if (prev - x > 180) offset += 360;
    prev = x;
    return [x + offset, y];
  });
  // Anneau non refermé (bord le long de l'antiméridien, Antarctique) : on le laisse tel quel.
  if (out[0][0] !== out[out.length - 1][0]) return ring;
  // On recale l'anneau dans le cadre où sa longitude moyenne est dans [-180, 180],
  // sinon un anneau qui démarre près de ±180 (l'Eurasie) part entier à -360.
  const mean = out.reduce((k, [x]) => k + x, 0) / out.length;
  const shift = mean > 180 ? -360 : mean < -180 ? 360 : 0;
  return shift ? out.map(([x, y]) => [x + shift, y]) : out;
}
const unwrap = (polys) => polys.map((rings) => rings.map(unwrapRing));
const wrapRing = (ring) => ring.map(([x, y]) => [x > 180 ? x - 360 : x < -180 ? x + 360 : x, y]);
const wrap = (polys) => polys.map((rings) => rings.map(wrapRing));
// polygon-clipping se perd aussi sur des sommets quasi confondus : on arrondit tout à 1e-3° (~100 m).
const snap = (coords) => (typeof coords[0] === 'number' ? coords.map((v) => Math.round(v * 1000) / 1000) : coords.map(snap));
const LAND = snap(unwrap(feature(landTopo, landTopo.objects.land).features[0].geometry.coordinates));
const MODERN = feature(countriesTopo, countriesTopo.objects.countries).features.map((f) => {
  const polys = snap(unwrap(pieces(f.geometry).map((piece) => piece.coordinates)));
  return {
    feature: f,
    polys,
    box: bbox(polys),
    // Points d'échantillon : centroïde de chaque morceau, pour savoir quel État historique couvre le pays.
    samples: polys.map((rings) => geoCentroid({ type: 'Polygon', coordinates: rings })),
  };
});
const inBox = ([x0, y0, x1, y1], [x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

function clipToLand(parts) {
  const clipped = polygonClipping.intersection(snap(unwrap(parts.map((p) => p.coordinates))), LAND);
  return clipped.map((coordinates) => ({ type: 'Polygon', coordinates }));
}

function attachOrphans(features) {
  const states = features.map((f) => ({
    f,
    box: bbox(f.geometry.coordinates),
    vertices: f.geometry.coordinates.flat(2),
  }));
  const contains = (state, point) => inBox(state.box, point) && geoContains(state.f, point);
  let attached = 0;
  // Pays par pays, pour garder des opérations géométriques petites (polygon-clipping
  // se perd sur un calcul mondial). On ne rattache que des morceaux modestes : une
  // grande zone non couverte (désert, steppe) reste sans État, c'est voulu.
  for (const country of MODERN) {
    const votes = new Map();
    for (const point of country.samples) {
      for (const state of states) if (contains(state, point)) votes.set(state, (votes.get(state) ?? 0) + 1);
    }
    const candidates = [...votes.keys()];
    if (candidates.length === 0) continue;
    const countryCoords = country.polys;
    const countryArea = geoArea(country.feature);
    const maxPiece = Math.max(0.001, countryArea * 0.05);
    let orphans;
    try {
      const union = polygonClipping.union(...candidates.map((state) => state.f.geometry.coordinates));
      orphans = polygonClipping.difference(countryCoords, union);
    } catch {
      // Repli : les morceaux entiers (îles) dont le centre n'est couvert par personne.
      orphans = countryCoords.filter((coords) => !candidates.some((state) => contains(state, geoCentroid({ type: 'Polygon', coordinates: coords }))));
    }
    for (const coordinates of orphans) {
      const ring = rewind(coordinates);
      if (geoArea({ type: 'Polygon', coordinates: ring }) > maxPiece) continue;
      const centroid = geoCentroid({ type: 'Polygon', coordinates: ring });
      const dist = (state) => Math.min(...state.vertices.map(([x, y]) => (x - centroid[0]) ** 2 + (y - centroid[1]) ** 2));
      const best = candidates.reduce((a, b) => (dist(b) < dist(a) ? b : a));
      best.f.geometry.coordinates.push(ring);
      attached++;
    }
  }
  return attached;
}

// Aires culturelles sans État (chasseurs-cueilleurs, cultures archéologiques…) :
// utiles aux historiens, bruit pour le jeu. On les fond dans les terres neutres.
const CULTURE = /hunter|gatherer|culture|complex|focus|peoples|farmers|fichers|foraging|aboriginal|cultures/i;

for (const era of wants('history') ? ERAS : []) {
  const src = raw(`world_${era.year}.geojson`);
  const groups = new Map();
  for (const f of src.features) {
    // Sans nom propre, un territoire prend celui de la puissance qui l'administre.
    // (Le fichier contient quelques SUBJECTO parasites comme « 1 » : on les ignore.)
    const subject = f.properties.SUBJECTO?.trim();
    const rawName = f.properties.NAME?.trim() || (subject && subject.length > 2 && !/^d+$/.test(subject) ? subject : null);
    const aliased = rawName ? (era.aliases[rawName] ?? rawName) : null;
    const name = aliased && !CULTURE.test(aliased) ? aliased : null;
    const key = name ?? '__unnamed__';
    if (!groups.has(key)) groups.set(key, { name, parts: [] });
    groups.get(key).parts.push(...pieces(f.geometry));
  }
  const features = [...groups.values()]
    .filter(({ name }) => name)
    .map(({ name, parts }) => ({
      type: 'Feature',
      id: slug(name),
      properties: { name },
      geometry: multi('Polygon', clipToLand(parts)),
    }));
  const attached = attachOrphans(features);
  // Les franges rattachées sont fusionnées avec l'État : formes propres, fichier plus léger.
  for (const f of features) {
    try {
      f.geometry.coordinates = polygonClipping.union(...f.geometry.coordinates).map(rewind);
    } catch {
      /* on garde les morceaux séparés */
    }
    f.geometry.coordinates = wrap(f.geometry.coordinates);
  }
  console.log(`  ${era.year} : ${attached} îles et franges côtières rattachées`);
  // Vérifie que chaque cible demandée existe bien dans le fichier.
  for (const map of era.maps) {
    for (const target of Object.keys(map.targets)) {
      if (!groups.has(target)) console.warn(`  ! ${map.id} : cible absente du fichier : ${target}`);
    }
  }
  write(`history-${era.year}.json`, toTopo(features, 0.35));
}

// ─── Subdivisions (admin-1) ───
// Une carte par pays (et par variante) : unités fusionnées par nom, morceaux lointains
// (DOM, Hawaï, île de Pâques…) écartés pour que le cadrage reste lisible.
if (wants('admin1')) {
  const src = raw('ne_10m_admin_1_states_provinces.geojson');
  const numericByIso2 = Object.fromEntries(Object.entries(ISO2).map(([num, cc]) => [cc.toUpperCase(), num]));
  const byCountry = new Map();
  for (const f of src.features) {
    const cc = f.properties.iso_a2;
    if (!cc || cc === '-1' || SKIP.has(cc) || !numericByIso2[cc]) continue;
    if (!byCountry.has(cc)) byCountry.set(cc, []);
    byCountry.get(cc).push(f);
  }

  mkdirSync(path.join(outDir, 'admin1'), { recursive: true });
  const index = [];
  const centroidOf = (piece) => geoCentroid({ type: 'Polygon', coordinates: piece.coordinates });

  for (const [cc, feats] of byCountry) {
    const variants = VARIANTS[cc] ?? [{}];
    for (const variant of variants) {
      const kept = variant.filter ? feats.filter((f) => variant.filter(f.properties)) : feats;
      // Regroupement par nom (ou par région) : { name, parts, types }
      const groups = new Map();
      for (const f of kept) {
        const p = f.properties;
        let name = variant.merge ? p[variant.merge] : p.name_fr || p.name;
        if (!name) continue;
        if (variant.names?.[name]) name = variant.names[name];
        if (variant.clean) name = variant.clean(name);
        if (!groups.has(name)) groups.set(name, { name, parts: [], types: [] });
        const g = groups.get(name);
        g.parts.push(...pieces(f.geometry).map((piece) => ({ ...piece, area: geoArea({ type: 'Polygon', coordinates: piece.coordinates }) })));
        g.types.push(p.type_en || p.type);
      }
      // Cœur du pays : on part du plus grand morceau et on agrège de proche en proche
      // tout morceau à moins de 10° de l'emprise courante. Le reste est lointain.
      const all = [...groups.values()].flatMap((g) => g.parts);
      // Longitudes ramenées dans un repère continu si le pays chevauche l'antiméridien.
      const lons = all.map((piece) => centroidOf(piece)[0]);
      const wraps = Math.max(...lons) - Math.min(...lons) > 180;
      const lon = (x) => (wraps && x < 0 ? x + 360 : x);
      for (const piece of all) {
        const [x0, y0, x1, y1] = bbox(piece.coordinates);
        piece.box = [lon(x0), y0, lon(x1), y1];
      }
      // Point de départ : le morceau le plus proche du barycentre du pays (la Guyane est
      // presque aussi grande que la Nouvelle-Aquitaine, mais loin du barycentre).
      const total = all.reduce((k, piece) => k + piece.area, 0);
      for (const piece of all) {
        const [cx, cy] = centroidOf(piece);
        piece.c = [lon(cx), cy];
      }
      const mean = all.reduce(([x, y], piece) => [x + piece.c[0] * piece.area, y + piece.c[1] * piece.area], [0, 0]).map((v) => v / total);
      const dist = (piece) => Math.hypot(piece.c[0] - mean[0], piece.c[1] - mean[1]);
      const largest = all.reduce((a, b) => (dist(b) < dist(a) ? b : a));
      // Un îlot minuscule ne rejoint le cœur que s'il est vraiment tout près : sans ça,
      // les îles Ogasawara feraient dériver le cadrage du Japon de 1 000 km vers l'est.
      const margin = (piece) => (piece.area < total * 0.0005 ? 3 : 10);
      let [w, s, e, n] = largest.box;
      const inCore = new Set([largest]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const piece of all) {
          if (inCore.has(piece)) continue;
          const [x0, y0, x1, y1] = piece.box;
          const m = margin(piece);
          if (x1 >= w - m && x0 <= e + m && y1 >= s - m && y0 <= n + m) {
            inCore.add(piece);
            w = Math.min(w, x0); e = Math.max(e, x1); s = Math.min(s, y0); n = Math.max(n, y1);
            grew = true;
          }
        }
      }
      const units = [...groups.values()]
        .map((g) => ({ ...g, parts: g.parts.filter((piece) => inCore.has(piece)) }))
        .filter((g) => g.parts.length > 0);
      if (units.length < MIN_UNITS) {
        if (variant.suffix) console.warn(`  ! ${cc}-${variant.suffix} : ${units.length} unité(s) seulement, carte ignorée`);
        continue;
      }

      const center = [((w + e) / 2 + 180) % 360 - 180, (s + n) / 2];

      const used = new Set();
      const features = units.map((g) => {
        let id = slug(g.name);
        while (used.has(id)) id += '-2';
        used.add(id);
        return { type: 'Feature', id, properties: { name: g.name }, geometry: multi('Polygon', g.parts.map(({ type, coordinates }) => ({ type, coordinates }))) };
      });
      const points = features.reduce((k, f) => k + f.geometry.coordinates.flat(2).length, 0);
      const keep = Math.min(0.5, Math.max(0.08, 6000 / points));
      const id = cc.toLowerCase() + (variant.suffix ? `-${variant.suffix}` : '');
      write(`admin1/${id}.json`, toTopo(features, keep));

      const typeCounts = {};
      for (const g of units) for (const t of g.types) typeCounts[t] = (typeCounts[t] || 0) + 1;
      const majority = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
      const unitLabel = variant.unit
        ? [variant.unit, variant.unit.replace(/s$/, '')]
        : TYPE_OVERRIDES[cc] ?? TYPE_LABELS[majority] ?? ['Subdivisions', 'Subdivision'];
      index.push({
        id,
        cc,
        country: COUNTRIES[numericByIso2[cc]].fr,
        label: variant.label ?? unitLabel[0],
        unit: unitLabel,
        center,
        bbox: [w, s, e, n],
        units: features.map((f) => [f.id, f.properties.name]),
      });
    }
  }
  index.sort((a, b) => a.country.localeCompare(b.country, 'fr') || a.id.localeCompare(b.id));
  const json = JSON.stringify(index);
  writeFileSync(path.join(outDir, 'admin1-index.json'), json);
  console.log(`admin1-index.json     ${(json.length / 1024).toFixed(0).padStart(5)} Ko (${index.length} cartes)`);
}

// ─── Drapeaux ───
if (wants('flags')) {
  const dir = path.join(root, 'public', 'flags');
  mkdirSync(dir, { recursive: true });
  for (const cc of Object.values(ISO2)) {
    copyFileSync(path.join(root, 'node_modules', 'flag-icons', 'flags', '4x3', `${cc}.svg`), path.join(dir, `${cc}.svg`));
  }
  console.log(`public/flags : ${Object.keys(ISO2).length} drapeaux`);
}
