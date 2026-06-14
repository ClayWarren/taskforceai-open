import { defineTanStackAppConfig } from '../../scripts/vite/tanstack-config';

export default defineTanStackAppConfig({
  start: {
    spa: {
      enabled: true,
    },
  },
  server: {
    port: 3007,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/status.json': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: () => '/api/v1/status',
      },
      '^/api(/|$)': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        cookieDomainRewrite: '127.0.0.1',
      },
    },
  },
});
