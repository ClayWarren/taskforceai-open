# Infrastructure Packages

Concrete adapters for external systems live here. These packages are details:
Redis, cache, rate limiting, encryption, email providers, LLM providers, search
providers, resilience mechanisms, provider SDK wrappers, telemetry transports,
and config/env loaders.

Dependency direction should point inward:

- Apps and composition roots may import these packages.
- Infrastructure packages may import `packages/core` ports and domain types when
  implementing an adapter.
- `packages/core` must not import infrastructure packages.
- Infrastructure packages must not import app services or the interface adapter
  layer in `packages/adapters`.
- Business policy belongs in `packages/core`; provider, network, persistence,
  retry, cache, and telemetry details belong here.

Existing modules keep focused names under this folder:

- `cache`
- `config`
- `crypto`
- `email`
- `logger`
- `llm`
- `postgres`
- `ratelimit`
- `redis`
- `resilience`
- `rust/app-store`
- `search`

The TypeScript and Rust sides use language roots for the same ring. The
TypeScript side currently contains
`packages/infrastructure/ts/observability` and
`packages/infrastructure/ts/feature-flags`. The Rust side currently contains
`packages/infrastructure/rust/app-store`, the SQLite persistence driver for the
local app-server.
