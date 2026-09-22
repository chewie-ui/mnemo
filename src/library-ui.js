// Écrans de la bibliothèque : navigation dans les dossiers, cartes de leçons et de notes,
// lecture et édition d'une note, petites fenêtres « nommer » et « déplacer ».
import { library, folderPath, flattenFolders, renderMarkdown } from './library.js';
import { store as deckStore, SAMPLE_DECK, quizReady } from './memos.js';
import { currentUser } from './auth.js';
import { ApiError } from './api.js';
import { $, refreshIcons, escapeHtml, toast, setLoading, formatDate } from './ui.js';
import { openNoteToDeck, initNoteToDeck, extractCards } from './note-to-deck.js';
import { shareApi, openShare, openLeaderboard, initShare } from './share-ui.js';
import { avatarHtml } from './avatar.js';

const errorText = (err, fallback) => (err instanceof ApiError || err instanceof Error ? err.message : fallback);
const same = (a, b) => String(a ?? '') === String(b ?? '');

let tree = null; // { folders, decks, notes } du dernier rendu
let currentFolder = null;
let sharedDecks = []; // leçons reçues d'amis (racine seulement)

export const folderHash = (id) => (id == null ? '#/memos' : `#/memos/f/${id}`);

async function loadTree() {
  tree = await library().tree();
  return tree;
}

