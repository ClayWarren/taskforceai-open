import { copyOpenApiSpec } from '../../scripts/vite/copy-openapi-plugin';
import { defineTanStackAppConfig } from '../../scripts/vite/tanstack-config';

const marketingDevUrl = process.env.VITE_MARKETING_URL || 'http://127.0.0.1:5173';

export default defineTanStackAppConfig({
  plugins: [copyOpenApiSpec()],
  start: {
    router: {
      routeFileIgnorePattern: '\\.(test|spec)\\.(ts|tsx)$',
    },
  },
  server: {
    port: 3007,
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
      '^/api(/|$)': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        cookieDomainRewrite: '127.0.0.1',
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
});
