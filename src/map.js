// Rendu SVG d'une carte muette et gestion des clics / du zoom.
// Familles de cibles : zones (pays, États, mers), tracés (fleuves) et points (capitales, villes).
import { geoPath, geoAzimuthalEqualArea, geoNaturalEarth1, geoConicEqualArea, geoCentroid } from 'd3-geo';
import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import { feature } from 'topojson-client';
import { Delaunay } from 'd3-delaunay';
import { COUNTRIES, NAME_TO_ID, IGNORED_NAMES, US_STATES } from './data/countries.js';

export const VIEW_W = 1000;
export const VIEW_H = 620;
const PAD = 16;
const MICRO_AREA = 60; // surface projetée (px²) en dessous de laquelle on ajoute un marqueur cliquable
// Sur écran tactile, les ronds sont plus gros : on vise au doigt, pas au curseur.
const TOUCH = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const MARKER_R = TOUCH ? 10 : 8; // rayon du repère déporté à l'écran, constant quel que soit le zoom
const MARKER_HIDE_PX = 28; // dès que l'île fait cette taille à l'écran, on clique l'île elle-même
// Dézoomé, un simple point sur l'île (les traits de 100 repères feraient un fouillis) ;
// à partir de ce zoom, le repère déporté avec son trait, qui a alors la place de se ranger.
const CALLOUT_ZOOM = 2.5;
// Zone cliquable autour d'une petite île : la portion d'océan la plus proche d'elle,
// bornée à un carré (demi-côté en unités de la carte, 1000 de large). Plus petite sur la
// carte du Monde, où tout est déjà serré.
const ZONE = { continent: { half: 70, area: 500 }, world: { half: 26, area: 60 } };
const DOT_R = TOUCH ? 5 : 3.5;
// Emplacements candidats du cercle autour de l'île (distance et angle, en pixels écran).
const CALLOUT_SLOTS = [22, 40, 60].flatMap((d) => [-60, -120, 0, 180, -30, -150, 60, 120, 90, -90].map((a) => [d * Math.cos((a * Math.PI) / 180), d * Math.sin((a * Math.PI) / 180)]));
const POINT_R = TOUCH ? 7.5 : 5.5; // rayon d'une ville à l'écran, constant quel que soit le zoom
const MAX_ZOOM = 80; // assez pour séparer des ronds superposés (Antilles, micro-États d'Europe)

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

