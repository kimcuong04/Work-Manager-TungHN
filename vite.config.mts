import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: ppm-img:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'";

// CSP chỉ gắn vào bản build: dev server của Vite cần inline script cho React Refresh.
function cspPlugin(): Plugin {
  return {
    name: 'ppm-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  root: resolve(root, 'src/renderer'),
  base: './',
  plugins: [react(), cspPlugin()],
  build: {
    outDir: resolve(root, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome120',
  },
  server: { host: '127.0.0.1', port: 5173 },
  test: {
    root,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as any);
