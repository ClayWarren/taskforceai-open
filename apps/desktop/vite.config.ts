import tailwindcss from '@tailwindcss/vite';
import viteReact from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';

const desktopRoot = fileURLToPath(new URL('.', import.meta.url));
const webPublicRoot = resolve(desktopRoot, '../web/public');
const desktopPublicRoot = resolve(desktopRoot, 'ui/public');

const publicAssetNames = [
  'android-chrome-192x192.png',
  'android-chrome-512x512.png',
  'apple-touch-icon.png',
  'desktop-browser-start.html',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'favicon.ico',
  'icon.png',
  'manifest.json',
  'provider-logos/anthropic.png',
  'provider-logos/gemini.png',
  'provider-logos/meta.png',
  'provider-logos/openai.png',
  'provider-logos/xai.png',
];

const readPublicAsset = (assetName: string) =>
  readFileSync(
    resolve(
      assetName === 'desktop-browser-start.html' ? desktopPublicRoot : webPublicRoot,
      assetName
    )
  );

export const renderDesktopIndex = (entry: string, styles = '') => `<!doctype html>
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

export const contentTypeForAsset = (assetName: string) => {
  if (assetName.endsWith('.html')) return 'text/html';
  if (assetName.endsWith('.png')) return 'image/png';
  if (assetName.endsWith('.ico')) return 'image/x-icon';
  if (assetName.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
};

export const desktopIndexPlugin = (): Plugin => ({
  name: 'taskforceai-desktop-index',
  configureServer(server: ViteDevServer) {
    server.middlewares.use((req, res, next) => {
      void (async () => {
        const path = req.url?.split('?')[0] ?? '';
        const assetName = path.startsWith('/') ? path.slice(1) : path;

        if (publicAssetNames.includes(assetName)) {
          res.setHeader('Content-Type', contentTypeForAsset(assetName));
          res.end(readPublicAsset(assetName));
          return;
        }

        if (path !== '/' && path !== '/index.html') {
          next();
          return;
        }

        const html = await server.transformIndexHtml(
          path,
          renderDesktopIndex('/ui/desktop-client.tsx')
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
        source: readPublicAsset(assetName),
      });
    }
  },
});

/**
 * Vite config for desktop (Tauri) builds.
 * Uses static/client-only mode instead of SSR.
 */
export default defineConfig({
  root: desktopRoot,
  base: './',
  publicDir: false,
  plugins: [tailwindcss(), viteReact(), desktopIndexPlugin()],
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    outDir: './dist_web/client',
    emptyOutDir: true,
    target: 'esnext',
    minify: 'esbuild',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: {
        'desktop-client': './ui/desktop-client.tsx',
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
