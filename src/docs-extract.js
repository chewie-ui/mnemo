// Lecture d'un fichier de cours dans le navigateur : texte brut, PowerPoint (.pptx) et Word (.docx)
// sont ouverts ici (ce sont des zips de XML) pour n'envoyer que le texte ; un PDF part tel quel,
// l'IA sait le lire. Aucune dépendance : décompression par DecompressionStream.

const decoder = new TextDecoder();

// Entrées d'un zip : { name, method, offset, size } depuis le répertoire central.
function zipEntries(buf) {
  const dv = new DataView(buf);
  // Fin de répertoire central (signature 0x06054b50), en partant de la fin.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Fichier zip illisible.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(buf, p + 46, nameLen));
    entries.push({ name, method, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(buf, entry) {
  const dv = new DataView(buf);
  if (dv.getUint32(entry.offset, true) !== 0x04034b50) throw new Error('Entrée zip corrompue.');
  const nameLen = dv.getUint16(entry.offset + 26, true);
  const extraLen = dv.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  const data = new Uint8Array(buf, start, entry.size);
  if (entry.method === 0) return decoder.decode(data);
  if (entry.method !== 8) throw new Error('Compression non prise en charge.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

// Texte d'un XML Office : les <a:t> (PowerPoint) ou <w:t> (Word), paragraphes séparés par des sauts de ligne.
function officeText(xml, tag, paragraph) {
  const out = [];
  const paras = xml.split(new RegExp(`</${paragraph}>`));
  for (const para of paras) {
    const runs = [...para.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))].map((m) => unescapeXml(m[1]));
    const line = runs.join('').trim();
    if (line) out.push(line);
  }
  return out.join('\n');
}

export async function extractPptx(buf) {
  const entries = zipEntries(buf).filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name));
  entries.sort((a, b) => Number(a.name.match(/(\d+)/)[1]) - Number(b.name.match(/(\d+)/)[1]));
  const parts = [];
  for (const [i, e] of entries.entries()) {
    const text = officeText(await readEntry(buf, e), 'a:t', 'a:p');
    if (text) parts.push(`## Diapositive ${i + 1}\n${text}`);
  }
  // Notes du présentateur, souvent riches : on les ajoute après les diapositives.
  const notes = zipEntries(buf).filter((e) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(e.name));
  for (const e of notes) {
    const text = officeText(await readEntry(buf, e), 'a:t', 'a:p').replace(/^\d+$/gm, '').trim();
    if (text) parts.push(`## Notes (${e.name.match(/(\d+)/)[1]})\n${text}`);
  }
  return parts.join('\n\n');
}

export async function extractDocx(buf) {
  const entry = zipEntries(buf).find((e) => e.name === 'word/document.xml');
  if (!entry) throw new Error('Document Word illisible.');
  return officeText(await readEntry(buf, entry), 'w:t', 'w:p');
}

// { text } pour les formats texte/Office, { pdf } (base64) pour un PDF.
export async function extractCourse(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    if (file.size > 12 * 1024 * 1024) throw new Error('PDF trop lourd (12 Mo maximum) : exporte-le en plus léger ou copie le texte.');
    const b64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(new Error('Lecture du fichier impossible.'));
      r.readAsDataURL(file);
    });
    return { pdf: b64 };
  }
  const buf = await file.arrayBuffer();
  if (name.endsWith('.pptx')) return { text: await extractPptx(buf) };
  if (name.endsWith('.docx')) return { text: await extractDocx(buf) };
  if (name.endsWith('.ppt') || name.endsWith('.doc')) throw new Error('Ancien format Office : enregistre le fichier en .pptx ou .docx d’abord.');
  return { text: decoder.decode(buf) };
}
