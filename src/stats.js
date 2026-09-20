// Page « Mes stats » : totaux, meilleur score par carte, dernières parties.
import { get, ApiError } from './api.js';
import { currentUser } from './auth.js';
import { regionById, modeLabel } from './data/regions.js';
import { formatTime } from './game.js';
import { openAuth } from './account.js';
import { $, escapeHtml, refreshIcons, formatDate } from './ui.js';

function mapName(regionId, mode) {
  const region = regionById(regionId);
  if (!region) return `${regionId} · ${mode}`;
  return `${region.name} · ${modeLabel(region, mode)}`;
}

export async function renderStats() {
  const body = $('stats-body');
  if (!currentUser()) {
    body.innerHTML = `
      <div class="empty-state">
        <h2>Tes stats te suivent partout</h2>
        <p>Connecte-toi pour enregistrer chaque partie et retrouver tes records et ta progression sur tous tes appareils. Sans compte, seuls tes meilleurs scores restent dans ce navigateur.</p>
        <div class="hero-actions">
          <button id="stats-login" class="btn btn-primary" type="button"><i data-lucide="circle-user-round" aria-hidden="true"></i><span>Se connecter</span></button>
        </div>
      </div>`;
    refreshIcons();
    $('stats-login').addEventListener('click', () => openAuth('login'));
    return;
  }

  body.innerHTML = '<p class="note">Chargement…</p>';
  let stats;
  try {
    stats = await get('games', 'stats');
  } catch (err) {
    body.innerHTML = `<p class="form-error">${escapeHtml(err instanceof ApiError ? err.message : 'Impossible de charger les stats.')}</p>`;
    return;
  }

  if (stats.games === 0) {
    body.innerHTML = `
      <div class="empty-state">
        <h2>Aucune partie enregistrée</h2>
        <p>Joue une carte : dès la fin de la partie, elle apparaîtra ici.</p>
        <div class="hero-actions"><a class="btn btn-primary" href="#/#geo"><i data-lucide="play" aria-hidden="true"></i><span>Choisir une carte</span></a></div>
      </div>`;
    refreshIcons();
    return;
  }

  const rows = stats.perMap
    .map(
      (m) => `<tr>
        <td>${escapeHtml(mapName(m.region, m.mode))}</td>
        <td class="num">${m.games}</td>
        <td class="num">${m.best} %</td>
        <td class="num">${m.avg} %</td>
        <td class="num">${formatTime(m.bestTime)}</td>
      </tr>`,
    )
    .join('');
  const recent = stats.recent
    .map(
      (g) => `<tr>
        <td>${escapeHtml(formatDate(g.playedAt))}</td>
        <td>${escapeHtml(mapName(g.region, g.mode))}</td>
        <td class="num">${g.score} %</td>
        <td class="num">${g.errors}</td>
        <td class="num">${formatTime(g.timeMs)}</td>
      </tr>`,
    )
    .join('');

  body.innerHTML = `
    <div class="stat-row stat-row-4">
      <div class="stat"><span class="stat-value trophy"><i data-lucide="trophy" aria-hidden="true"></i>${stats.trophies}</span><span class="stat-label">trophées</span></div>
      <div class="stat"><span class="stat-value">${stats.games}</span><span class="stat-label">partie${stats.games > 1 ? 's' : ''}</span></div>
      <div class="stat"><span class="stat-value">${stats.avgScore} %</span><span class="stat-label">score moyen</span></div>
      <div class="stat"><span class="stat-value">${formatTime(stats.timeMs)}</span><span class="stat-label">temps de jeu</span></div>
    </div>
    <h2 class="stats-section">Par carte</h2>
    <div class="table-wrap">
      <table class="stats-table">
        <thead><tr><th>Carte</th><th class="num">Parties</th><th class="num">Record</th><th class="num">Moyenne</th><th class="num">Meilleur temps</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <h2 class="stats-section">Dernières parties</h2>
    <div class="table-wrap">
      <table class="stats-table">
        <thead><tr><th>Date</th><th>Carte</th><th class="num">Score</th><th class="num">Erreurs</th><th class="num">Temps</th></tr></thead>
        <tbody>${recent}</tbody>
      </table>
    </div>`;
  refreshIcons();
}
