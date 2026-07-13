# Interface Adapters

`packages/adapters` contains interface-adapter code. The current Go module at
this directory contains backend service runtime support: HTTP handler
scaffolding, generated sqlc gateway bindings, logging, audit helpers,
observability, auth helpers, and server bootstrap code. The `ts/` directory
contains TypeScript interface adapters, and `rust/app-client` contains the Rust
app-server client adapter.

This package is not product core. Business rules and domain policy belong in
`packages/core`; concrete provider, cache, search, Redis, encryption,
email, resilience, and rate limit adapters belong under
`packages/infrastructure/*`.

Dependency direction:

- Apps and composition roots may import `packages/adapters`.
- `packages/adapters` may import `packages/core` for business-rule types and
  ports.
- `packages/adapters` must not import `packages/infrastructure/*`; apps wire
  concrete infrastructure clients into adapter ports.
- `packages/core` must not import `packages/adapters`.
- `packages/infrastructure/*` must not import `packages/adapters`; keep
  adapters focused and injectable from app composition roots.

The generated sqlc bindings remain here because they form the database gateway
used by repository adapters. PostgreSQL schema and query sources, migrations,
pool lifecycle, transactions, retry, and query telemetry live in
`packages/infrastructure/postgres`. Apps compose the infrastructure pool with
the generated gateway; neither sibling ring imports the other.

Encryption primitives and OAuth token field encryption live in
`packages/infrastructure/crypto` because they read runtime key material and are
concrete security mechanisms, not interface-adapter translation code.

Email delivery lives in `packages/infrastructure/email` because Resend and
fallback logging are concrete delivery mechanisms. Apps compose that service
into handlers that need email behavior.

For TypeScript, pure client product rules stay in `packages/core/ts/client-core`;
runtime and boundary translation live in `packages/adapters/ts`; React,
localization, design assets, and components live in `packages/ui/ts`; and
Sentry/OpenTelemetry/Tauri-style details live in `packages/infrastructure/ts`.
