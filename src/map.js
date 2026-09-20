// Rendu SVG d'une carte muette et gestion des clics / du zoom.
// Familles de cibles : zones (pays, États, mers), tracés (fleuves) et points (capitales, villes).
import { geoPath, geoAzimuthalEqualArea, geoNaturalEarth1, geoConicEqualArea, geoCentroid } from 'd3-geo';
import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import { feature } from 'topojson-client';
import { COUNTRIES, NAME_TO_ID, IGNORED_NAMES, US_STATES } from './data/countries.js';

export const VIEW_W = 1000;
export const VIEW_H = 620;
const PAD = 16;
const MICRO_AREA = 60; // surface projetée (px²) en dessous de laquelle on ajoute un marqueur cliquable
const MARKER_R = 5; // rayon du marqueur de micro-État à l'écran, constant quel que soit le zoom
const POINT_R = 5.5; // rayon d'une ville à l'écran, constant quel que soit le zoom

// ─── Données (chargées à la demande, une seule fois) ───
const cache = {};

async function load(key, loader) {
  if (!cache[key]) cache[key] = loader();
  return cache[key];
}

function toFeatures(topo) {
  return feature(topo, topo.objects[Object.keys(topo.objects)[0]]).features;
}

const loadBase = () =>
  load('base', async () => {
    const [world, us] = await Promise.all([import('world-atlas/countries-50m.json'), import('us-atlas/states-10m.json')]);
    const countries = feature(world.default, world.default.objects.countries).features;
    for (const f of countries) {
      const name = f.properties.name;
      f.key = IGNORED_NAMES.has(name) ? null : (NAME_TO_ID[name] ?? f.id ?? null);
    }
    const states = feature(us.default, us.default.objects.states).features;
    for (const f of states) f.key = f.id;
    return { countries, states };
  });

const loadLayer = (name, prefix) =>
  load(name, async () => {
    const topo = (await import(`./data/generated/${name}.json`)).default;
    const features = toFeatures(topo);
    for (const f of features) f.key = f.id === 'unnamed' ? null : `${prefix}${f.id}`;
    return features;
  });

// Subdivisions d'un pays : un fichier par carte, dans un sous-dossier (import séparé,
// Vite ne résout les imports dynamiques qu'à un niveau de profondeur).
const loadAdmin1 = (file) =>
  load(`admin1/${file}`, async () => {
    const topo = (await import(`./data/generated/admin1/${file}.json`)).default;
    const features = toFeatures(topo);
    for (const f of features) f.key = `a:${f.id}`;
    return features;
  });

// Échantillonne le contour d'une bbox [ouest, sud, est, nord] pour cadrer une
// projection azimutale (les longitudes > 180 passent l'antiméridien).
function bboxPoints([w, s, e, n]) {
  const norm = (lon) => (lon > 180 ? lon - 360 : lon);
  const coordinates = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const lon = norm(w + (e - w) * t);
    const lat = s + (n - s) * t;
    coordinates.push([lon, s], [lon, n], [norm(w), lat], [norm(e), lat]);
  }
  return { type: 'MultiPoint', coordinates };
}

const svgNS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}) {
  const node = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  return node;
}

// Alaska et Hawaï vivent dans des encarts.
const isInset = (state) => state === '02' || state === '15';
const INSET_RIVERS = { '02': new Set(['river:yukon']), '15': new Set() };

export class GameMap {
  /**
   * @param {SVGSVGElement} svg
   * @param {object} region   voir data/regions.js
   * @param {Array}  targets  cibles de la partie ({ id, name } ou { id, name, lat, lon, state? })
   * @param {string} mode     'countries' | 'flags' | 'capitals' | 'cities' | 'rivers' | 'seas'
   */
  constructor(svg, region, targets, mode = 'countries') {
    this.svg = svg;
    this.region = region;
    this.targets = targets;
    this.targetIds = new Set(targets.map((t) => t.id));
    this.mode = mode;
    // Les zones restent cliquables dans les modes qui désignent un pays (drapeaux, langues).
    this.zoneMode = mode === 'countries' || mode === 'flags' || mode === 'languages' || mode === 'currencies';
    this.pointMode = mode === 'capitals' || mode === 'cities' || mode === 'monuments';
    this.onSelect = () => {};
    this.nodes = new Map(); // id -> [éléments SVG]
    this.markers = []; // { node, area } micro-États, adaptés au zoom
    this.points = []; // villes, adaptées au zoom
    this.zoomBehavior = null;
    this.clipCount = 0;
  }