// Découpe un polygone par un rectangle (Sutherland–Hodgman).
function clipRect(polygon, x0, y0, x1, y1) {
  const edges = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ];
  let output = polygon;
  for (const [inside, intersect] of edges) {
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) output.push(intersect(prev, cur));
        output.push(cur);
      } else if (inside(prev)) {
        output.push(intersect(prev, cur));
      }
    }
    if (!output.length) break;
  }
  return output;
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
    this.markers = []; // repères déportés des micro-États : { group, leader, circle, cx, cy, size }
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
      // Seuls les pays jouables (dans countries.js) sont des cibles : Groenland, Malouines
    // ou Porto Rico restent du décor, même sur la carte du Monde.
    const inRegion = (f) => Boolean(f.key) && Boolean(COUNTRIES[f.key]) && (!r.continent || COUNTRIES[f.key].c === r.continent);
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
    // Grandes zones d'abord, petites par-dessus : une enclave (Bruxelles dans le Brabant
    // flamand, le Lesotho, Berlin…) reste visible et cliquable même si son voisin n'a pas de trou.
    const ordered = features.map((f) => ({ f, role: tone(f), area: 0 })).filter((x) => x.role !== 'skip');
    for (const x of ordered) x.area = path.area(x.f);
    ordered.sort((a, b) => b.area - a.area);
    for (const { f, role } of ordered) {
      const d = path(f);
      if (!d) continue;
      const clickable = role === 'target' || role === 'sea';
      const cls = role === 'sea' ? 'sea target' : `land ${role}`;
      const node = el('path', { d, class: cls, 'data-id': clickable ? f.key : null });
      g.appendChild(node);
      if (clickable) this.#register(f.key, node);
      if (role === 'target') targets.push(f);
    }
    this.#drawZones(g, path, targets);
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
      // Repère déporté : un trait part de l'île vers un cercle posé à côté, c'est lui qu'on clique.
      const group = el('g', { class: 'micro target', 'data-id': f.key });
      const leader = el('line', { class: 'leader', x1: cx, y1: cy, x2: cx, y2: cy });
      const circle = el('circle', { cx, cy, r: MARKER_R });
      group.appendChild(leader);
      group.appendChild(circle);
      markers.appendChild(group);
      this.#register(f.key, group);
      // Taille « utile » = côté du carré de même surface : un archipel étalé mais minuscule
      // (Kiribati) garde son repère, alors que sa boîte englobante est énorme.
      this.markers.push({ group, leader, circle, cx, cy, size: Math.sqrt(path.area(f)) });
    }
    this.#placeMarkers(1);
  }

  // Zones autour des petites îles, comme sur une carte d'atlas : l'océan est partagé entre
  // les cibles (chaque point revient à la plus proche), et seules les petites îles reçoivent
  // leur cellule, découpée dans un carré. Dessinées sous les terres : un continent reste prioritaire.
  #drawZones(g, path, targets) {
    const { half, area } = this.region.continent === null ? ZONE.world : ZONE.continent;
    const sites = [];
    for (const f of targets) {
      const c = path.projection()(geoCentroid(f));
      if (c && Number.isFinite(c[0])) sites.push({ f, c, micro: path.area(f) < area });
    }
    if (!sites.some((s) => s.micro)) return;
    // Seules les îles reçoivent une zone : autour d'un micro-État enclavé (Vatican, Andorre)
    // il y a de la terre, pas de la mer. On sonde 8 points autour du centre.
    const lands = [...g.querySelectorAll('path.land')];
    const point = this.svg.createSVGPoint();
    const isWater = (x, y, own) => {
      point.x = x;
      point.y = y;
      return !lands.some((land) => land !== own && land.isPointInFill(point));
    };
    for (const site of sites) {
      if (!site.micro) continue;
      const own = g.querySelector(`path.land[data-id="${site.f.key}"]`);
      let water = 0;
      for (let a = 0; a < 8; a++) {
        const angle = (a * Math.PI) / 4;
        if (isWater(site.c[0] + Math.cos(angle) * half * 0.5, site.c[1] + Math.sin(angle) * half * 0.5, own)) water++;
      }
      site.island = water >= 7;
    }
    const delaunay = Delaunay.from(sites.map((s) => s.c));
    const voronoi = delaunay.voronoi([-VIEW_W, -VIEW_H, VIEW_W * 2, VIEW_H * 2]);
    const layer = el('g', { class: 'zones' });
    const firstLand = g.querySelector('.land');
    g.insertBefore(layer, firstLand);
    sites.forEach((site, i) => {
      if (!site.micro || !site.island) return;
      const cell = voronoi.cellPolygon(i);
      if (!cell) return;
      const [cx, cy] = site.c;
      const clipped = clipRect(cell, cx - half, cy - half, cx + half, cy + half);
      if (clipped.length < 3) return;
      const d = `M${clipped.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`;
      const node = el('path', { d, class: 'zone target', 'data-id': site.f.key });
      layer.appendChild(node);
      this.#register(site.f.key, node);
    });
  }

  // Place les cercles des repères pour un niveau de zoom donné : chacun prend le premier
  // emplacement libre autour de son île (pas sur un autre cercle, pas sur une autre île).
  #placeMarkers(k) {
    const r = MARKER_R / k;
    const placed = [];
    const islands = this.markers.map((m) => [m.cx, m.cy]);
    const clash = (x, y, ownIndex) =>
      placed.some((p) => Math.hypot(p[0] - x, p[1] - y) < 2 * r + 3 / k) ||
      islands.some(([ix, iy], i) => i !== ownIndex && Math.hypot(ix - x, iy - y) < r + 4 / k);
    // Les repères sont posés de haut en bas pour un rendu stable d'un zoom à l'autre.
    const order = this.markers.map((m, i) => i).sort((a, b) => this.markers[a].cy - this.markers[b].cy || this.markers[a].cx - this.markers[b].cx);
    const dots = k < CALLOUT_ZOOM;
    for (const i of order) {
      const m = this.markers[i];
      const hidden = m.size * k >= MARKER_HIDE_PX;
      m.group.style.display = hidden ? 'none' : '';
      m.group.classList.toggle('is-dot', dots);
      if (hidden) continue;
      if (dots) {
        m.circle.setAttribute('cx', m.cx);
        m.circle.setAttribute('cy', m.cy);
        m.circle.setAttribute('r', DOT_R / k);
        m.leader.setAttribute('x2', m.cx);
        m.leader.setAttribute('y2', m.cy);
        continue;
      }
      let best = null;
      for (const [dx, dy] of CALLOUT_SLOTS) {
        const x = m.cx + dx / k;
        const y = m.cy + dy / k;
        if (!clash(x, y, i)) {
          best = [x, y];
          break;
        }
      }
      if (!best) best = [m.cx + CALLOUT_SLOTS[0][0] / k, m.cy + CALLOUT_SLOTS[0][1] / k];
      placed.push(best);
      m.circle.setAttribute('cx', best[0]);
      m.circle.setAttribute('cy', best[1]);
      m.circle.setAttribute('r', r);
      m.leader.setAttribute('x2', best[0]);
      m.leader.setAttribute('y2', best[1]);
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
      .scaleExtent([1, MAX_ZOOM])
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
    if (this.markers.length) {
      // Au plus un calcul par image, le zoom envoie des dizaines d'événements par seconde.
      this.pendingK = k;
      if (!this.placing) {
        this.placing = true;
        requestAnimationFrame(() => {
          this.placing = false;
          this.#placeMarkers(this.pendingK);
        });
      }
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

  // Surligne une zone en attente de confirmation (null pour tout désélectionner).
  setSelected(id) {
    for (const n of this.svg.querySelectorAll('.is-selected')) n.classList.remove('is-selected');
    for (const n of this.nodes.get(id) ?? []) n.classList.add('is-selected');
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
