import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Im Entwicklungsmodus läuft die PHP-API separat:
//   TM_STORAGE=/tmp/tm php -S 127.0.0.1:8000 -t public
// Gleiche Content-Security-Policy wie public/.htaccess, damit sie sich im Preview testen lässt
const csp = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
const api = { '/api.php': 'http://127.0.0.1:8000', '/photos': 'http://127.0.0.1:8000' };

export default defineConfig({
  plugins: [react()],
  server: { proxy: api },
  preview: { proxy: api, headers: { 'Content-Security-Policy': csp } },
  test: { include: ['tests/**/*.test.js'], environment: 'node' },
});
