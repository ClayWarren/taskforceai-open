# Repository Guidelines

This document covers the TaskForceAI (frontier AI research lab) monorepo. "microservices" backend (apps/ auth, billing, core, engine, sync, developer) + apps/ web, mobile, desktop, cli. SDKs (typescript, rust, go, python). Rest API. 11 total vercel deployments.

- This repository is locked to the Bun version pinned in `package.json` (`packageManager`). **Do not use `npm` or `pnpm`.**
- Always prefer Bun, which is our package manager, runtime, and test runner.
- We use TypeScript 7 from the `typescript` package for typechecking; invoke its native compiler through `tsc`.
- Use Robert Martin's Clean Code/Architecture and S.O.L.I.D.
- apps/engine handles AI task execution and data synchronization.
- packages/core is the product. It contains shared data models and business logic schemas used by all Go services.
- We use Vercel for DNS. Vercel CLI is connected.

## Open-Source Subtrees

The CLI and SDKs (rust, go, python, typescript) are published as open-source on Github.
