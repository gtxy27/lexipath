import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';

function shouldIgnoreRollupWarning(warning: any): boolean {
  return (
    warning?.code === 'MODULE_LEVEL_DIRECTIVE' &&
    typeof warning?.message === 'string' &&
    warning.message.includes('"use client"')
  );
}

// Content scripts must be classic scripts in many extension contexts.
// Build a dedicated IIFE bundle to avoid top-level `import`.
export default defineConfig(({ mode }) => {
  const isFirefox = mode === 'firefox' || process.env.VITE_BROWSER === 'firefox';
  const browser: 'firefox' | 'chrome' = isFirefox ? 'firefox' : 'chrome';
  const outDir = isFirefox ? 'dist/firefox' : 'dist/chrome';
  const isDev = mode === 'development';

  return {
    build: {
      outDir,
      emptyOutDir: false,
      sourcemap: isDev,
      minify: !isDev,
      rollupOptions: {
        onwarn(warning, warn) {
          if (shouldIgnoreRollupWarning(warning)) return;
          warn(warning);
        },
        input: {
          content: resolve(__dirname, 'src/content/index.ts'),
        },
        output: {
          format: 'iife',
          entryFileNames: 'content.js',
          chunkFileNames: 'content-[hash].js',
          assetFileNames: (assetInfo) => {
            const name = assetInfo.name ?? '';
            if (name.endsWith('.css')) return 'assets/theme.css';
            return 'assets/[name]-[hash][extname]';
          },
          inlineDynamicImports: true,
        },
      },
    },
    plugins: [
      {
        name: 'copy-manifest-content',
         closeBundle() {
           const src = resolve(__dirname, `public/manifest.${browser}.json`);
           const destDir = resolve(__dirname, outDir);
           const dest = resolve(destDir, 'manifest.json');
           mkdirSync(destDir, { recursive: true });
           copyFileSync(src, dest);
         },

      },
    ],
  };
});
