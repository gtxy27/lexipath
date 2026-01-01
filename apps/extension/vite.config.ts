import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync } from 'fs';

const isFirefox = process.env.VITE_BROWSER === 'firefox';
const browser = isFirefox ? 'firefox' : 'chrome';

function copyManifestPlugin() {
  return {
    name: 'copy-manifest',
    closeBundle() {
      const outDir = isFirefox ? 'dist/firefox' : 'dist/chrome';
      const src = resolve(__dirname, `public/manifest.${browser}.json`);
      const dest = resolve(__dirname, `${outDir}/manifest.json`);
      copyFileSync(src, dest);
    },
  };
}

export default defineConfig({
  plugins: [react(), copyManifestPlugin()],
  build: {
    outDir: isFirefox ? 'dist/firefox' : 'dist/chrome',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        popup: resolve(__dirname, 'src/ui/popup/index.html'),
        options: resolve(__dirname, 'src/ui/options/index.html'),
        onboarding: resolve(__dirname, 'src/ui/onboarding/index.html'),
        sidebar: resolve(__dirname, 'src/ui/sidebar/index.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    minify: process.env.NODE_ENV === 'production',
    sourcemap: process.env.NODE_ENV !== 'production',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  define: {
    'process.env.BROWSER': JSON.stringify(isFirefox ? 'firefox' : 'chrome'),
  },
});
