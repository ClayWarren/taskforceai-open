# Contributing to TaskForceAI

Thank you for your interest in contributing to TaskForceAI. This guide covers the development workflow, testing expectations, and pull request process.

## Prerequisites

- **Bun** >= 1.3.6 (primary runtime for dev/test commands)
- **Node.js** (see `.nvmrc` for version; required for Prisma/Next tooling)
- **Go** >= 1.22 (for backend microservices under `apps/auth`, `apps/core`, `apps/engine`, `apps/billing`, `apps/sync`, `apps/developer`)
- **Docker** (optional, for local Postgres/Redis)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/TaskForceAI/taskforceai.git
cd taskforceai

# Install dependencies
make install

# Copy and configure environment files
cp .env.test.example .env.local
cp .env.test.example .env.test
# Edit .env.local with your secrets (AUTH_SECRET, ENCRYPTION_KEY, AI_GATEWAY_API_KEY, etc.)

# Run database migrations
make migrate

# Start the development server
make dev
```

See [docs/guides/GETTING_STARTED.md](docs/guides/GETTING_STARTED.md) for detailed setup and [docs/guides/environment-files.md](docs/guides/environment-files.md) for environment variable reference.

## Development Workflow

1. **Create a branch** from `main` with a descriptive name (e.g., `fix/auth-token-refresh`, `feat/memory-search`).
2. **Make your changes** in the appropriate app or package directory.
3. **Run linting and type checks** before committing:
   ```bash
   make lint
   make typecheck
   ```
4. **Run the relevant test suites** (see Testing below).
5. **Commit with a clear message** describing what changed and why.

### Monorepo Structure

- **`apps/`** -- Deployable applications (web, mobile, desktop, Go microservices, Python services)
- **`packages/`** -- Shared libraries consumed by apps (Go packages, TypeScript packages, SDKs)
- **`docs/`** -- Internal documentation and guides
- **`tests/`** -- Integration and E2E test suites
- **`qa/`** -- QA infrastructure and tooling

Go services use `replace` directives in their `go.mod` to point at local `packages/*` directories. Changes to shared packages affect all consuming services.

## Testing

```bash
# Run all tests
make test

# Frontend unit tests
make test-frontend

# Backend (Go) tests with coverage
make test-backend

# E2E tests (requires running dev server)
make test-e2e

# Desktop (Tauri/Rust) tests
make test-tauri

# Mobile tests
make test-mobile
```

All pull requests should include tests for new functionality and must not break existing tests. See [docs/qa/TESTING.md](docs/qa/TESTING.md) for the full testing guide.

## Pull Request Process

1. **Ensure CI passes** -- linting, type checks, and all test suites must be green.
2. **Keep PRs focused** -- one logical change per PR. Large refactors should be discussed in an issue first.
3. **Write a clear description** explaining the motivation, what changed, and how to verify.
4. **Request review** from a maintainer. PRs require at least one approval before merge.
5. **Squash and merge** is the default merge strategy.

## Code Style

- **TypeScript/JavaScript**: Enforced by ESLint and Prettier via `make lint` and `make format`.
- **Go**: Enforced by `gofmt` and `go vet`. Run `go fmt ./...` in the relevant service directory.
- **Rust**: Enforced by `cargo fmt` and `cargo clippy` for the desktop app.
- **Python**: Enforced by Ruff for the model-server and evaluation packages.

## Reporting Issues

Use [GitHub Issues](https://github.com/TaskForceAI/taskforceai/issues) to report bugs or request features. Include reproduction steps, expected behavior, and environment details.

## Security

If you discover a security vulnerability, please report it responsibly. See [docs/security/SECURITY.md](docs/security/SECURITY.md) for the disclosure process.
