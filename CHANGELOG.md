# TaskForceAI Unified Changelog

All notable changes across TaskForceAI platforms will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Platform Overview

- **Web Application** — TanStack Start multi-agent orchestration platform
- **Desktop Application** — Tauri-based macOS/Windows/Linux app
- **Mobile Application** — React Native / Expo iOS & Android
- **CLI/TUI** — Go-based terminal interface (npm distributed)
- **Server** — Pure Go backend with Vercel Functions integration

---

## [Week of 2026-06-22] — Web Reliability & Latency Follow-Through

### Web App Startup & Prompt Flow

- **Auth Bootstrap**: Cached the authenticated profile hint, bootstrapped the web shell auth/model path earlier, and kept the prompt composer usable during auth hydration.
- **Prompt Preservation**: Preserved prompt drafts through hydration and loaded prompt draft capture from the self-hosted script.
- **Sidebar Recovery**: Fixed local-first and cloud sidebar history backfills, including partial cache recovery and local pagination preservation.
- **Public Bootstrap**: Added app-shell bootstrap snapshot coverage so the public web shell can reuse known-good startup state.
- **Artifact Links**: Hid internal artifact metadata from public artifact links and tightened web response validation for public artifact payloads.

### Performance & Benchmarks

- **Latency Coverage**: Added hosted status, seeded browser, TTFT, P0, and P1 latency benchmarks with baseline comparisons.
- **Runtime Hot Paths**: Optimized sync pull, developer proxy, auth refresh, engine active-task indexing, Redis-backed rate-limit checks, and app-server event/SSE parsing.
- **Validation Gates**: Hardened benchmark manifests, organized benchmark entrypoints, fixed repo validation fallout, and documented the P1 latency optimization audit.

### Security & Maintenance

- **Security Fixes**: Fixed sync security findings and added read-media limit regression coverage.
- **Dependency Refresh**: Landed the first dependency update wave and related gate cleanup.
- **Admin Usage**: Added all-time admin token usage aggregation across the admin API, repository queries, shared SQL, and admin dashboard schemas.
- **QA Harness**: Restored the resilience and chaos QA harnesses, added meta-report generation, and covered meta-report parsing.
- **Docs Drift**: Updated the documentation drift audit and refreshed OpenAPI generation guidance plus the Go SDK README.
- **Patch Maintenance**: Refreshed the safe dependency patch set across Bun, Cargo, Python, and app package manifests.

### Key References

