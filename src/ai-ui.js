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
  else $('ai-quota').textContent = `${st.limit - st.used} génération${st.limit - st.used > 1 ? 's' : ''} restante${st.limit - st.used > 1 ? 's' : ''} aujourd’hui.`;
  $('ai-file').accept = st.pdf ? '.pdf,.pptx,.docx,.txt,.md,application/pdf,text/plain' : '.pptx,.docx,.txt,.md,text/plain';
  $('ai-file-hint').textContent = st.pdf
    ? 'PowerPoint (.pptx), Word (.docx), PDF (12 Mo max), texte. Les anciens .ppt/.doc doivent être enregistrés au format récent.'
    : 'PowerPoint (.pptx), Word (.docx), texte. Ce fournisseur d’IA ne lit pas les PDF : copie-colle leur texte.';
  await fillFolders(folderId);
  refreshIcons();
}

export function initAi() {
  $('ai-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    $('ai-file-label').textContent = 'Lecture…';
    try {
      if (file.name.toLowerCase().endsWith('.pdf') && !status?.pdf) throw new Error('Ce fournisseur d’IA ne lit pas les PDF : colle le texte du cours.');
      const res = await extractCourse(file);
      source = { text: res.text ?? '', pdf: res.pdf ?? null, label: file.name };
      if (res.text !== undefined && !res.text.trim()) throw new Error('Aucun texte trouvé dans ce fichier.');
      $('ai-file-label').textContent = res.pdf ? `${file.name} (PDF, envoyé tel quel)` : `${file.name} — ${res.text.length.toLocaleString('fr-FR')} caractères extraits`;
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
    try {
      const res = await post('ai', 'generate', { text, pdf: source.pdf, title: $('ai-title').value.trim(), count: Number($('ai-count').value) });
      status = { ...status, used: res.used, limit: res.limit };
      generated = res.cards;
      status = { ...status, enabled: true, used: res.used, limit: res.limit };
      $('ai-quota').textContent = `${res.limit - res.used} génération${res.limit - res.used > 1 ? 's' : ''} restante${res.limit - res.used > 1 ? 's' : ''} aujourd’hui.`;
      renderCards();
      $('ai-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      error.textContent = errorText(err, 'Génération impossible.');
      error.hidden = false;
    } finally {
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
