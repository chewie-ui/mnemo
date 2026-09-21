// Logique d'une partie, indépendante de l'affichage.
// On demande les cibles une par une dans un ordre aléatoire ; 3 essais par cible.
// Après 3 échecs, la bonne réponse est révélée et le joueur doit cliquer dessus
// pour passer à la suite : une cible ratée compte pour une seule erreur.

export const MAX_ATTEMPTS = 3;

// Générateur pseudo-aléatoire déterministe (mulberry32) : avec la même graine,
// deux joueurs d'un défi reçoivent exactement le même ordre de questions.
function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, seed) {
  const random = seed ? seeded(seed) : Math.random;
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Game {
  constructor(targets, seed = null) {
    this.queue = shuffle(targets, seed);
    this.index = 0;
    this.attempts = 0; // essais ratés sur la cible courante
    this.revealing = false; // la bonne réponse est affichée, on attend le clic de validation
    this.results = []; // { id, name, attempts, ok }
    this.startedAt = Date.now();
    this.endedAt = null;
  }

  get current() {
    return this.queue[this.index] ?? null;
  }

  get total() {
    return this.queue.length;
  }

  get done() {
    return this.endedAt !== null;
  }

  get elapsedMs() {
    return (this.endedAt ?? Date.now()) - this.startedAt;
  }

  // Retourne ce qui s'est passé pour que l'UI réagisse.
  answer(id) {
    if (this.done) return { type: 'done' };
    const target = this.current;

    // Une cible peut accepter plusieurs zones (une langue → tous ses pays).
    const matches = target.ids ? target.ids.includes(id) : id === target.id;

    if (this.revealing) {
      if (!matches) return { type: 'ignored', target };
      this.results.push({ ...target, attempts: MAX_ATTEMPTS, ok: false });
      this.#advance();
      return { type: 'confirmed', target };
    }

    if (matches) {
      const attempts = this.attempts + 1;
      this.results.push({ ...target, attempts, ok: true });
      this.#advance();
      return { type: 'correct', attempts, target };
    }

    this.attempts += 1;
    if (this.attempts >= MAX_ATTEMPTS) {
      this.revealing = true;
      return { type: 'failed', target };
    }
    return { type: 'wrong', attempts: this.attempts, remaining: MAX_ATTEMPTS - this.attempts, target, clicked: id };
  }

  #advance() {
    this.index += 1;
    this.attempts = 0;
    this.revealing = false;
    if (this.index >= this.queue.length) this.endedAt = Date.now();
  }

  get stats() {
    const total = this.total;
    const firstTry = this.results.filter((r) => r.ok && r.attempts === 1).length;
    const found = this.results.filter((r) => r.ok).length;
    const errors = this.results.filter((r) => !r.ok).length;
    return {
      total,
      firstTry,
      found,
      errors,
      score: total ? Math.round((firstTry / total) * 100) : 0,
      timeMs: this.elapsedMs,
      missed: this.results.filter((r) => !(r.ok && r.attempts === 1)),
    };
  }
}

export function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
