# TypeScript Infrastructure

This directory is the target home for TypeScript Frameworks & Drivers code:
third-party SDK wrappers, host/runtime integrations, telemetry transports, and
environment/config loading. These packages are details and should sit outside
core product rules.

## Current Packages

- `packages/infrastructure/ts/db-sync`: Prisma/Drizzle schema projection,
  generated SQL artifacts, and mobile local database schema tooling.
- `packages/infrastructure/ts/feature-flags`: Statsig TypeScript/React bindings.
- `packages/infrastructure/ts/config`: Environment/config loading and API base
  URL resolution.
- `packages/infrastructure/ts/observability`: Sentry config/reporting/sanitization,
  OpenTelemetry helpers, console bridging, and Tauri log transport.

TypeScript infrastructure may depend inward on `packages/core/ts`, current
`packages/core/ts/client-core` primitives, and `packages/contracts/typescript` where
wire shapes are needed. It must not depend upward on apps or on interface
adapters in `packages/adapters/ts`.
