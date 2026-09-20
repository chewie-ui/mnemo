// Écrans des mémos : liste des leçons, éditeur, révision (cartes) et quiz (QCM).
import { store, isDue, schedule, previewInterval, GRADES, SAMPLE_DECK, hasLocalDecks, cleanWrong, quizReady } from './memos.js';
import { currentUser } from './auth.js';
import { ApiError } from './api.js';
import { $, refreshIcons, escapeHtml, toast, setLoading } from './ui.js';

const errorText = (err, fallback) => (err instanceof ApiError || err instanceof Error ? err.message : fallback);

// ─── Liste ───
export async function renderMemosList() {
  const list = $('memos-list');
  const empty = $('memos-empty');
  const note = $('memos-note');
  note.hidden = Boolean(currentUser());
  note.textContent = 'Sans compte, tes leçons restent dans ce navigateur. Connecte-toi pour les retrouver partout.';
  list.innerHTML = '<p class="note">Chargement…</p>';
  let decks;
  try {
    decks = await store().list();
  } catch (err) {
    list.innerHTML = `<p class="form-error">${escapeHtml(errorText(err, 'Impossible de charger tes leçons.'))}</p>`;
    return;
  }
  list.innerHTML = '';
  empty.hidden = decks.length > 0;
  for (const deck of decks) {
    const card = document.createElement('article');
    card.className = 'region-card deck-card';
    card.setAttribute('role', 'listitem');
    card.innerHTML = `
      <h3 class="name">${escapeHtml(deck.title)}</h3>
      ${deck.description ? `<p class="desc">${escapeHtml(deck.description)}</p>` : ''}
      <p class="deck-meta"><span>${deck.cards} carte${deck.cards > 1 ? 's' : ''}${deck.qcm ? ` · ${deck.qcm} QCM` : ''}</span>${deck.due ? `<span class="due">${deck.due} à réviser</span>` : '<span>Rien à réviser pour l’instant</span>'}</p>
      <div class="actions">
        <a class="btn btn-primary" href="#/study/${deck.id}"><i data-lucide="book-open" aria-hidden="true"></i><span>Réviser</span></a>
        <a class="btn btn-ghost" href="#/quiz/${deck.id}" ${quizReady(deck) ? '' : 'aria-disabled="true" title="Il faut au moins 4 cartes, ou des mauvaises réponses sur chaque carte, pour un quiz"'}><i data-lucide="list-checks" aria-hidden="true"></i><span>Quiz</span></a>
        <a class="btn btn-ghost" href="#/memos/${deck.id}"><i data-lucide="pencil" aria-hidden="true"></i><span>Modifier</span></a>
      </div>`;
    list.appendChild(card);
  }
  refreshIcons();
}

$('memos-sample').addEventListener('click', async (e) => {
  setLoading(e.currentTarget, true);
  try {
    await store().save(SAMPLE_DECK);
    await renderMemosList();
  } catch (err) {
    toast(errorText(err, 'Impossible d’ajouter la leçon.'));
  } finally {
    setLoading(e.currentTarget, false);
  }
});

// ─── Éditeur ───
let editing = null; // { id } ou null pour une nouvelle leçon

export async function renderDeckEditor(id) {
  const form = $('deck-form');
  const rows = $('deck-cards');
  const error = $('deck-error');
  error.hidden = true;
  rows.innerHTML = '';
  $('deck-delete').hidden = true;
  form.reset();

  if (id === 'new') {
    editing = null;
    $('deck-heading').textContent = 'Nouvelle leçon';
    for (let i = 0; i < 3; i++) addCardRow();
  } else {
    let deck;
    try {
      deck = await store().get(id);
    } catch (err) {
      toast(errorText(err, 'Leçon introuvable.'));
      location.hash = '#/memos';
      return;
    }
    editing = { id: deck.id };
    $('deck-heading').textContent = deck.title;
    $('deck-title').value = deck.title;
    $('deck-description').value = deck.description ?? '';
    for (const card of deck.cards) addCardRow(card);
    if (deck.cards.length === 0) addCardRow();
    $('deck-delete').hidden = false;
  }
  updateCount();
  refreshIcons();
  $('deck-title').focus();
}