  async render() {
    const base = await loadBase();
    const layers = {
      rivers: this.mode === 'rivers' ? await loadLayer('rivers', 'river:') : null,
      seas: this.mode === 'seas' ? await loadLayer('seas', 'sea:') : null,
      history: this.region.kind === 'history' ? await loadLayer(`history-${this.region.year}`, 'h:') : null,
      admin1: this.region.kind === 'admin1' ? await loadAdmin1(this.region.file) : null,
    };
    const svg = this.svg;
    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
    this.defs = el('defs');
    svg.appendChild(this.defs);

    const root = el('g', { class: 'zoomable' });
    svg.appendChild(root);
    this.root = root;

    if (this.region.kind === 'states') {
      this.#renderStates(root, base, layers);
    } else {
      this.#renderCountries(root, base, layers);
    }

    this.#setupZoom();
    // Propriété plutôt que addEventListener : le <svg> est réutilisé d'une partie
    // à l'autre, on ne veut qu'un seul gestionnaire actif.
    svg.onclick = (e) => {
      const target = e.target.closest('[data-id]');
      if (!target) return;
      this.onSelect(target.dataset.id, { x: e.clientX, y: e.clientY });
    };
  }

  // Rôle d'une zone : cible cliquable, membre de la carte (clair, inerte) ou décor (sombre).
  #tone(inRegion) {
    if (!inRegion) return 'context';
    return this.zoneMode ? 'target' : 'neutral';
  }

  #projection() {
    const r = this.region;
    if (r.continent === null) {
      return geoNaturalEarth1().fitExtent([[PAD, PAD], [VIEW_W - PAD, VIEW_H - PAD]], { type: 'Sphere' });
    }
    return geoAzimuthalEqualArea()
      .rotate([-r.center[0], -r.center[1]])
      .fitExtent([[PAD, PAD], [VIEW_W - PAD, VIEW_H - PAD]], bboxPoints(r.bbox));
  }

  #renderCountries(root, { countries }, layers) {
    const r = this.region;
    const projection = this.#projection();
    const path = geoPath(projection);
    const g = el('g');
    root.appendChild(g);
    if (r.continent === null) g.appendChild(el('path', { class: 'sphere', d: path({ type: 'Sphere' }) }));

    // Les mers se dessinent sous les terres : on ne peut cliquer que sur l'eau.
    if (layers.seas) this.#drawLayer(g, path, layers.seas, (f) => (this.targetIds.has(f.key) ? 'sea' : 'skip'));

    if (r.kind === 'admin1') {
      // Le monde en fond, les unités du pays par-dessus.
      this.#drawLayer(g, path, countries, () => 'context');
      this.#drawLayer(g, path, layers.admin1, (f) => (this.targetIds.has(f.key) ? 'target' : 'skip'));
    } else if (r.kind === 'history') {
      // Terres modernes en fond clair (les frontières historiques sont grossières et
      // laissent des trous sur les côtes), puis les autres États de l'époque, puis les cibles
      // par-dessus pour qu'aucun voisin ne les recouvre. Les zones sans nom sont ignorées.
      this.#drawLayer(g, path, countries, () => 'base');
      this.#drawLayer(g, path, layers.history, (f) => (f.key && !this.targetIds.has(f.key) ? 'context' : 'skip'));
      this.#drawLayer(g, path, layers.history, (f) => (this.targetIds.has(f.key) ? 'target' : 'skip'));
    } else {
      const inRegion = (f) => Boolean(f.key) && (!r.continent || COUNTRIES[f.key]?.c === r.continent);
      this.#drawLayer(g, path, countries, (f) => this.#tone(inRegion(f)));
    }

    if (layers.rivers) this.#drawRivers(g, path, layers.rivers);
    if (this.pointMode) this.#drawPoints(g, projection, this.targets);
  }

  #renderStates(root, { countries, states }, layers) {
    const isState = (f) => f.key in US_STATES;
    const tone = (f) => this.#tone(isState(f));
    // On écarte Alaska/Hawaï (encarts) et les territoires (Porto Rico, Guam…) qui casseraient le cadrage.
    const contiguous = states.filter((f) => isState(f) && !isInset(f.key));
    const alaska = states.find((f) => f.key === '02');
    const hawaii = states.find((f) => f.key === '15');
    // Voisins dessinés en fond pour situer le pays, comme sur Seterra.
    const neighbours = countries.filter((f) => f.key && (COUNTRIES[f.key]?.c === 'north-america' || f.key === '304'));

    const main = geoConicEqualArea().parallels([29.5, 45.5]).rotate([96, 0])
      // On laisse une bande en bas à gauche (Pacifique) pour les encarts.
      .fitExtent([[120, PAD], [VIEW_W - PAD, VIEW_H - 100]], { type: 'FeatureCollection', features: contiguous });
    const gMain = el('g');
    root.appendChild(gMain);
    const mainPath = geoPath(main);
    this.#drawLayer(gMain, mainPath, [...neighbours, ...contiguous], tone);
    if (layers.rivers) this.#drawRivers(gMain, mainPath, layers.rivers.filter((f) => !INSET_RIVERS['02'].has(f.key)));
    if (this.pointMode) this.#drawPoints(gMain, main, this.targets.filter((t) => !isInset(t.state)));

    this.#inset(root, alaska, [[PAD, VIEW_H - 230], [236, VIEW_H - PAD]], geoConicEqualArea().parallels([55, 65]).rotate([154, 0]), tone, layers);
    this.#inset(root, hawaii, [[248, VIEW_H - 130], [388, VIEW_H - PAD]], geoConicEqualArea().parallels([8, 18]).rotate([157, 0]), tone, layers);
  }

  #inset(root, feat, extent, projection, tone, layers) {
    const [[x0, y0], [x1, y1]] = extent;
    const inner = [[x0 + 10, y0 + 10], [x1 - 10, y1 - 10]];
    projection.fitExtent(inner, feat);
    // Tout ce qui déborde du cadre est coupé (un fleuve projeté hors encart, par exemple).
    const clipId = `inset-clip-${this.clipCount++}`;
    const clip = el('clipPath', { id: clipId });
    clip.appendChild(el('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 6 }));
    this.defs.appendChild(clip);
    const g = el('g', { class: 'inset', 'clip-path': `url(#${clipId})` });
    g.appendChild(el('rect', { class: 'inset-frame', x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 6 }));
    root.appendChild(g);
    const path = geoPath(projection);
    this.#drawLayer(g, path, [feat], tone);
    if (layers.rivers) this.#drawRivers(g, path, layers.rivers.filter((f) => INSET_RIVERS[feat.key].has(f.key)));
    if (this.pointMode) this.#drawPoints(g, projection, this.targets.filter((t) => t.state === feat.key));
  }

  // Dessine les formes puis, pour les cibles minuscules, un marqueur rond cliquable.
  // tone(f) : 'target' | 'neutral' | 'context' | 'base' (terre non attribuée) | 'sea' | 'skip'
  #drawLayer(g, path, features, tone) {
    const targets = [];
    for (const f of features) {
      const role = tone(f);
      if (role === 'skip') continue;
      const d = path(f);
      if (!d) continue;
      const clickable = role === 'target' || role === 'sea';
      const cls = role === 'sea' ? 'sea target' : `land ${role}`;
      const node = el('path', { d, class: cls, 'data-id': clickable ? f.key : null });
      g.appendChild(node);
      if (clickable) this.#register(f.key, node);
      if (role === 'target') targets.push(f);
    }
    const markers = el('g', { class: 'markers' });
    g.appendChild(markers);
    for (const f of targets) {
      // Surface plutôt que bbox : un archipel étalé (Kiribati, Fidji) reste minuscule à cliquer.
      if (path.area(f) >= MICRO_AREA) continue;
      // Centroïde sphérique puis projeté : un archipel à cheval sur l'antiméridien
      // aurait sinon un centroïde planaire au milieu de nulle part.
      const projected = path.projection()(geoCentroid(f));
      if (!projected || !Number.isFinite(projected[0])) continue;
      const [cx, cy] = projected;
      const m = el('circle', { class: 'micro target', cx, cy, r: MARKER_R, 'data-id': f.key });
      markers.appendChild(m);
      this.#register(f.key, m);
      this.markers.push({ node: m, area: path.area(f) });
    }
  }

  // Un fleuve = un groupe avec le tracé visible et une bande large invisible pour le clic.
  #drawRivers(g, path, rivers) {
    const layer = el('g', { class: 'rivers' });
    g.appendChild(layer);
    for (const f of rivers) {
      if (!this.targetIds.has(f.key)) continue;
      const d = path(f);
      if (!d) continue;
      const group = el('g', { class: 'river-group target', 'data-id': f.key });
      group.appendChild(el('path', { d, class: 'river' }));
      group.appendChild(el('path', { d, class: 'river-hit' }));
      layer.appendChild(group);
      this.#register(f.key, group);
    }
  }

  // Un point cliquable par ville. Triés du nord au sud pour que les points du
  // bas passent devant, comme des épingles plantées sur la carte.
  #drawPoints(g, projection, points) {
    const layer = el('g', { class: 'points' });
    g.appendChild(layer);
    const sorted = points.slice().sort((a, b) => b.lat - a.lat);
    for (const p of sorted) {
      const projected = projection([p.lon, p.lat]);
      if (!projected || !Number.isFinite(projected[0])) continue;
      const [cx, cy] = projected;
      const node = el('circle', { class: 'city target', cx, cy, r: POINT_R, 'data-id': p.id });
      layer.appendChild(node);
      this.#register(p.id, node);
      this.points.push(node);
    }
  }

  #register(id, node) {
    if (!this.nodes.has(id)) this.nodes.set(id, []);
    this.nodes.get(id).push(node);
  }

  #setupZoom() {
    const root = select(this.root);
    this.zoomBehavior = zoom()
      .scaleExtent([1, 10])
      .translateExtent([[0, 0], [VIEW_W, VIEW_H]])
      .on('zoom', (e) => {
        root.attr('transform', e.transform);
        this.#fitMarkers(e.transform.k);
      });
    select(this.svg).call(this.zoomBehavior).on('dblclick.zoom', null);
  }

  // Marqueurs et villes gardent leur taille à l'écran. Un marqueur de micro-État
  // s'efface dès que l'île qu'il signale est devenue assez grande pour être cliquée.
  #fitMarkers(k) {
    for (const { node, area } of this.markers) {
      node.setAttribute('r', MARKER_R / k);
      // Marge ×2 pour que l'île soit confortablement cliquable avant que le rond parte.
      node.style.display = area * k * k >= MICRO_AREA * 2 ? 'none' : '';
    }
    for (const node of this.points) node.setAttribute('r', POINT_R / k);
  }

  zoomBy(factor) {
    select(this.svg).transition().duration(200).call(this.zoomBehavior.scaleBy, factor);
  }

  resetZoom() {
    select(this.svg).transition().duration(250).call(this.zoomBehavior.transform, zoomIdentity);
  }

  // Nom lisible de ce qu'on a cliqué (pays, État, cible), pour l'infobulle d'erreur.
  labelOf(id) {
    return COUNTRIES[id]?.fr ?? US_STATES[id] ?? this.targets.find((t) => t.id === id)?.name ?? null;
  }

  // state : 'correct-1' | 'correct-2' | 'correct-3' | 'reveal' | 'failed' | null
  setState(id, state) {
    for (const n of this.nodes.get(id) ?? []) {
      if (state) n.dataset.state = state;
      else delete n.dataset.state;
    }
  }

  // Clignotement rouge sur un mauvais clic, sans écraser un état déjà acquis.
  flash(id) {
    for (const n of this.nodes.get(id) ?? []) {
      if (n.dataset.state) continue;
      n.classList.add('flash');
      setTimeout(() => n.classList.remove('flash'), 450);
    }
  }
}
