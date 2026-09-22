// Petits utilitaires d'interface partagés par tous les écrans.
import {
  createIcons, Globe, ArrowLeft, Plus, Minus, Maximize, RotateCcw, Trophy, Map, MapPin, Building2, Waves, Sailboat,
  Landmark, Flag, MapPinned, Search, CircleUserRound, BarChart3, NotebookPen, LogOut, Play, X, Check, Trash2, Pencil,
  BookOpen, ListChecks, Clock, Eye, Languages, Coins, Castle, ChevronDown, ChevronUp, Users, Swords, UserPlus, Star, Award, Lock, ArrowRight, Settings, Monitor, Sun, Moon, Mail, LayoutGrid, House, Folder, FolderPlus, FolderOpen, FolderInput, FilePlus2, FileText, Ellipsis, ChevronRight, BookOpenText, WandSparkles, Send, Copy, Sparkles, Upload,
  Cat, Dog, Bird, Fish, Rabbit, Squirrel, Turtle, Snail, Bug, Ghost, Bot, Skull, Rocket, Crown, Heart, Zap, Flame, Leaf, Mountain, Anchor, Compass, Sword, Shield, Gamepad2, Palette, Music, Pizza, Dices,
} from 'lucide';

const icons = {
  Globe, ArrowLeft, Plus, Minus, Maximize, RotateCcw, Trophy, Map, MapPin, Building2, Waves, Sailboat, Landmark, Flag,
  MapPinned, Search, CircleUserRound, BarChart3, NotebookPen, LogOut, Play, X, Check, Trash2, Pencil, BookOpen, ListChecks, Clock, Eye, Languages, Coins, Castle, ChevronDown, ChevronUp, Users, Swords, UserPlus, Star, Award, Lock, ArrowRight, Settings, Monitor, Sun, Moon, Mail, LayoutGrid, House, Folder, FolderPlus, FolderOpen, FolderInput, FilePlus2, FileText, Ellipsis, ChevronRight, BookOpenText, WandSparkles, Send, Copy, Sparkles, Upload,
  Cat, Dog, Bird, Fish, Rabbit, Squirrel, Turtle, Snail, Bug, Ghost, Bot, Skull, Rocket, Crown, Heart, Zap, Flame, Leaf, Mountain, Anchor, Compass, Sword, Shield, Gamepad2, Palette, Music, Pizza, Dices,
};

export const $ = (id) => document.getElementById(id);

// Remplace les <i data-lucide> par les SVG. À appeler après avoir injecté du HTML.
export function refreshIcons() {
  createIcons({ icons });
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const flagUrl = (code) => `${import.meta.env.BASE_URL}flags/${code}.svg`;

let toastTimer = null;
export function toast(message, ms = 3000) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

// Bouton en cours d'action : spinner, désactivé.
export function setLoading(btn, loading) {
  btn.classList.toggle('is-loading', loading);
  btn.disabled = loading;
}

// Affiche un écran (<main id="screen-…">) et cache les autres.
// Onglet du bas correspondant à chaque écran (mobile). Les écrans sans onglet gardent l'onglet parent.
const TAB_OF = { home: 'home', campaign: 'campaign', memos: 'memos', deck: 'memos', study: 'memos', note: 'memos', 'note-edit': 'memos', ai: 'memos', friends: 'friends', duel: 'friends', settings: 'settings', stats: 'settings', reset: 'settings', confirm: 'settings' };

export function showScreen(name) {
  for (const el of document.querySelectorAll('main.screen')) el.hidden = el.id !== `screen-${name}`;
  document.body.classList.toggle('in-game', name === 'game');
  const tab = TAB_OF[name] ?? null;
  for (const a of document.querySelectorAll('#tabbar a')) {
    const active = a.dataset.tab === tab;
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0 });
}

export function formatDate(sql) {
  if (!sql) return '';
  const d = new Date(sql.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
