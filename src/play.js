// Écran de partie : carte muette, question, réponses, résultats.
import { confirmMode as readConfirmMode, setConfirmMode } from './settings.js';
import { targetsFor, modeLabel, unitLabel } from './data/regions.js';
import { Game, formatTime } from './game.js';
import { GameMap } from './map.js';
import { FlagGrid } from './flag-grid.js';
import { recordGame } from './scores.js';
import { currentUser } from './auth.js';
import { LANGUAGES } from './data/languages.js';
import { CURRENCIES } from './data/currencies.js';
import { get, post } from './api.js';
import { levelTargets, completeLevel, starRow } from './campaign.js';
import { $, flagUrl, escapeHtml, refreshIcons, toast } from './ui.js';

const ui = {
  promptLabel: document.querySelector('.prompt-label'),
  promptFlag: $('prompt-flag'),
  grid: $('flag-grid'),
  zoomControls: $('zoom-controls'),
  promptName: $('prompt-name'),
  feedback: $('feedback'),
  progress: $('hud-progress'),
  errors: $('hud-errors'),
  time: $('hud-time'),
  svg: $('map'),
  loading: $('map-loading'),
  results: $('results'),
  tip: $('map-tip'),
  rival: $('hud-rival'),
  rivalName: $('hud-rival-name'),
  rivalProgress: $('hud-rival-progress'),
  duelResult: $('res-duel'),
  duelsBtn: $('btn-duels'),
  confirmToggle: $('confirm-toggle'),
  confirmBar: $('confirm-bar'),
  levelTag: $('hud-level'),
  levelResult: $('res-level'),
  nextBtn: $('btn-next-level'),
};

// Mode « confirmer » : le clic surligne la zone, un second clic (ou Valider) répond.
// Réglage propre à l'appareil, gardé d'une partie à l'autre.
let confirmMode = false;
let pending = null; // { id, at } : zone surlignée en attente de validation

let session = null; // { region, mode, game, map, timer, duel, poll }

// Partie en cours gardée sur l'appareil : un rechargement de page reprend là où on en était.
// Une seule à la fois, oubliée après 3 h ou quand on quitte volontairement.
const RESUME_KEY = 'mnemo:resume';
const RESUME_TTL = 3 * 3600_000;
const resumeKey = (region, mode, duel, level) => `${region.id}|${mode}|${level?.id ?? ''}|${duel?.id ?? ''}`;

function readResume(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(RESUME_KEY));
    if (saved?.key === key && Date.now() - saved.savedAt < RESUME_TTL) return saved.snap;
  } catch {
    /* rien de valable */
  }
  return null;
}

function persistGame() {
  if (!session || session.game.done) return;
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ key: session.key, snap: session.game.snapshot(), savedAt: Date.now() }));
  } catch {
    /* stockage indisponible */
  }
}

function clearResume() {
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    /* stockage indisponible */
  }
}

function clearPending() {
  if (pending) session?.map.setSelected(null);
  pending = null;
  ui.confirmBar.hidden = true;
}

// Quitter un défi en cours = abandon : l'adversaire pourra finir et gagner.
function forfeitIfNeeded(keepalive = false) {
  const s = session;
  if (!s?.duel || s.game.done || s.forfeited) return;
  s.forfeited = true;
  const params = new URLSearchParams({ action: 'forfeit' });
  fetch(`${import.meta.env.BASE_URL}api/duels.php?${params}`, {
    method: 'POST',
    keepalive,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: JSON.stringify({ id: s.duel.id }),
  }).catch(() => {});
}

window.addEventListener('pagehide', () => forfeitIfNeeded(true));

export function stopSession() {
  clearPending();
  forfeitIfNeeded();
  if (session?.timer) clearInterval(session.timer);
  if (session?.poll) clearInterval(session.poll);
  session = null;
  ui.results.hidden = true;
  ui.rival.hidden = true;
  ui.duelResult.hidden = true;
  ui.duelsBtn.hidden = true;
  ui.levelResult.hidden = true;
  ui.nextBtn.hidden = true;
  ui.levelTag.hidden = true;
}

