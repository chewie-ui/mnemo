// Avatars : une icône Lucide sur un fond de couleur, choisis dans les réglages et
// stockés sous la forme « icone:couleur ». Sans avatar, l'initiale du pseudo sur une
// couleur dérivée du pseudo. Même rendu partout (barre, amis, défis, écran VS).
import { escapeHtml } from './ui.js';

export const AVATAR_ICONS = [
  'cat', 'dog', 'bird', 'fish', 'rabbit', 'squirrel', 'turtle', 'snail', 'bug', 'ghost', 'bot', 'skull',
  'rocket', 'crown', 'star', 'heart', 'zap', 'flame', 'leaf', 'sun', 'moon', 'globe', 'mountain', 'anchor',
  'compass', 'sword', 'shield', 'gamepad-2', 'palette', 'music', 'pizza', 'dices',
];

// Fonds fixes (pas de variante par thème) : le blanc reste lisible dessus dans les deux modes.
export const AVATAR_COLORS = {
  blue: '#1f5fbf', teal: '#0f766e', green: '#1a7f43', orange: '#c2410c',
  red: '#b42318', purple: '#6d28d9', pink: '#be185d', slate: '#475569',
};

export const AVATAR_COLOR_LABELS = {
  blue: 'Bleu', teal: 'Turquoise', green: 'Vert', orange: 'Orange', red: 'Rouge', purple: 'Violet', pink: 'Rose', slate: 'Ardoise',
};

export function parseAvatar(value) {
  const [icon, color] = String(value ?? '').split(':');
  if (!AVATAR_ICONS.includes(icon) || !AVATAR_COLORS[color]) return null;
  return { icon, color };
}

export const isValidAvatar = (value) => value === '' || parseAvatar(value) !== null;

function defaultColor(name) {
  const keys = Object.keys(AVATAR_COLORS);
  let h = 0;
  for (const ch of String(name ?? '')) h = (h * 31 + ch.codePointAt(0)) % 9973;
  return keys[h % keys.length];
}

// HTML d'un avatar. `size` : sm (24 px), md (40 px), lg (72 px). Penser à refreshIcons() après insertion.
export function avatarHtml(user, size = 'md') {
  const parsed = parseAvatar(user?.avatar);
  const color = parsed?.color ?? defaultColor(user?.name);
  const inner = parsed
    ? `<i data-lucide="${parsed.icon}" aria-hidden="true"></i>`
    : `<span class="avatar-initial" aria-hidden="true">${escapeHtml((user?.name ?? '?').trim().charAt(0).toUpperCase() || '?')}</span>`;
  return `<span class="avatar avatar-${size}" style="--avatar-bg:${AVATAR_COLORS[color]}" aria-hidden="true">${inner}</span>`;
}
