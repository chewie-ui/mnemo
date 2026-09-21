// Point d'entrée : routeur (hash) et démarrage.
import { initSettings, renderSettings } from './settings.js';
import { MODES, regionById } from './data/regions.js';
import { loadUser, onAuthChange, currentUser } from './auth.js';
import { refreshServerBests } from './scores.js';
import { initAccount, initReset, renderReset, renderConfirmEmail } from './account.js';
import { renderHome } from './home.js';
import { startGame, stopSession } from './play.js';
import { renderStats } from './stats.js';
import { renderDeckEditor, renderStudy } from './memos-ui.js';
import { renderLibrary, renderNote, renderNoteEditor, initLibrary } from './library-ui.js';
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
  } else if ((m = hash.match(/^#\/reset\/([a-f0-9]{64})$/))) {
    showScreen('reset');
    renderReset(m[1]);
  } else if ((m = hash.match(/^#\/confirm-email\/([a-f0-9]{64})$/))) {
    showScreen('confirm');
    renderConfirmEmail(m[1]);
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
    renderLibrary(null);
  } else if ((m = hash.match(/^#\/memos\/f\/([\w-]+)$/))) {
    showScreen('memos');
    renderLibrary(m[1]);
  } else if ((m = hash.match(/^#\/memos\/new(?:\/([\w-]+))?$/))) {
    showScreen('deck');
    renderDeckEditor('new', m[1] ?? null);
  } else if ((m = hash.match(/^#\/memos\/([\w-]+)$/))) {
    showScreen('deck');
    renderDeckEditor(m[1]);
  } else if ((m = hash.match(/^#\/notes\/new(?:\/([\w-]+))?$/))) {
    showScreen('note-edit');
    renderNoteEditor('new', m[1] ?? null);
  } else if ((m = hash.match(/^#\/notes\/([\w-]+)\/edit$/))) {
    showScreen('note-edit');
    renderNoteEditor(m[1]);
  } else if ((m = hash.match(/^#\/notes\/([\w-]+)$/))) {
    showScreen('note');
    renderNote(m[1]);
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
  initReset();
  initSettings();
  initFriends();
  initLibrary();
  window.addEventListener('hashchange', route);
  // Les pages qui lisent une leçon attendent de savoir qui est connecté (stockage local ou serveur).
  if (!/^#\/(memos|notes|study|quiz|confirm-email)(\/|$)/.test(location.hash)) route();
  // Le compte se charge en arrière-plan ; l'accueil se rafraîchit quand on sait qui joue.
  await loadUser();
  await refreshServerBests();
  if (currentUser()) startInboxWatch();
  // Connexion ou déconnexion : on recharge la page courante. Une simple mise à jour du
  // profil (pseudo, avatar, adresse) ne fait pas repartir le routeur.
  let lastUserId = currentUser()?.id ?? null;
  onAuthChange(async (user) => {
    const id = user?.id ?? null;
    if (id === lastUserId) return;
    lastUserId = id;
    await refreshServerBests();
    if (user) startInboxWatch();
    else stopInboxWatch();
    route();
  });
  if (!location.hash.startsWith('#/play/') && !location.hash.startsWith('#/duel/') && !location.hash.startsWith('#/campagne/')) route();
}

// Comportement « application » : pas de zoom de page par pincement (Safari iOS ignore user-scalable=no ;
// le double tap est déjà neutralisé par touch-action: manipulation). Le zoom de la carte, lui, reste libre.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => {
    if (!e.target.closest?.('#map')) e.preventDefault();
  }, { passive: false });
}

boot();
