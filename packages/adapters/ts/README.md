# TypeScript Interface Adapters

These packages translate between product rules and delivery mechanisms. They
may depend inward on `packages/core/ts` and on stable wire shapes from
`packages/contracts/typescript`. They must not import app-owned source or
concrete infrastructure packages; apps supply infrastructure implementations
through ports at composition time.

## Packages

- `api-client`: REST/auth transport and wire-response translation.
- `browser-runtime`: browser API implementations and file handling.
- `client-runtime`: client use-case coordination and streaming integration.
- `persistence`: repositories, storage gateways, and preference persistence.
- `presenters`: UI-ready labels, formatting, error mapping, and view models.
- `sync-client`: realtime and HTTP synchronization adapters.
- `voice`: voice managers and platform voice adapters.

Concrete environment, database schema, feature-flag, observability, clock,
randomness, timer, and host-runtime details belong in
`packages/infrastructure/ts`. Application startup and concrete wiring belong in
`apps/*`. React components, hooks, design tokens, and localized UI resources
belong in `packages/ui/ts`; framework-free presenters remain here.

## Remaining Audit

`packages/contracts/typescript` should remain a DTO and protocol boundary. Any
browser clients, React hooks, auth providers, or service helpers still present
there are adapter candidates and should move here in a separate change.

The dependency policy enforces package ownership, inward edges, adapter versus
infrastructure separation, app isolation, and package-cycle detection.
