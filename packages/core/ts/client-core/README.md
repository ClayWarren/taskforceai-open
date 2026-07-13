# TypeScript Client Core

`@taskforceai/client-core` is the platform-neutral TypeScript product ring used
by web, desktop, and mobile clients. It owns product policy, state transitions,
domain types, use-case helpers, and ports. Dependencies point inward to this
package; this package does not know which UI, network client, database, host
runtime, or provider executes it.

## Ownership

- `auth/`: device-login domain values and normalization.
- `chat/`: attachment, model, routing, approval, budget, and prompt policy.
- `json/`: deterministic JSON parsing used by product rules.
- `mcp/`: MCP endpoint and settings policy.
- `ports/`: capabilities supplied by outer rings.
- `product/`: plans and other product-level concepts.
- `random/` and `time/`: capability interfaces, not host implementations.
- `streaming/`: stream state, normalization, lifecycle, and effects expressed as data.
- `support/` and `sync/`: issue-report and synchronization policy.
- `types/`, `validation/`, and `utils/`: domain types and pure helpers.

## Outside Core

- Wire DTOs and generated protocol types: `packages/contracts`.
- API, persistence, presenters, React, browser, sync, and voice translation:
  `packages/adapters/ts`.
- Environment, database schema, feature flags, observability, clocks, IDs,
  randomness, timers, and host APIs: `packages/infrastructure/ts`.
- Framework startup and concrete dependency wiring: `apps/*` composition roots.

Core code must not call network, storage, browser, environment, clock, random,
timer, logging, or framework APIs directly. Define a port when product logic
needs a capability and inject its implementation from an app or adapter.

## Dependency Policy

`zod` is the only currently approved production dependency because schemas and
validation are part of the product boundary. New production libraries require
an explicit architecture-policy update. The dependency checker also prevents
mechanism directories such as `storage`, `logging`, and `i18n`, or files named
as storage implementations and view models, from returning to this package.

Import through the package exports, for example:

```typescript
import { selectModel } from '@taskforceai/client-core';
import type { Clock } from '@taskforceai/client-core/time/clock';
```