// duel : { id, seed, opponent: { name }, them: { progress } } quand la partie est un défi.
// level : niveau de campagne (sous-ensemble de cibles, étoiles à la fin).
export async function startGame(region, mode, duel = null, level = null) {
  stopSession();
  ui.feedback.textContent = '';
  ui.feedback.className = 'feedback';
  ui.loading.hidden = false;
  ui.loading.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Chargement de la carte…</span>';
  ui.svg.innerHTML = '';
  ui.grid.innerHTML = '';

  const targets = level ? levelTargets(level) : targetsFor(region, mode);
  const key = resumeKey(region, mode, duel, level);
  const saved = readResume(key);
  const game = new Game(targets, duel?.seed ?? saved?.seed ?? null);
  if (saved) game.restore(saved);
  // « Trouve le drapeau » se joue sur une grille de drapeaux, pas sur la carte.
  const isGrid = mode === 'flagpick';
  ui.svg.hidden = isGrid;
  ui.grid.hidden = !isGrid;
  ui.zoomControls.hidden = isGrid;
  const map = isGrid ? new FlagGrid(ui.grid, targets, game.seed) : new GameMap(ui.svg, region, targets, mode, { restrict: Boolean(level) });
  session = { region, mode, game, map, timer: null, duel, level, poll: null, lastProgressSent: 0, key };
  if (level) {
    ui.levelTag.hidden = false;
    ui.levelTag.textContent = `Niveau ${level.number} · ${level.title}`;
  }
  (isGrid ? ui.grid : ui.svg).setAttribute('aria-label', `${isGrid ? 'Drapeaux' : 'Carte muette'} — ${region.name}, ${modeLabel(region, mode)}`);

  try {
    await map.render();
  } catch (err) {
    console.error(err);
    ui.loading.innerHTML = '<span>Impossible de charger la carte. Recharge la page pour réessayer.</span>';
    return;
  }
  if (session?.game !== game) return; // l'utilisateur a quitté pendant le chargement
  ui.loading.hidden = true;

  if (saved) {
    // Reprise : on recolore ce qui a déjà été joué, et la réponse en attente si on était en plein raté.
    for (const r of game.results) map.setState(r.zone ?? r.id, r.ok ? `correct-${r.attempts}` : 'failed');
    if (game.revealing && game.current) for (const z of zonesOf(game.current)) map.setState(z, 'reveal');
    toast('Partie reprise là où tu en étais.');
  } else {
    // Le chrono démarre quand la carte est visible, pas pendant le chargement.
    game.startedAt = Date.now();
  }
  if (game.done) {
    finishGame();
    return;
  }
  session.timer = setInterval(() => {
    ui.time.textContent = formatTime(game.elapsedMs);
  }, 500);

  confirmMode = readConfirmMode();
  ui.confirmToggle.checked = confirmMode;
  map.onSelect = (id, at) => {
    // Une zone déjà répondue (colorée) ne fait plus rien : ni erreur, ni sélection.
    if (game.results.some((r) => r.id === id)) return setFeedback('Déjà trouvé', '');
    if (!confirmMode) return handleAnswer(id, at);
    // Même zone recliquée : on valide. Sinon, on la surligne et on attend.
    if (pending?.id === id) return confirmPending();
    pending = { id, at };
    map.setSelected(id);
    ui.confirmBar.hidden = false;
  };
  updateHud();

  if (duel) {
    ui.rival.hidden = false;
    ui.rivalName.textContent = duel.opponent.name;
    renderRival(duel);
    // On relit l'avancement de l'adversaire toutes les 3 s : s'il joue en même temps, on le voit.
    session.poll = setInterval(async () => {
      if (!session || session.duel !== duel) return;
      try {
        const { duel: fresh } = await get('duels', 'get', { id: duel.id });
        renderRival(fresh);
      } catch {
        /* réseau capricieux : on réessaie au prochain tour */
      }
    }, 3000);
  }
}

