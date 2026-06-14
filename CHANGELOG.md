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
