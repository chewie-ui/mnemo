// Partage de leçons entre amis : fenêtre « Partager avec… », liste des leçons reçues, classement.
import { get, post, ApiError } from './api.js';
import { $, escapeHtml, refreshIcons, toast, setLoading } from './ui.js';
import { avatarHtml } from './avatar.js';
import { currentUser } from './auth.js';

const errorText = (err, fallback) => (err instanceof ApiError || err instanceof Error ? err.message : fallback);

export const shareApi = {
  list: async (id) => get('decks', 'share-list', { id }),
  set: async (id, userIds) => post('decks', 'share-set', { id, userIds }),
  shared: async () => (await get('decks', 'shared')).decks,
  score: async (id, good, total) => post('decks', 'score', { id, good, total }),
  leaderboard: async (id) => get('decks', 'leaderboard', { id }),
  copy: async (id) => (await post('decks', 'copy', { id })).deck,
};

// ─── Fenêtre de partage ───
let sharing = null; // { id, onDone }

export async function openShare(deck, onDone) {
  sharing = { id: deck.id, onDone };
  const modal = $('share-modal');
  $('share-title').textContent = `Partager « ${deck.title} »`;
  const list = $('share-friends');
  list.innerHTML = '<p class="note">Chargement…</p>';
  modal.hidden = false;
  try {
    const { sharedWith, friends } = await shareApi.list(deck.id);
    if (!friends.length) {
      list.innerHTML = '<p class="note">Tu n’as pas encore d’ami. Ajoute-en depuis la page <a href="#/amis">Amis</a> pour partager tes leçons.</p>';
      $('share-submit').disabled = true;
      return;
    }
    $('share-submit').disabled = false;
    list.innerHTML = friends.map((f) => `
      <label class="share-row">
        <input type="checkbox" name="share-user" value="${f.id}" ${sharedWith.includes(f.id) ? 'checked' : ''} />
        ${avatarHtml(f, 'sm')}
        <span class="share-name">${escapeHtml(f.name)}</span>
        <span class="muted small">${f.trophies} trophées</span>
      </label>`).join('');
    refreshIcons();
  } catch (err) {
    list.innerHTML = `<p class="form-error">${escapeHtml(errorText(err, 'Impossible de charger tes amis.'))}</p>`;
  }
}

function closeShare() {
  $('share-modal').hidden = true;
  sharing = null;
}

// ─── Classement d'une leçon (après un quiz, ou à la demande) ───
export function rankingHtml(ranking, meId) {
  if (!ranking.length) return '';
  return `
    <table class="stats-table ranking">
      <thead><tr><th>#</th><th>Joueur</th><th class="num">Meilleur quiz</th><th class="num">Essais</th></tr></thead>
      <tbody>${ranking.map((r, i) => `
        <tr class="${r.id === meId ? 'is-me' : ''}">
          <td>${r.score === null ? '—' : i + 1}</td>
          <td><span class="name-with-avatar">${avatarHtml(r, 'sm')}<span>${escapeHtml(r.name)}${r.owner ? ' <span class="muted">(auteur)</span>' : ''}${r.id === meId ? ' <span class="muted">(toi)</span>' : ''}</span></span></td>
          <td class="num">${r.score === null ? '<span class="muted">pas encore joué</span>' : `<strong>${r.score} %</strong> <span class="muted small">(${r.good}/${r.total})</span>`}</td>
          <td class="num">${r.attempts || '—'}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

export async function openLeaderboard(deck) {
  const modal = $('rank-modal');
  $('rank-title').textContent = `Classement — ${deck.title}`;
  const body = $('rank-body');
  body.innerHTML = '<p class="note">Chargement…</p>';
  modal.hidden = false;
  try {
    const { ranking } = await shareApi.leaderboard(deck.id);
    body.innerHTML = ranking.length > 1
      ? rankingHtml(ranking, currentUser()?.id)
      : '<p class="note">Partage la leçon avec des amis : leur meilleur score au quiz apparaîtra ici.</p>';
    refreshIcons();
  } catch (err) {
    body.innerHTML = `<p class="form-error">${escapeHtml(errorText(err, 'Classement indisponible.'))}</p>`;
  }
}

export function initShare() {
  $('share-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sharing) return;
    const ids = [...document.querySelectorAll('input[name="share-user"]:checked')].map((i) => Number(i.value));
    setLoading($('share-submit'), true);
    try {
      await shareApi.set(sharing.id, ids);
      toast(ids.length ? `Leçon partagée avec ${ids.length} ami${ids.length > 1 ? 's' : ''}.` : 'Leçon plus partagée avec personne.');
      const done = sharing.onDone;
      closeShare();
      done?.();
    } catch (err) {
      toast(errorText(err, 'Partage impossible.'));
    } finally {
      setLoading($('share-submit'), false);
    }
  });
  $('share-cancel').addEventListener('click', closeShare);
  $('share-modal').addEventListener('click', (e) => {
    if (e.target === $('share-modal')) closeShare();
  });
  $('rank-close').addEventListener('click', () => ($('rank-modal').hidden = true));
  $('rank-modal').addEventListener('click', (e) => {
    if (e.target === $('rank-modal')) $('rank-modal').hidden = true;
  });
}
