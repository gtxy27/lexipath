import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    css: true,
    setupFiles: [resolve(__dirname, './vitest.setup.ts')],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/types/',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './apps/extension/src'),
      '@lexipath/core': resolve(__dirname, './packages/core/src'),
      '@lexipath/providers': resolve(__dirname, './packages/providers/src'),
      '@lexipath/subtitles': resolve(__dirname, './packages/subtitles/src'),
      '@lexipath/dictionary': resolve(__dirname, './packages/dictionary/src'),
    },
  },
});
