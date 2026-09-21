// Mode campagne : progression, page des chapitres, lancement d'un niveau.
import { CHAPTERS, LEVELS, levelById, starsFor, STAR_TROPHIES, CHAPTER_TROPHIES } from './data/campaign.js';
import { regionById, targetsFor, modeLabel } from './data/regions.js';
import { get, post } from './api.js';
import { currentUser } from './auth.js';
import { $, escapeHtml, refreshIcons, toast, showScreen } from './ui.js';

// ─── Progression : locale toujours, serveur en plus quand on est connecté ───
const LOCAL_KEY = 'mnemo:campaign';
let progress = {}; // levelId -> { stars, score, timeMs }

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY)) ?? {};
  } catch {
    return {};
  }
}

function writeLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(progress));
  } catch {
    /* stockage indisponible */
  }
}

const better = (a, b) => !b || a.stars > b.stars || (a.stars === b.stars && (a.score > b.score || (a.score === b.score && a.timeMs < b.timeMs)));

export async function loadProgress() {
  progress = readLocal();
  if (!currentUser()) return progress;
  try {
    const { progress: remote } = await get('campaign', 'list');
    for (const [id, entry] of Object.entries(remote)) if (better(entry, progress[id])) progress[id] = entry;
    writeLocal();
  } catch {
    /* on garde le local */
  }
  return progress;
}

export const levelProgress = (id) => progress[id] ?? null;

// Un niveau est ouvert si c'est le premier de son chapitre ou si le précédent a au moins une étoile.
export function isUnlocked(level) {
  if (level.number === 1) return true;
  const prev = LEVELS.find((l) => l.chapter === level.chapter && l.number === level.number - 1);
  if ((progress[prev.id]?.stars ?? 0) > 0) return true;
  // Niveau déjà réussi, ou un niveau plus loin dans le chapitre l'est : on ne referme pas la porte.
  return LEVELS.some((l) => l.chapter === level.chapter && l.number >= level.number && (progress[l.id]?.stars ?? 0) > 0);
}

export function chapterStats(chapter) {
  const stars = chapter.levels.reduce((n, l) => n + (progress[l.id]?.stars ?? 0), 0);
  const done = chapter.levels.filter((l) => (progress[l.id]?.stars ?? 0) > 0).length;
  return { stars, max: chapter.levels.length * 3, done, total: chapter.levels.length, complete: done === chapter.levels.length };
}

// Cibles d'un niveau : le sous-ensemble demandé, dans l'ordre de la carte.
export function levelTargets(level) {
  const region = regionById(level.region);
  const all = targetsFor(region, level.mode);
  if (level.targets) {
    const keep = new Set(level.targets);
    return all.filter((t) => keep.has(t.id));
  }
  if (level.countries) {
    const keep = new Set(level.countries.map((c) => (level.mode === 'capitals' ? `cap:${c}` : c)));
    return all.filter((t) => keep.has(t.id));
  }
  return all;
}

// Fin d'un niveau : étoiles, sauvegarde, récompenses. Retourne de quoi afficher.
export async function completeLevel(level, stats) {
  const stars = starsFor(stats);
  const entry = { stars, score: stats.score, timeMs: stats.timeMs };
  const prev = progress[level.id] ?? null;
  const chapter = CHAPTERS.find((c) => c.id === level.chapter);
  const wasComplete = chapterStats(chapter).complete;
  if (better(entry, prev)) progress[level.id] = { ...entry, stars: Math.max(stars, prev?.stars ?? 0) };
  writeLocal();
  const newStars = Math.max(0, stars - (prev?.stars ?? 0));
  const chapterDone = !wasComplete && chapterStats(chapter).complete;
  let trophies = newStars * STAR_TROPHIES + (chapterDone ? CHAPTER_TROPHIES : 0);
  if (currentUser()) {
    try {
      const res = await post('campaign', 'save', { levelId: level.id, stars, score: stats.score, timeMs: stats.timeMs, chapterLevels: chapter.levels.map((l) => l.id) });
      trophies = res.trophies;
    } catch (err) {
      console.warn('Progression non enregistrée sur le serveur :', err.message);
    }
  }
  const next = LEVELS.find((l) => l.chapter === level.chapter && l.number === level.number + 1) ?? null;
  return { stars, newStars, trophies, chapterDone, chapter, next };
}

