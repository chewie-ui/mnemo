// Réglages : thème (système / clair / sombre), mode « confirmer », compte, données locales.
// Tout est propre à l'appareil et gardé dans localStorage.
import { currentUser, onAuthChange, logout, changePassword, deleteAccount, renameUser, changeEmail } from './auth.js';
import { ApiError } from './api.js';
import { openAuth } from './account.js';
import { $, refreshIcons, toast, setLoading } from './ui.js';

export const THEME_KEY = 'mnemo:theme';
export const CONFIRM_KEY = 'mnemo:confirm';
const THEMES = ['system', 'light', 'dark'];
const media = window.matchMedia('(prefers-color-scheme: dark)');

function readPref(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : le réglage vaut pour la session */
  }
}

export function themePreference() {
  const t = readPref(THEME_KEY);
  return THEMES.includes(t) ? t : 'system';
}

// Pose le thème effectif sur <html> (le script inline de index.html fait pareil avant le premier rendu).
export function applyTheme() {
  const pref = themePreference();
  const resolved = pref === 'system' ? (media.matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#181f27' : '#ffffff');
}

export function setTheme(pref) {
  writePref(THEME_KEY, THEMES.includes(pref) ? pref : 'system');
  applyTheme();
}

media.addEventListener('change', () => {
  if (themePreference() === 'system') applyTheme();
});

export const confirmMode = () => readPref(CONFIRM_KEY) === '1';
export const setConfirmMode = (on) => writePref(CONFIRM_KEY, on ? '1' : '0');

// ─── Page ───
function renderAccount() {
  const user = currentUser();
  $('settings-account-in').hidden = !user;
  $('settings-account-out').hidden = Boolean(user);
  $('name-form').hidden = !user;
  $('email-form').hidden = !user;
  $('password-form').hidden = !user;
  $('settings-danger').hidden = !user;
  if (user) {
    $('settings-name').textContent = user.name;
    $('settings-email').textContent = user.email ?? '';
    $('name-input').value = user.name;
    $('email-input').value = user.email ?? '';
    $('email-password').value = '';
  }
}

export function renderSettings() {
  const pref = themePreference();
  $('password-form').reset();
  $('pwd-error').hidden = true;
  $('name-error').hidden = true;
  $('email-error').hidden = true;
  closeDelete();
  for (const input of document.querySelectorAll('input[name="theme"]')) input.checked = input.value === pref;
  $('settings-confirm').checked = confirmMode();
  renderAccount();
  refreshIcons();
}

function closeDelete() {
  const form = $('delete-form');
  form.hidden = true;
  form.reset();
  $('delete-error').hidden = true;
  $('delete-open').hidden = false;
}

export function initSettings() {
  applyTheme();
  onAuthChange(renderAccount);

  for (const input of document.querySelectorAll('input[name="theme"]')) {
    input.addEventListener('change', () => {
      if (input.checked) setTheme(input.value);
    });
  }
  $('settings-confirm').addEventListener('change', (e) => setConfirmMode(e.currentTarget.checked));
  $('settings-login').addEventListener('click', () => openAuth('login'));
  $('settings-logout').addEventListener('click', async (e) => {
    setLoading(e.currentTarget, true);
    try {
      await logout();
      toast('Tu es déconnecté.');
    } catch {
      toast('Déconnexion impossible pour le moment.');
    } finally {
      setLoading(e.currentTarget, false);
    }
  });
  $('name-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('name-error');
    const name = $('name-input').value.trim();
    if (name.length < 2) {
      error.textContent = 'Choisis un pseudo d’au moins 2 caractères.';
      error.hidden = false;
      return;
    }
    if (name === currentUser()?.name) return;
    error.hidden = true;
    setLoading($('name-submit'), true);
    try {
      await renameUser(name);
      toast(`Tu t’appelles maintenant ${name}.`);
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : 'Une erreur est survenue. Réessaie.';
      error.hidden = false;
    } finally {
      setLoading($('name-submit'), false);
    }
  });

  $('email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('email-error');
    const fail = (msg) => {
      error.textContent = msg;
      error.hidden = false;
    };
    const email = $('email-input').value.trim();
    const password = $('email-password').value;
    if (!email || !$('email-input').checkValidity()) return fail('Adresse e-mail invalide.');
    if (email.toLowerCase() === currentUser()?.email) return fail('C’est déjà ton adresse actuelle.');
    if (!password) return fail('Indique ton mot de passe pour confirmer.');
    error.hidden = true;
    setLoading($('email-submit'), true);
    try {
      const user = await changeEmail(email, password);
      $('email-password').value = '';
      toast(`Adresse changée : ${user.email}.`);
    } catch (err) {
      fail(err instanceof ApiError ? err.message : 'Une erreur est survenue. Réessaie.');
    } finally {
      setLoading($('email-submit'), false);
    }
  });

  const pwdForm = $('password-form');
  pwdForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('pwd-error');
    const fail = (msg) => {
      error.textContent = msg;
      error.hidden = false;
    };
    const current = $('pwd-current').value;
    const next = $('pwd-new').value;
    if (!current) return fail('Indique ton mot de passe actuel.');
    if (next.length < 8) return fail('Le nouveau mot de passe doit faire au moins 8 caractères.');
    if (next !== $('pwd-confirm').value) return fail('Les deux nouveaux mots de passe ne sont pas identiques.');
    error.hidden = true;
    setLoading($('pwd-submit'), true);
    try {
      await changePassword(current, next);
      pwdForm.reset();
      toast('Mot de passe changé.');
    } catch (err) {
      fail(err instanceof ApiError ? err.message : 'Une erreur est survenue. Réessaie.');
    } finally {
      setLoading($('pwd-submit'), false);
    }
  });

  $('delete-open').addEventListener('click', () => {
    $('delete-open').hidden = true;
    $('delete-form').hidden = false;
    $('delete-password').focus();
  });
  $('delete-cancel').addEventListener('click', closeDelete);
  $('delete-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('delete-error');
    const password = $('delete-password').value;
    if (!password) {
      error.textContent = 'Indique ton mot de passe pour confirmer.';
      error.hidden = false;
      return;
    }
    if (!window.confirm('Supprimer définitivement ton compte et tout ce qui va avec ? Il n’y a pas de retour en arrière.')) return;
    error.hidden = true;
    setLoading($('delete-submit'), true);
    try {
      await deleteAccount(password);
      closeDelete();
      toast('Ton compte a été supprimé.');
      location.hash = '#/';
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : 'Une erreur est survenue. Réessaie.';
      error.hidden = false;
    } finally {
      setLoading($('delete-submit'), false);
    }
  });

  $('settings-clear').addEventListener('click', () => {
    if (!window.confirm('Effacer les données gardées dans ce navigateur ? Records hors connexion, progression de campagne locale et leçons non synchronisées seront perdus. Ton compte en ligne n’est pas touché.')) return;
    try {
      const keep = { theme: readPref(THEME_KEY), confirm: readPref(CONFIRM_KEY) };
      for (const key of Object.keys(localStorage)) if (key.startsWith('mnemo:')) localStorage.removeItem(key);
      if (keep.theme) writePref(THEME_KEY, keep.theme);
      if (keep.confirm) writePref(CONFIRM_KEY, keep.confirm);
    } catch {
      /* stockage indisponible */
    }
    toast('Données locales effacées.');
  });
}
