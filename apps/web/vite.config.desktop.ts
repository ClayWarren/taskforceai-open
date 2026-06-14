import tailwindcss from '@tailwindcss/vite';
import viteReact from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type ViteDevServer } from 'vite';

const publicAssetNames = [
  'android-chrome-192x192.png',
  'android-chrome-512x512.png',
  'apple-touch-icon.png',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'favicon.ico',
  'icon.png',
  'manifest.json',
];

const renderDesktopIndex = (entry: string, styles = '') => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
    <link rel="icon" href="./favicon.ico" />
    <title>TaskForceAI Desktop</title>
${styles}
    <script>window.__TASKFORCE_TAURI_READY = true;</script>
    <script type="module" src="${entry}"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`;

const contentTypeForAsset = (assetName: string) => {
  if (assetName.endsWith('.png')) return 'image/png';
  if (assetName.endsWith('.ico')) return 'image/x-icon';
  if (assetName.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
};

const desktopIndexPlugin = () => ({
  name: 'taskforceai-desktop-index',
  configureServer(server: ViteDevServer) {
    server.middlewares.use((req, res, next) => {
      void (async () => {
        const path = req.url?.split('?')[0] ?? '';
        const assetName = path.startsWith('/') ? path.slice(1) : path;

        if (publicAssetNames.includes(assetName)) {
          res.setHeader('Content-Type', contentTypeForAsset(assetName));
          res.end(readFileSync(resolve(process.cwd(), 'public', assetName)));
          return;
        }

        if (path !== '/' && path !== '/index.html') {
          next();
          return;
        }

        const html = await server.transformIndexHtml(
          path,
          renderDesktopIndex('/app/desktop-client.tsx')
        );
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
      })().catch(next);
    });
  },
  generateBundle(_options, bundle) {
    const files = Object.keys(bundle);
    const entry = files.find((asset) => /^assets\/desktop-client-.*\.js$/.test(asset));
    if (!entry) {
      throw new Error('Desktop build did not emit an index JavaScript entry.');
    }

    const styles = files
      .filter((asset) => asset.endsWith('.css'))
      .toSorted()
      .map((asset) => `    <link rel="stylesheet" href="./${asset}" />`)
      .join('\n');

    this.emitFile({
      type: 'asset',
      fileName: 'index.html',
      source: renderDesktopIndex(`./${entry}`, styles),
    });

    for (const assetName of publicAssetNames) {
      this.emitFile({
        type: 'asset',
        fileName: assetName,
        source: readFileSync(resolve(process.cwd(), 'public', assetName)),
      });
    }
  },
});

/**
 * Vite config for desktop (Tauri) builds.
 * Uses static/client-only mode instead of SSR.
 */
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [tailwindcss(), viteReact(), desktopIndexPlugin()],
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    outDir: '../desktop/dist_web/client',
    emptyOutDir: true,
    target: 'esnext',
    minify: 'esbuild',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: {
        'desktop-client': './app/desktop-client.tsx',
      },
      external: [/^node:/, '@vercel/og'],
      onwarn(warning, warn) {
        const isModuleLevelDirectiveWarning =
          warning.code === 'MODULE_LEVEL_DIRECTIVE' ||
          warning.message.includes('Module level directives cause errors when bundled');
        const isUnresolvableSourcemapWarning = warning.message.includes(
          "Can't resolve original location of error"
        );

        if (isModuleLevelDirectiveWarning || isUnresolvableSourcemapWarning) {
          return;
        }

        warn(warning);
      },
    },
  },
  optimizeDeps: {
    exclude: ['@vercel/og'],
  },
});