function renderRival(duel) {
  const them = duel.them;
  if (them.finished) ui.rivalProgress.textContent = `fini · ${them.score} % en ${formatTime(them.timeMs)}`;
  else if (them.progress > 0) ui.rivalProgress.textContent = `${them.progress} / ${session.game.total}`;
  else ui.rivalProgress.textContent = 'pas commencé';
}

// Envoie mon avancement à l'adversaire, au plus une fois toutes les 2 s.
function sendProgress() {
  const s = session;
  if (!s?.duel || Date.now() - s.lastProgressSent < 2000) return;
  s.lastProgressSent = Date.now();
  post('duels', 'progress', { id: s.duel.id, progress: s.game.index }).catch(() => {});
}

function updateHud() {
  const { game } = session;
  const current = game.current;
  // En mode Drapeaux, on montre le drapeau et on tait le nom (il s'affiche après la réponse).
  ui.promptFlag.hidden = !current?.flag;
  if (current?.flag) ui.promptFlag.src = flagUrl(current.flag);
  ui.promptLabel.textContent = current?.prompt?.label ?? 'Trouve';
  ui.promptName.textContent = current ? (current.flag ? '' : (current.prompt?.text ?? current.name)) : '—';
  ui.progress.textContent = `${game.index} / ${game.total}`;
  ui.errors.textContent = String(game.stats.errors);
  ui.time.textContent = formatTime(game.elapsedMs);
}

function setFeedback(text, kind) {
  ui.feedback.textContent = text;
  ui.feedback.className = `feedback ${kind ?? ''}`;
}

// Ce qu'on vient de cliquer par erreur ; en mode Langues, on en profite pour dire ce qu'on y parle.
function nameOf(id) {
  const name = session?.map.labelOf(id);
  if (!name) return null;
  if (session.mode === 'languages' && LANGUAGES[id]) return `${name} : ${LANGUAGES[id].join(', ')}`;
  if (session.mode === 'currencies' && CURRENCIES[id]) return `${name} : ${CURRENCIES[id]}`;
  return name;
}

// Toutes les zones qu'une cible accepte (une seule pour un pays, plusieurs pour une langue).
const zonesOf = (target) => target.ids ?? [target.id];

// Éclaire brièvement les autres bonnes réponses, puis les rend à leur état d'avant.
function flashOthers(map, ids, state) {
  const untouched = ids.filter((id) => !map.nodes.get(id)?.[0]?.dataset.state);
  for (const id of untouched) map.setState(id, state);
  setTimeout(() => {
    for (const id of untouched) map.setState(id, null);
  }, 1400);
}

let tipTimer = null;
function showTip(text, at) {
  if (!at || !text) return;
  const box = ui.tip.parentElement.getBoundingClientRect();
  ui.tip.textContent = text;
  ui.tip.style.left = `${at.x - box.left}px`;
  ui.tip.style.top = `${at.y - box.top}px`;
  ui.tip.hidden = false;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => {
    ui.tip.hidden = true;
  }, 1600);
}

function confirmPending() {
  if (!pending) return;
  const { id, at } = pending;
  clearPending();
  handleAnswer(id, at);
}

