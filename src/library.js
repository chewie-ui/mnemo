// Bibliothèque de cours : dossiers imbriqués, leçons (cartes) et notes de cours.
// Stockage local si déconnecté, serveur sinon (même forme de données).
import { get, post } from './api.js';
import { currentUser } from './auth.js';
import { store as deckStore, nowSql } from './memos.js';

const LOCAL_KEY = 'mnemo:library';

function readLocal() {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY));
    return { folders: v?.folders ?? [], notes: v?.notes ?? [] };
  } catch {
    return { folders: [], notes: [] };
  }
}

function writeLocal(lib) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(lib));
}

const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const excerpt = (body) => body.replace(/^#+\s*/gm, '').replace(/^\s*(?:[-*>]|\d+[.)])\s+/gm, '').replace(/\*\*|==|`|\*/g, '').replace(/^-{3,}$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 140);

// Vrai si `candidate` est `folderId` ou un de ses descendants.
function isInside(folders, folderId, candidate) {
  let cur = candidate;
  for (let guard = 0; cur != null && guard < 64; guard++) {
    if (String(cur) === String(folderId)) return true;
    cur = folders.find((f) => String(f.id) === String(cur))?.parentId ?? null;
  }
  return false;
}

const localStore = {
  async tree() {
    const lib = readLocal();
    const decks = await deckStore().list();
    return { folders: lib.folders, decks, notes: lib.notes.map((n) => ({ id: n.id, folderId: n.folderId, title: n.title, updatedAt: n.updatedAt, excerpt: excerpt(n.body) })) };
  },
  async saveFolder({ id, name, parentId }) {
    const lib = readLocal();
    const clean = String(name ?? '').trim().slice(0, 120);
    if (!clean) throw new Error('Donne un nom au dossier.');
    let folder = lib.folders.find((f) => f.id === id);
    if (folder) {
      folder.name = clean;
      if (parentId !== undefined) {
        if (parentId != null && isInside(lib.folders, folder.id, parentId)) throw new Error('Un dossier ne peut pas aller dans lui-même.');
        folder.parentId = parentId ?? null;
      }
      folder.updatedAt = nowSql();
    } else {
      folder = { id: newId('f'), parentId: parentId ?? null, name: clean, updatedAt: nowSql() };
      lib.folders.push(folder);
    }
    writeLocal(lib);
    return folder;
  },
  async deleteFolder(id) {
    const lib = readLocal();
    const folder = lib.folders.find((f) => f.id === id);
    if (!folder) return;
    const parent = folder.parentId ?? null;
    for (const f of lib.folders) if (f.parentId === id) f.parentId = parent;
    for (const n of lib.notes) if (n.folderId === id) n.folderId = parent;
    lib.folders = lib.folders.filter((f) => f.id !== id);
    writeLocal(lib);
    // Les leçons du dossier remontent aussi.
    for (const d of await deckStore().list()) {
      if (d.folderId === id) {
        const full = await deckStore().get(d.id);
        await deckStore().save({ ...full, folderId: parent });
      }
    }
  },
  async move(type, id, folderId) {
    const lib = readLocal();
    if (type === 'folder') {
      const f = lib.folders.find((x) => x.id === id);
      if (!f) return;
      if (folderId != null && isInside(lib.folders, id, folderId)) throw new Error('Un dossier ne peut pas aller dans lui-même.');
      f.parentId = folderId ?? null;
      writeLocal(lib);
    } else if (type === 'note') {
      const n = lib.notes.find((x) => x.id === id);
      if (n) n.folderId = folderId ?? null;
      writeLocal(lib);
    } else if (type === 'deck') {
      const full = await deckStore().get(id);
      await deckStore().save({ ...full, folderId: folderId ?? null });
    }
  },
  async getNote(id) {
    const n = readLocal().notes.find((x) => x.id === id);
    if (!n) throw new Error('Note introuvable.');
    return structuredClone(n);
  },
  async saveNote({ id, folderId, title, body }) {
    const lib = readLocal();
    const clean = String(title ?? '').trim().slice(0, 160);
    if (!clean) throw new Error('Donne un titre à la note.');
    let note = lib.notes.find((n) => n.id === id);
    if (note) Object.assign(note, { title: clean, body: String(body ?? ''), folderId: folderId ?? null, updatedAt: nowSql() });
    else {
      note = { id: newId('n'), folderId: folderId ?? null, title: clean, body: String(body ?? ''), updatedAt: nowSql() };
      lib.notes.unshift(note);
    }
    writeLocal(lib);
    return structuredClone(note);
  },
  async deleteNote(id) {
    const lib = readLocal();
    lib.notes = lib.notes.filter((n) => n.id !== id);
    writeLocal(lib);
  },
};

const apiStore = {
  tree: () => get('library', 'tree'),
  saveFolder: async (f) => (await post('library', 'folder-save', f)).folder,
  deleteFolder: (id) => post('library', 'folder-delete', { id }),
  move: (type, id, folderId) => post('library', 'move', { type, id, folderId }),
  getNote: async (id) => (await get('library', 'note-get', { id })).note,
  saveNote: async (n) => (await post('library', 'note-save', n)).note,
  deleteNote: (id) => post('library', 'note-delete', { id }),
};

export function library() {
  return currentUser() ? apiStore : localStore;
}

// Chemin d'un dossier depuis la racine : [{ id, name }, …].
export function folderPath(folders, folderId) {
  const path = [];
  let cur = folderId;
  for (let guard = 0; cur != null && guard < 64; guard++) {
    const f = folders.find((x) => String(x.id) === String(cur));
    if (!f) break;
    path.unshift({ id: f.id, name: f.name });
    cur = f.parentId;
  }
  return path;
}

// Tous les dossiers aplatis avec leur profondeur, dans l'ordre d'un arbre (pour un <select>).
export function flattenFolders(folders, parentId = null, depth = 0) {
  const out = [];
  for (const f of folders.filter((x) => (x.parentId ?? null) === parentId || (parentId !== null && String(x.parentId) === String(parentId))).sort((a, b) => a.name.localeCompare(b.name, 'fr'))) {
    out.push({ ...f, depth });
    out.push(...flattenFolders(folders, f.id, depth + 1));
  }
  return out;
}

// ─── Rendu des notes : un Markdown volontairement réduit (titres, listes, gras, italique, citations) ───
const esc = (t) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function inline(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/==(.+?)==/g, '<mark>$1</mark>');
}

export function renderMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let list = null; // 'ul' | 'ol'
  let para = [];
  const flushPara = () => {
    if (para.length) html.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) {
      flushPara();
      closeList();
    } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flushPara();
      closeList();
      const level = m[1].length + 1; // # → h2 : le h1 est le titre de la note
      html.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushPara();
      closeList();
      html.push('<hr>');
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ul') {
        closeList();
        list = 'ul';
        html.push('<ul>');
      }
      html.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ol') {
        closeList();
        list = 'ol';
        html.push('<ol>');
      }
      html.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara();
      closeList();
      html.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return html.join('\n');
}
