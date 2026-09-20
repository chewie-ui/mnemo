// Page « Amis et défis » : classement par trophées, demandes d'amis, défis à jouer.
import { get, post, ApiError } from './api.js';
import { currentUser } from './auth.js';
import { REGIONS, HISTORY_REGIONS, MODES, regionById, targetsFor, modeLabel } from './data/regions.js';
import { formatTime } from './game.js';
import { openAuth } from './account.js';
import { $, escapeHtml, refreshIcons, toast, setLoading, formatDate } from './ui.js';

const errorText = (err, fallback) => (err instanceof ApiError ? err.message : fallback);

function mapName(regionId, mode) {
  const region = regionById(regionId);
  return region ? `${region.name} · ${modeLabel(region, mode)}` : `${regionId} · ${mode}`;
}

export async function renderFriends() {
  const body = $('friends-body');
  if (!currentUser()) {
    body.innerHTML = `
      <div class="empty-state">
        <h2>Joue avec tes amis</h2>
        <p>Avec un compte, tu peux ajouter des amis par leur pseudo, les défier sur n'importe quelle carte (même partie, même ordre, le plus rapide gagne) et comparer vos trophées.</p>
        <div class="hero-actions">
          <button id="friends-login" class="btn btn-primary" type="button"><i data-lucide="circle-user-round" aria-hidden="true"></i><span>Se connecter</span></button>
        </div>
      </div>`;
    refreshIcons();
    $('friends-login').addEventListener('click', () => openAuth('register'));
    return;
  }

  body.innerHTML = '<p class="note">Chargement…</p>';
  let data;
  try {
    const [friends, duels, ranking] = await Promise.all([get('friends', 'list'), get('duels', 'list'), get('friends', 'leaderboard')]);
    data = { ...friends, duels: duels.duels, ranking: ranking.ranking };
  } catch (err) {
    body.innerHTML = `<p class="form-error">${escapeHtml(errorText(err, 'Impossible de charger tes amis.'))}</p>`;
    return;
  }

  const me = data.me;
  const incoming = data.friends.filter((f) => f.status === 'pending' && f.incoming);
  const outgoing = data.friends.filter((f) => f.status === 'pending' && !f.incoming);
  const accepted = data.friends.filter((f) => f.status === 'accepted');
  const toPlay = data.duels.filter((d) => d.status === 'accepted' && !d.me.finished);
  const toAccept = data.duels.filter((d) => d.status === 'pending' && !d.isChallenger);
  const waiting = data.duels.filter((d) => (d.status === 'pending' && d.isChallenger) || (d.status === 'accepted' && d.me.finished));
  const finished = data.duels.filter((d) => d.status === 'finished' || d.status === 'declined').slice(0, 15);

  const rankRows = data.ranking
    .map(
      (r, i) => `<tr class="${r.status === 'me' ? 'is-me' : ''}">
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(r.name)}${r.status === 'me' ? ' <span class="muted">(toi)</span>' : ''}</td>
        <td class="num"><span class="trophy"><i data-lucide="trophy" aria-hidden="true"></i>${r.trophies}</span></td>
      </tr>`,
    )
    .join('');

  const duelCard = (d, actions) => `
    <article class="region-card deck-card" role="listitem">
      <h3 class="name">${escapeHtml(d.opponent.name)}</h3>
      <p class="desc">${escapeHtml(mapName(d.region, d.mode))} · ${escapeHtml(formatDate(d.createdAt))}</p>
      ${d.them.finished ? `<p class="deck-meta"><span>${escapeHtml(d.opponent.name)} : ${d.them.score} % en ${formatTime(d.them.timeMs)}</span></p>` : ''}
      ${d.me.finished ? `<p class="deck-meta"><span>Toi : ${d.me.score} % en ${formatTime(d.me.timeMs)}</span></p>` : ''}
      <div class="actions">${actions}</div>
    </article>`;

  const outcome = (d) => {
    if (d.status === 'declined') return '<span class="deck-meta"><span>Refusé</span></span>';
    if (d.winnerId === null) return '<span class="deck-meta"><span>Égalité</span></span>';
    return d.winnerId === me.id ? '<span class="deck-meta"><span class="win">Gagné · +5 trophées</span></span>' : '<span class="deck-meta"><span class="loss">Perdu</span></span>';
  };

  body.innerHTML = `
    <div class="stat-row stat-row-2">
      <div class="stat"><span class="stat-value trophy"><i data-lucide="trophy" aria-hidden="true"></i>${me.trophies}</span><span class="stat-label">tes trophées</span></div>
      <div class="stat"><span class="stat-value">${accepted.length}</span><span class="stat-label">ami${accepted.length > 1 ? 's' : ''}</span></div>
    </div>
    <p class="note">Trophées : 1 par tranche de 10 % du premier coup sur une partie, +2 pour un sans-faute, le double sur les grandes cartes (40 questions ou plus), +5 par défi gagné.</p>

    ${toAccept.length ? `<h2 class="stats-section">Défis reçus</h2><div class="region-grid" role="list">${toAccept.map((d) => duelCard(d, `<a class="btn btn-primary" href="#/duel/${d.id}"><i data-lucide="swords" aria-hidden="true"></i><span>Voir le défi</span></a><button class="btn btn-ghost" data-decline="${d.id}">Refuser</button>`)).join('')}</div>` : ''}
    ${toPlay.length ? `<h2 class="stats-section">À jouer</h2><div class="region-grid" role="list">${toPlay.map((d) => duelCard(d, `<a class="btn btn-primary" href="#/duel/${d.id}"><i data-lucide="play" aria-hidden="true"></i><span>Jouer</span></a>`)).join('')}</div>` : ''}
    ${waiting.length ? `<h2 class="stats-section">En attente de l'adversaire</h2><div class="region-grid" role="list">${waiting.map((d) => duelCard(d, d.status === 'pending' ? `<a class="btn btn-ghost" href="#/duel/${d.id}">Salle d'attente</a>` : '<span class="muted small">En cours de son côté</span>')).join('')}</div>` : ''}

    <h2 class="stats-section">Classement entre amis</h2>
    <div class="table-wrap">
      <table class="stats-table">
        <thead><tr><th class="num">#</th><th>Joueur</th><th class="num">Trophées</th></tr></thead>
        <tbody>${rankRows}</tbody>
      </table>
    </div>

    ${incoming.length ? `<h2 class="stats-section">Demandes d'amis reçues</h2><div class="region-grid" role="list">${incoming.map((f) => `<article class="region-card deck-card" role="listitem"><h3 class="name">${escapeHtml(f.name)}</h3><div class="actions"><button class="btn btn-primary" data-friend-accept="${f.id}"><i data-lucide="check" aria-hidden="true"></i><span>Accepter</span></button><button class="btn btn-ghost" data-friend-remove="${f.id}">Refuser</button></div></article>`).join('')}</div>` : ''}

    <h2 class="stats-section">Mes amis</h2>
    ${accepted.length ? `<div class="region-grid" role="list">${accepted.map((f) => `<article class="region-card deck-card" role="listitem"><h3 class="name">${escapeHtml(f.name)}</h3><p class="deck-meta"><span class="trophy"><i data-lucide="trophy" aria-hidden="true"></i>${f.trophies} trophées</span></p><div class="actions"><button class="btn btn-primary" data-challenge="${f.id}" data-name="${escapeHtml(f.name)}"><i data-lucide="swords" aria-hidden="true"></i><span>Défier</span></button><button class="btn btn-ghost" data-friend-remove="${f.id}">Retirer</button></div></article>`).join('')}</div>` : '<p class="note">Pas encore d’ami. Cherche un pseudo ci-dessous.</p>'}
    ${outgoing.length ? `<p class="note">Demandes envoyées : ${outgoing.map((f) => escapeHtml(f.name)).join(', ')} (en attente).</p>` : ''}

    <h2 class="stats-section">Ajouter un ami</h2>
    <div class="search">
      <label for="friend-search" class="visually-hidden">Chercher un pseudo</label>
      <i data-lucide="search" aria-hidden="true"></i>
      <input id="friend-search" type="search" placeholder="Pseudo de ton ami" autocomplete="off" />
    </div>
    <div id="friend-results" class="region-grid" role="list"></div>

    ${finished.length ? `<h2 class="stats-section">Défis terminés</h2><div class="region-grid" role="list">${finished.map((d) => duelCard(d, outcome(d))).join('')}</div>` : ''}`;
  refreshIcons();

  // ─── Actions ───
  body.querySelectorAll('[data-accept]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      setLoading(btn, true);
      try {
        await post('duels', 'accept', { id: Number(btn.dataset.accept) });
        location.hash = `#/duel/${btn.dataset.accept}`;
      } catch (err) {
        toast(errorText(err, 'Impossible d’accepter ce défi.'));
        setLoading(btn, false);
      }
    }),
  );
  body.querySelectorAll('[data-decline]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      setLoading(btn, true);
      try {
        await post('duels', 'decline', { id: Number(btn.dataset.decline) });
        renderFriends();
      } catch (err) {
        toast(errorText(err, 'Impossible de refuser ce défi.'));
        setLoading(btn, false);
      }
    }),
  );
  body.querySelectorAll('[data-friend-accept]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      setLoading(btn, true);
      try {
        await post('friends', 'accept', { userId: Number(btn.dataset.friendAccept) });
        renderFriends();
      } catch (err) {
        toast(errorText(err, 'Impossible d’accepter.'));
        setLoading(btn, false);
      }
    }),
  );
  body.querySelectorAll('[data-friend-remove]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      setLoading(btn, true);
      try {
        await post('friends', 'remove', { userId: Number(btn.dataset.friendRemove) });
        renderFriends();
      } catch (err) {
        toast(errorText(err, 'Impossible de retirer cet ami.'));
        setLoading(btn, false);
      }
    }),
  );
  body.querySelectorAll('[data-challenge]').forEach((btn) =>
    btn.addEventListener('click', () => openChallenge(Number(btn.dataset.challenge), btn.dataset.name)),
  );

  const search = $('friend-search');
  let searchTimer = null;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchUsers(search.value.trim()), 250);
  });
}

