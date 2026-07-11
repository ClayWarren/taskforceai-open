# Repository Guidelines

This is the public TaskForceAI monorepo: active hosted services, reusable product
packages, and the web, mobile, desktop, console, status, docs, marketing,
app-server, and TUI clients.

- Use the Bun version pinned in package.json. Do not use npm or pnpm.
- Prefer Bun for package management, scripts, and TypeScript tests.
- Use tsc for TypeScript typechecking.
- Run bun run security:check for the local multi-language security suite.
- Keep generated output, credentials, local deployment state, and build artifacts out of Git.
- Follow the public boundary documented in OPEN_SOURCE.md.
