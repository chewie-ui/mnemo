// Point d'entrée : routeur (hash) et démarrage.
import { MODES, regionById } from './data/regions.js';
import { loadUser, onAuthChange, currentUser } from './auth.js';
import { refreshServerBests } from './scores.js';
import { initAccount } from './account.js';
import { renderHome } from './home.js';
import { startGame, stopSession } from './play.js';
import { renderStats } from './stats.js';
import { renderMemosList, renderDeckEditor, renderStudy } from './memos-ui.js';
import { renderFriends, initFriends, loadDuel } from './friends.js';
import { showScreen, refreshIcons, toast } from './ui.js';

function route() {
  const hash = location.hash || '#/';
  let m;

  if ((m = hash.match(/^#\/play\/([\w-]+)(?:\/(\w+))?$/))) {
    const region = regionById(m[1]);
    const mode = m[2] ?? 'countries';
    if (region && MODES.includes(mode)) {
      showScreen('game');
      startGame(region, mode);
      return;
    }
  }
  if ((m = hash.match(/^#\/duel\/(\d+)$/))) {
    showScreen('game');
    startDuel(Number(m[1]));
    return;
  }
  stopSession();

  if (hash === '#/amis') {
    showScreen('friends');
    renderFriends();
  } else if (hash === '#/stats') {
    showScreen('stats');
    renderStats();
  } else if (hash === '#/memos') {
    showScreen('memos');
    renderMemosList();
  } else if ((m = hash.match(/^#\/memos\/([\w-]+)$/))) {
    showScreen('deck');
    renderDeckEditor(m[1]);
  } else if ((m = hash.match(/^#\/(study|quiz)\/([\w-]+)$/))) {
    showScreen('study');
    renderStudy(m[2], m[1]);
  } else {
    showScreen('home');
    renderHome();
    // "#/#geo" : on descend jusqu'à la section demandée.
    const anchor = hash.match(/^#\/#([\w-]+)$/)?.[1];
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' });
  }
}

// Un défi : on attend de connaître l'utilisateur, puis on lance la même partie que l'adversaire.
async function startDuel(id) {
  await loadUser();
  if (!currentUser()) {
    location.hash = '#/amis';
    return;
  }
  const duel = await loadDuel(id);
  if (!duel) {
    location.hash = '#/amis';
    return;
  }
  const region = regionById(duel.region);
  const playable = duel.status !== 'declined' && duel.status !== 'finished' && !duel.me.finished && (duel.isChallenger || duel.status === 'accepted');
  if (!region || !playable) {
    toast(duel.me.finished ? 'Tu as déjà joué ce défi.' : 'Ce défi n’est pas jouable.');
    location.hash = '#/amis';
    return;
  }
  startGame(region, duel.mode, duel);
}

async function boot() {
  refreshIcons();
  initAccount();
  initFriends();
  window.addEventListener('hashchange', route);
  route();
  // Le compte se charge en arrière-plan ; l'accueil se rafraîchit quand on sait qui joue.
  await loadUser();
  await refreshServerBests();
  onAuthChange(async () => {
    await refreshServerBests();
    route();
  });
  if (!location.hash.startsWith('#/play/') && !location.hash.startsWith('#/duel/')) route();
}

boot();
