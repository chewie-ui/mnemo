// Déroulé d'un défi : invitation reçue, attente de l'adversaire, écran VS avec compte à rebours,
// puis la carte. Et la notification quand un ami nous défie.
import { get, post, ApiError } from './api.js';
import { currentUser } from './auth.js';
import { regionById, modeLabel } from './data/regions.js';
import { startGame } from './play.js';
import { $, escapeHtml, refreshIcons, toast, setLoading, showScreen } from './ui.js';

const errorText = (err, fallback) => (err instanceof ApiError ? err.message : fallback);

function mapName(duel) {
  const region = regionById(duel.region);
  return region ? `${region.name} · ${modeLabel(region, duel.mode)}` : `${duel.region} · ${duel.mode}`;
}

let watching = null; // { id, timer } : défi dont on surveille l'état (attente du lanceur)

export function stopDuelWatch() {
  if (watching?.timer) clearInterval(watching.timer);
  watching = null;
}

const playerCard = (p, side) => `
  <div class="vs-player vs-${side}">
    <span class="vs-avatar" aria-hidden="true"><i data-lucide="circle-user-round"></i></span>
    <strong class="vs-name">${escapeHtml(p.name)}</strong>
    <span class="trophy"><i data-lucide="trophy" aria-hidden="true"></i>${p.trophies}</span>
  </div>`;

// Point d'entrée #/duel/<id> : on affiche l'écran qui correspond à l'état du défi.
export async function openDuel(id) {
  stopDuelWatch();
  let duel;
  try {
    ({ duel } = await get('duels', 'get', { id }));
  } catch (err) {
    toast(errorText(err, 'Défi introuvable.'));
    location.hash = '#/amis';
    return;
  }
  if (duel.status === 'accepted' && !duel.me.finished) return launch(duel);
  if (duel.status === 'pending' && duel.isChallenger) return renderWaiting(duel);
  if (duel.status === 'pending' && !duel.isChallenger) return renderInvite(duel);
  toast(duel.me.finished ? 'Tu as déjà joué ce défi.' : duel.status === 'declined' ? 'Ce défi a été refusé.' : 'Ce défi est terminé.');
  location.hash = '#/amis';
}

// ─── Côté lanceur : en attente de la réponse ───
function renderWaiting(duel) {
  showScreen('duel');
  const body = $('duel-body');
  body.innerHTML = `
    <div class="vs-screen">
      <p class="vs-map">${escapeHtml(mapName(duel))}</p>
      <div class="vs-row">
        ${playerCard(duel.self, 'me')}
        <span class="vs-badge">VS</span>
        ${playerCard(duel.opponent, 'them')}
      </div>
      <p class="vs-status"><span class="spinner spinner-dark" aria-hidden="true"></span> En attente de ${escapeHtml(duel.opponent.name)}…</p>
      <p class="note">Ton ami reçoit l'invitation dès qu'il ouvre Mnemo. Dès qu'il accepte, la partie démarre ici. Tu peux aussi partir : le défi restera dans « À jouer ».</p>
      <div class="hero-actions" style="justify-content:center">
        <button id="duel-cancel" class="btn btn-ghost" type="button"><i data-lucide="x" aria-hidden="true"></i><span>Annuler le défi</span></button>
        <a class="btn btn-ghost" href="#/amis">Revenir aux amis</a>
      </div>
    </div>`;
  refreshIcons();
  $('duel-cancel').addEventListener('click', async (e) => {
    setLoading(e.currentTarget, true);
    try {
      await post('duels', 'cancel', { id: duel.id });
      stopDuelWatch();
      toast('Défi annulé.');
      location.hash = '#/amis';
    } catch (err) {
      toast(errorText(err, 'Impossible d’annuler.'));
      setLoading(e.currentTarget, false);
    }
  });
  // On relit l'état toutes les 2 s jusqu'à la réponse de l'ami.
  watching = { id: duel.id, timer: null };
  watching.timer = setInterval(async () => {
    if (!watching || watching.id !== duel.id) return;
    try {
      const { duel: fresh } = await get('duels', 'get', { id: duel.id });
      if (fresh.status === 'accepted') {
        stopDuelWatch();
        launch(fresh);
      } else if (fresh.status === 'declined') {
        stopDuelWatch();
        toast(`${fresh.opponent.name} a refusé le défi.`);
        location.hash = '#/amis';
      }
    } catch {
      /* on réessaie au tour suivant */
    }
  }, 2000);
}

