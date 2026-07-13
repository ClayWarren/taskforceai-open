# @taskforceai/openapi

Canonical source of the public **TaskForceAI Developer API** OpenAPI spec.

`openapi.yaml` here is the single source of truth. It is copied into each app's
`public/openapi.yaml` (served at `/openapi.yaml`) at build time — those copies are
gitignored. **Edit this file, not the per-app copies.**

Consumers:

| App         | Copy mechanism                                                       |
| ----------- | -------------------------------------------------------------------- |
| web         | `copyOpenApiSpec()` vite plugin (`scripts/vite/copy-openapi-plugin`) |
| marketing   | `copyOpenApiSpec()` vite plugin                                      |
| console     | `copyOpenApiSpec()` vite plugin                                      |
| docs (Next) | `predev` / `prebuild` `cp` step in `apps/docs/package.json`          |