// ─── Bibliothèque (racine ou dossier) ───
export async function renderLibrary(folderId = null) {
  currentFolder = folderId;
  const body = $('library-body');
  body.innerHTML = '<p class="note">Chargement…</p>';
  $('memos-note').hidden = Boolean(currentUser());
  $('memos-note').textContent = 'Sans compte, tes cours restent dans ce navigateur. Connecte-toi pour les retrouver partout.';
  try {
    await loadTree();
    sharedDecks = folderId == null && currentUser() ? await shareApi.shared().catch(() => []) : [];
  } catch (err) {
    body.innerHTML = `<p class="form-error">${escapeHtml(errorText(err, 'Impossible de charger tes cours.'))}</p>`;
    return;
  }
  const path = folderPath(tree.folders, folderId);
  if (folderId != null && path.length === 0) {
    toast('Dossier introuvable.');
    location.hash = '#/memos';
    return;
  }
  const here = path[path.length - 1] ?? null;
  $('memos-title').textContent = here ? here.name : 'Mes cours';
  const back = $('memos-back');
  back.href = here ? folderHash(path[path.length - 2]?.id ?? null) : '#/';
  back.querySelector('span').textContent = here ? (path[path.length - 2]?.name ?? 'Mes cours') : 'Accueil';
  $('memos-crumbs').innerHTML = here
    ? `<a href="#/memos">Mes cours</a>${path.map((p, i) => `<i data-lucide="chevron-right" aria-hidden="true"></i>${i === path.length - 1 ? `<span aria-current="page">${escapeHtml(p.name)}</span>` : `<a href="${folderHash(p.id)}">${escapeHtml(p.name)}</a>`}`).join('')}`
    : '';
  $('lib-new-deck').href = folderId == null ? '#/memos/new' : `#/memos/new/${folderId}`;
  $('lib-new-note').href = folderId == null ? '#/notes/new' : `#/notes/new/${folderId}`;

  const folders = tree.folders.filter((f) => same(f.parentId, folderId)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const decks = tree.decks.filter((d) => same(d.folderId, folderId));
  const notes = tree.notes.filter((n) => same(n.folderId, folderId));
  const count = (id) => {
    const inner = tree.folders.filter((f) => same(f.parentId, id)).length;
    const d = tree.decks.filter((x) => same(x.folderId, id)).length;
    const n = tree.notes.filter((x) => same(x.folderId, id)).length;
    return [inner && `${inner} dossier${inner > 1 ? 's' : ''}`, d && `${d} leçon${d > 1 ? 's' : ''}`, n && `${n} note${n > 1 ? 's' : ''}`].filter(Boolean).join(' · ') || 'Vide';
  };

  if (!folders.length && !decks.length && !notes.length && !sharedDecks.length) {
    body.innerHTML = here
      ? `<div class="empty-state"><h2>Dossier vide</h2><p>Ajoute un sous-dossier, une leçon (cartes à réviser) ou une note de cours.</p></div>`
      : `<div class="empty-state">
          <h2>Range tes cours ici</h2>
          <p>Crée un dossier par matière (« Bac 1 marketing », « Droit civil »…), puis mets dedans tes <strong>leçons</strong> — des cartes question → réponse à réviser au bon moment — et tes <strong>notes de cours</strong> pour relire l’essentiel.</p>
          <div class="hero-actions">
            <button class="btn btn-primary" type="button" data-new-folder><i data-lucide="folder-plus" aria-hidden="true"></i><span>Créer mon premier dossier</span></button>
            <button id="memos-sample" class="btn btn-ghost" type="button">Ajouter une leçon d’exemple</button>
          </div>
        </div>`;
    refreshIcons();
    return;
  }

  body.innerHTML = `
    ${folders.length ? `<h2 class="lib-section"><i data-lucide="folder" aria-hidden="true"></i><span>Dossiers</span></h2>
    <div class="lib-grid" role="list">${folders.map((f) => `
      <article class="lib-card lib-folder" role="listitem">
        <a class="lib-main" href="${folderHash(f.id)}"><i data-lucide="folder" aria-hidden="true"></i><span class="lib-text"><strong>${escapeHtml(f.name)}</strong><span class="muted small">${count(f.id)}</span></span></a>
        <button class="btn btn-icon btn-icon-plain lib-menu-btn" type="button" aria-label="Actions pour ${escapeHtml(f.name)}" data-menu="folder:${f.id}"><i data-lucide="ellipsis" aria-hidden="true"></i></button>
      </article>`).join('')}</div>` : ''}
    ${decks.length ? `<h2 class="lib-section"><i data-lucide="book-open" aria-hidden="true"></i><span>Leçons</span></h2>
    <div class="region-grid" role="list">${decks.map((d) => `
      <article class="region-card deck-card" role="listitem">
        <div class="lib-card-head"><h3 class="name">${escapeHtml(d.title)}</h3><button class="btn btn-icon btn-icon-plain lib-menu-btn" type="button" aria-label="Actions pour ${escapeHtml(d.title)}" data-menu="deck:${d.id}"><i data-lucide="ellipsis" aria-hidden="true"></i></button></div>
        ${d.description ? `<p class="desc">${escapeHtml(d.description)}</p>` : ''}
        <p class="deck-meta"><span>${d.cards} carte${d.cards > 1 ? 's' : ''}${d.qcm ? ` · ${d.qcm} QCM` : ''}</span>${d.due ? `<span class="due">${d.due} à réviser</span>` : '<span>Rien à réviser pour l’instant</span>'}${d.sharedWith ? `<span class="shared-pill"><i data-lucide="users" aria-hidden="true"></i>${d.sharedWith} ami${d.sharedWith > 1 ? 's' : ''}</span>` : ''}</p>
        <div class="actions">
          <a class="btn btn-primary" href="#/study/${d.id}"><i data-lucide="book-open" aria-hidden="true"></i><span>Réviser</span></a>
          <a class="btn btn-ghost" href="#/quiz/${d.id}" ${quizReady(d) ? '' : 'aria-disabled="true" title="Il faut au moins 4 cartes, ou des mauvaises réponses sur chaque carte, pour un quiz"'}><i data-lucide="list-checks" aria-hidden="true"></i><span>Quiz</span></a>
          <a class="btn btn-ghost" href="#/memos/${d.id}"><i data-lucide="pencil" aria-hidden="true"></i><span>Modifier</span></a>
        </div>
      </article>`).join('')}</div>` : ''}
    ${sharedDecks.length ? `<h2 class="lib-section"><i data-lucide="users" aria-hidden="true"></i><span>Partagées avec moi</span></h2>
    <div class="region-grid" role="list">${sharedDecks.map((d) => `
      <article class="region-card deck-card lib-shared" role="listitem">
        <div class="lib-card-head"><h3 class="name">${escapeHtml(d.title)}</h3><button class="btn btn-icon btn-icon-plain lib-menu-btn" type="button" aria-label="Actions pour ${escapeHtml(d.title)}" data-menu="shared:${d.id}"><i data-lucide="ellipsis" aria-hidden="true"></i></button></div>
        <p class="deck-meta"><span class="name-with-avatar">${avatarHtml(d.owner, 'sm')}<span>par ${escapeHtml(d.owner.name)}</span></span></p>
        ${d.description ? `<p class="desc">${escapeHtml(d.description)}</p>` : ''}
        <p class="deck-meta"><span>${d.cards} carte${d.cards > 1 ? 's' : ''}${d.qcm ? ` · ${d.qcm} QCM` : ''}</span>${d.due ? `<span class="due">${d.due} à réviser</span>` : '<span>Rien à réviser pour l’instant</span>'}${d.myBest !== null ? `<span class="shared-pill"><i data-lucide="trophy" aria-hidden="true"></i>${d.myBest} %</span>` : ''}</p>
        <div class="actions">
          <a class="btn btn-primary" href="#/study/${d.id}"><i data-lucide="book-open" aria-hidden="true"></i><span>Réviser</span></a>
          <a class="btn btn-ghost" href="#/quiz/${d.id}" ${quizReady(d) ? '' : 'aria-disabled="true" title="Il faut au moins 4 cartes, ou des mauvaises réponses sur chaque carte, pour un quiz"'}><i data-lucide="list-checks" aria-hidden="true"></i><span>Quiz</span></a>
          <button class="btn btn-ghost" type="button" data-rank="${d.id}"><i data-lucide="trophy" aria-hidden="true"></i><span>Classement</span></button>
        </div>
      </article>`).join('')}</div>` : ''}
    ${notes.length ? `<h2 class="lib-section"><i data-lucide="file-text" aria-hidden="true"></i><span>Notes de cours</span></h2>
    <div class="region-grid" role="list">${notes.map((n) => `
      <article class="region-card deck-card lib-note" role="listitem">
        <div class="lib-card-head"><h3 class="name"><a href="#/notes/${n.id}">${escapeHtml(n.title)}</a></h3><button class="btn btn-icon btn-icon-plain lib-menu-btn" type="button" aria-label="Actions pour ${escapeHtml(n.title)}" data-menu="note:${n.id}"><i data-lucide="ellipsis" aria-hidden="true"></i></button></div>
        ${n.excerpt ? `<p class="desc">${escapeHtml(n.excerpt)}</p>` : '<p class="desc muted">Note vide</p>'}
        <p class="deck-meta"><span>Modifiée le ${formatDate(n.updatedAt)}</span></p>
        <div class="actions">
          <a class="btn btn-primary" href="#/notes/${n.id}"><i data-lucide="book-open-text" aria-hidden="true"></i><span>Lire</span></a>
          <a class="btn btn-ghost" href="#/notes/${n.id}/edit"><i data-lucide="pencil" aria-hidden="true"></i><span>Modifier</span></a>
        </div>
      </article>`).join('')}</div>` : ''}`;
  refreshIcons();
}

// ─── Menu d'actions d'un élément (renommer, déplacer, supprimer) ───
const menu = {
  el: null,
  open(anchor, items) {
    this.close();
    const box = document.createElement('div');
    box.className = 'menu lib-menu';
    box.setAttribute('role', 'menu');
    box.innerHTML = items.map((it) => `<button class="menu-item ${it.danger ? 'is-danger' : ''}" role="menuitem" type="button" data-act="${it.act}"><i data-lucide="${it.icon}" aria-hidden="true"></i><span>${it.label}</span></button>`).join('');
    document.body.append(box);
    const r = anchor.getBoundingClientRect();
    const w = 220;
    box.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
    box.style.top = `${r.bottom + 6 + window.scrollY}px`;
    box.hidden = false;
    refreshIcons();
    this.el = box;
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      this.close();
      items.find((it) => it.act === act)?.run();
    });
    box.querySelector('button')?.focus();
  },
  close() {
    this.el?.remove();
    this.el = null;
  },
};
document.addEventListener('click', (e) => {
  if (menu.el && !e.target.closest('.lib-menu, .lib-menu-btn')) menu.close();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') menu.close();
});

