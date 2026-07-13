# PostgreSQL Infrastructure

This module owns concrete PostgreSQL details: schema and sqlc query sources,
embedded migrations, connection-pool lifecycle, transactions, retry policy,
and query telemetry.

The sqlc generator writes Go gateway bindings to
`packages/adapters/pkg/db`. Those generated bindings remain in the interface
adapter ring because repository adapters consume them to translate database
rows into core types. Apps compose that gateway with `postgres.GetPool` in
their app-local `pkg/database` package.

Dependency direction is intentionally two-way independent:

- This module does not import `packages/adapters` or app modules.
- `packages/adapters` does not import this module.
- Apps may import both modules and wire them together.

Run `bun run generate:sqlc` after changing files under `sqlc/`.
