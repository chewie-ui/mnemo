// `npm run deploy` : construit le site et publie le resultat sur la branche `deploy` du depot.
// Le serveur n'a alors qu'a recuperer cette branche (aucun Node necessaire la-bas) :
//
//   git --git-dir=~/sources/mnemo-deploy/.git --work-tree=~/sites/<domaine> checkout -f deploy
//
// La branche `deploy` ne contient que le site construit (dist/), jamais les sources ni le .env.
import { execSync } from 'node:child_process';
import { cpSync, rmSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, '.deploy');
const git = (cmd, cwd = root) => execSync(`git ${cmd}`, { cwd, stdio: 'pipe' }).toString().trim();
const gitLoud = (cmd, cwd = root) => execSync(`git ${cmd}`, { cwd, stdio: 'inherit' });

execSync('npm run package', { cwd: root, stdio: 'inherit' });

// Un « worktree » : un dossier de travail separe, pour ne pas toucher a ta copie de travail.
rmSync(work, { recursive: true, force: true });
try {
  git('worktree remove .deploy --force');
} catch {
  /* aucun worktree a nettoyer */
}
let hasRemote = false;
try {
  git('fetch origin deploy');
  hasRemote = true;
} catch {
  console.log('Premiere publication : la branche `deploy` va etre creee.');
}
if (hasRemote) {
  gitLoud('worktree add -B deploy .deploy origin/deploy');
} else {
  // Premiere fois : un worktree detache, puis une branche orpheline (sans historique des sources).
  gitLoud('worktree add --detach .deploy');
  gitLoud('checkout --orphan deploy', work);
  git('rm -rf --cached . || true', work);
}

// On remplace tout le contenu par le dist fraichement construit.
for (const name of readdirSync(work)) {
  if (name !== '.git') rmSync(path.join(work, name), { recursive: true, force: true });
}
cpSync(path.join(root, 'dist'), work, { recursive: true });

git('add -A', work);
const changed = git('status --porcelain', work);
if (!changed) {
  console.log('\nRien de nouveau a publier.');
} else {
  const rev = git('rev-parse --short HEAD');
  git(`commit -m "Site construit (${rev})"`, work);
  gitLoud('push -u origin deploy --force', work);
  console.log('\nBranche `deploy` publiee.');
}
git('worktree remove .deploy --force');
if (existsSync(work)) rmSync(work, { recursive: true, force: true });

console.log(`
Sur le serveur (depot clone une fois avec : git clone --bare -b deploy <url> ~/sources/mnemo-deploy.git) :

  G=$HOME/sources/mnemo-deploy.git; W=$HOME/sites/<domaine>
  git --git-dir=$G --work-tree=$W fetch origin deploy:deploy
  git --git-dir=$G --work-tree=$W reset --hard deploy

(reset --hard remet aussi les fichiers effaces ; api/.env, non suivi, n'est jamais touche)`);