function addCardRow(card = {}) {
  const rows = $('deck-cards');
  const row = document.createElement('div');
  row.className = 'card-row';
  row.dataset.id = card.id ?? '';
  row.innerHTML = `
    <span class="index" aria-hidden="true"></span>
    <input type="text" class="front-input" maxlength="2000" placeholder="Question ou terme" aria-label="Question" />
    <input type="text" class="back-input" maxlength="2000" placeholder="Réponse ou définition" aria-label="Réponse" />
    <button type="button" class="btn btn-icon btn-icon-plain remove" aria-label="Supprimer cette carte"><i data-lucide="trash-2" aria-hidden="true"></i></button>
    <div class="card-extra">
      <button type="button" class="btn btn-ghost btn-sm toggle-wrong" aria-expanded="false"><i data-lucide="list-checks" aria-hidden="true"></i><span>Mauvaises réponses (QCM)</span><span class="wrong-count"></span></button>
      <div class="wrong-box" hidden>
        <p class="note small">Propositions fausses affichées dans le quiz à côté de la bonne réponse. Sans elles, le quiz pioche dans les réponses des autres cartes.</p>
        <div class="wrong-rows"></div>
        <button type="button" class="btn btn-ghost btn-sm add-wrong"><i data-lucide="plus" aria-hidden="true"></i><span>Ajouter une mauvaise réponse</span></button>
      </div>
    </div>`;
  row.querySelector('.front-input').value = card.front ?? '';
  row.querySelector('.back-input').value = card.back ?? '';
  const wrongBox = row.querySelector('.wrong-box');
  const wrongRows = row.querySelector('.wrong-rows');
  const toggle = row.querySelector('.toggle-wrong');
  const addWrong = (value = '') => {
    if (wrongRows.children.length >= 5) return;
    const line = document.createElement('div');
    line.className = 'wrong-row';
    line.innerHTML = `
      <input type="text" class="wrong-input" maxlength="500" placeholder="Mauvaise réponse" aria-label="Mauvaise réponse" />
      <button type="button" class="btn btn-icon btn-icon-plain remove-wrong" aria-label="Retirer cette mauvaise réponse"><i data-lucide="x" aria-hidden="true"></i></button>`;
    line.querySelector('.wrong-input').value = value;
    line.querySelector('.remove-wrong').addEventListener('click', () => {
      line.remove();
      updateCount();
    });
    // Entrée : mauvaise réponse suivante (créée si besoin), comme pour les cartes.
    line.querySelector('.wrong-input').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (line === wrongRows.lastElementChild && wrongRows.children.length < 5) {
        addWrong();
        refreshIcons();
      }
      line.nextElementSibling?.querySelector('.wrong-input').focus();
    });
    wrongRows.appendChild(line);
    row.querySelector('.add-wrong').hidden = wrongRows.children.length >= 5;
  };
  for (const w of card.wrong ?? []) addWrong(w);
  toggle.addEventListener('click', () => {
    const open = wrongBox.hidden;
    wrongBox.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open && !wrongRows.children.length) addWrong();
    refreshIcons();
    if (open) wrongRows.lastElementChild?.querySelector('.wrong-input').focus();
  });
  row.querySelector('.add-wrong').addEventListener('click', () => {
    addWrong();
    refreshIcons();
    wrongRows.lastElementChild.querySelector('.wrong-input').focus();
  });
  row.querySelector('.remove').addEventListener('click', () => {
    row.remove();
    if (!rows.children.length) addCardRow();
    updateCount();
  });
  // Entrée dans la dernière réponse : nouvelle carte, comme dans un tableur.
  row.querySelector('.back-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && row === rows.lastElementChild) {
      e.preventDefault();
      addCardRow();
      refreshIcons();
      rows.lastElementChild.querySelector('.front-input').focus();
    }
  });
  rows.appendChild(row);
  updateCount();
}

function updateCount() {
  const rows = [...$('deck-cards').children];
  rows.forEach((row, i) => {
    row.querySelector('.index').textContent = String(i + 1);
    const n = [...row.querySelectorAll('.wrong-input')].filter((w) => w.value.trim()).length;
    row.querySelector('.wrong-count').textContent = n ? `(${n})` : '';
    row.querySelector('.add-wrong').hidden = row.querySelectorAll('.wrong-row').length >= 5;
  });
  const filled = rows.filter((r) => r.querySelector('.front-input').value.trim() && r.querySelector('.back-input').value.trim()).length;
  $('deck-count').textContent = filled ? `(${filled})` : '';
}

function readForm() {
  const cards = [...$('deck-cards').children].map((row) => ({
    id: row.dataset.id || undefined,
    front: row.querySelector('.front-input').value,
    back: row.querySelector('.back-input').value,
    wrong: cleanWrong([...row.querySelectorAll('.wrong-input')].map((w) => w.value), row.querySelector('.back-input').value.trim()),
  }));
  return { id: editing?.id, title: $('deck-title').value, description: $('deck-description').value, cards };
}

$('deck-add').addEventListener('click', () => {
  addCardRow();
  refreshIcons();
  $('deck-cards').lastElementChild.querySelector('.front-input').focus();
});
$('deck-cards').addEventListener('input', updateCount);

