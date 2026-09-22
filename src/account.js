// Bouton compte (en haut à droite), menu, et fenêtre de connexion / inscription.
import { currentUser, onAuthChange, login, register, logout, forgotPassword, resetPassword, confirmEmail } from './auth.js';
import { ApiError } from './api.js';
import { $, setLoading, toast, escapeHtml, refreshIcons } from './ui.js';
import { avatarHtml } from './avatar.js';

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
  passwordField: $('auth-password-field'),
  passwordHint: $('auth-password-hint'),
  forgotNote: $('auth-forgot-note'),
  error: $('auth-error'),
  success: $('auth-success'),
  submit: $('auth-submit'),
  forgot: $('auth-forgot'),
  back: $('auth-back'),
};

let mode = 'login';

function renderUser(user) {
  ui.label.textContent = user ? user.name : 'Se connecter';
  $('user-avatar').innerHTML = user ? avatarHtml(user, 'sm') : '<i data-lucide="circle-user-round" aria-hidden="true"></i>';
  refreshIcons();
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
  const isForgot = which === 'forgot';
  ui.title.textContent = isRegister ? 'Créer un compte' : isForgot ? 'Mot de passe oublié' : 'Se connecter';
  ui.submit.querySelector('span').textContent = isRegister ? 'Créer mon compte' : isForgot ? 'Envoyer le lien' : 'Se connecter';
  ui.tabLogin.setAttribute('aria-selected', String(!isRegister && !isForgot));
  ui.tabRegister.setAttribute('aria-selected', String(isRegister));
  ui.nameField.hidden = !isRegister;
  ui.passwordField.hidden = isForgot;
  ui.password.required = !isForgot;
  ui.passwordHint.hidden = !isRegister;
  ui.forgotNote.hidden = !isForgot;
  ui.forgot.hidden = which !== 'login';
  ui.back.hidden = !isForgot;
  ui.submit.disabled = false;
  ui.password.autocomplete = isRegister ? 'new-password' : 'current-password';
  ui.error.hidden = true;
  ui.success.hidden = true;
}

// Le message doit sauter aux yeux : on le montre, on place le curseur dans le champ fautif
// et on le fait lire aux lecteurs d'écran.
function showError(message, field = null) {
  ui.error.textContent = message;
  ui.error.hidden = false;
  ui.error.scrollIntoView({ block: 'nearest' });
  const target = field ?? (/mot de passe/i.test(message) ? ui.password : /pseudo/i.test(message) ? ui.name : /adresse/i.test(message) || /e-mail/i.test(message) ? ui.email : null);
  if (target && !target.closest('[hidden]')) {
    target.focus();
    target.select?.();
    target.classList.add('is-invalid');
    target.addEventListener('input', () => target.classList.remove('is-invalid'), { once: true });
  }
}

async function submit(e) {
  e.preventDefault();
  const email = ui.email.value.trim();
  const password = ui.password.value;
  const name = ui.name.value.trim();
  if (mode === 'forgot') return sendResetLink(email);
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

// Demande de lien : même réponse qu'un compte existe ou non (pas d'indice sur les adresses).
async function sendResetLink(email) {
  if (!email) return showError('Indique ton adresse e-mail.');
  setLoading(ui.submit, true);
  try {
    const res = await forgotPassword(email);
    ui.error.hidden = true;
    ui.success.innerHTML = 'Si un compte existe avec cette adresse, un e-mail vient de partir. Pense à vérifier les indésirables.';
    if (res.debugLink) {
      // En local, pas d'envoi : le lien est fourni directement pour tester.
      const a = document.createElement('a');
      a.href = res.debugLink;
      a.textContent = 'Ouvrir le lien (mode local)';
      ui.success.append(' ', a);
      a.addEventListener('click', closeAuth);
    }
    ui.success.hidden = false;
    ui.submit.disabled = true;
  } catch (err) {
    showError(err instanceof ApiError ? err.message : 'Une erreur est survenue. Réessaie.');
  } finally {
    ui.submit.classList.remove('is-loading');
    if (ui.success.hidden) ui.submit.disabled = false;
  }
}

// Écran « nouveau mot de passe » ouvert depuis le lien reçu (#/reset/<jeton>).
export function renderReset(token) {
  const form = $('reset-form');
  const error = $('reset-error');
  form.reset();
  error.hidden = true;
  form.dataset.token = token;
  $('reset-password').focus();
}

// Écran ouvert depuis le lien de confirmation d'adresse (#/confirm-email/<jeton>).
// Le changement d'adresse met à jour l'utilisateur, ce qui refait passer le routeur :
// on garde le résultat par jeton pour ne pas consommer le lien deux fois.
const confirmations = new Map();

export async function renderConfirmEmail(token) {
  const body = $('confirm-body');
  body.innerHTML = '<p class="note">Vérification du lien…</p>';
  try {
    if (!confirmations.has(token)) confirmations.set(token, confirmEmail(token));
    const res = await confirmations.get(token);
    body.innerHTML = `
      <p class="form-success">Adresse confirmée : <strong>${escapeHtml(res.email)}</strong>.</p>
      <p class="note">C’est désormais celle qui sert à te connecter et à récupérer ton mot de passe.</p>
      <div class="hero-actions"><a class="btn btn-primary" href="#/"><span>Retour à l’accueil</span></a>${currentUser() ? '' : '<button id="confirm-login" class="btn btn-ghost" type="button"><span>Se connecter</span></button>'}</div>`;
    body.querySelector('#confirm-login')?.addEventListener('click', () => openAuth('login'));
  } catch (err) {
    body.innerHTML = `
      <p class="form-error">${escapeHtml(err instanceof ApiError ? err.message : 'Une erreur est survenue. Réessaie.')}</p>
      <div class="hero-actions"><a class="btn btn-primary" href="#/reglages"><span>Aller aux réglages</span></a></div>`;
  }
  refreshIcons();
}

export function initReset() {
  const form = $('reset-form');
  const error = $('reset-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('reset-password').value;
    const confirm = $('reset-confirm').value;
    const fail = (msg) => {
      error.textContent = msg;
      error.hidden = false;
    };
    if (password.length < 8) return fail('Le mot de passe doit faire au moins 8 caractères.');
    if (password !== confirm) return fail('Les deux mots de passe ne sont pas identiques.');
    error.hidden = true;
    setLoading($('reset-submit'), true);
    try {
      const user = await resetPassword(form.dataset.token, password);
      toast(`Mot de passe changé. Content de te revoir, ${user.name} !`);
      location.hash = '#/';
    } catch (err) {
      fail(err instanceof ApiError ? err.message : 'Une erreur est survenue. Réessaie.');
    } finally {
      setLoading($('reset-submit'), false);
    }
  });
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

  ui.forgot.addEventListener('click', () => {
    setMode('forgot');
    ui.email.focus();
  });
  ui.back.addEventListener('click', () => {
    setMode('login');
    ui.email.focus();
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
