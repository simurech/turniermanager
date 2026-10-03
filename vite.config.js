import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Im Entwicklungsmodus läuft die PHP-API separat:
//   TM_STORAGE=/tmp/tm php -S 127.0.0.1:8000 -t public
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api.php': 'http://127.0.0.1:8000', '/photos': 'http://127.0.0.1:8000' } },
  test: { include: ['tests/**/*.test.js'], environment: 'node' },
});