$('deck-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('deck-error');
  const data = readForm();
  const valid = data.cards.filter((c) => c.front.trim() && c.back.trim());
  if (!data.title.trim()) {
    error.textContent = 'Donne un titre à la leçon.';
    error.hidden = false;
    $('deck-title').focus();
    return;
  }
  if (valid.length === 0) {
    error.textContent = 'Ajoute au moins une carte complète (question et réponse).';
    error.hidden = false;
    return;
  }
  error.hidden = true;
  setLoading($('deck-save'), true);
  try {
    await store().save({ ...data, cards: valid });
    toast('Leçon enregistrée.');
    location.hash = '#/memos';
  } catch (err) {
    error.textContent = errorText(err, 'Enregistrement impossible.');
    error.hidden = false;
  } finally {
    setLoading($('deck-save'), false);
  }
});

$('deck-delete').addEventListener('click', async (e) => {
  if (!editing) return;
  if (!window.confirm('Supprimer cette leçon et toutes ses cartes ?')) return;
  setLoading(e.currentTarget, true);
  try {
    await store().remove(editing.id);
    toast('Leçon supprimée.');
    location.hash = '#/memos';
  } catch (err) {
    toast(errorText(err, 'Suppression impossible.'));
  } finally {
    setLoading(e.currentTarget, false);
  }
});

// ─── Révision et quiz ───
let studySession = null;

const shuffle = (list) => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export async function renderStudy(id, kind) {
  const body = $('study-body');
  body.innerHTML = '<p class="note">Chargement…</p>';
  $('study-progress').textContent = '';
  let deck;
  try {
    deck = await store().get(id);
  } catch (err) {
    toast(errorText(err, 'Leçon introuvable.'));
    location.hash = '#/memos';
    return;
  }
  $('study-title').textContent = deck.title;
  $('study-back').href = '#/memos';

  if (kind === 'quiz') {
    const summary = { cards: deck.cards.length, qcm: deck.cards.filter((c) => c.wrong?.length).length };
    if (!quizReady(summary)) {
      body.innerHTML = `<div class="empty-state"><h2>Pas encore de quiz</h2><p>Il faut au moins 4 cartes pour proposer des choix, ou des mauvaises réponses sur chaque carte. Cette leçon en a ${deck.cards.length}.</p><div class="hero-actions"><a class="btn btn-primary" href="#/memos/${deck.id}"><i data-lucide="pencil" aria-hidden="true"></i><span>Ajouter des cartes</span></a></div></div>`;
      refreshIcons();
      return;
    }
    studySession = { deck, kind, queue: shuffle(deck.cards), done: 0, total: deck.cards.length, again: 0, good: 0 };
    nextQuiz();
    return;
  }

  // Révision : les cartes dues d'abord ; s'il n'y en a aucune, on propose de tout revoir.
  const due = deck.cards.filter((c) => isDue(c));
  const cards = due.length ? due : deck.cards;
  if (deck.cards.length === 0) {
    body.innerHTML = `<div class="empty-state"><h2>Leçon vide</h2><p>Ajoute des cartes pour pouvoir réviser.</p><div class="hero-actions"><a class="btn btn-primary" href="#/memos/${deck.id}"><i data-lucide="pencil" aria-hidden="true"></i><span>Modifier la leçon</span></a></div></div>`;
    refreshIcons();
    return;
  }
  studySession = { deck, kind: 'study', queue: shuffle(cards), done: 0, total: cards.length, again: 0, good: 0, ahead: due.length === 0 };
  nextCard();
}

function progressText() {
  const s = studySession;
  return `${Math.min(s.done, s.total)} / ${s.total}`;
}

async function grade(card, key) {
  const s = studySession;
  const state = schedule(card, key);
  Object.assign(card, state);
  try {
    await store().review(card.id, state);
  } catch (err) {
    toast(errorText(err, 'Révision non enregistrée.'));
  }
  if (key === 'again') {
    s.again += 1;
    s.queue.push(card); // repasse en fin de session
  } else {
    s.good += 1;
    s.done += 1;
  }
}

