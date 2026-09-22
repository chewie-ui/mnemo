// Lance l'API PHP et Vite ensemble (npm run dev). Ctrl+C arrête tout.
// Sans PHP dans le PATH, seul Vite démarre et le site tourne sans compte.
// Si un serveur s'arrête tout seul (plantage, processus tué), il est relancé automatiquement :
// pas besoin de redémarrer quoi que ce soit à la main.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const PHP_BASE = ['-d', 'extension=pdo_sqlite', '-d', 'extension=pdo_mysql', '-d', 'extension=mbstring', '-d', 'extension=curl', '-d', 'extension=openssl'];
const phpArgs = (port) => [...PHP_BASE, '-S', `127.0.0.1:${port}`, '-t', '.'];
// Sur Windows, PHP sans php.ini n'a pas de certificats racine : on prend ceux de Git pour parler à l'API IA en HTTPS.
const CA = 'C:/Program Files/Git/mingw64/etc/ssl/certs/ca-bundle.crt';
if (process.platform === 'win32' && existsSync(CA)) PHP_BASE.unshift('-d', `curl.cainfo=${CA}`);
const shell = process.platform === 'win32';
const children = new Set();
let stopping = false;

function run(name, cmd, args, { restart = false } = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', shell });
  children.add(child);
  child.on('exit', (code) => {
    children.delete(child);
    if (stopping) return;
    if (code !== null && code !== 0) console.error(`[${name}] arrêté (code ${code})`);
    if (!restart) return;
    console.log(`[${name}] redémarrage…`);
    setTimeout(() => {
      if (!stopping) run(name, cmd, args, { restart });
    }, 1000);
  });
  return child;
}

const hasPhp = spawnSync('php', ['-v'], { stdio: 'ignore', shell }).status === 0;
if (hasPhp) {
  run('api', 'php', phpArgs(8080), { restart: true });
  // Second serveur dédié à l'IA : le serveur intégré de PHP ne traite qu'une requête à la fois,
  // et une génération peut durer une minute.
  run('api-ia', 'php', phpArgs(8081), { restart: true });
  console.log('API PHP sur http://127.0.0.1:8080 (+ 8081 pour l’IA) — SQLite : api/data/mnemo.sqlite');
} else {
  console.warn('PHP introuvable : le site démarre sans API (pas de comptes ni de défis). Installe PHP 8.1+ pour l’activer.');
}
run('vite', 'npx', ['vite', ...process.argv.slice(2)]);

const stop = () => {
  stopping = true;
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
