// Plateau « Trouve le drapeau » : tous les drapeaux de la carte en grille, on clique le bon.
// Même interface que GameMap (render, onSelect, setState, flash, labelOf, setSelected, nodes)
// pour que play.js n'ait pas à savoir s'il parle à une carte ou à une grille.
import { shuffle } from './game.js';
import { flagUrl, refreshIcons } from './ui.js';

export class FlagGrid {
  /**
   * @param {HTMLElement} root   conteneur de la grille
   * @param {Array} targets      { id, name, tile } — tile = code ISO2 du drapeau
   * @param {number|null} seed   même graine que la partie : même ordre chez les deux joueurs d'un défi
   */
  constructor(root, targets, seed = null) {
    this.root = root;
    this.targets = targets;
    this.seed = seed;
    this.nodes = new Map();
    this.onSelect = null;
    this.root.onclick = (e) => {
      const tile = e.target.closest('.flag-tile');
      if (!tile || !this.root.contains(tile)) return;
      this.onSelect?.(tile.dataset.id, { x: e.clientX, y: e.clientY });
    };
  }

  async render() {
    this.root.innerHTML = '';
    this.nodes.clear();
    // Ordre mélangé (sinon l'alphabet donnerait la réponse), différent de l'ordre des questions.
    const order = shuffle(this.targets, this.seed ? (this.seed ^ 0x5bd1e995) >>> 0 : null);
    order.forEach((t, i) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'flag-tile';
      tile.dataset.id = t.id;
      tile.setAttribute('aria-label', `Drapeau ${i + 1}`);
      const img = document.createElement('img');
      img.src = flagUrl(t.tile);
      img.alt = '';
      img.draggable = false;
      // Coche (ou croix) qui apparait une fois la tuile jouee : le drapeau, lui, s'estompe.
      const mark = document.createElement('span');
      mark.className = 'tile-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.innerHTML = '<i data-lucide="check" class="mark-ok"></i><i data-lucide="x" class="mark-ko"></i>';
      tile.append(img, mark);
      this.nodes.set(t.id, [tile]);
      this.root.append(tile);
    });
    refreshIcons();
    this.root.scrollTop = 0;
  }

  labelOf(id) {
    return this.targets.find((t) => t.id === id)?.name ?? null;
  }

  setSelected(id) {
    for (const n of this.root.querySelectorAll('.is-selected')) n.classList.remove('is-selected');
    for (const n of this.nodes.get(id) ?? []) n.classList.add('is-selected');
  }

  // state : 'correct-1' | 'correct-2' | 'correct-3' | 'reveal' | 'failed' | null
  setState(id, state) {
    for (const n of this.nodes.get(id) ?? []) {
      if (state) n.dataset.state = state;
      else delete n.dataset.state;
      n.classList.remove('flash');
      // La bonne réponse qui clignote est amenée à l'écran : la grille peut défiler.
      if (state === 'reveal') n.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  flash(id) {
    for (const n of this.nodes.get(id) ?? []) {
      if (n.dataset.state) continue;
      n.classList.add('flash');
      setTimeout(() => n.classList.remove('flash'), 450);
    }
  }

  // Pas de zoom sur une grille : les boutons sont cachés, mais play.js peut appeler ces méthodes.
  zoomBy() {}
  resetZoom() {}
}
