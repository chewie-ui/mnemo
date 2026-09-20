// Compte utilisateur (optionnel) : état courant, connexion, inscription, déconnexion.
import { get, post, ApiError } from './api.js';

let user = null;
let known = false; // a-t-on déjà demandé au serveur qui est connecté ?
const listeners = new Set();

export function currentUser() {
  return user;
}

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setUser(next) {
  user = next;
  known = true;
  for (const fn of listeners) fn(user);
}

// Au chargement : le serveur dit qui est connecté (cookie de session).
// Sans serveur (site statique seul), on reste simplement déconnecté.
export async function loadUser() {
  if (known) return user;
  try {
    const { user: u } = await get('auth', 'me');
    setUser(u ?? null);
  } catch {
    setUser(null);
  }
  return user;
}

export async function login(email, password) {
  const { user: u } = await post('auth', 'login', { email, password });
  setUser(u);
  return u;
}

export async function register(email, name, password) {
  const { user: u } = await post('auth', 'register', { email, name, password });
  setUser(u);
  return u;
}

export async function logout() {
  try {
    await post('auth', 'logout');
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 0) throw err;
  }
  setUser(null);
}
