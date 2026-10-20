import { defineConfig } from 'vite';

export default defineConfig({
  // Caminhos relativos: necessário para o WebView do Capacitor.
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
  },
});
