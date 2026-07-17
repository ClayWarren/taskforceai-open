import { fileURLToPath } from 'node:url';

import { copyOpenApiSpec } from '../../scripts/vite/copy-openapi-plugin';
import { defineTanStackAppConfig } from '../../scripts/vite/tanstack-config';
import {
  marketingBuildAssetsDir,
  marketingDevServerPort,
  routeFileIgnorePattern,
  shouldSuppressBuildWarning,
} from './app/lib/vite-options';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineTanStackAppConfig({
  plugins: [copyOpenApiSpec()],
  start: {
    router: {
      routeFileIgnorePattern,
    },
  },
  server: {
    port: marketingDevServerPort,
    fs: {
      allow: [repoRoot],
    },
  },
  build: {
    assetsDir: marketingBuildAssetsDir,
    rollupOptions: {
      onwarn(warning, warn) {
        if (shouldSuppressBuildWarning(warning)) {
          return;
        }

        warn(warning);
      },
    },
  },
});
