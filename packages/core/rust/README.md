# Rust Core

Rust product rules and reusable domain policy live here.

This crate must stay independent of app-server runtime wiring, SQLite, HTTP,
keyring, MCP transports, UI, and provider SDKs. Rust adapters, infrastructure,
apps, and SDKs may depend inward on this crate when they need shared product
policy.

Current Rust ring split:

- `packages/core/rust`: pure Rust product policy.
- `packages/contracts/rust`: JSON-RPC and app-server protocol DTOs.
- `packages/adapters/rust/app-client`: app-server protocol client adapter.
- `packages/infrastructure/rust/app-store`: SQLite persistence driver.
- `packages/sdk/rust`: public SDK.
