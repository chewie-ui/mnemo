// Mémos : leçons faites de cartes question → réponse, révisées avec un algorithme
// de répétition espacée (SM-2 simplifié). Stockage local si déconnecté, serveur sinon.
import { get, post } from './api.js';
import { currentUser } from './auth.js';

// ─── Répétition espacée ───
export const GRADES = [
  { key: 'again', label: 'À revoir', hint: '10 min' },
  { key: 'hard', label: 'Difficile', hint: null },
  { key: 'good', label: 'Correct', hint: null },
  { key: 'easy', label: 'Facile', hint: null },
];

// Date au format du serveur (UTC, "AAAA-MM-JJ HH:MM:SS"), comparable comme une chaîne.
export function toSql(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export const nowSql = () => toSql(new Date());

export function isDue(card, now = nowSql()) {
  return !card.dueAt || card.dueAt <= now;
}

// Nouvel état d'une carte après une réponse. Retourne aussi l'intervalle lisible.
export function schedule(card, grade, now = new Date()) {
  let { intervalDays = 0, ease = 2.5, reps = 0 } = card;
  let minutes = null;
  if (grade === 'again') {
    reps = 0;
    intervalDays = 0;
    ease = Math.max(1.3, ease - 0.2);
    minutes = 10;
  } else if (grade === 'hard') {
    intervalDays = Math.max(1, intervalDays * 1.2);
    ease = Math.max(1.3, ease - 0.15);
    reps += 1;
  } else if (grade === 'good') {
    intervalDays = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(intervalDays * ease);
    reps += 1;
  } else {
    intervalDays = reps === 0 ? 3 : Math.round(intervalDays * ease * 1.3);
    ease += 0.15;
    reps += 1;
  }
  const due = new Date(now.getTime() + (minutes ? minutes * 60_000 : intervalDays * 86_400_000));
  return { dueAt: toSql(due), intervalDays, ease, reps };
}

// Texte de l'intervalle proposé par un bouton (« 3 j », « 2 sem »…).
export function previewInterval(card, grade) {
  if (grade === 'again') return '10 min';
  const { intervalDays } = schedule(card, grade);
  if (intervalDays < 7) return `${Math.round(intervalDays)} j`;
  if (intervalDays < 60) return `${Math.round(intervalDays / 7)} sem`;
  if (intervalDays < 730) return `${Math.round(intervalDays / 30)} mois`;
  return `${Math.round(intervalDays / 365)} ans`;
}

// ─── Stockage local (déconnecté) ───
const LOCAL_KEY = 'mnemo:decks';

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY)) ?? [];
  } catch {
    return [];
  }
}

function writeLocal(decks) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(decks));
}

const newId = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const localStore = {
  async list() {
    const now = nowSql();
    return readLocal().map((d) => ({
      id: d.id, title: d.title, description: d.description, updatedAt: d.updatedAt,
      cards: d.cards.length, due: d.cards.filter((c) => isDue(c, now)).length,
    }));
  },
  async get(id) {
    const deck = readLocal().find((d) => d.id === id);
    if (!deck) throw new Error('Leçon introuvable.');
    return structuredClone(deck);
  },
  async save(input) {
    const decks = readLocal();
    const existing = decks.find((d) => d.id === input.id);
    const cards = input.cards
      .filter((c) => c.front.trim() && c.back.trim())
      .map((c) => {
        const prev = existing?.cards.find((p) => p.id === c.id);
        return { id: prev?.id ?? newId(), front: c.front.trim(), back: c.back.trim(), dueAt: prev?.dueAt ?? null, intervalDays: prev?.intervalDays ?? 0, ease: prev?.ease ?? 2.5, reps: prev?.reps ?? 0 };
      });
    const deck = { id: existing?.id ?? newId(), title: input.title.trim(), description: (input.description ?? '').trim(), updatedAt: nowSql(), cards };
    const next = existing ? decks.map((d) => (d.id === deck.id ? deck : d)) : [deck, ...decks];
    writeLocal(next);
    return structuredClone(deck);
  },
  async remove(id) {
    writeLocal(readLocal().filter((d) => d.id !== id));
  },
  async review(cardId, state) {
    const decks = readLocal();
    for (const d of decks) {
      const card = d.cards.find((c) => c.id === cardId);
      if (card) Object.assign(card, state);
    }
    writeLocal(decks);
  },
};

// ─── Stockage serveur (connecté) ───
const apiStore = {
  list: async () => (await get('decks', 'list')).decks,
  get: async (id) => (await get('decks', 'get', { id })).deck,
  save: async (deck) => (await post('decks', 'save', deck)).deck,
  remove: (id) => post('decks', 'delete', { id }),
  review: (cardId, state) => post('decks', 'review', { cardId, ...state }),
};

export function store() {
  return currentUser() ? apiStore : localStore;
}

export const hasLocalDecks = () => readLocal().length > 0;

// Leçons de démonstration proposées à la première visite.
export const SAMPLE_DECK = {
  title: 'Exemple — Dates de l’histoire de France',
  description: 'Une leçon pour voir comment ça marche. Modifie-la ou supprime-la.',
  cards: [
    { front: 'Bataille de Marignan', back: '1515' },
    { front: 'Prise de la Bastille', back: '14 juillet 1789' },
    { front: 'Sacre de Napoléon', back: '2 décembre 1804' },
    { front: 'Armistice de la Première Guerre mondiale', back: '11 novembre 1918' },
    { front: 'Droit de vote des femmes en France', back: '1944' },
  ],
};
