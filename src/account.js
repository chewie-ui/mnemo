// Bouton compte (en haut à droite), menu, et fenêtre de connexion / inscription.
import { currentUser, onAuthChange, login, register, logout } from './auth.js';
import { ApiError } from './api.js';
import { $, setLoading, toast } from './ui.js';

const ui = {
  btn: $('user-btn'),
  label: $('user-label'),
  menu: $('user-menu'),
  logout: $('logout-btn'),
  modal: $('auth-modal'),
  title: $('auth-title'),
  close: $('auth-close'),
  tabLogin: $('tab-login'),
  tabRegister: $('tab-register'),
  form: $('auth-form'),
  nameField: $('auth-name-field'),
  name: $('auth-name'),
  email: $('auth-email'),
  password: $('auth-password'),
  passwordHint: $('auth-password-hint'),
  error: $('auth-error'),
  submit: $('auth-submit'),
};

let mode = 'login';

function renderUser(user) {
  ui.label.textContent = user ? user.name : 'Se connecter';
  ui.btn.setAttribute('aria-label', user ? `Compte de ${user.name}` : 'Se connecter ou créer un compte');
}

function openMenu(open) {
  ui.menu.hidden = !open;
  ui.btn.setAttribute('aria-expanded', String(open));
}

export function openAuth(which = 'login') {
  setMode(which);
  ui.error.hidden = true;
  ui.form.reset();
  ui.modal.hidden = false;
  (which === 'register' ? ui.name : ui.email).focus();
}

function closeAuth() {
  ui.modal.hidden = true;
}

function setMode(which) {
  mode = which;
  const isRegister = which === 'register';
  ui.title.textContent = isRegister ? 'Créer un compte' : 'Se connecter';
  ui.submit.querySelector('span').textContent = isRegister ? 'Créer mon compte' : 'Se connecter';
  ui.tabLogin.setAttribute('aria-selected', String(!isRegister));
  ui.tabRegister.setAttribute('aria-selected', String(isRegister));
  ui.nameField.hidden = !isRegister;
  ui.passwordHint.hidden = !isRegister;
  ui.password.autocomplete = isRegister ? 'new-password' : 'current-password';
  ui.error.hidden = true;
}

function showError(message) {
  ui.error.textContent = message;
  ui.error.hidden = false;
}

async function submit(e) {
  e.preventDefault();
  const email = ui.email.value.trim();
  const password = ui.password.value;
  const name = ui.name.value.trim();
  if (!email || !password) return showError('Renseigne ton adresse e-mail et ton mot de passe.');
  if (mode === 'register' && name.length < 2) return showError('Choisis un pseudo d’au moins 2 caractères.');
  if (mode === 'register' && password.length < 8) return showError('Le mot de passe doit faire au moins 8 caractères.');
  setLoading(ui.submit, true);
  try {
    const user = mode === 'register' ? await register(email, name, password) : await login(email, password);
    closeAuth();
    toast(mode === 'register' ? `Bienvenue, ${user.name} !` : `Content de te revoir, ${user.name} !`);
  } catch (err) {
    showError(err instanceof ApiError ? err.message : 'Une erreur est survenue. Réessaie.');
  } finally {
    setLoading(ui.submit, false);
  }
}

export function initAccount() {
  renderUser(currentUser());
  onAuthChange(renderUser);

  ui.btn.addEventListener('click', () => {
    if (currentUser()) openMenu(ui.menu.hidden);
    else openAuth('login');
  });
  document.addEventListener('click', (e) => {
    if (!ui.menu.hidden && !e.target.closest('.user-area')) openMenu(false);
  });
  ui.menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) openMenu(false);
  });
  ui.logout.addEventListener('click', async () => {
    openMenu(false);
    setLoading(ui.logout, true);
    try {
      await logout();
      toast('Tu es déconnecté.');
      if (location.hash.startsWith('#/stats')) location.hash = '#/';
    } catch {
      toast('Déconnexion impossible pour le moment.');
    } finally {
      setLoading(ui.logout, false);
    }
  });

  ui.tabLogin.addEventListener('click', () => setMode('login'));
  ui.tabRegister.addEventListener('click', () => setMode('register'));
  ui.close.addEventListener('click', closeAuth);
  ui.modal.addEventListener('click', (e) => {
    if (e.target === ui.modal) closeAuth();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAuth();
      openMenu(false);
    }
  });
  ui.form.addEventListener('submit', submit);
}
