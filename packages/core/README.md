# Core

`packages/core` is the product ring. It owns business rules, domain models, use
cases, and ports. Delivery, database, provider SDK, UI, runtime, and framework
details belong outside this folder.

Language roots make the intended Clean Architecture matrix explicit:

- `go/`: Go product rules and domain services.
- `python/`: Python product rules and reusable domain policy.
- `rust/`: Rust product rules and reusable domain policy.
- `ts/`: TypeScript product/client rules, currently rooted at
  `packages/core/ts/client-core`.

Keep language roots independent of delivery, storage, provider SDKs, UI, and
runtime wiring. Put those details in adapters, infrastructure, or apps.

## Deliberate exception: YAML in `go/pkg/config`

`packages/core/go/pkg/config` owns the product's user-facing config file
semantics — which keys exist, defaults, merge and override rules. That is
product policy, distinct from `packages/infrastructure/config`, which loads
host/deployment environment variables and stays outside core.

Because the config file format (YAML) is part of the product's contract with
users, core decodes it directly (the `go.yaml.in/yaml` dependency), the same
way core uses `encoding/json` for JSON-shaped policy data. File location and
reading stay behind the `ConfigLoaderSource` port; apps inject the sources.
Do not add I/O, env reading, or provider formats here — only the contract
format decode is allowed.