// Petites fenêtres : nommer (dossier) et déplacer (vers un dossier).
function askName({ title, value = '', submit }) {
  return new Promise((resolve) => {
    const modal = $('name-modal');
    $('name-modal-title').textContent = title;
    $('name-modal-submit').querySelector('span').textContent = submit;
    const input = $('name-modal-input');
    input.value = value;
    modal.hidden = false;
    input.focus();
    input.select();
    const done = (v) => {
      modal.hidden = true;
      form.onsubmit = null;
      $('name-modal-cancel').onclick = null;
      resolve(v);
    };
    const form = $('name-modal-form');
    form.onsubmit = (e) => {
      e.preventDefault();
      if (input.value.trim()) done(input.value.trim());
    };
    $('name-modal-cancel').onclick = () => done(null);
    modal.onclick = (e) => {
      if (e.target === modal) done(null);
    };
  });
}

function askFolder({ title, current, exclude = null }) {
  return new Promise((resolve) => {
    const modal = $('move-modal');
    $('move-modal-title').textContent = title;
    const select = $('move-modal-select');
    const options = flattenFolders(tree.folders).filter((f) => !exclude || !isDescendant(f.id, exclude));
    select.innerHTML = `<option value="">Mes cours (racine)</option>${options.map((f) => `<option value="${escapeHtml(String(f.id))}">${'  '.repeat(f.depth)}${escapeHtml(f.name)}</option>`).join('')}`;
    select.value = current == null ? '' : String(current);
    if (select.value !== String(current ?? '')) select.value = '';
    modal.hidden = false;
    select.focus();
    const done = (v) => {
      modal.hidden = true;
      form.onsubmit = null;
      resolve(v);
    };
    const form = $('move-modal-form');
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = select.value;
      done({ folderId: v === '' ? null : (tree.folders.find((f) => String(f.id) === v)?.id ?? null) });
    };
    $('move-modal-cancel').onclick = () => done(null);
    modal.onclick = (e) => {
      if (e.target === modal) done(null);
    };
  });
}