// ─── Page ───
const starRow = (n, max = 3) =>
  `<span class="stars" aria-label="${n} étoile${n > 1 ? 's' : ''} sur ${max}">${Array.from({ length: max }, (_, i) => `<i data-lucide="star" class="${i < n ? 'is-on' : ''}" aria-hidden="true"></i>`).join('')}</span>`;

export async function renderCampaign() {
  showScreen('campaign');
  const body = $('campaign-body');
  body.innerHTML = '<p class="note">Chargement…</p>';
  await loadProgress();
  const totalStars = LEVELS.reduce((n, l) => n + (progress[l.id]?.stars ?? 0), 0);
  const badges = CHAPTERS.filter((c) => chapterStats(c).complete);

  body.innerHTML = `
    <div class="stat-row stat-row-2">
      <div class="stat"><span class="stat-value stars-total"><i data-lucide="star" class="is-on" aria-hidden="true"></i>${totalStars}</span><span class="stat-label">étoiles sur ${LEVELS.length * 3}</span></div>
      <div class="stat"><span class="stat-value">${badges.length}</span><span class="stat-label">badge${badges.length > 1 ? 's' : ''} sur ${CHAPTERS.length}</span></div>
    </div>
    ${!currentUser() ? '<p class="note">Ta progression est gardée dans ce navigateur. Connecte-toi pour la retrouver partout et gagner des trophées.</p>' : ''}
    ${badges.length ? `<p class="badges">${badges.map((c) => `<span class="badge-pill"><i data-lucide="award" aria-hidden="true"></i>${escapeHtml(c.badge)}</span>`).join('')}</p>` : ''}
    ${CHAPTERS.map((chapter) => {
      const cs = chapterStats(chapter);
      return `
        <section class="chapter ${cs.complete ? 'is-complete' : ''}">
          <div class="chapter-head">
            <div>
              <h2>${escapeHtml(chapter.title)}</h2>
              <p class="muted">${escapeHtml(chapter.subtitle)}</p>
            </div>
            <div class="chapter-progress">
              <span class="trophy"><i data-lucide="star" class="is-on" aria-hidden="true"></i>${cs.stars} / ${cs.max}</span>
              ${cs.complete ? `<span class="badge-pill"><i data-lucide="award" aria-hidden="true"></i>${escapeHtml(chapter.badge)}</span>` : `<span class="muted small">${cs.done} / ${cs.total} niveaux</span>`}
            </div>
          </div>
          <ol class="levels">
            ${chapter.levels.map((l, i) => {
              const level = LEVELS.find((x) => x.id === l.id);
              const p = progress[l.id];
              const unlocked = isUnlocked(level);
              const region = regionById(l.region);
              const count = levelTargets(level).length;
              return `<li class="level ${unlocked ? '' : 'is-locked'} ${l.boss ? 'is-boss' : ''} ${p?.stars ? 'is-done' : ''}">
                <span class="level-number">${unlocked ? i + 1 : '<i data-lucide="lock" aria-hidden="true"></i>'}</span>
                <div class="level-text">
                  <strong>${escapeHtml(l.title)}</strong>
                  <span class="muted small">${escapeHtml(region.name)} · ${escapeHtml(modeLabel(region, l.mode))} · ${count} question${count > 1 ? 's' : ''}${l.boss ? ' · niveau final' : ''}</span>
                </div>
                ${starRow(p?.stars ?? 0)}
                ${unlocked ? `<a class="btn ${p?.stars ? 'btn-ghost' : 'btn-primary'} level-play" href="#/campagne/${l.id}"><i data-lucide="${p?.stars ? 'rotate-ccw' : 'play'}" aria-hidden="true"></i><span>${p?.stars ? 'Rejouer' : 'Jouer'}</span></a>` : '<span class="muted small level-play">Termine le niveau précédent</span>'}
              </li>`;
            }).join('')}
          </ol>
        </section>`;
    }).join('')}`;
  refreshIcons();
}

export function nextLevelId(level) {
  return LEVELS.find((l) => l.chapter === level.chapter && l.number === level.number + 1)?.id ?? null;
}

export { levelById, starRow };
