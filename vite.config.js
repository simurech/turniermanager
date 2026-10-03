import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Im Entwicklungsmodus läuft die PHP-API separat:
//   TM_STORAGE=/tmp/tm php -S 127.0.0.1:8000 -t public
const api = { '/api.php': 'http://127.0.0.1:8000', '/photos': 'http://127.0.0.1:8000' };

export default defineConfig({
  plugins: [react()],
  server: { proxy: api },
  preview: { proxy: api },
  test: { include: ['tests/**/*.test.js'], environment: 'node' },
});
