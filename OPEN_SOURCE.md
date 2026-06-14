# Open Source Boundary

TaskForceAI opens the product client and developer platform surface while keeping the service control plane private.

## Public Apps

- apps/app-server
- apps/console
- apps/desktop
- apps/docs
- apps/marketing
- apps/mobile
- apps/status
- apps/tui
- apps/web

## Public Packages

- SDKs: Go, Python, Rust, TypeScript
- API contracts and OpenAPI artifacts
- Client runtime, React core, UI kit, design tokens
- Local persistence, sync client, observability, voice, locales
- Desktop/TUI protocol and app-server client packages

## Private Boundary

- Go backend services: auth, billing, core, developer, engine, sync
- Admin, model-server, and evaluation apps
- Backend core/shared/config/db-sync packages
- Infrastructure, Redis/cache/rate-limit/search/email/LLM packages
- Production secrets, provider credentials, deployment state, and private operational data

## Contribution Boundary

Bug fixes, SDK improvements, client UX fixes, docs, tests, and provider/client compatibility improvements are welcome. Net-new product features, billing/auth behavior, model-routing behavior, or backend control-plane behavior require maintainer design review before implementation.
