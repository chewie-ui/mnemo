// Lecture d'un fichier de cours dans le navigateur : texte brut, PowerPoint (.pptx) et Word (.docx)
// sont ouverts ici (ce sont des zips de XML, décompressés par DecompressionStream), et le texte des
// PDF est extrait par pdf.js : seul le texte est envoyé, ce que toutes les IA savent lire (y compris
// une IA auto-hébergée). Un PDF scanné, sans texte, part tel quel vers une IA qui lit les PDF.

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

// Texte d'un PDF, lu dans le navigateur avec pdf.js (chargé seulement quand on choisit un PDF).
// Vide pour un PDF scanné (des images de pages, sans texte).
export async function extractPdf(buf) {
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(buf) });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    let text = '';
    for (const it of items) text += it.str + (it.hasEOL ? '\n' : '');
    text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (text) pages.push(`## Page ${n}\n${text}`);
    page.cleanup();
  }
  const count = doc.numPages;
  await task.destroy();
  return { text: pages.join('\n\n'), pages: count };
}

// { text } pour les formats texte/Office et les PDF dont on sait lire le texte ;
// { pdf } (base64) pour un PDF scanné, que seule une IA capable de lire les PDF comprendra.
export async function extractCourse(file, { pdfFallback = true } = {}) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    let scanned = true;
    try {
      const { text, pages } = await extractPdf(await file.arrayBuffer());
      // Moins de ~80 caractères par page : des images avec, au mieux, quelques légendes.
      scanned = text.replace(/## Page \d+/g, '').trim().length < Math.max(200, pages * 80);
      if (!scanned) return { text };
    } catch (err) {
      console.warn('pdf.js :', err);
    }
    if (!pdfFallback) {
      throw new Error(scanned
        ? 'Ce PDF semble scanné (des images de pages, sans texte à lire) : copie-colle son contenu ou utilise un PDF avec du texte sélectionnable.'
        : 'PDF illisible : copie-colle son contenu.');
    }
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