- No merged PRs were found in GitHub for 2026-06-19 through 2026-06-26; this entry is backed by representative commits.
- Available links:
  [web startup and sidebar recovery](https://github.com/ClayWarren/taskforceai/commit/7113671b4),
  [latency benchmarks](https://github.com/ClayWarren/taskforceai/commit/f329c7d20),
  [admin token usage](https://github.com/ClayWarren/taskforceai/commit/efa309a59),
  [public artifact metadata](https://github.com/ClayWarren/taskforceai/commit/540c5dfda),
  [QA resilience harness](https://github.com/ClayWarren/taskforceai/commit/a33cd7d49),
  [documentation drift audit](https://github.com/ClayWarren/taskforceai/commit/7a8bb23fd),
  and [safe dependency patches](https://github.com/ClayWarren/taskforceai/commit/244c94e55).

## [Week of 2026-06-15] — Reliability, Security & Runtime Performance

### 📱 Mobile & App Review

- **iOS Review Flow**: Fixed App Review-facing login and subscription flows, including the "continue without an account" path and mobile billing portal routing.
- **Account Settings**: Added mobile authenticator MFA, archived chat management, storage, memory, keyboard, notification, and AI-provider consent settings.
- **Store Builds**: Bumped mobile build numbers and hardened React Native runtime pins, worklets, NativeWind env types, and RevenueCat identity handling.

### 🛡️ Security & Release Hardening

- **Security Findings**: Remediated high, medium, low, informational, cloud, mobile, desktop command, MCP, billing, auth, and engine policy findings from the security scan pass.
- **Auth & Rate Limits**: Hardened auth session resolution, callback handling, Redis-backed rate limiting, and shared auth/audit paths.
- **Desktop Release**: Fixed macOS DMG notarization by preparing the notarytool profile in the release keychain and tightening release workflow checks.

### ⚡ Engine, Sync & Developer Experience

- **Agent Runtime**: Optimized stream chunk assembly, progress tool compaction, tool result packaging, enginecore grep scanning, read-window formatting, glob bounds, and tree rendering.
- **Sync Resolver**: Optimized metadata conflict merges and added regression coverage for sync retry and payload edge cases.
- **Quality Gates**: Parallelized Go check and test scheduling, added knip dead-code sweep tooling, and expanded full-gate coverage across backend, frontend, SDK, and shared packages.

### 🌐 Web, Marketing & Docs

- **SEO Crawlability**: Fixed marketing changelog, blog, legal, benchmark, and safe-markdown crawlability paths.
- **Deploy Manifests**: Added a checked-in Vercel app manifest and schema, plus developer API documentation drift checks.
- **Dependencies**: Updated the TypeScript RC package and refreshed the low-risk dependency patch set across Bun, Cargo, and Python lockfiles.

### 🔗 Key References

- No merged PRs were found in GitHub for 2026-06-12 through 2026-06-19; this entry is backed by representative commits.
- Available links:
  [mobile App Review](https://github.com/ClayWarren/taskforceai/commit/43f588700),
  [desktop notarization](https://github.com/ClayWarren/taskforceai/commit/c2215fa31),
  [model-server/deploy docs](https://github.com/ClayWarren/taskforceai/commit/a1d2e15e1),
  [auth and rate limits](https://github.com/ClayWarren/taskforceai/commit/43ab91bf6),
  and [TypeScript RC](https://github.com/ClayWarren/taskforceai/commit/407e275ba).
- Local-only commits on this branch also support the latest marketing, performance, dependency, and QA highlights: `953783cab`, `2bdc69070`, `3e9a4407e`, `c6b0d2102`, `c70aa2961`, `470caa45b`, and `be11af62a`.

## [Week of 2026-06-04] — App Polish & Progress Fidelity

### 🌐 Web & Marketing

- **Benchmarks**: Split benchmarks into a dedicated section and refreshed the public model comparison copy.
- **Changelog**: Updated the changelog page layout so long release notes render fully instead of clipping inside the panel.
- **Model Labels**: Ensured Sentinel is presented as TaskForceAI's public model across progress and model-selection UI.

### 🤖 Agent Experience

- **Progress Bubble**: Improved sparse progress smoothing so long-running work feels active without claiming completion early.
- **Tool Usage**: Matched live tool events more reliably to agent rows, including custom model labels and single-agent runs.

---

## [Week of 2026-01-19] — Speed & Polish

### ⚡ Core Engine

- **Quick Mode**: Introduced a new mode to bypass multi-agent orchestration for instant, direct model responses.
- **Performance**: Optimized server response times for non-complex queries.

### 📚 Documentation

- **User Guide**: Updated `USER_FEATURES.md` with Quick Mode instructions.

---

## [Week of 2025-12-30] — New Year, New Stack

### 🏗️ Architecture & Ops

- **Web Migration**: Migrated the web application to **TanStack Start**
- **Server Port**: Completed transition to a pure **Go server**
- **Marketing Split**: Extracted marketing site into `apps/marketing`
- **Vercel Functions**: Implemented Go runtime support

### 🌐 Web & Marketing

- Added OG image generation using `@vercel/og`
- Implemented full-page navigation
- Decoupled authentication logic from framework-specific dependencies

---

## [Week of 2025-12-23] — The Go Rewrite & Clean Architecture

### ⚡ Core Engine

- **Go Port**: Ported orchestration engine and shared packages (100% coverage)
- **SOLID Refactor**: Clean Architecture refactor across backend
- **Dependency Injection**: DIP for LLM clients, caching, repositories

### 🧪 Testing

- Achieved **97% test coverage**
- Standardized test suites across packages

---

## [Week of 2025-12-16] — UI/UX Polish & E2E Stability

### 🎨 Frontend

- AI-powered background removal for logos
- Improved voice control resilience with stop capability
- Refreshed landing page and blog

### 🤖 Automation

- Stabilized Detox / Playwright E2E tests
- Met 80%+ frontend coverage targets

---

## [Week of 2025-12-09] — Modularization

### 🧩 Refactoring

- Broke monoliths into focused components (<300 LOC)
- Refactored agent orchestration & search tooling
- Reorganized build & maintenance scripts

---

## [Week of 2025-12-02] — Toolchain & Performance

### 🛠️ Developer Experience

- Migrated from ESLint → **Oxlint**
- Prepared for TS7 features
- Repo-wide clean code & logging pass

---

## [Week of 2025-11-25] — Type Safety & Models

### 🛡️ Safety

- Enforced strict DB structs in Go/Desktop
- Python SDK modularized with Pydantic
- Shared validation packages added

---

## [Week of 2025-11-18] — Testing & Logging

### 🧪 Quality Assurance

- Migrated tests to **Bun**
- Structured JSON logging everywhere
- Cleaned agent/environment docs

---

## [Week of 2025-11-11] — Infrastructure & Gateway

### ☁️ Cloud & Data

- Migrated to **Vercel AI Gateway**
- Integrated Upstash Redis & tRPC v11
- Mobile UI aligned for NativeWind v5

---

## [Week of 2025-11-04] — Cross-Platform Expansion

### 🖥️ Desktop & CLI

- Windows/Linux desktop builds
- Cross-platform CLI binaries
- Installer distribution via Vercel Blob
- CLI v0.6.2 released

### 📱 Mobile

- Secure storage & Google OAuth
- Offline-first sync improvements
- CI minutes reduced ~75%

---

## [0.1.1] — 2025-11-04

### 🖥️ Desktop Application (Tauri)

- Bundled the standalone web server with embedded SQLite
- Fixed Dexie initialization & pnpm symlink issues

---

## [1.0.0] — 2025-11-03

### 🚀 Initial Major Release

- **Web**: Multi-agent system, TanStack Start, Stripe, Redis, Prisma
- **Desktop**: Native macOS app with Sparkle updates
- **Mobile**: React Native (Expo SDK 54)
- **CLI**: Go TUI (Bubble Tea)
- **SDKs**: TypeScript & Python
- **API**: Public REST API with tiered pricing

---

## Release Process & Links

- Website: https://taskforceai.chat
- Docs: https://docs.taskforceai.chat
- GitHub: https://github.com/TaskForceAI/taskforceai

[Unreleased]: https://github.com/TaskForceAI/taskforceai/compare/v1.0.0...HEAD
