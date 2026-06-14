import { fileURLToPath } from 'node:url';

import { copyOpenApiSpec } from '../../scripts/vite/copy-openapi-plugin';
import { defineTanStackAppConfig } from '../../scripts/vite/tanstack-config';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineTanStackAppConfig({
  plugins: [copyOpenApiSpec()],
  start: {
    router: {
      routeFileIgnorePattern: '\\.(test|spec)\\.[tj]sx?$',
    },
  },
  server: {
    port: 3001,
    fs: {
      allow: [repoRoot],
    },
  },
  build: {
    assetsDir: '_build',
    rollupOptions: {
      onwarn(warning, warn) {
        const isAcemirCssomEvalWarning =
          warning.code === 'EVAL' && warning.id?.includes('@acemir/cssom/lib/errorUtils.js');

        if (isAcemirCssomEvalWarning) {
          return;
        }

        warn(warning);
      },
    },
  },
});
