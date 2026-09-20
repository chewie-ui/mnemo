import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    // Accessible depuis les autres appareils du reseau local (http://<ip-du-pc>:5173).
    host: true,
    // L'API PHP tourne à côté (npm run api) ; même origine pour le navigateur.
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
});
