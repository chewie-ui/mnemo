// Petits utilitaires d'interface partagés par tous les écrans.
import {
  createIcons, Globe, ArrowLeft, Plus, Minus, Maximize, RotateCcw, Trophy, Map, MapPin, Building2, Waves, Sailboat,
  Landmark, Flag, MapPinned, Search, CircleUserRound, BarChart3, NotebookPen, LogOut, Play, X, Check, Trash2, Pencil,
  BookOpen, ListChecks, Clock, Eye, Languages, Coins, Castle, ChevronDown, ChevronUp, Users, Swords, UserPlus, Star, Award, Lock, ArrowRight, Settings, Monitor, Sun, Moon, Mail, LayoutGrid,
  Cat, Dog, Bird, Fish, Rabbit, Squirrel, Turtle, Snail, Bug, Ghost, Bot, Skull, Rocket, Crown, Heart, Zap, Flame, Leaf, Mountain, Anchor, Compass, Sword, Shield, Gamepad2, Palette, Music, Pizza, Dices,
} from 'lucide';

const icons = {
  Globe, ArrowLeft, Plus, Minus, Maximize, RotateCcw, Trophy, Map, MapPin, Building2, Waves, Sailboat, Landmark, Flag,
  MapPinned, Search, CircleUserRound, BarChart3, NotebookPen, LogOut, Play, X, Check, Trash2, Pencil, BookOpen, ListChecks, Clock, Eye, Languages, Coins, Castle, ChevronDown, ChevronUp, Users, Swords, UserPlus, Star, Award, Lock, ArrowRight, Settings, Monitor, Sun, Moon, Mail, LayoutGrid,
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
export function showScreen(name) {
  for (const el of document.querySelectorAll('main.screen')) el.hidden = el.id !== `screen-${name}`;
  window.scrollTo({ top: 0 });
}

export function formatDate(sql) {
  if (!sql) return '';
  const d = new Date(sql.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
