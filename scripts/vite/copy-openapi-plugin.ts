import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Copies the canonical OpenAPI spec (packages/contracts/openapi/openapi.yaml) into the
 * consuming app's public/ directory so it is served at /openapi.yaml.
 *
 * The per-app copies are generated (gitignored) — edit packages/contracts/openapi/openapi.yaml
 * instead. Runs on `buildStart`, which fires for both `vite dev` and `vite build`
 * (including the build:vercel path that spawns `vite build` directly).
 */
export function copyOpenApiSpec(): Plugin {
  const source = fileURLToPath(
    new URL('../../packages/contracts/openapi/openapi.yaml', import.meta.url)
  );
  let root = process.cwd();

  return {
    name: 'copy-openapi-spec',
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      const dest = resolve(root, 'public/openapi.yaml');
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(source, dest);
    },
  };
}
