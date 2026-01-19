import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';

function copyManifestPlugin(params: { isFirefox: boolean; browser: 'firefox' | 'chrome' }) {
  return {
    name: 'copy-manifest',
    closeBundle() {
      const outDir = params.isFirefox ? 'dist/firefox' : 'dist/chrome';
      const src = resolve(__dirname, `public/manifest.${params.browser}.json`);
      const destDir = resolve(__dirname, outDir);
      const dest = resolve(destDir, 'manifest.json');
      mkdirSync(destDir, { recursive: true });
      copyFileSync(src, dest);
    },
  };
}

function shouldIgnoreRollupWarning(warning: any): boolean {
  // Some deps (e.g. framer-motion) ship Next.js "use client" directives in ESM builds.
  // These directives are irrelevant in our extension bundles and Rollup reports them as
  // "module level directives"; suppress to keep build output readable.
  return (
    warning?.code === 'MODULE_LEVEL_DIRECTIVE' &&
    typeof warning?.message === 'string' &&
    warning.message.includes('"use client"')
  );
}

export default defineConfig(({ mode }) => {
  // Vite only injects .env[.mode] after config loading starts. Avoid reading
  // process.env.VITE_BROWSER at module top-level.
  const isFirefox = mode === 'firefox' || process.env.VITE_BROWSER === 'firefox';
  const browser: 'firefox' | 'chrome' = isFirefox ? 'firefox' : 'chrome';
  const isDev = mode === 'development';

  return {
    plugins: [react(), copyManifestPlugin({ isFirefox, browser })],
    build: {
      outDir: isFirefox ? 'dist/firefox' : 'dist/chrome',
      emptyOutDir: true,
      rollupOptions: {
        onwarn(warning, warn) {
          if (shouldIgnoreRollupWarning(warning)) return;
          warn(warning);
        },
        input: {
          background: resolve(__dirname, 'src/background/index.ts'),
          popup: resolve(__dirname, 'src/ui/popup/index.html'),
          options: resolve(__dirname, 'src/ui/options/index.html'),
          onboarding: resolve(__dirname, 'src/ui/onboarding/index.html'),
          sidebar: resolve(__dirname, 'src/ui/sidebar/index.html'),
        },
        output: {
          // Keep default output for background/UI entries.
          format: 'es',
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            const name = assetInfo.name ?? '';
            if (name.endsWith('.css')) return 'assets/theme.css';
            return 'assets/[name]-[hash][extname]';
          },
        },
      },
      minify: !isDev,
      sourcemap: isDev,
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    define: {
      'process.env.BROWSER': JSON.stringify(browser),
    },
  };
});
