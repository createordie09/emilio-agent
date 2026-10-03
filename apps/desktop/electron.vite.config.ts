import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Les paquets du monorepo sont compilés dans les bundles ; les dépendances tierces (modules natifs inclus) restent externes.
const bundled = ['@emilio/engine', '@emilio/shared'];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: bundled },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
          engine: resolve(__dirname, '../../packages/engine/src/process.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: bundled },
      rollupOptions: { input: { index: resolve(__dirname, 'electron/preload.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': resolve(__dirname, 'renderer/src') } },
    build: { rollupOptions: { input: resolve(__dirname, 'renderer/index.html') } },
  },
});
