import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Im Entwicklungsmodus läuft die PHP-API separat:
//   TM_STORAGE=/tmp/tm php -S 127.0.0.1:8000 -t public
const api = { '/api.php': 'http://127.0.0.1:8000', '/photos': 'http://127.0.0.1:8000' };

// Gleiche Content-Security-Policy wie public/.htaccess, damit sie sich im Preview testen lässt
const csp = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

// Die vier Schriftdateien, die jede Seite braucht, werden schon im HTML angefordert. Sonst entdeckt der Browser
// sie erst nach dem Laden des Stylesheets und der ersten Darstellung, und der Text springt später um.
const preloadFonts = () => ({
  name: 'preload-latin-fonts',
  transformIndexHtml: {
    order: 'post',
    handler(html, ctx) {
      if (!ctx.bundle) return html;
      const files = Object.keys(ctx.bundle).filter((f) => /(alfa-slab-one|bebas-neue|courier-prime)-latin-(400|700)-normal-[^.]+\.woff2$/.test(f));
      return {
        html,
        tags: files.map((f) => ({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '', href: `/${f}` }, injectTo: 'head' })),
      };
    },
  },
});

export default defineConfig({
  plugins: [react(), preloadFonts()],
  server: { proxy: api },
  preview: { proxy: api, headers: { 'Content-Security-Policy': csp } },
  test: { include: ['tests/**/*.test.js'], environment: 'node' },
});
