// Écran « Leçon avec l'IA » : un cours (texte collé ou fichier) → des cartes de quiz proposées,
// qu'on relit puis qu'on enregistre comme leçon. Et l'aide dans l'éditeur : compléter une carte.
import { get, post, ApiError } from './api.js';
import { currentUser } from './auth.js';
import { store as deckStore } from './memos.js';
import { library, flattenFolders } from './library.js';
import { folderHash } from './library-ui.js';
import { extractCourse } from './docs-extract.js';
import { $, escapeHtml, refreshIcons, toast, setLoading } from './ui.js';

const errorText = (err, fallback) => (err instanceof ApiError || err instanceof Error ? err.message : fallback);

let status = null; // { enabled, used, limit } (mis en cache le temps de la session)

export async function aiStatus(force = false) {
  if (!currentUser()) return { enabled: false };
  if (status && !force) return status;
  try {
    status = await get('ai', 'status');
  } catch {
    status = { enabled: false };
  }
  return status;
}

export const aiSuggest = (front, back, title) => post('ai', 'suggest', { front, back, title });
// Plusieurs cartes d'un coup : un seul appel, donc une seule unité de quota.
export const aiSuggestMany = (cards, title) => post('ai', 'suggest', { cards, title });

// Découpe un long cours en parties d'au plus `max` caractères, remplies au maximum et coupées
// entre deux lignes (une ligne trop longue l'est entre deux phrases) : une IA lente traite ainsi
// chaque partie dans le temps imparti, avec le moins de parties possible.
export function splitCourse(text, max) {
  const pieces = [];
  for (const line of text.trim().split('\n')) {
    if (line.length <= max) pieces.push(line);
    else for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      for (let i = 0; i < sentence.length; i += max) pieces.push(sentence.slice(i, i + max));
    }
  }
  const parts = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + 1 + piece.length > max) {
      parts.push(current.trim());
      current = '';
    }
    current = current ? `${current}\n${piece}` : piece;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// IA lente (auto-hébergée) : questions visées par partie, et plafond pour tenir dans le temps imparti.
const PER_PART = 15;
const MAX_PER_PART = 20;

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const quotaText = (st) => `${st.limit - st.used} génération${st.limit - st.used > 1 ? 's' : ''} restante${st.limit - st.used > 1 ? 's' : ''} aujourd’hui.`;

// ─── Écran de génération ───
let source = { text: '', pdf: null, label: '' };
let generated = []; // cartes proposées
let targetFolder = null;

function renderCards() {
  const list = $('ai-cards');
  const wrap = $('ai-result');
  wrap.hidden = generated.length === 0;
  $('ai-count-label').textContent = `${generated.length} carte${generated.length > 1 ? 's' : ''} proposée${generated.length > 1 ? 's' : ''} — retire celles qui ne te plaisent pas, tu pourras tout retoucher ensuite.`;
  list.innerHTML = generated.map((c, i) => `
    <li class="ai-card">
      <div class="ai-card-text">
        <strong>${escapeHtml(c.front)}</strong>
        <span class="ai-answer"><i data-lucide="check" aria-hidden="true"></i>${escapeHtml(c.back)}</span>
        ${c.wrong.length ? `<span class="ai-wrong muted small">QCM : ${c.wrong.map(escapeHtml).join(' · ')}</span>` : ''}
      </div>
      <button class="btn btn-icon btn-icon-plain" type="button" aria-label="Retirer cette carte" data-remove="${i}"><i data-lucide="x" aria-hidden="true"></i></button>
    </li>`).join('');
  refreshIcons();
}

async function fillFolders(selected) {
  let folders = [];
  try {
    folders = (await library().tree()).folders;
  } catch {
    folders = [];
  }
  const select = $('ai-folder');
  select.innerHTML = `<option value="">Mes cours (racine)</option>${flattenFolders(folders).map((f) => `<option value="${escapeHtml(String(f.id))}">${'  '.repeat(f.depth)}${escapeHtml(f.name)}</option>`).join('')}`;
  select.value = selected == null ? '' : String(selected);
  return folders;
}

export async function renderAiScreen(folderId = null) {
  targetFolder = folderId;
  generated = [];
  source = { text: '', pdf: null, label: '' };
  $('ai-form').reset();
  $('ai-file-label').textContent = 'Aucun fichier';
  $('ai-error').hidden = true;
  $('ai-result').hidden = true;
  $('ai-back').href = folderHash(folderId);
  const st = await aiStatus(true);
  $('ai-unavailable').hidden = st.enabled;
  $('ai-form').hidden = !st.enabled;
  if (!currentUser()) $('ai-unavailable').textContent = 'Connecte-toi pour utiliser la génération par IA.';
  else if (!st.enabled) $('ai-unavailable').textContent = 'L’IA n’est pas configurée sur ce serveur : ajoute une clé d’API (par ex. GEMINI_API_KEY) dans le .env de l’API.';
  else $('ai-quota').textContent = quotaText(st);
  // Le texte des PDF est extrait dans le navigateur : toutes les IA s'en servent. Seuls les PDF
  // scannés (sans texte) demandent une IA qui lit les PDF.
  $('ai-file').accept = '.pdf,.pptx,.docx,.txt,.md,application/pdf,text/plain';
  $('ai-file-hint').textContent = st.pdf
    ? 'PowerPoint (.pptx), Word (.docx), PDF, texte. Les anciens .ppt/.doc doivent être enregistrés au format récent.'
    : 'PowerPoint (.pptx), Word (.docx), PDF avec du texte (pas les PDF scannés), texte. Les anciens .ppt/.doc doivent être enregistrés au format récent.';
  await fillFolders(folderId);
  refreshIcons();
}

