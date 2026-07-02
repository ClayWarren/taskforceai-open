# TaskForceAI Desktop Architecture

## Overview

The desktop app is now a thin Tauri shell around the shared TaskForceAI web UI and the Rust app-server. Desktop-specific Rust owns native capabilities only:

1. bootstrap the webview and show the window after the frontend is ready
2. spawn and proxy the shared `taskforceai-app-server`
3. expose desktop-only native features such as terminal reveal, MCP process control, voice, observability, and locked computer use

Local product state, conversation storage, sync metadata, prompt queues, model selection, Ollama probing, skills/plugins inventory, context summary, and memory summary live behind `apps/app-server`.

## Technology Stack

- **Tauri 2.x** - Desktop app framework
- **Rust app-server** - Shared local runtime and persistence boundary
- **Tokio** - Native async runtime
- **Reqwest/RMCP** - Network and MCP support used by native desktop features
- **Tracing + Sentry** - Structured logging and crash reporting

## Runtime Flow

```text
Web UI
  |
  | Tauri invoke()
  v
Desktop command wrappers
  |
  | stdio JSON-RPC
  v
taskforceai-app-server
  |
  +-- local SQLite/runtime state
  +-- remote TaskForceAI APIs
  +-- Ollama/OpenAI-compatible local model support
```

On page load, desktop starts the app-server through `DesktopAppServer::initialize()`. The frontend may also call `app_server_initialize`; the app-server client is idempotent and reuses the running child process.

## File Structure

```text
apps/desktop/
├── Cargo.toml
├── tauri.conf.json
└── src/
    ├── main.rs
    ├── app/
    │   ├── bootstrap.rs
    │   ├── config.rs
    │   └── runtime.rs
    ├── app_server.rs
    ├── commands/
    │   ├── app_server.rs
    │   ├── logging.rs
    │   ├── mcp.rs
    │   └── ui.rs
    ├── locked_computer_use.rs
    ├── mcp/
    ├── observability.rs
    ├── state/
    └── voice/
```

## Tauri Commands

Desktop exposes `app_server_*` commands as the primary product bridge. These commands proxy to `packages/app-client-rs`, which talks to `apps/app-server` over stdio JSON-RPC.

Desktop-only commands remain in native Rust:

- `frontend_ready`
- `show_terminal`
- `terminal_execute`
- `mcp_*`
- `locked_computer_use_*`
- `log_event`
- `voice_*`

`terminal_execute` is intentionally equivalent to a VS Code integrated terminal:
it runs user-entered shell commands in the desktop app workspace and returns
bounded stdout/stderr. It is a privileged local desktop capability, not a
sandbox. Reviews should verify that it remains scoped to the desktop webview,
keeps command timeouts/output caps, and is surfaced as a deliberate user action
rather than silently callable automation.

Local-process MCP (`stdio:` or bare command endpoints) is also a privileged
desktop capability. It is disabled unless
`TASKFORCEAI_DESKTOP_ALLOW_LOCAL_PROCESS_MCP=true` is configured for a trusted
desktop runtime. Streamable HTTP MCP remains available without that local
process switch.

`voice_listen` is command-backed in desktop dev/runtime builds. Configure
`TASKFORCEAI_DESKTOP_VOICE_LISTEN_COMMAND` with a local speech-to-text command
that prints the transcript to stdout. `voice_speak` and `voice_cancel` use the
native desktop TTS engine.

## Storage

Desktop no longer owns a separate Rust SQLite database or generated REST client. The app-server is the local product runtime and persistence owner. This keeps desktop, TUI, and future clients on one local contract instead of maintaining parallel storage and sync implementations.

## Development

```bash
bun run tauri:dev:local
bun run tauri:build
```

For local dev, the root `desktop:dev:local` script starts the desktop web dev
server on port `3210`, then starts Tauri without waiting for a Tauri-managed
dev-server command. When running the pieces manually:

```bash
cd apps/web && bun run dev:desktop
cd apps/desktop && bun x tauri dev --no-dev-server-wait
```

## Verification

High-signal gates for desktop/app-server cutover work:

```bash
cargo test --manifest-path apps/desktop/Cargo.toml
cargo test --manifest-path apps/app-server/Cargo.toml
bun run typecheck:rust
bun run lint:rust
```
