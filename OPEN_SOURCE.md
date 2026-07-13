# Open Source Boundary

TaskForceAI opens its active product and hosted-service implementation while keeping internal tools, secrets, production data, and live operational state private.

## Public Apps

- apps/app-server
- apps/auth
- apps/billing
- apps/console
- apps/core
- apps/desktop
- apps/developer
- apps/docs
- apps/engine
- apps/marketing
- apps/mobile
- apps/status
- apps/sync
- apps/tui
- apps/web

## Public Packages

All tracked source under packages is public, including:

- Product rules and orchestration core: Go, Rust, Python, TypeScript
- SDKs, API contracts, OpenAPI artifacts, and protocols
- Client and server adapters
- UI, persistence, schema sync, observability, and feature flags
- Database, cache, LLM, email, search, crypto, and provider integrations

## Private Boundary

- Admin, model-server, and evaluation apps
- Production secrets, provider credentials, deployment state, and private operational data

## Contribution Boundary

Bug fixes, product-core improvements, SDK improvements, client UX fixes, docs, tests, and provider/client compatibility improvements are welcome. Changes to authentication, billing, hosted model-routing policy, or backend control-plane behavior require maintainer design review before implementation.
