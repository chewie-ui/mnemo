// Point d'entrée : routeur (hash) et démarrage.
import { MODES, regionById } from './data/regions.js';
import { loadUser, onAuthChange, currentUser } from './auth.js';
import { refreshServerBests } from './scores.js';
import { initAccount } from './account.js';
import { renderHome } from './home.js';
import { startGame, stopSession } from './play.js';
import { renderStats } from './stats.js';
import { renderMemosList, renderDeckEditor, renderStudy } from './memos-ui.js';
import { renderFriends, initFriends } from './friends.js';
import { openDuel, stopDuelWatch, startInboxWatch, stopInboxWatch } from './duel-ui.js';
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
  stopDuelWatch();
  if ((m = hash.match(/^#\/duel\/(\d+)$/))) {
    stopSession();
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

// Un défi : on attend de connaître l'utilisateur, puis l'écran qui correspond à son état.
async function startDuel(id) {
  await loadUser();
  if (!currentUser()) {
    toast('Connecte-toi pour jouer ce défi.');
    location.hash = '#/amis';
    return;
  }
  openDuel(id);
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
  if (currentUser()) startInboxWatch();
  onAuthChange(async (user) => {
    await refreshServerBests();
    if (user) startInboxWatch();
    else stopInboxWatch();
    route();
  });
  if (!location.hash.startsWith('#/play/') && !location.hash.startsWith('#/duel/')) route();
}

boot();
