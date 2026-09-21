// Transformer une note de cours en leçon : chaque ligne « terme : définition » devient une carte.
// Aperçu avant création, choix du séparateur, puis on atterrit dans l'éditeur de la leçon.
import { store as deckStore } from './memos.js';
import { $, escapeHtml, refreshIcons, toast, setLoading } from './ui.js';
import { ApiError } from './api.js';

// Séparateurs reconnus, du plus explicite au plus ambigu (le tiret seul est fréquent dans du texte).
const SEPARATORS = {
  auto: null,
  colon: /\s*:\s+/,
  arrow: /\s*(?:=>|->|→|⇒)\s*/,
  dash: /\s+[—–-]\s+/,
  equal: /\s*=\s*/,
  tab: /\t+|\s{2,}/,
};

const clean = (line) =>
  line
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '') // puces et numéros
    .replace(/\*\*|==|`/g, '') // gras, surligné, code
    .trim();

function splitLine(line, sepKey) {
  const text = clean(line);
  if (!text || /^#/.test(text) || /^>/.test(text) || /^-{3,}$/.test(text)) return null;
  const order = sepKey === 'auto' ? ['colon', 'arrow', 'dash', 'equal', 'tab'] : [sepKey];
  for (const key of order) {
    const re = SEPARATORS[key];
    const m = re.exec(text);
    if (!m || m.index === 0) continue;
    const front = text.slice(0, m.index).trim();
    const back = text.slice(m.index + m[0].length).trim();
    if (front && back && front.length <= 200) return { front, back };
  }
  return null;
}

// Cartes détectées dans le corps d'une note.
export function extractCards(body, sepKey = 'auto') {
  const cards = [];
  const seen = new Set();
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const card = splitLine(line, sepKey);
    if (!card) continue;
    const k = card.front.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    cards.push(card);
  }
  return cards;
}

let current = null; // { note }

function renderPreview() {
  const sep = $('n2d-sep').value;
  const cards = extractCards(current.note.body, sep);
  $('n2d-count').textContent = cards.length
    ? `${cards.length} carte${cards.length > 1 ? 's' : ''} détectée${cards.length > 1 ? 's' : ''}`
    : 'Aucune carte détectée';
  $('n2d-preview').innerHTML = cards.length
    ? cards.slice(0, 8).map((c) => `<li><strong>${escapeHtml(c.front)}</strong><span>${escapeHtml(c.back)}</span></li>`).join('') + (cards.length > 8 ? `<li class="muted">… et ${cards.length - 8} de plus</li>` : '')
    : '<li class="muted">Écris chaque notion sur une ligne, sous la forme « terme : définition » (ou « terme — définition », « question ? => réponse »).</li>';
  $('n2d-submit').disabled = cards.length === 0;
  return cards;
}

export function openNoteToDeck(note) {
  current = { note };
  $('n2d-title').value = note.title;
  $('n2d-sep').value = 'auto';
  $('n2d-error').hidden = true;
  renderPreview();
  $('n2d-modal').hidden = false;
  refreshIcons();
  $('n2d-title').focus();
}

function close() {
  $('n2d-modal').hidden = true;
  current = null;
}

export function initNoteToDeck() {
  $('n2d-sep').addEventListener('change', renderPreview);
  $('n2d-cancel').addEventListener('click', close);
  $('n2d-modal').addEventListener('click', (e) => {
    if (e.target === $('n2d-modal')) close();
  });
  $('n2d-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!current) return;
    const error = $('n2d-error');
    const title = $('n2d-title').value.trim();
    const cards = extractCards(current.note.body, $('n2d-sep').value);
    if (!title) {
      error.textContent = 'Donne un titre à la leçon.';
      error.hidden = false;
      return;
    }
    if (!cards.length) return;
    error.hidden = true;
    setLoading($('n2d-submit'), true);
    try {
      const deck = await deckStore().save({
        title,
        description: `Créée à partir de la note « ${current.note.title} »`,
        folderId: current.note.folderId ?? null,
        cards,
      });
      close();
      toast(`Leçon créée avec ${cards.length} carte${cards.length > 1 ? 's' : ''}. Vérifie-la et ajuste si besoin.`);
      location.hash = `#/memos/${deck.id}`;
    } catch (err) {
      error.textContent = err instanceof ApiError || err instanceof Error ? err.message : 'Création impossible.';
      error.hidden = false;
    } finally {
      setLoading($('n2d-submit'), false);
    }
  });
}
