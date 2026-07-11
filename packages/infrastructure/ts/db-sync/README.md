# @taskforceai/db-sync

Portable schema + tooling that keeps TaskForceAI local sync storage artifacts in sync.

## Workflow

1. Update `schema.prisma` with the desired changes to the shared conversation/prompt tables.
2. Run `bun run db:sync-schema` to:
   - emit canonical SQL for SQLite/Postgres,
   - hydrate a reference SQLite database,
   - regenerate the shared Drizzle schema, mobile schema re-export, and mobile migrations.

   To update only package-owned artifacts, run
   `cd packages/infrastructure/ts/db-sync && bun run generate`.

3. Commit the updated artifacts together with your schema change.

Desktop and TUI are Rust clients that sync through the app-server/API contracts; they no longer
consume copied SQL schema files from this package.

The root `db:sync-schema` script projects these package-owned artifacts into the
mobile app, so the shared Drizzle schema remains the single source of truth.
