// Point d'entrée : routeur (hash) et démarrage.
import { initSettings, renderSettings } from './settings.js';
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
import { renderCampaign, levelById, isUnlocked, loadProgress } from './campaign.js';
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
  if ((m = hash.match(/^#\/campagne\/([\w-]+)$/))) {
    stopSession();
    startLevel(m[1]);
    return;
  }
  if ((m = hash.match(/^#\/duel\/(\d+)$/))) {
    stopSession();
    startDuel(Number(m[1]));
    return;
  }
  stopSession();

  if (hash === '#/campagne') {
    renderCampaign();
  } else if (hash === '#/reglages') {
    showScreen('settings');
    renderSettings();
  } else if (hash === '#/amis') {
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

// Un niveau de campagne : verrouillé tant que le précédent n'est pas réussi.
async function startLevel(id) {
  const level = levelById(id);
  if (!level) {
    location.hash = '#/campagne';
    return;
  }
  await loadUser();
  await loadProgress();
  if (!isUnlocked(level)) {
    toast('Termine d’abord le niveau précédent.');
    location.hash = '#/campagne';
    return;
  }
  showScreen('game');
  startGame(regionById(level.region), level.mode, null, level);
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
  initSettings();
  initFriends();
  window.addEventListener('hashchange', route);
  // Les pages qui lisent une leçon attendent de savoir qui est connecté (stockage local ou serveur).
  if (!/^#\/(memos|study|quiz)\//.test(location.hash)) route();
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
  if (!location.hash.startsWith('#/play/') && !location.hash.startsWith('#/duel/') && !location.hash.startsWith('#/campagne/')) route();
}

boot();
