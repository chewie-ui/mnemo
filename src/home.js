// Accueil : cartes de géographie, d'histoire, pays en détail, aperçu des mémos.
import { REGIONS, HISTORY_REGIONS, SUBDIVISION_REGIONS, MODES, targetsFor, modeLabel, unitLabel } from './data/regions.js';
import { getBest } from './scores.js';
import { store } from './memos.js';
import { $, refreshIcons, flagUrl, escapeHtml } from './ui.js';

const MODE_ICON = { countries: 'map', flags: 'flag', flagpick: 'layout-grid', capitals: 'map-pin', cities: 'building-2', languages: 'languages', currencies: 'coins', monuments: 'castle', rivers: 'waves', seas: 'sailboat' };

// Modes toujours visibles ; les autres se replient derrière un bouton « Plus ».
const PRIMARY_MODES = new Set(['countries', 'flags', 'flagpick', 'capitals']);
const expanded = new Set(); // cartes dépliées, conservées d'un rendu à l'autre

// « Pays en détail » : 179 pays, affichés par pages pour que la liste reste courte.
const PER_PAGE = 24;
let countryPage = 1;

const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function renderHome() {
  renderCards($('region-grid'), REGIONS);
  renderCards($('history-grid'), HISTORY_REGIONS);
  renderSubdivisions($('country-search').value);
  renderMemosPreview();
  refreshIcons();
}

// Une carte par pays, avec un bouton par découpage (départements, régions…), page par page.
export function renderSubdivisions(query, page = countryPage) {
  const q = fold(query.trim());
  const byCountry = new globalThis.Map();
  for (const region of SUBDIVISION_REGIONS) {
    if (q && !fold(region.country).includes(q)) continue;
    if (!byCountry.has(region.country)) byCountry.set(region.country, []);
    byCountry.get(region.country).push(region);
  }
  const groups = [...byCountry.entries()].map(([country, maps]) => ({ name: country, flag: maps[0].file.slice(0, 2), maps }));
  const pages = Math.max(1, Math.ceil(groups.length / PER_PAGE));
  countryPage = Math.min(Math.max(1, page), pages);
  const start = (countryPage - 1) * PER_PAGE;
  renderCards($('subdivision-grid'), groups.slice(start, start + PER_PAGE), { compact: true });
  renderPager($('subdivision-pager'), countryPage, pages, groups.length, 'pays', (p) => {
    renderSubdivisions($('country-search').value, p);
    refreshIcons();
    // On remonte à la liste, pas en haut de page : on reste dans la section.
    document.getElementById('pays')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('subdivision-empty').hidden = groups.length > 0;
}

// Numéros de pages : 1 … 4 5 [6] 7 8 … 12, avec Précédent / Suivant.
function renderPager(nav, page, pages, total, unit, onGo) {
  nav.hidden = pages <= 1;
  if (pages <= 1) {
    nav.innerHTML = '';
    return;
  }
  const numbers = [];
  const push = (n) => {
    if (n >= 1 && n <= pages && !numbers.includes(n)) numbers.push(n);
  };
  push(1);
  for (let n = page - 1; n <= page + 1; n++) push(n);
  push(pages);
  numbers.sort((a, b) => a - b);

  nav.innerHTML = '';
  const add = (label, { go, icon, current = false, disabled = false, aria } = {}) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `pager-btn${current ? ' is-current' : ''}`;
    btn.disabled = disabled;
    if (current) btn.setAttribute('aria-current', 'page');
    if (aria) btn.setAttribute('aria-label', aria);
    btn.innerHTML = icon ? `<i data-lucide="${icon}" aria-hidden="true"></i>` : label;
    if (go) btn.addEventListener('click', () => onGo(go));
    nav.appendChild(btn);
  };

  add('', { icon: 'chevron-left', go: page - 1, disabled: page === 1, aria: 'Page précédente' });
  let last = 0;
  for (const n of numbers) {
    if (n - last > 1) {
      const gap = document.createElement('span');
      gap.className = 'pager-gap';
      gap.textContent = '…';
      nav.appendChild(gap);
    }
    add(String(n), { go: n, current: n === page, aria: `Page ${n}` });
    last = n;
  }
  add('', { icon: 'chevron-right', go: page + 1, disabled: page === pages, aria: 'Page suivante' });

  const count = document.createElement('span');
  count.className = 'pager-count muted small';
  // « 179 pays », « 11 cartes » : le pluriel de « pays » est invariable.
  count.textContent = `${total} ${unit === 'pays' ? 'pays' : total > 1 ? `${unit}s` : unit}`;
  nav.appendChild(count);
}

function renderCards(grid, items, { compact = false } = {}) {
  grid.innerHTML = '';
  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'region-card';
    card.setAttribute('role', 'listitem');
    const title = document.createElement('h3');
    title.className = 'name';
    if (item.flag) {
      const img = document.createElement('img');
      img.className = 'flag';
      img.src = flagUrl(item.flag);
      img.alt = '';
      img.loading = 'lazy';
      title.appendChild(img);
    }
    title.appendChild(document.createTextNode(item.name));
    card.appendChild(title);
    // Toujours présent (vide si la carte n'a pas de sous-titre) : les trois rangées d'une carte
    // s'alignent ainsi sur celles des cartes voisines (voir .region-card en CSS).
    const sub = document.createElement('p');
    sub.className = 'subtitle';
    sub.textContent = item.subtitle ?? '';
    card.appendChild(sub);
    const list = document.createElement('div');
    list.className = 'mode-list';
    if (compact) {
      // Groupe de cartes d'un même pays : un bouton par découpage, mode unique.
      for (const region of item.maps) list.appendChild(modeButton(region, 'countries', 'map'));
    } else {
      const modes = MODES.filter((mode) => targetsFor(item, mode).length > 0);
      const secondary = modes.filter((mode) => !PRIMARY_MODES.has(mode));
      for (const mode of modes) {
        const btn = modeButton(item, mode, MODE_ICON[mode]);
        if (!PRIMARY_MODES.has(mode)) {
          btn.classList.add('mode-secondary');
          btn.hidden = !expanded.has(item.id);
        }
        list.appendChild(btn);
      }
      if (secondary.length) list.appendChild(moreButton(item, secondary.length));
    }
    card.appendChild(list);
    grid.appendChild(card);
  }
}

