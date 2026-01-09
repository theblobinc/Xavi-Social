import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Security hardening: the npm advisory is about the dev server.
  // We don't need to expose it beyond localhost for this package.
  server: {
    host: '127.0.0.1',
    cors: false,
    strictPort: true,
    hmr: {
      host: '127.0.0.1',
    },
  },
  preview: {
    host: '127.0.0.1',
    cors: false,
    strictPort: true,
  },
  build: {
    outDir: resolve(process.cwd(), '../dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(process.cwd(), 'index.html'),
      output: {
        entryFileNames: 'app.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) return 'app.css';
          return '[name][extname]';
        }
      }
    }
  }
});