async function searchUsers(q) {
  const box = $('friend-results');
  if (q.length < 2) {
    box.innerHTML = '';
    return;
  }
  let users;
  try {
    ({ users } = await get('friends', 'search', { q }));
  } catch (err) {
    box.innerHTML = `<p class="form-error">${escapeHtml(errorText(err, 'Recherche impossible.'))}</p>`;
    return;
  }
  if (!users.length) {
    box.innerHTML = '<p class="note">Aucun joueur avec ce pseudo.</p>';
    return;
  }
  box.innerHTML = users
    .map((u) => {
      const action =
        u.status === 'accepted'
          ? '<span class="muted small">Déjà ami</span>'
          : u.status === 'pending'
            ? '<span class="muted small">Demande en attente</span>'
            : `<button class="btn btn-primary" data-add="${u.id}"><i data-lucide="user-plus" aria-hidden="true"></i><span>Ajouter</span></button>`;
      return `<article class="region-card deck-card" role="listitem"><h3 class="name">${escapeHtml(u.name)}</h3><p class="deck-meta"><span class="trophy"><i data-lucide="trophy" aria-hidden="true"></i>${u.trophies} trophées</span></p><div class="actions">${action}</div></article>`;
    })
    .join('');
  refreshIcons();
  box.querySelectorAll('[data-add]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      setLoading(btn, true);
      try {
        const { status } = await post('friends', 'request', { userId: Number(btn.dataset.add) });
        toast(status === 'accepted' ? 'Vous êtes maintenant amis !' : 'Demande envoyée.');
        renderFriends();
      } catch (err) {
        toast(errorText(err, 'Impossible d’envoyer la demande.'));
        setLoading(btn, false);
      }
    }),
  );
}

