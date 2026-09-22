// Prepare le dossier a envoyer chez l'hebergeur : `npm run package`
// -> dist/ contient le site construit + dist/api (PHP, .htaccess, schemas), sans les donnees locales.
// Le fichier .env n'est PAS copie : cree-le sur le serveur (ou envoie-le a la main dans /api).
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { zipDirectory } from './zip.mjs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'api');
const dest = path.join(root, 'dist', 'api');
// Deploiement par git sur le serveur : le .env vit dans dist/api. On le met de cote AVANT la
// construction (vite vide dist/), sinon chaque « npm run package » effacerait les mots de passe.
const envFile = path.join(dest, '.env');
const keepEnv = existsSync(envFile) ? readFileSync(envFile) : null;

execSync('npm run build', { cwd: root, stdio: 'inherit' });

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
if (keepEnv) writeFileSync(envFile, keepEnv);
const keep = (name) => name.endsWith('.php') || name.endsWith('.sql') || name === '.htaccess';
for (const name of readdirSync(src)) if (keep(name)) cpSync(path.join(src, name), path.join(dest, name));

// Archive prete a envoyer : un seul fichier au lieu de ~400, puis « Extraire » chez l'hebergeur.
const zip = path.join(root, 'dist.zip');
const { files, bytes } = zipDirectory(path.join(root, 'dist'), zip, (name) => name !== 'api/.env');
console.log(`\ndist/ est pret : envoie tout son contenu a la racine du site.`);
console.log(`dist.zip aussi : ${files} fichiers, ${(bytes / 1048576).toFixed(1)} Mo — a envoyer puis extraire sur le serveur (plus rapide en FTP).`);
if (!existsSync(path.join(root, '.env'))) console.log('Pense a creer .env sur le serveur (voir .env.example).');