function nextCard() {
  const s = studySession;
  const body = $('study-body');
  $('study-progress').textContent = progressText();
  const card = s.queue.shift();
  if (!card) return renderSummary();

  body.innerHTML = `
    ${s.ahead ? '<p class="note">Rien n’était à réviser aujourd’hui : tu revois toute la leçon en avance.</p>' : ''}
    <div class="flashcard">
      <p class="side-label">Question</p>
      <p class="front">${escapeHtml(card.front)}</p>
      <div id="answer" hidden>
        <p class="side-label" style="margin-top:24px">Réponse</p>
        <p class="back">${escapeHtml(card.back)}</p>
      </div>
    </div>
    <div class="study-actions" id="study-actions">
      <button id="reveal" class="btn btn-primary" type="button"><i data-lucide="eye" aria-hidden="true"></i><span>Voir la réponse</span></button>
    </div>`;
  refreshIcons();
  const reveal = $('reveal');
  reveal.focus();
  reveal.addEventListener('click', () => {
    $('answer').hidden = false;
    const actions = $('study-actions');
    actions.innerHTML = GRADES.map(
      (g) => `<button class="btn btn-ghost grade grade-${g.key}" type="button" data-grade="${g.key}"><span>${g.label}</span><small>${previewInterval(card, g.key)}</small></button>`,
    ).join('');
    actions.querySelectorAll('[data-grade]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        actions.querySelectorAll('button').forEach((b) => (b.disabled = true));
        await grade(card, btn.dataset.grade);
        nextCard();
      }),
    );
    actions.querySelector('[data-grade="good"]').focus();
  });
}

function nextQuiz() {
  const s = studySession;
  const body = $('study-body');
  $('study-progress').textContent = progressText();
  const card = s.queue.shift();
  if (!card) return renderSummary();

  // Propositions : les mauvaises réponses de la carte d'abord, complétées par celles des autres cartes jusqu'à 4.
  const wrong = (card.wrong ?? []).map((text, i) => ({ id: `w${i}`, back: text }));
  const taken = new Set([card.back, ...wrong.map((w) => w.back)]);
  const others = [];
  for (const c of shuffle(s.deck.cards)) {
    if (wrong.length + others.length >= 3) break;
    if (c.id === card.id || taken.has(c.back)) continue;
    taken.add(c.back);
    others.push(c);
  }
  const choices = shuffle([card, ...wrong, ...others]);
  body.innerHTML = `
    <div class="flashcard">
      <p class="side-label">Question</p>
      <p class="front">${escapeHtml(card.front)}</p>
    </div>
    <div class="choices" id="choices">
      ${choices.map((c) => `<button class="btn btn-ghost choice" type="button" data-id="${escapeHtml(String(c.id))}">${escapeHtml(c.back)}</button>`).join('')}
    </div>
    <div class="study-actions" id="quiz-next" hidden>
      <button id="quiz-continue" class="btn btn-primary" type="button"><span>Continuer</span></button>
    </div>`;
  const buttons = [...body.querySelectorAll('.choice')];
  buttons[0].focus();
  buttons.forEach((btn) =>
    btn.addEventListener('click', async () => {
      const right = btn.dataset.id === String(card.id);
      buttons.forEach((b) => {
        b.disabled = true;
        if (b.dataset.id === String(card.id)) b.classList.add('is-right');
      });
      if (!right) btn.classList.add('is-wrong');
      // Le quiz nourrit aussi la révision espacée : juste → « correct », faux → « à revoir ».
      const state = schedule(card, right ? 'good' : 'again');
      Object.assign(card, state);
      try {
        await store().review(card.id, state);
      } catch {
        /* pas bloquant */
      }
      if (right) s.good += 1;
      else s.again += 1;
      s.done += 1;
      $('quiz-next').hidden = false;
      const cont = $('quiz-continue');
      cont.focus();
      cont.addEventListener('click', nextQuiz);
    }),
  );
}

function renderSummary() {
  const s = studySession;
  const body = $('study-body');
  $('study-progress').textContent = '';
  const reviewed = s.good + s.again;
  const rate = reviewed ? Math.round((s.good / reviewed) * 100) : 0;
  body.innerHTML = `
    <div class="study-summary">
      <h2>${s.kind === 'quiz' ? 'Quiz terminé' : 'Révision terminée'}</h2>
      <p class="note">${s.kind === 'quiz' ? `${s.good} bonne${s.good > 1 ? 's' : ''} réponse${s.good > 1 ? 's' : ''} sur ${s.total}.` : `${s.total} carte${s.total > 1 ? 's' : ''} revue${s.total > 1 ? 's' : ''}, ${s.again} à retravailler.`}</p>
      <div class="stat-row">
        <div class="stat"><span class="stat-value">${rate} %</span><span class="stat-label">réussite</span></div>
        <div class="stat"><span class="stat-value">${s.good}</span><span class="stat-label">acquis</span></div>
        <div class="stat"><span class="stat-value">${s.again}</span><span class="stat-label">à revoir</span></div>
      </div>
      <div class="hero-actions" style="justify-content:center">
        <a class="btn btn-primary" href="#/memos"><span>Mes mémos</span></a>
        <a class="btn btn-ghost" href="#/study/${s.deck.id}"><i data-lucide="rotate-ccw" aria-hidden="true"></i><span>Recommencer</span></a>
      </div>
    </div>`;
  refreshIcons();
}

export { hasLocalDecks };