// ─── Fenêtre « Défier » : choix de la carte et du mode ───
let challengeTarget = null;

function openChallenge(userId, name) {
  challengeTarget = userId;
  $('challenge-title').textContent = `Défier ${name}`;
  const regionSelect = $('challenge-region');
  regionSelect.innerHTML = [...REGIONS, ...HISTORY_REGIONS].map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  fillModes();
  $('challenge-error').hidden = true;
  $('challenge-modal').hidden = false;
  regionSelect.focus();
}

function fillModes() {
  const region = regionById($('challenge-region').value);
  const modes = MODES.filter((m) => targetsFor(region, m).length > 0);
  $('challenge-mode').innerHTML = modes.map((m) => `<option value="${m}">${escapeHtml(modeLabel(region, m))} (${targetsFor(region, m).length})</option>`).join('');
}

function closeChallenge() {
  $('challenge-modal').hidden = true;
}

export function initFriends() {
  $('challenge-region').addEventListener('change', fillModes);
  $('challenge-close').addEventListener('click', closeChallenge);
  $('challenge-modal').addEventListener('click', (e) => {
    if (e.target === $('challenge-modal')) closeChallenge();
  });
  $('challenge-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('challenge-submit');
    setLoading(btn, true);
    try {
      const { duel } = await post('duels', 'create', { opponentId: challengeTarget, region: $('challenge-region').value, mode: $('challenge-mode').value });
      closeChallenge();
      // Salle d'attente : la partie démarre pour les deux quand l'ami accepte.
      location.hash = `#/duel/${duel.id}`;
    } catch (err) {
      $('challenge-error').textContent = errorText(err, 'Impossible de lancer le défi.');
      $('challenge-error').hidden = false;
    } finally {
      setLoading(btn, false);
    }
  });
}