function handleAnswer(id, at) {
  if (!session || session.game.done) return;
  const { game, map } = session;
  const res = game.answer(id);
  // En mode Drapeaux, le nom n'est pas dans la question : on le donne avec la réponse.
  const named = (text) => (res.target?.flag ? `${text} — ${res.target.name}` : text);

  if (res.type === 'correct') {
    map.setState(id, `correct-${res.attempts}`);
    const others = zonesOf(res.target).filter((z) => z !== id);
    if (others.length) {
      flashOthers(map, others, `correct-${res.attempts}`);
      setFeedback(`Exact ! ${res.target.name} : ${others.length + 1} pays, tous en vert`, 'ok');
    } else {
      setFeedback(named(res.attempts === 1 ? 'Exact !' : 'Trouvé'), 'ok');
    }
  } else if (res.type === 'wrong') {
    map.flash(id);
    showTip(nameOf(id), at);
    setFeedback(`Raté, encore ${res.remaining} essai${res.remaining > 1 ? 's' : ''}`, 'ko');
  } else if (res.type === 'failed') {
    map.flash(id);
    showTip(nameOf(id), at);
    for (const z of zonesOf(res.target)) map.setState(z, 'reveal');
    setFeedback(zonesOf(res.target).length > 1 ? 'Raté. Clique sur un des pays qui clignotent' : `Raté. Clique sur ${session.mode === 'flagpick' ? 'le drapeau' : 'la zone'} qui clignote pour continuer`, 'ko');
  } else if (res.type === 'confirmed') {
    for (const z of zonesOf(res.target)) map.setState(z, z === id ? 'failed' : null);
    setFeedback(`C'était ${res.target.name}`, 'ko');
  } else if (res.type === 'ignored') {
    showTip(nameOf(id), at);
    setFeedback(`Clique sur ${session.mode === 'flagpick' ? 'le drapeau' : 'la zone'} qui clignote`, 'ko');
  }

  updateHud();
  if (game.done) finishGame();
  else {
    persistGame();
    if (res.type === 'correct' || res.type === 'confirmed') sendProgress();
  }
}

async function finishGame() {
  const { region, mode, game } = session;
  clearInterval(session.timer);
  clearResume();
  ui.tip.hidden = true;
  ui.promptFlag.hidden = true;
  const stats = game.stats;

  $('results-region').textContent = `${region.name} · ${modeLabel(region, mode)} · ${stats.total} ${unitLabel(region, mode, stats.total)}`;
  $('res-score').textContent = `${stats.score} %`;
  $('res-time').textContent = formatTime(stats.timeMs);
  $('res-errors').textContent = String(stats.errors);

  const list = $('res-missed');
  list.innerHTML = '';
  const colors = { 2: 'var(--state-correct-2)', 3: 'var(--state-correct-3)', failed: 'var(--state-failed)' };
  for (const m of stats.missed) {
    const li = document.createElement('li');
    li.style.setProperty('--dot', m.ok ? colors[m.attempts] : colors.failed);
    li.textContent = m.ok ? `${m.name} (${m.attempts}e essai)` : `${m.name} (non trouvé)`;
    list.appendChild(li);
  }
  $('res-missed-wrap').hidden = stats.missed.length === 0;

  const saved = $('res-saved');
  saved.hidden = true;
  saved.textContent = currentUser() ? 'Partie enregistrée dans tes stats.' : 'Connecte-toi pour garder tes stats sur tous tes appareils.';
  saved.hidden = false;

  let isBest;
  if (session.level) {
    // Un niveau est enregistré à part : ses 7 questions ne doivent pas devenir le record de toute l'Europe.
    isBest = await recordGame(`campaign:${session.level.id}`, mode, stats);
    await showLevelResult(session.level, stats);
  } else if (session.duel) {
    clearInterval(session.poll);
    isBest = await finishDuel(session.duel, stats);
    ui.duelsBtn.hidden = false;
  } else {
    isBest = await recordGame(region.id, mode, stats);
  }
  const best = $('res-best');
  if (stats.missed.length === 0) best.textContent = isBest ? 'Sans faute et nouveau record !' : 'Sans faute !';
  else best.textContent = isBest ? 'Nouveau record sur cette carte !' : '';
  best.hidden = best.textContent === '';

  ui.results.hidden = false;
  $('btn-replay').focus();
}

