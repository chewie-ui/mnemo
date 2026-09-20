// Prepare le dossier a envoyer chez l'hebergeur : `npm run package`
// -> dist/ contient le site construit + dist/api (PHP, .htaccess, schemas), sans les donnees locales.
// Le fichier .env n'est PAS copie : cree-le sur le serveur (ou envoie-le a la main dans /api).
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

const src = path.join(root, 'api');
const dest = path.join(root, 'dist', 'api');
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
const keep = (name) => name.endsWith('.php') || name.endsWith('.sql') || name === '.htaccess';
for (const name of readdirSync(src)) if (keep(name)) cpSync(path.join(src, name), path.join(dest, name));

console.log(`\ndist/ est pret : envoie tout son contenu a la racine du site.`);
if (!existsSync(path.join(root, '.env'))) console.log('Pense a creer .env sur le serveur (voir .env.example).');
