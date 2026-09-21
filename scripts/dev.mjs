// Lance l'API PHP et Vite ensemble (npm run dev). Ctrl+C arrête les deux.
// Sans PHP dans le PATH, seul Vite démarre et le site tourne sans compte.
import { spawn, spawnSync } from 'node:child_process';

const PHP_ARGS = ['-d', 'extension=pdo_sqlite', '-d', 'extension=pdo_mysql', '-d', 'extension=mbstring', '-S', '127.0.0.1:8080', '-t', '.'];
const shell = process.platform === 'win32';
const children = [];

function run(name, cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit', shell });
  child.on('exit', (code) => {
    if (code !== null && code !== 0) console.error(`[${name}] arrêté (code ${code})`);
  });
  children.push(child);
  return child;
}

const hasPhp = spawnSync('php', ['-v'], { stdio: 'ignore', shell }).status === 0;
if (hasPhp) {
  run('api', 'php', PHP_ARGS);
  console.log('API PHP sur http://127.0.0.1:8080 (SQLite : api/data/mnemo.sqlite)');
} else {
  console.warn('PHP introuvable : le site démarre sans API (pas de comptes ni de défis). Installe PHP 8.1+ pour l’activer.');
}
run('vite', 'npx', ['vite', ...process.argv.slice(2)]);

const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
