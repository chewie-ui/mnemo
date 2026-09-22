// Accès à l'API PHP (api/*.php). Même origine que le site : le cookie de session suit tout seul.
// En développement, Vite renvoie /api vers le serveur PHP local (voir vite.config.js).

const BASE = `${import.meta.env.BASE_URL}api/`;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {string} endpoint  'auth' | 'games' | 'decks'
 * @param {string} action    action côté serveur
 * @param {object} [options] { method, body, query }
 */
export async function api(endpoint, action, { method = 'GET', body, query = {} } = {}) {
  const params = new URLSearchParams({ action, ...query });
  let res;
  try {
    res = await fetch(`${BASE}${endpoint}.php?${params}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Impossible de joindre le serveur.');
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* réponse vide ou non JSON */
  }
  // 502/503/504 : le relais fonctionne mais pas le serveur PHP derrière (en local : npm run dev lance les deux).
  if (res.status >= 502 && res.status <= 504 && !data.error) throw new ApiError(res.status, 'Le serveur ne répond pas pour le moment. Réessaie dans un instant.');
  // Réponse sans JSON exploitable (page d'erreur du serveur) : message compréhensible.
  if (!res.ok && !data.error) throw new ApiError(res.status, `Le serveur a renvoyé une erreur (${res.status}). Si tu viens d'installer le site, vérifie api/.env.`);
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`);
  return data;
}

export const get = (endpoint, action, query) => api(endpoint, action, { query });
export const post = (endpoint, action, body) => api(endpoint, action, { method: 'POST', body });
