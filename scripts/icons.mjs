// Génère les icônes PNG de l'application (écran d'accueil, manifeste) à partir du même dessin
// que public/favicon.svg, sans dépendance : rendu vectoriel maison + encodeur PNG (zlib).
//   node scripts/icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BLUE = [0x1f, 0x5f, 0xbf];
const WHITE = [0xff, 0xff, 0xff];

// Coordonnées dans un repère 32×32 (comme le SVG). `bleed` : fond plein bord à bord (icône « maskable »).
function coverage(x, y, bleed) {
  // 1 = pixel du fond, 2 = trait blanc, 0 = transparent
  const r = 7;
  const inRect = bleed || (() => {
    const cx = Math.min(Math.max(x, r), 32 - r);
    const cy = Math.min(Math.max(y, r), 32 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  })();
  if (!inRect) return 0;
  const dx = x - 16;
  const dy = y - 16;
  const w = 1; // demi-épaisseur du trait (stroke-width 2)
  // cercle r=9
  if (Math.abs(Math.hypot(dx, dy) - 9) <= w) return 2;
  // équateur
  if (Math.abs(dy) <= w && Math.abs(dx) <= 9) return 2;
  // méridien : ellipse rx≈2.6, ry=9 (approximation de la courbe du SVG)
  const rx = 2.6;
  const ry = 9;
  const f = (dx / rx) ** 2 + (dy / ry) ** 2;
  const grad = Math.hypot((2 * dx) / rx ** 2, (2 * dy) / ry ** 2) || 1e-6;
  if (Math.abs(f - 1) / grad <= w) return 2;
  return 1;
}

function render(size, { bleed = false, padding = 0 } = {}) {
  const px = new Uint8Array(size * size * 4);
  const ss = 4; // sur-échantillonnage pour l'anticrénelage
  const scale = 32 / (size * (1 - 2 * padding));
  const offset = size * padding;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let bg = 0;
      let fg = 0;
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const x = (i - offset + (si + 0.5) / ss) * scale;
          const y = (j - offset + (sj + 0.5) / ss) * scale;
          const c = bleed ? coverage(Math.min(Math.max(x, 0), 32), Math.min(Math.max(y, 0), 32), true) : coverage(x, y, false);
          if (c) bg++;
          if (c === 2) fg++;
        }
      }
      const n = ss * ss;
      const a = bg / n;
      const t = bg ? fg / bg : 0;
      const o = (j * size + i) * 4;
      px[o] = Math.round(BLUE[0] + (WHITE[0] - BLUE[0]) * t);
      px[o + 1] = Math.round(BLUE[1] + (WHITE[1] - BLUE[1]) * t);
      px[o + 2] = Math.round(BLUE[2] + (WHITE[2] - BLUE[2]) * t);
      px[o + 3] = Math.round(a * 255);
    }
  }
  return px;
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let j = 0; j < size; j++) {
    raw[j * (size * 4 + 1)] = 0; // filtre « none »
    raw.set(px.subarray(j * size * 4, (j + 1) * size * 4), j * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
for (const [name, size, opts] of [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { bleed: true, padding: 0.1 }],
  ['apple-touch-icon.png', 180, { bleed: true }],
]) {
  writeFileSync(`public/icons/${name}`, png(size, render(size, opts)));
  console.log('public/icons/' + name);
}