function modeButton(region, mode, icon) {
  const count = targetsFor(region, mode).length;
  const best = getBest(region.id, mode);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mode-btn';
  btn.setAttribute('aria-label', `${region.name} — ${modeLabel(region, mode)}, ${count} ${unitLabel(region, mode, count)}`);
  btn.innerHTML = `
    <i data-lucide="${icon}" aria-hidden="true"></i>
    <span class="mode-name">${escapeHtml(modeLabel(region, mode))}</span>
    <span class="mode-count">${count}</span>
    <span class="mode-best ${best ? 'has-score' : ''}">${best ? `${best.score} %` : '—'}</span>`;
  btn.addEventListener('click', () => {
    location.hash = `#/play/${region.id}/${mode}`;
  });
  return btn;
}

// Bouton « Plus » / « Moins » qui déplie les modes secondaires d'une carte.
function moreButton(region, count) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mode-more';
  const render = () => {
    const open = expanded.has(region.id);
    btn.setAttribute('aria-expanded', String(open));
    btn.innerHTML = `<i data-lucide="${open ? 'chevron-up' : 'chevron-down'}" aria-hidden="true"></i><span>${open ? 'Moins' : `Plus (${count})`}</span>`;
  };
  btn.addEventListener('click', () => {
    if (expanded.has(region.id)) expanded.delete(region.id);
    else expanded.add(region.id);
    for (const el of btn.parentElement.querySelectorAll('.mode-secondary')) el.hidden = !expanded.has(region.id);
    render();
    refreshIcons();
  });
  render();
  return btn;
}

// Aperçu des leçons sur l'accueil : les plus récentes, puis un bouton pour en créer.
async function renderMemosPreview() {
  const grid = $('home-memos');
  let decks = [];
  try {
    decks = await store().list();
  } catch {
    decks = [];
  }
  grid.innerHTML = '';
  for (const deck of decks.slice(0, 3)) {
    const card = document.createElement('article');
    card.className = 'region-card deck-card';
    card.setAttribute('role', 'listitem');
    card.innerHTML = `
      <h3 class="name">${escapeHtml(deck.title)}</h3>
      <p class="deck-meta"><span>${deck.cards} carte${deck.cards > 1 ? 's' : ''}</span>${deck.due ? `<span class="due">${deck.due} à réviser</span>` : ''}</p>
      <div class="actions">
        <a class="btn btn-primary" href="#/study/${deck.id}"><i data-lucide="book-open" aria-hidden="true"></i><span>Réviser</span></a>
        <a class="btn btn-ghost" href="#/memos/${deck.id}"><i data-lucide="pencil" aria-hidden="true"></i><span>Modifier</span></a>
      </div>`;
    grid.appendChild(card);
  }
  const more = document.createElement('article');
  more.className = 'region-card deck-card';
  more.setAttribute('role', 'listitem');
  more.innerHTML = `
    <h3 class="name">${decks.length ? 'Toutes mes leçons' : 'Crée ta première leçon'}</h3>
    <p class="desc">${decks.length ? `${decks.length} leçon${decks.length > 1 ? 's' : ''} au total.` : 'Définitions, dates, articles de loi, vocabulaire : tout ce que tu dois retenir.'}</p>
    <div class="actions">
      <a class="btn btn-primary" href="#/memos/new"><i data-lucide="plus" aria-hidden="true"></i><span>Nouvelle leçon</span></a>
      ${decks.length ? '<a class="btn btn-ghost" href="#/memos"><span>Voir tout</span></a>' : ''}
    </div>`;
  grid.appendChild(more);
  refreshIcons();
}

$('country-search').addEventListener('input', (e) => {
  // Nouvelle recherche : on repart de la première page.
  renderSubdivisions(e.target.value, 1);
  refreshIcons();
});
