// Meilleurs scores : toujours en local (localStorage), et en plus sur le serveur quand on est connecté.
import { get, post } from './api.js';
import { currentUser } from './auth.js';

// Le mode Pays garde l'ancienne clé pour ne pas perdre les records existants.
const localKey = (regionId, mode) => (mode === 'countries' ? `mnemo:best:${regionId}` : `mnemo:best:${regionId}:${mode}`);

let serverBests = {}; // "region|mode" -> { score, timeMs }

function readLocal(regionId, mode) {
  try {
    return JSON.parse(localStorage.getItem(localKey(regionId, mode))) ?? null;
  } catch {
    return null;
  }
}

// Meilleur = score plus haut, puis temps plus court à score égal.
const better = (a, b) => !b || a.score > b.score || (a.score === b.score && a.timeMs < b.timeMs);

export function getBest(regionId, mode) {
  const local = readLocal(regionId, mode);
  const remote = serverBests[`${regionId}|${mode}`] ?? null;
  if (local && remote) return better(local, remote) ? local : remote;
  return local ?? remote;
}

// Récupère les records du compte connecté (ou vide si déconnecté).
export async function refreshServerBests() {
  if (!currentUser()) {
    serverBests = {};
    return;
  }
  try {
    const { bests } = await get('games', 'bests');
    serverBests = bests ?? {};
  } catch {
    serverBests = {};
  }
}

// Enregistre une partie. Retourne true si c'est un nouveau record.
// skipServer : la partie a déjà été enregistrée par un autre chemin (défi).
export async function recordGame(regionId, mode, stats, { skipServer = false } = {}) {
  const entry = { score: stats.score, timeMs: stats.timeMs };
  const isBest = better(entry, getBest(regionId, mode));
  try {
    localStorage.setItem(localKey(regionId, mode), JSON.stringify(entry));
  } catch {
    /* stockage indisponible : on joue sans historique */
  }
  if (currentUser() && !skipServer) {
    try {
      await post('games', 'save', { region: regionId, mode, score: stats.score, timeMs: stats.timeMs, errors: stats.errors, total: stats.total });
      const key = `${regionId}|${mode}`;
      if (better(entry, serverBests[key])) serverBests[key] = entry;
    } catch (err) {
      console.warn('Partie non enregistrée sur le serveur :', err.message);
    }
  }
  return isBest;
}
