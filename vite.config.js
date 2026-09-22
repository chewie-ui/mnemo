import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    // Accessible depuis les autres appareils du reseau local (http://<ip-du-pc>:5173).
    host: true,
    // L'API PHP tourne à côté (npm run dev la lance) ; même origine pour le navigateur.
    // Le serveur PHP intégré ne traite qu'une requête à la fois : les appels à l'IA, qui durent
    // jusqu'à une minute, partent sur un second serveur pour ne pas figer le reste du site.
    proxy: {
      '/api/ai.php': { target: 'http://127.0.0.1:8081', timeout: 300000, proxyTimeout: 300000 },
      '/api': 'http://127.0.0.1:8080',
    },
  },
});