function isDescendant(candidate, folderId) {
  let cur = candidate;
  for (let guard = 0; cur != null && guard < 64; guard++) {
    if (same(cur, folderId)) return true;
    cur = tree.folders.find((f) => same(f.id, cur))?.parentId ?? null;
  }
  return false;
}

async function run(action, okMessage) {
  try {
    await action();
    if (okMessage) toast(okMessage);
    await renderLibrary(currentFolder);
  } catch (err) {
    toast(errorText(err, 'Action impossible.'));
  }
}

async function newFolder() {
  const name = await askName({ title: 'Nouveau dossier', submit: 'Créer' });
  if (!name) return;
  await run(() => library().saveFolder({ name, parentId: currentFolder }), 'Dossier créé.');
}

function openMenu(btn) {
  const [type, id] = btn.dataset.menu.split(':');
  const find = (list) => list.find((x) => same(x.id, id));
  if (type === 'folder') {
    const f = find(tree.folders);
    menu.open(btn, [
      { act: 'open', icon: 'folder-open', label: 'Ouvrir', run: () => (location.hash = folderHash(f.id)) },
      { act: 'rename', icon: 'pencil', label: 'Renommer', run: async () => {
        const name = await askName({ title: 'Renommer le dossier', value: f.name, submit: 'Renommer' });
        if (name && name !== f.name) await run(() => library().saveFolder({ id: f.id, name }), 'Dossier renommé.');
      } },
      { act: 'move', icon: 'folder-input', label: 'Déplacer', run: async () => {
        const r = await askFolder({ title: `Déplacer « ${f.name} » vers`, current: f.parentId, exclude: f.id });
        if (r) await run(() => library().move('folder', f.id, r.folderId), 'Dossier déplacé.');
      } },
      { act: 'delete', icon: 'trash-2', label: 'Supprimer le dossier', danger: true, run: async () => {
        if (!window.confirm(`Supprimer le dossier « ${f.name} » ? Son contenu remonte dans le dossier parent, rien n’est perdu.`)) return;
        await run(() => library().deleteFolder(f.id), 'Dossier supprimé.');
      } },
    ]);
  } else if (type === 'deck') {
    const d = find(tree.decks);
    menu.open(btn, [
      { act: 'edit', icon: 'pencil', label: 'Modifier la leçon', run: () => (location.hash = `#/memos/${d.id}`) },
      ...(currentUser() ? [
        { act: 'share', icon: 'send', label: d.sharedWith ? `Partager (${d.sharedWith} ami${d.sharedWith > 1 ? 's' : ''})` : 'Partager avec des amis', run: () => openShare(d, () => renderLibrary(currentFolder)) },
        { act: 'rank', icon: 'trophy', label: 'Classement', run: () => openLeaderboard(d) },
      ] : []),
      { act: 'move', icon: 'folder-input', label: 'Déplacer', run: async () => {
        const r = await askFolder({ title: `Déplacer « ${d.title} » vers`, current: d.folderId });
        if (r) await run(() => library().move('deck', d.id, r.folderId), 'Leçon déplacée.');
      } },
      { act: 'delete', icon: 'trash-2', label: 'Supprimer la leçon', danger: true, run: async () => {
        if (!window.confirm(`Supprimer la leçon « ${d.title} » et toutes ses cartes ?`)) return;
        await run(() => deckStore().remove(d.id), 'Leçon supprimée.');
      } },
    ]);
  } else if (type === 'shared') {
    const d = sharedDecks.find((x) => same(x.id, id));
    menu.open(btn, [
      { act: 'rank', icon: 'trophy', label: 'Classement', run: () => openLeaderboard(d) },
      { act: 'copy', icon: 'copy', label: 'Copier dans mes cours', run: async () => {
        try {
          const copy = await shareApi.copy(d.id);
          toast('Copie ajoutée à la racine de tes cours.');
          location.hash = `#/memos/${copy.id}`;
        } catch (err) {
          toast(errorText(err, 'Copie impossible.'));
        }
      } },
    ]);
  } else if (type === 'note') {
    const n = find(tree.notes);
    menu.open(btn, [
      { act: 'read', icon: 'book-open-text', label: 'Lire', run: () => (location.hash = `#/notes/${n.id}`) },
      { act: 'edit', icon: 'pencil', label: 'Modifier', run: () => (location.hash = `#/notes/${n.id}/edit`) },
      { act: 'deck', icon: 'wand-sparkles', label: 'En faire une leçon', run: async () => {
        try {
          openNoteToDeck(await library().getNote(n.id));
        } catch (err) {
          toast(errorText(err, 'Note introuvable.'));
        }
      } },
      { act: 'move', icon: 'folder-input', label: 'Déplacer', run: async () => {
        const r = await askFolder({ title: `Déplacer « ${n.title} » vers`, current: n.folderId });
        if (r) await run(() => library().move('note', n.id, r.folderId), 'Note déplacée.');
      } },
      { act: 'delete', icon: 'trash-2', label: 'Supprimer la note', danger: true, run: async () => {
        if (!window.confirm(`Supprimer la note « ${n.title} » ?`)) return;
        await run(() => library().deleteNote(n.id), 'Note supprimée.');
      } },
    ]);
  }
}

