# Contracts

Boundary data shapes live here. These packages define wire formats and generated
or serialized DTOs; they do not own product policy or concrete transports.

- `go`: generated Go API contract types.
- `openapi`: canonical public API OpenAPI source.
- `rust`: app-server JSON-RPC/IPC protocol types shared by desktop, TUI, and
  the local app server.
- `typescript`: generated and hand-authored TypeScript API contract types.

Clients, controllers, transports, and persistence gateways belong in
`packages/adapters` or `packages/infrastructure`, not in contracts.