// ─── Côté invité : accepter ou refuser ───
function renderInvite(duel) {
  showScreen('duel');
  const body = $('duel-body');
  body.innerHTML = `
    <div class="vs-screen">
      <p class="vs-map">${escapeHtml(duel.opponent.name)} te défie</p>
      <div class="vs-row">
        ${playerCard(duel.opponent, 'them')}
        <span class="vs-badge">VS</span>
        ${playerCard(duel.self, 'me')}
      </div>
      <p class="vs-status">${escapeHtml(mapName(duel))}</p>
      <p class="note">Même carte, même ordre de questions pour vous deux. Le meilleur score gagne, le temps départage. +5 trophées pour le vainqueur.</p>
      <div class="hero-actions" style="justify-content:center">
        <button id="duel-accept" class="btn btn-primary" type="button"><i data-lucide="swords" aria-hidden="true"></i><span>Accepter et jouer</span></button>
        <button id="duel-decline" class="btn btn-ghost" type="button">Refuser</button>
      </div>
    </div>`;
  refreshIcons();
  $('duel-accept').addEventListener('click', async (e) => {
    setLoading(e.currentTarget, true);
    try {
      const { duel: fresh } = await post('duels', 'accept', { id: duel.id });
      launch(fresh);
    } catch (err) {
      toast(errorText(err, 'Impossible d’accepter ce défi.'));
      setLoading(e.currentTarget, false);
    }
  });
  $('duel-decline').addEventListener('click', async (e) => {
    setLoading(e.currentTarget, true);
    try {
      await post('duels', 'decline', { id: duel.id });
      toast('Défi refusé.');
      location.hash = '#/amis';
    } catch (err) {
      toast(errorText(err, 'Impossible de refuser.'));
      setLoading(e.currentTarget, false);
    }
  });
}

// ─── Écran VS : les deux joueurs, 3-2-1, et la carte s'ouvre ───
function launch(duel) {
  const region = regionById(duel.region);
  if (!region) {
    toast('Carte inconnue.');
    location.hash = '#/amis';
    return;
  }
  showScreen('duel');
  const body = $('duel-body');
  body.innerHTML = `
    <div class="vs-screen vs-live">
      <p class="vs-map">${escapeHtml(mapName(duel))}</p>
      <div class="vs-row">
        ${playerCard(duel.self, 'me')}
        <span class="vs-badge vs-badge-big">VS</span>
        ${playerCard(duel.opponent, 'them')}
      </div>
      <p class="vs-count" id="vs-count" aria-live="assertive">3</p>
      <p class="vs-status">C'est parti dans un instant…</p>
    </div>`;
  refreshIcons();
  const count = $('vs-count');
  let n = 3;
  const tick = setInterval(() => {
    n -= 1;
    if (location.hash !== `#/duel/${duel.id}`) return clearInterval(tick);
    if (n > 0) {
      count.textContent = String(n);
      count.classList.remove('pop');
      void count.offsetWidth; // relance l'animation
      count.classList.add('pop');
    } else {
      clearInterval(tick);
      count.textContent = 'GO';
      setTimeout(() => {
        if (location.hash !== `#/duel/${duel.id}`) return;
        showScreen('game');
        startGame(region, duel.mode, duel);
      }, 500);
    }
  }, 900);
}

// ─── Notification : un ami nous défie ───
const seen = new Set(); // invitations déjà signalées pendant cette session
let inboxTimer = null;

async function checkInbox() {
  if (!currentUser()) return;
  let inbox;
  try {
    inbox = await get('duels', 'inbox');
  } catch {
    return;
  }
  const pending = inbox.invites.length + inbox.ready.length;
  const badge = $('nav-badge');
  badge.hidden = pending === 0;
  badge.textContent = String(pending);
  document.title = pending ? `(${pending}) Mnemo — Apprendre en jouant` : 'Mnemo — Apprendre en jouant';
  const fresh = inbox.invites.find((d) => !seen.has(d.id));
  if (fresh && !location.hash.startsWith('#/duel/') && $('screen-game').hidden) {
    for (const d of inbox.invites) seen.add(d.id);
    showInviteBanner(fresh);
  }
}

function showInviteBanner(duel) {
  const banner = $('invite-banner');
  banner.innerHTML = `
    <i data-lucide="swords" aria-hidden="true"></i>
    <div class="invite-text"><strong>${escapeHtml(duel.opponent.name)} te défie</strong><span>${escapeHtml(mapName(duel))}</span></div>
    <a class="btn btn-primary" href="#/duel/${duel.id}">Voir</a>
    <button class="btn btn-icon btn-icon-plain" type="button" aria-label="Fermer" data-close><i data-lucide="x" aria-hidden="true"></i></button>`;
  banner.hidden = false;
  refreshIcons();
  banner.querySelector('[data-close]').addEventListener('click', () => {
    banner.hidden = true;
  });
  banner.querySelector('a').addEventListener('click', () => {
    banner.hidden = true;
  });
}

export function startInboxWatch() {
  clearInterval(inboxTimer);
  checkInbox();
  inboxTimer = setInterval(checkInbox, 10000);
}

export function stopInboxWatch() {
  clearInterval(inboxTimer);
  inboxTimer = null;
  $('nav-badge').hidden = true;
  $('invite-banner').hidden = true;
  document.title = 'Mnemo — Apprendre en jouant';
}