// ─── Notes : lecture et édition ───
let editingNote = null; // { id } ou null
let currentNote = null; // note affichée en lecture

export async function renderNote(id) {
  const body = $('note-body');
  body.innerHTML = '<p class="note">Chargement…</p>';
  let note;
  try {
    note = await library().getNote(id);
    if (!tree) await loadTree();
  } catch (err) {
    toast(errorText(err, 'Note introuvable.'));
    location.hash = '#/memos';
    return;
  }
  $('note-title').textContent = note.title;
  const back = $('note-back');
  back.href = folderHash(note.folderId);
  back.querySelector('span').textContent = folderPath(tree?.folders ?? [], note.folderId).pop()?.name ?? 'Mes cours';
  $('note-edit').href = `#/notes/${note.id}/edit`;
  currentNote = note;
  const detected = extractCards(note.body).length;
  $('note-to-deck').hidden = detected === 0;
  $('note-to-deck').querySelector('span').textContent = detected ? `En faire une leçon (${detected})` : 'En faire une leçon';
  $('note-meta').textContent = `Modifiée le ${formatDate(note.updatedAt)}`;
  body.innerHTML = note.body.trim() ? `<div class="note-content">${renderMarkdown(note.body)}</div>` : '<p class="note">Cette note est vide. Modifie-la pour y écrire ton cours.</p>';
  refreshIcons();
}