export function initAi() {
  $('ai-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    $('ai-file-label').textContent = 'Lecture…';
    try {
      const res = await extractCourse(file, { pdfFallback: Boolean(status?.pdf) });
      source = { text: res.text ?? '', pdf: res.pdf ?? null, label: file.name };
      if (res.text !== undefined && !res.text.trim()) throw new Error('Aucun texte trouvé dans ce fichier.');
      $('ai-file-label').textContent = res.pdf ? `${file.name} (PDF scanné, envoyé tel quel)` : `${file.name} — ${res.text.length.toLocaleString('fr-FR')} caractères extraits`;
      if (res.text && !$('ai-text').value.trim()) $('ai-text').placeholder = 'Le texte du fichier sera utilisé. Tu peux aussi coller ici des compléments.';
    } catch (err) {
      source = { text: '', pdf: null, label: '' };
      $('ai-file-label').textContent = 'Aucun fichier';
      e.target.value = '';
      toast(errorText(err, 'Fichier illisible.'));
    }
  });

  $('ai-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('ai-error');
    const pasted = $('ai-text').value.trim();
    const text = [source.text, pasted].filter(Boolean).join('\n\n');
    if (!text && !source.pdf) {
      error.textContent = 'Colle ton cours ou choisis un fichier.';
      error.hidden = false;
      return;
    }
    error.hidden = true;
    const btn = $('ai-generate');
    setLoading(btn, true);
    $('ai-progress').hidden = false;
    const title = $('ai-title').value.trim();
    const count = Number($('ai-count').value);
    const progress = $('ai-progress-text');
    const progressDefault = progress.textContent;
    // IA lente : une partie du cours après l'autre, le nombre de questions réparti selon la longueur.
    // On découpe quand le cours est long, ou quand on demande beaucoup de questions (une IA lente
    // n'en rédige qu'une quinzaine dans le temps imparti), sans descendre sous ~1500 caractères par
    // partie pour qu'elle ait encore de quoi poser des questions.
    let parts = [text];
    if (!source.pdf && status?.chunk) {
      const wanted = Math.max(Math.ceil(text.length / status.chunk), Math.min(Math.ceil(count / PER_PART), Math.floor(text.length / 1500)));
      if (wanted > 1) parts = splitCourse(text, Math.min(status.chunk, Math.ceil(text.length / wanted) + 200));
    }
    generated = [];
    let failed = null;
    try {
      for (const [i, part] of parts.entries()) {
        if (parts.length > 1) {
          const left = Math.ceil((parts.length - i) * 2.5);
          progress.textContent = `Génération en plusieurs fois : partie ${i + 1} sur ${parts.length}, ${plural(generated.length, 'carte')} pour l’instant… (encore ~${left} minutes, garde cette page ouverte)`;
        }
        const n = parts.length > 1 ? Math.min(MAX_PER_PART, Math.max(3, Math.round((count * part.length) / text.length))) : status?.chunk ? Math.min(MAX_PER_PART, count) : count;
        try {
          const res = await post('ai', 'generate', { text: part, pdf: parts.length > 1 ? null : source.pdf, title: parts.length > 1 ? `${title || source.label} (partie ${i + 1}/${parts.length})` : title, count: n });
          status = { ...status, enabled: true, used: res.used, limit: res.limit };
          $('ai-quota').textContent = quotaText(status);
          const seen = new Set(generated.map((c) => c.front.toLowerCase()));
          generated.push(...res.cards.filter((c) => !seen.has(c.front.toLowerCase())));
          if (parts.length > 1) renderCards();
        } catch (err) {
          // Une partie ratée : on garde les cartes déjà obtenues.
          failed = err;
          if (!generated.length || (err instanceof ApiError && err.status === 429)) break;
        }
      }
      if (failed) {
        error.textContent = generated.length
          ? `Une partie du cours n’a pas pu être traitée (${errorText(failed, 'erreur')}) : voici les cartes obtenues pour le reste.`
          : errorText(failed, 'Génération impossible.');
        error.hidden = false;
      }
      if (generated.length) {
        renderCards();
        $('ai-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } finally {
      progress.textContent = progressDefault;
      setLoading(btn, false);
      $('ai-progress').hidden = true;
    }
  });

  $('ai-cards').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    generated.splice(Number(btn.dataset.remove), 1);
    renderCards();
  });

  $('ai-save').addEventListener('click', async (e) => {
    if (!generated.length) return;
    const title = $('ai-title').value.trim() || source.label.replace(/\.[^.]+$/, '') || 'Quiz généré';
    const v = $('ai-folder').value;
    const folderId = v === '' ? null : (Number.isNaN(Number(v)) ? v : Number(v));
    setLoading(e.currentTarget, true);
    try {
      const deck = await deckStore().save({ title, description: 'Quiz généré par l’IA — relis les cartes avant de réviser.', folderId, cards: generated });
      toast(`Leçon créée avec ${generated.length} cartes.`);
      location.hash = `#/memos/${deck.id}`;
    } catch (err) {
      toast(errorText(err, 'Enregistrement impossible.'));
    } finally {
      setLoading(e.currentTarget, false);
    }
  });
}
