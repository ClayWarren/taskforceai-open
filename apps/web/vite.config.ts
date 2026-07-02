import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { createLogger, defineConfig } from 'vite';
import { copyOpenApiSpec } from '../../scripts/vite/copy-openapi-plugin';

const isProduction = process.env.NODE_ENV === 'production';
const marketingDevUrl = process.env['VITE_MARKETING_URL'] || 'http://127.0.0.1:5173';
const viteLogger = createLogger();
const warn = viteLogger.warn.bind(viteLogger);
const warnOnce = viteLogger.warnOnce.bind(viteLogger);
const shouldSuppressBrowserExternalizationWarning = (message: string) =>
  message.includes(
    'Module "diagnostics_channel" has been externalized for browser compatibility'
  ) && message.includes('node_modules/ai/');

viteLogger.warn = (message, options) => {
  if (shouldSuppressBrowserExternalizationWarning(message)) {
    return;
  }
  warn(message, options);
};

viteLogger.warnOnce = (message, options) => {
  if (shouldSuppressBrowserExternalizationWarning(message)) {
    return;
  }
  warnOnce(message, options);
};

export default defineConfig({
  customLogger: viteLogger,
  plugins: [
    copyOpenApiSpec(),
    tailwindcss(),
    tanstackStart({
      router: {
        routeFileIgnorePattern: '\\.(test|spec)\\.(ts|tsx)$',
      },
      srcDirectory: 'app',
    }),
    viteReact(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: 3000,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api/auth': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
        cookieDomainRewrite: '127.0.0.1',
      },
      '/api/v1/auth': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
        cookieDomainRewrite: '127.0.0.1',
      },
      '/api/v1/run': {
        target: 'http://127.0.0.1:3005',
        changeOrigin: true,
        cookieDomainRewrite: '127.0.0.1',
      },
      '/api/v1/stream': {
        target: 'http://127.0.0.1:3005',
        changeOrigin: true,
        cookieDomainRewrite: '127.0.0.1',
      },
      '/api/v1/sync': {
        target: 'http://127.0.0.1:3006',
        changeOrigin: true,
        cookieDomainRewrite: '127.0.0.1',
      },
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        cookieDomainRewrite: '127.0.0.1',
        bypass(req) {
          if (
            req.url?.startsWith('/api/og') ||
            req.url?.startsWith('/api/realtime') ||
            req.url?.startsWith('/api/dictation') ||
            req.url?.startsWith('/api/speech')
          ) {
            return req.url;
          }
          return undefined;
        },
      },
      '/enterprise': {
        target: marketingDevUrl,
        changeOrigin: true,
      },
      '/help': {
        target: marketingDevUrl,
        changeOrigin: true,
      },
    },
  },
  build: {
    // Suppress chunk size warning - TanStack Start handles SSR bundling
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      // Externalize node built-ins only
      external: [/^node:/],
      output: {
        manualChunks(id) {
          if (id.includes('@tanstack/react-router') || id.includes('@tanstack/react-query')) {
            return 'vendor-tanstack';
          }

          return undefined;
        },
      },
    },
  },
  // Only bundle all dependencies for production serverless deployment
  // In dev mode, this breaks CommonJS modules like React
  ...(isProduction && {
    ssr: {
      noExternal: true,
    },
  }),
  optimizeDeps: {
    // No exclusions needed
  },
});