export async function renderNoteEditor(id, folderId = null) {
  const form = $('note-form');
  const error = $('note-error');
  error.hidden = true;
  form.reset();
  $('note-delete').hidden = true;
  try {
    await loadTree();
  } catch {
    tree = { folders: [], decks: [], notes: [] };
  }
  const select = $('note-folder');
  select.innerHTML = `<option value="">Mes cours (racine)</option>${flattenFolders(tree.folders).map((f) => `<option value="${escapeHtml(String(f.id))}">${'  '.repeat(f.depth)}${escapeHtml(f.name)}</option>`).join('')}`;

  if (id === 'new') {
    editingNote = null;
    $('note-editor-heading').textContent = 'Nouvelle note';
    select.value = folderId == null ? '' : String(folderId);
    $('note-editor-back').href = folderHash(folderId);
  } else {
    let note;
    try {
      note = await library().getNote(id);
    } catch (err) {
      toast(errorText(err, 'Note introuvable.'));
      location.hash = '#/memos';
      return;
    }
    editingNote = { id: note.id };
    $('note-editor-heading').textContent = note.title;
    $('note-title-input').value = note.title;
    $('note-text').value = note.body;
    select.value = note.folderId == null ? '' : String(note.folderId);
    $('note-editor-back').href = `#/notes/${note.id}`;
    $('note-delete').hidden = false;
  }
  autosize($('note-text'));
  refreshIcons();
  $('note-title-input').focus();
}

function autosize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.max(240, textarea.scrollHeight + 4)}px`;
}

export function initLibrary() {
  initNoteToDeck();
  initShare();
  $('note-to-deck').addEventListener('click', () => currentNote && openNoteToDeck(currentNote));
  $('lib-new-folder').addEventListener('click', newFolder);
  $('library-body').addEventListener('click', async (e) => {
    const menuBtn = e.target.closest('.lib-menu-btn');
    if (menuBtn) {
      e.preventDefault();
      openMenu(menuBtn);
      return;
    }
    if (e.target.closest('[data-new-folder]')) return newFolder();
    const rank = e.target.closest('[data-rank]');
    if (rank) {
      const d = sharedDecks.find((x) => same(x.id, rank.dataset.rank));
      if (d) openLeaderboard(d);
      return;
    }
    const sample = e.target.closest('#memos-sample');
    if (sample) {
      setLoading(sample, true);
      await run(() => deckStore().save({ ...SAMPLE_DECK, folderId: currentFolder }), 'Leçon d’exemple ajoutée.');
    }
  });

  const text = $('note-text');
  text.addEventListener('input', () => autosize(text));
  $('note-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('note-error');
    const title = $('note-title-input').value.trim();
    if (!title) {
      error.textContent = 'Donne un titre à la note.';
      error.hidden = false;
      $('note-title-input').focus();
      return;
    }
    error.hidden = true;
    setLoading($('note-save'), true);
    const v = $('note-folder').value;
    const folderId = v === '' ? null : (tree.folders.find((f) => String(f.id) === v)?.id ?? null);
    try {
      const note = await library().saveNote({ id: editingNote?.id, folderId, title, body: text.value });
      toast('Note enregistrée.');
      location.hash = `#/notes/${note.id}`;
    } catch (err) {
      error.textContent = errorText(err, 'Enregistrement impossible.');
      error.hidden = false;
    } finally {
      setLoading($('note-save'), false);
    }
  });
  $('note-delete').addEventListener('click', async (e) => {
    if (!editingNote || !window.confirm('Supprimer cette note ?')) return;
    setLoading(e.currentTarget, true);
    try {
      const note = await library().getNote(editingNote.id).catch(() => null);
      await library().deleteNote(editingNote.id);
      toast('Note supprimée.');
      location.hash = folderHash(note?.folderId ?? null);
    } catch (err) {
      toast(errorText(err, 'Suppression impossible.'));
    } finally {
      setLoading(e.currentTarget, false);
    }
  });
}

export { flattenFolders };
