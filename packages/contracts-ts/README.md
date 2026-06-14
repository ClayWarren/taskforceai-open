# @taskforceai/contracts

Canonical API contracts for TaskForceAI. This package hosts:

- `schema/openapi.json`: the canonical OpenAPI document used to generate Go/Rust/TypeScript clients (`bun run generate:clients`).
- `src/contracts.ts`: Zod schemas + TypeScript types that power the web/mobile/desktop frontends.
- `src/client.ts`, `src/browserClient.ts`, `src/hooks.ts`: shared API helpers with built-in resiliency metrics.

Every app (web, mobile, desktop, CLI) should import from `@taskforceai/contracts` instead of referencing deep `shared` paths. This keeps the monorepo DRY and guarantees a single source of truth for request/response shapes.

Derived contract artifacts are intentionally gitignored:

- `src/openapi-schemas.generated.ts`

Run `bun run generate:contracts` from the repo root before directly typechecking or testing this package outside the root scripts.