// Fin d'un niveau de campagne : étoiles, récompenses, niveau suivant.
async function showLevelResult(level, stats) {
  const res = await completeLevel(level, stats);
  const box = ui.levelResult;
  const lines = [];
  if (res.stars === 0) lines.push('Pas encore d’étoile : il faut 70 % du premier coup pour valider le niveau.');
  else if (res.newStars > 0) lines.push(`${res.newStars} nouvelle${res.newStars > 1 ? 's' : ''} étoile${res.newStars > 1 ? 's' : ''} !`);
  else lines.push('Niveau déjà validé, étoiles conservées.');
  if (res.trophies > 0) lines.push(`+${res.trophies} trophées`);
  if (res.chapterDone) lines.push(`Chapitre terminé : badge « ${res.chapter.badge} » débloqué !`);
  box.innerHTML = `<strong>Niveau ${level.number} · ${escapeHtml(level.title)}</strong>${starRow(res.stars)}<span>${escapeHtml(lines.join(' · '))}</span>`;
  box.className = `level-result ${res.stars ? 'is-win' : ''}`;
  box.hidden = false;
  refreshIcons();
  ui.nextBtn.hidden = !(res.next && res.stars > 0);
  if (res.next && res.stars > 0) {
    ui.nextBtn.querySelector('span').textContent = `Niveau suivant : ${res.next.title}`;
    ui.nextBtn.onclick = () => {
      location.hash = `#/campagne/${res.next.id}`;
    };
  }
}

// Fin d'un défi : le serveur enregistre la partie et, si l'autre a fini, désigne le gagnant.
async function finishDuel(duel, stats) {
  const box = ui.duelResult;
  try {
    const { duel: d } = await post('duels', 'finish', { id: duel.id, score: stats.score, timeMs: stats.timeMs, errors: stats.errors, total: stats.total });
    const me = currentUser();
    let text;
    if (d.status === 'finished') {
      const outcome = d.winnerId === null ? 'Égalité parfaite !' : d.winnerId === me?.id ? 'Tu gagnes le défi ! +5 trophées' : `${d.opponent.name} gagne le défi.`;
      const forfeit = d.them.score === 0 && d.them.timeMs === 0;
      text = `${outcome} — ${d.opponent.name} : ${forfeit ? 'a abandonné' : `${d.them.score} % en ${formatTime(d.them.timeMs)}`}.`;
    } else {
      text = `Résultat envoyé. ${d.opponent.name} n'a pas encore joué : le gagnant sera désigné quand il aura fini.`;
    }
    box.innerHTML = `<strong>Défi contre ${escapeHtml(d.opponent.name)}</strong><br>${escapeHtml(text)}`;
    box.className = `duel-result ${d.status === 'finished' && d.winnerId === me?.id ? 'is-win' : ''}`;
  } catch (err) {
    box.textContent = `Défi non enregistré : ${err.message}`;
    box.className = 'duel-result is-error';
  }
  box.hidden = false;
  // Le défi compte aussi comme une partie normale côté records locaux.
  return recordGame(session.region.id, session.mode, stats, { skipServer: true });
}

ui.confirmToggle.addEventListener('change', () => {
  confirmMode = ui.confirmToggle.checked;
  setConfirmMode(confirmMode);
  if (!confirmMode) clearPending();
});
$('confirm-ok').addEventListener('click', confirmPending);
$('confirm-cancel').addEventListener('click', clearPending);
document.addEventListener('keydown', (e) => {
  if (!pending || $('screen-game').hidden) return;
  if (e.key === 'Enter') confirmPending();
  if (e.key === 'Escape') clearPending();
});

$('btn-quit').addEventListener('click', () => {
  if (session?.duel && !session.game.done && !window.confirm('Quitter le défi ? Tu abandonnes cette manche : ton adversaire pourra la finir et la gagner.')) return;
  clearResume();
  location.hash = session?.duel ? '#/amis' : '#/';
});
$('btn-home').addEventListener('click', () => {
  location.hash = '#/';
});
$('btn-replay').addEventListener('click', () => {
  if (session) startGame(session.region, session.mode, null, session.level);
});
$('btn-duels').addEventListener('click', () => {
  location.hash = '#/amis';
});
$('zoom-in').addEventListener('click', () => session?.map.zoomBy(1.6));
$('zoom-out').addEventListener('click', () => session?.map.zoomBy(1 / 1.6));
$('zoom-reset').addEventListener('click', () => session?.map.resetZoom());
