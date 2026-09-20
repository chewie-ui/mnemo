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
    const { user: u, pendingEmail: p } = await get('auth', 'me');
    pendingEmail = p ?? null;
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

export async function forgotPassword(email) {
  return post('auth', 'forgot', { email });
}

export async function resetPassword(token, password) {
  const { user: u } = await post('auth', 'reset', { token, password });
  setUser(u);
  return u;
}

export async function renameUser(name) {
  const { user: u } = await post('auth', 'rename', { name });
  setUser(u);
  return u;
}

// Adresse en attente de confirmation (renvoyée par « me » et par la demande de changement).
let pendingEmail = null;
export const pendingEmailAddress = () => pendingEmail;

export async function requestEmailChange(email, password) {
  const res = await post('auth', 'email', { email, password });
  pendingEmail = res.pendingEmail ?? null;
  return res;
}

export async function cancelEmailChange() {
  await post('auth', 'cancel-email');
  pendingEmail = null;
}

export async function confirmEmail(token) {
  const res = await post('auth', 'confirm-email', { token });
  if (user && user.id === res.userId) setUser({ ...user, email: res.email });
  pendingEmail = null;
  return res;
}

export async function setAvatar(avatar) {
  const { user: u } = await post('auth', 'avatar', { avatar });
  setUser(u);
  return u;
}

export function changePassword(current, password) {
  return post('auth', 'password', { current, password });
}

export async function deleteAccount(password) {
  await post('auth', 'delete', { password });
  setUser(null);
}

export async function logout() {
  try {
    await post('auth', 'logout');
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 0) throw err;
  }
  setUser(null);
}
