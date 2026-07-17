# TaskForceAI App Server

Local TaskForceAI runtime process for first-party TaskForceAI clients.

The app-server exists so TUI, desktop, web-adjacent local clients, and future
native surfaces can share product/runtime behavior instead of re-implementing
auth, persistence, sync, MCP, and execution separately.

The app-server is an async Rust process with the same three transport classes
used by the Codex and T3 Code local runtimes: stdio for the embedded desktop/TUI
process boundary, loopback HTTP for local clients, and an authenticated
WebSocket relay for persistent Remote sessions. All transports share the same
runtime and JSON-RPC command handlers.

## Transport

- `stdio`: newline-delimited JSON-RPC request/response and `event`
  notifications. Desktop and TUI use this as the local process boundary.
- `HTTP`: loopback JSON-RPC, health, event, and mobile-session routes. Binding
  to a non-loopback address requires an explicit mobile network configuration.
- `WebSocket`: the desktop host keeps an outbound authenticated connection to
  the Sync Remote relay. Redis Streams preserve command state across reconnects;
  an acknowledged cursor prevents a dropped socket from losing results. HTTP
  long polling remains the reconnect fallback.

## Local State

Run history is persisted in SQLite. By default the server stores data at:

```text
~/.taskforceai/app-server.sqlite3
```

Set `TASKFORCE_APP_SERVER_RUN_STORE` to point a client or test run at a
different SQLite database file.

Set `TASKFORCE_APP_SERVER_API_BASE_URL` to point API-adapter checks at a local
or staged TaskForceAI backend. The legacy `TASKFORCE_API_BASE_URL` name is also
accepted for compatibility.

When started from the environment-backed config, auth tokens are stored in the
OS keychain. SQLite metadata is read as a legacy compatibility fallback, but new
environment-backed logins are not written there. Unit tests and explicit
in-memory runtimes keep auth tokens in the runtime metadata map.

## Implemented Methods

| Method                              | Params                                                                                                                                                                                                      | Result                                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize`                        | `{}`                                                                                                                                                                                                        | server metadata, transport, capabilities                                                                                                            |
| `server.ping`                       | `{}`                                                                                                                                                                                                        | `{ "ok": true }`                                                                                                                                    |
| `server.describe`                   | `{}`                                                                                                                                                                                                        | exact embedded protocol version, capabilities, stable methods, and experimental methods                                                             |
| `config.get`                        | `{}`                                                                                                                                                                                                        | local runtime config                                                                                                                                |
| `auth.status`                       | `{}`                                                                                                                                                                                                        | current auth state                                                                                                                                  |
| `auth.logout`                       | `{}`                                                                                                                                                                                                        | cleared local auth state                                                                                                                            |
| `auth.deviceStart`                  | `{}`                                                                                                                                                                                                        | device login code and verification URL                                                                                                              |
| `auth.devicePoll`                   | `{ "deviceCode": "..." }`                                                                                                                                                                                   | device login status and token                                                                                                                       |
| `api.health`                        | `{}`                                                                                                                                                                                                        | configured API base URL health                                                                                                                      |
| `history.list`                      | `{ "limit": 50 }`                                                                                                                                                                                           | recent runs                                                                                                                                         |
| `run.search`                        | `{ "query": "...", "limit": 10 }`                                                                                                                                                                           | local run prompt/output/error matches                                                                                                               |
| `run.submit`                        | `{ "prompt": "...", "modelId": "...", "quickMode": true, "projectId": 1, "attachmentIds": ["..."] }`                                                                                                        | created run                                                                                                                                         |
| `run.status`                        | `{ "runId": "..." }`                                                                                                                                                                                        | run                                                                                                                                                 |
| `run.cancel`                        | `{ "runId": "..." }`                                                                                                                                                                                        | updated run                                                                                                                                         |
| `run.delete`                        | `{ "runId": "..." }`                                                                                                                                                                                        | deleted run acknowledgement                                                                                                                         |
| `pendingPrompt.list`                | `{}`                                                                                                                                                                                                        | prompts queued for retry after submission failure                                                                                                   |
| `pendingPrompt.add`                 | `{ "id": "pp-1", "prompt": "...", "modelId": "gpt-5", "projectId": 1, "status": "queued", "retryCount": 0, "lastError": null, "createdAt": 1, "updatedAt": 1 }`                                             | queued pending prompt                                                                                                                               |
| `pendingPrompt.delete`              | `{ "pendingPromptId": "..." }`                                                                                                                                                                              | deleted pending prompt acknowledgement                                                                                                              |
| `pendingPrompt.replay`              | `{}`                                                                                                                                                                                                        | replayed queued pending prompt                                                                                                                      |
| `attachment.list`                   | `{}`                                                                                                                                                                                                        | pending attachments for the next run                                                                                                                |
| `attachment.add`                    | `{ "path": "/path/to/file" }`                                                                                                                                                                               | uploaded attachment and pending attachment list                                                                                                     |
| `attachment.clear`                  | `{}`                                                                                                                                                                                                        | cleared pending attachment list                                                                                                                     |
| `project.list`                      | `{}`                                                                                                                                                                                                        | remote projects plus active local project                                                                                                           |
| `project.create`                    | `{ "name": "...", "description": "..." }`                                                                                                                                                                   | created remote project                                                                                                                              |
| `project.delete`                    | `{ "projectId": 1 }`                                                                                                                                                                                        | deleted remote project acknowledgement                                                                                                              |
| `project.use`                       | `{ "projectId": 1 }`                                                                                                                                                                                        | active project setting                                                                                                                              |
| `project.clear`                     | `{}`                                                                                                                                                                                                        | cleared active project setting                                                                                                                      |
| `orchestration.get`                 | `{}`                                                                                                                                                                                                        | role-model assignments and autonomous budget                                                                                                        |
| `orchestration.setRole`             | `{ "role": "Researcher", "modelId": "gpt-5" }`                                                                                                                                                              | updated role-model assignment                                                                                                                       |
| `orchestration.setBudget`           | `{ "budget": 50 }`                                                                                                                                                                                          | updated autonomous budget                                                                                                                           |
| `orchestration.clear`               | `{}`                                                                                                                                                                                                        | cleared orchestration config                                                                                                                        |
| `quickMode.get`                     | `{}`                                                                                                                                                                                                        | current direct-chat state                                                                                                                           |
| `quickMode.set`                     | `{ "enabled": true }`                                                                                                                                                                                       | updated direct-chat state                                                                                                                           |
| `settings.local.get`                | `{}`                                                                                                                                                                                                        | local theme, telemetry, and logging settings                                                                                                        |
| `settings.local.update`             | `{ "theme": "dark", "loggingLevel": "debug" }`                                                                                                                                                              | updated local settings                                                                                                                              |
| `permissionProfile.list`            | `{}`                                                                                                                                                                                                        | built-in permission profiles and filesystem/network scope                                                                                           |
| `permissionGrant.list`              | `{ "threadId": "..." }`                                                                                                                                                                                     | remembered approvals, optionally filtered to a thread                                                                                               |
| `permissionGrant.clear`             | `{ "threadId": "...", "signature": "..." }`                                                                                                                                                                 | clears one or all remembered approvals for a thread                                                                                                 |
| `model.list`                        | `{}`                                                                                                                                                                                                        | model selector options and selected model                                                                                                           |
| `modelProvider.list`                | `{}`                                                                                                                                                                                                        | providers, model IDs, modalities, and tool/search/generation capabilities                                                                           |
| `model.select`                      | `{ "modelId": "gpt-5" }`                                                                                                                                                                                    | updated selected model                                                                                                                              |
| `model.reset`                       | `{}`                                                                                                                                                                                                        | cleared selected model                                                                                                                              |
| `integration.list`                  | `{}`                                                                                                                                                                                                        | typed connected-app catalog                                                                                                                         |
| `integration.get`                   | `{ "integrationId": "github" }`                                                                                                                                                                             | one connected-app record                                                                                                                            |
| `integration.connect`               | `{ "integrationId": "github" }`                                                                                                                                                                             | app record with authorization URL                                                                                                                   |
| `integration.disconnect`            | `{ "integrationId": "github" }`                                                                                                                                                                             | typed disconnect result                                                                                                                             |
| `conversation.list`                 | `{ "limit": 50 }`                                                                                                                                                                                           | local conversations                                                                                                                                 |
| `conversation.get`                  | `{ "conversationId": "..." }`                                                                                                                                                                               | local conversation by ID                                                                                                                            |
| `conversation.upsert`               | `{ "conversationId": "...", "title": "...", "createdAt": 1, "updatedAt": 2, "lastMessagePreview": "..." }`                                                                                                  | written local conversation                                                                                                                          |
| `conversation.replaceId`            | `{ "oldConversationId": "...", "newConversationId": "..." }`                                                                                                                                                | rewrites local conversation and message references                                                                                                  |
| `conversation.delete`               | `{ "conversationId": "..." }`                                                                                                                                                                               | deleted local conversation acknowledgement                                                                                                          |
| `message.list`                      | `{ "conversationId": "..." }`                                                                                                                                                                               | local messages                                                                                                                                      |
| `message.get`                       | `{ "messageId": "..." }`                                                                                                                                                                                    | local message by ID                                                                                                                                 |
| `message.upsert`                    | `{ "messageId": "...", "conversationId": "...", "role": "user", "content": "...", "createdAt": 1, "updatedAt": 2 }`                                                                                         | written local message                                                                                                                               |
| `message.delete`                    | `{ "messageId": "..." }`                                                                                                                                                                                    | deleted local message acknowledgement                                                                                                               |
| `pendingChange.list`                | `{}`                                                                                                                                                                                                        | local offline sync changes                                                                                                                          |
| `pendingChange.add`                 | `{ "type": "message", "entityId": "...", "operation": "update", "data": {}, "createdAt": 1 }`                                                                                                               | queued offline sync change                                                                                                                          |
| `pendingChange.updateData`          | `{ "id": 1, "data": {} }`                                                                                                                                                                                   | updated queued sync payload acknowledgement                                                                                                         |
| `pendingChange.delete`              | `{ "id": 1 }`                                                                                                                                                                                               | removed queued sync change acknowledgement                                                                                                          |
| `pendingChange.clear`               | `{}`                                                                                                                                                                                                        | cleared queued sync changes acknowledgement                                                                                                         |
| `promptQueue.list`                  | `{}`                                                                                                                                                                                                        | queued prompts with dispatch steering                                                                                                               |
| `promptQueue.add`                   | `{ "conversationId": "...", "prompt": "...", "status": "queued", "dispatchTiming": "immediate", "createdAt": 1, "updatedAt": 1, "modelId": "gpt-5", "attachmentIds": [] }`                                  | queued prompt; `immediate` dispatches through `run.submit`, `after_response` waits for a completed run                                              |
| `promptQueue.delete`                | `{ "id": 1 }`                                                                                                                                                                                               | removed queued prompt acknowledgement                                                                                                               |
| `promptQueue.clear`                 | `{}`                                                                                                                                                                                                        | cleared queued prompts acknowledgement                                                                                                              |
| `promptQueue.dispatchAfterResponse` | `{ "conversationId": "..." }`                                                                                                                                                                               | dispatches the next `after_response` prompt for a completed conversation                                                                            |
| `metadata.get`                      | `{ "key": "device_id" }`                                                                                                                                                                                    | metadata value                                                                                                                                      |
| `metadata.set`                      | `{ "key": "device_id", "value": "..." }`                                                                                                                                                                    | acknowledgement                                                                                                                                     |
| `metadata.clearAll`                 | `{}`                                                                                                                                                                                                        | clears local conversations, messages, pending queues, and metadata                                                                                  |
| `sync.status`                       | `{}`                                                                                                                                                                                                        | local sync metadata state                                                                                                                           |
| `sync.configure`                    | `{ "deviceId": "...", "lastSyncVersion": 1 }`                                                                                                                                                               | updated local sync metadata                                                                                                                         |
| `sync.ensureDevice`                 | `{}`                                                                                                                                                                                                        | existing or generated local device ID                                                                                                               |
| `sync.pull`                         | `{ "limit": 50 }`                                                                                                                                                                                           | cloud sync pull when authenticated, otherwise local snapshot                                                                                        |
| `sync.push`                         | `{ "conversations": [], "messages": [], "newVersion": 2 }`                                                                                                                                                  | cloud sync push when authenticated, otherwise accepted local writes; empty record lists snapshot local SQLite conversations/messages when available |
| `sync.realtimePoll`                 | `{ "lastEventId": "..." }`                                                                                                                                                                                  | cloud realtime sync poll when authenticated, otherwise unchanged cursor                                                                             |
| `sync.run`                          | `{ "lastEventId": "..." }`                                                                                                                                                                                  | alias for `sync.realtimePoll`                                                                                                                       |
| `status.summary`                    | `{}`                                                                                                                                                                                                        | structured runtime/auth/run/model/direct-chat state                                                                                                 |
| `usage.summary`                     | `{}`                                                                                                                                                                                                        | structured run counts by status                                                                                                                     |
| `agentSession.list`                 | `{}`                                                                                                                                                                                                        | local background agent sessions                                                                                                                     |
| `agentSession.create`               | `{ "objective": "...", "title": "...", "source": "tui" }`                                                                                                                                                   | created local agent session                                                                                                                         |
| `agentSession.get`                  | `{ "sessionId": "..." }`                                                                                                                                                                                    | local agent session                                                                                                                                 |
| `agentSession.pause`                | `{ "sessionId": "..." }`                                                                                                                                                                                    | paused local agent session                                                                                                                          |
| `agentSession.resume`               | `{ "sessionId": "..." }`                                                                                                                                                                                    | resumed local agent session                                                                                                                         |
| `agentSession.cancel`               | `{ "sessionId": "..." }`                                                                                                                                                                                    | cancelled local agent session                                                                                                                       |
| `agentSession.message`              | `{ "sessionId": "...", "message": "..." }`                                                                                                                                                                  | updated local agent session steering message                                                                                                        |
| `agentSession.fork`                 | `{ "sessionId": "..." }`                                                                                                                                                                                    | forked local agent session                                                                                                                          |
| `agentSession.run`                  | `{ "sessionId": "...", "prompt": "...", "modelId": "..." }`                                                                                                                                                 | submitted an app-server run owned by the agent session                                                                                              |
| `agentMode.list`                    | `{}`                                                                                                                                                                                                        | discoverable chat, work, and code presets                                                                                                           |
| `diagnostics.inspect`               | `{}`                                                                                                                                                                                                        | runtime, account, model, extension, and automation diagnostics                                                                                      |
| `diagnostics.submit`                | `{ "service": "desktop", "level": "warn", "message": "...", "threadId": "...", "extra": {} }`                                                                                                               | structured client diagnostic acknowledgement                                                                                                        |
| `serverRequest.list`                | `{ "threadId": "..." }`                                                                                                                                                                                     | pending approvals, questions, MCP elicitations, and dynamic tool calls                                                                              |
| `channel.list`                      | `{}`                                                                                                                                                                                                        | local automation channels                                                                                                                           |
| `channel.add`                       | `{ "name": "desktop", "kind": "local", "targetSessionId": "...", "enabled": true }`                                                                                                                         | created local automation channel                                                                                                                    |
| `channel.delete`                    | `{ "channelId": "..." }`                                                                                                                                                                                    | removed local automation channel                                                                                                                    |
| `channel.push`                      | `{ "channelId": "...", "message": "...", "dispatch": true }`                                                                                                                                                | pushed a message into a channel, optionally dispatching its target agent session                                                                    |
| `schedule.list`                     | `{}`                                                                                                                                                                                                        | local scheduled task definitions                                                                                                                    |
| `schedule.add`                      | `{ "name": "daily triage", "prompt": "...", "cadence": "daily", "targetSessionId": "...", "enabled": true }`                                                                                                | created local scheduled task definition                                                                                                             |
| `schedule.delete`                   | `{ "scheduleId": "..." }`                                                                                                                                                                                   | removed local scheduled task definition                                                                                                             |
| `schedule.enable`                   | `{ "scheduleId": "..." }`                                                                                                                                                                                   | enabled local scheduled task definition                                                                                                             |
| `schedule.disable`                  | `{ "scheduleId": "..." }`                                                                                                                                                                                   | disabled local scheduled task definition                                                                                                            |
| `schedule.tick`                     | `{ "now": 1767139200000 }`                                                                                                                                                                                  | dispatched due schedules into app-server runs or target agent sessions                                                                              |
| `workflow.list`                     | `{}`                                                                                                                                                                                                        | saved local workflow definitions                                                                                                                    |
| `workflow.save`                     | `{ "workflow": { "workflowId": "codebase-audit", "name": "Codebase audit", "version": "1.0.0", "visibility": "project", "phases": [{ "phaseId": "fanout", "name": "Path auditors", "kind": "fanout" }] } }` | created or updated a local workflow definition                                                                                                      |
| `workflow.get`                      | `{ "workflowId": "codebase-audit" }`                                                                                                                                                                        | local workflow definition                                                                                                                           |
| `workflow.delete`                   | `{ "workflowId": "codebase-audit" }`                                                                                                                                                                        | removed local workflow definition                                                                                                                   |
| `workflow.run`                      | `{ "workflowId": "codebase-audit", "args": { "paths": ["apps/app-server"] } }`                                                                                                                              | queued a durable local workflow run                                                                                                                 |
| `workflowRun.list`                  | `{}`                                                                                                                                                                                                        | local workflow runs                                                                                                                                 |
| `workflowRun.get`                   | `{ "runId": "workflow-run-..." }`                                                                                                                                                                           | local workflow run                                                                                                                                  |
| `workflowRun.pause`                 | `{ "runId": "workflow-run-..." }`                                                                                                                                                                           | paused local workflow run                                                                                                                           |
| `workflowRun.resume`                | `{ "runId": "workflow-run-..." }`                                                                                                                                                                           | resumed local workflow run                                                                                                                          |
| `workflowRun.cancel`                | `{ "runId": "workflow-run-..." }`                                                                                                                                                                           | cancelled local workflow run                                                                                                                        |
| `skill.list`                        | `{}`                                                                                                                                                                                                        | discovered local/repo/admin skills                                                                                                                  |
| `plugin.list`                       | `{}`                                                                                                                                                                                                        | discovered local plugins                                                                                                                            |
| `computerUse.status`                | `{}`                                                                                                                                                                                                        | Computer Use support, installation, and permission guidance                                                                                         |
| `browser.status`                    | `{}`                                                                                                                                                                                                        | in-app browser support, installation, and scope guidance                                                                                            |
| `context.summary`                   | `{}`                                                                                                                                                                                                        | approximate context breakdown and optimization suggestions                                                                                          |
| `memory.summary`                    | `{}`                                                                                                                                                                                                        | discovered durable memory/instruction sources and size estimates                                                                                    |
| `mcp.list`                          | `{}`                                                                                                                                                                                                        | configured MCP servers                                                                                                                              |
| `mcp.add`                           | `{ "name": "files", "endpoint": "https://example.com/mcp", "tools": ["read"], "enabled": true }`                                                                                                            | configured MCP server                                                                                                                               |
| `mcp.remove`                        | `{ "name": "files" }`                                                                                                                                                                                       | removed MCP server acknowledgement                                                                                                                  |
| `mcp.enable`                        | `{ "name": "files" }`                                                                                                                                                                                       | enabled MCP server                                                                                                                                  |
| `mcp.disable`                       | `{ "name": "files" }`                                                                                                                                                                                       | disabled MCP server                                                                                                                                 |
| `mcp.tools`                         | `{ "name": "files", "tools": ["read"] }`                                                                                                                                                                    | updated MCP tool allowlist                                                                                                                          |
| `mcp.available`                     | `{}`                                                                                                                                                                                                        | enabled MCP server inventory and adapter readiness                                                                                                  |
| `mcp.inspect`                       | `{ "name": "files" }`                                                                                                                                                                                       | configured MCP server details, parsed transport, and adapter readiness                                                                              |
| `mcpServerStatus/list`              | `{ "cursor": null, "limit": 50, "detail": "full", "threadId": null }`                                                                                                                                       | paged live MCP server metadata, tools, prompts, resources, templates, auth, and connection status                                                   |
| `mcp.callTool`                      | `{ "name": "files", "tool": "read", "input": {} }`                                                                                                                                                          | MCP tool-call readiness/result envelope                                                                                                             |
| `command.execute`                   | `{ "input": "/direct on" }`                                                                                                                                                                                 | command result                                                                                                                                      |
| `shutdown`                          | `{}`                                                                                                                                                                                                        | `{ "ok": true }`                                                                                                                                    |

### Thread, streaming, and process surfaces

The canonical slash methods also accept their dotted compatibility aliases:

- `thread/list` supports cursor paging plus `search`, `workspaceRoot`, `state`,
  and `parentThreadId` filters. `thread/children` and `thread/status/list`
  expose hierarchy and active-turn state.
- `thread/start` accepts an omitted or blank objective for clients that create
  the thread before the first turn. Successful `thread/start` and
  `thread/resume` calls subscribe the connection and replay that thread's
  pending server requests before new work continues.
- `turn/start` accepts `clientUserMessageId` for exact-retry deduplication and
  `permissionProfile` (`read_only`, `workspace_write`, or `full_access`).
  `thread/settings/get` and `thread/settings/update` persist the model,
  reasoning, project/workspace, permission, and execution-mode defaults reused
  by later turns. `thread/start` can also receive the same `settings` object.
- `thread/compact/start` replaces older completed turns with a durable bounded
  summary while retaining the requested recent turns.
- Transcript notifications include typed agent/reasoning/command/file deltas
  and `turn/plan/updated` alongside the existing lifecycle snapshots.
  `turn/diff`, `thread/tokenUsage`, `turn/diff/updated`, and
  `thread/tokenUsage/updated` expose accumulated file changes and model-reported
  token/context usage.
- `process/list`, `process/start`, `process/read`, `process/write`,
  `process/resize`, and `process/kill` manage workspace-scoped PTY processes.
  The `pty.*` names are accepted as OpenCode-style aliases. Commands are
  executed directly, not through an implicit shell. Because host PTYs cannot
  currently confine file reads, `process/start` requires explicitly approved
  `full_access`; `read_only` and `workspace_write` are rejected. Output and exit
  state are also pushed through `process/outputDelta` and `process/exited`
  notifications.
- `workspace/file/list` performs bounded fuzzy path/name search (also exposed as
  `fuzzyFileSearch`). `fs/readDirectory` and `fs/getMetadata` expose structured,
  workspace-contained directory entries and filesystem metadata. `fs/watch`
  and `fs/unwatch` add recursive workspace watches that publish batched
  `fs/changed` notifications.
- `hooks/list`, `hooks/set`, and `hooks/remove` manage durable executable hooks
  for thread/turn start boundaries. Hook commands are argv-based, time-bounded,
  and emit `hook/completed` results; no implicit shell is used.
- `config/read`, `config/value/write`, `config/batch/write`, and
  `config/reload` provide durable general configuration with revision hashes.
  Secret-like keys remain restricted to dedicated credential APIs.

`mcp.discover` is accepted as an alias for `mcp.available`. When the
environment-backed runtime is used, `mcp.inspect` can discover live streamable
HTTP and stdio MCP adapters. `mcpServerStatus/list` returns the same live
inventory as a stable, name-sorted paged contract. Its `toolsAndAuthOnly`
detail mode skips prompt/resource discovery, and individual connection failures
are returned on their server record instead of failing the entire page.
`mcp.callTool` validates configured server/tool
readiness only; tool execution requires explicit user approval. SSE endpoints
are parsed and retained as config records, but remain config-only until the SSE
execution adapter is promoted into the shared runtime. Endpoint parsing is shared now:
`http(s)` maps to streamable HTTP, `sse+http(s)` maps to SSE, and `stdio:` or
`stdio://...?arg=` maps to stdio command execution.

## Event Shape

HTTP clients can reconnect with `Last-Event-ID` or
`X-TaskForce-Event-Cursor`. `GET /events/snapshot` preserves the legacy
`events` array and also returns matching `eventIds`, the current `cursor`, the
`oldestCursor`, and `replayTruncated`. The exact running protocol schema is
available through `GET /schema`, `server/describe`, and the
`generate-json-schema` (`--schema`) CLI command.

`run.submit`, local placeholder progress, remote stream progress, prompt-queue
dispatch, and `run.cancel` emit:

```json
{ "jsonrpc": "2.0", "method": "event", "params": { "type": "run_updated", "run": {} } }
```

Unauthenticated runs use a local placeholder executor. It accepts a submitted
run, emits `queued`, then asynchronously emits `processing` and `completed` so
clients can build against the same event flow as remote execution. When an auth
token is present, `run.submit` posts to the configured TaskForceAI API `/run`
endpoint, records the remote task ID, and consumes `/stream/<task-id>` SSE
progress, completion, error, source, tool, agent-status, and approval events
into the same `run_updated` event flow.

## TUI Rewrite Contract

A Rust TUI can now be written as a first-party client of this process without
owning the runtime loop directly:

1. Spawn `taskforceai-app-server`.
2. Send `initialize`.
3. Use `history.list` for initial state.
4. Use `run.submit`, `run.status`, and `run.cancel` for run lifecycle.
5. Listen for `event` notifications to update UI state.

Prefer `packages/adapters/rust/app-client` for Rust clients. It owns spawning,
request/response correlation, event reading, custom app-server binary paths,
custom run-store paths, and API-base overrides. Desktop/TUI clients should add
missing app-server methods there before adding local transport code.

The next adapter work is live product-account verification, richer release
validation, and client polish for the Rust TUI and desktop app-server bridge.

`command.execute` currently handles `/help`, `/status`, `/usage`,
`/search`, `/goal`, `/agents`, `/inspect`, `/doctor`, `/channel`, `/schedule`,
`/workflows`, `/skills`, `/plugins`, `/computer`, `/browser`, `/pending`, `/attach`,
`/project`, `/context`, `/memory`, `/mcp`, `/direct`, `/model`, `/sync`,
`/orchestrate`, `/settings`, `/config`, `/mock`, `/clear`, `/reset`, `/new`,
and `/logout`.
`/plugins browse` lists discovered plugins. `/plugins install <source>` creates
a managed install from a local directory, Git URL, or `github:owner/repo`;
`/plugins update <id>` refreshes the recorded source, and
`/plugins uninstall <id>` removes managed installs. Discovered plugins outside
the managed directory can be enabled or disabled but are never deleted.
Clients should prefer the structured methods for search, pending prompts,
logout, settings, and the other listed capabilities before falling back to
`command.execute`. `/attach` lists and clears pending attachments through
`command.execute`; clients should call `attachment.add` to upload a file before
the next `run.submit`.
`/agents`, `/channel`, `/schedule`, and `/workflows` are currently local
app-server control surfaces. They persist session, channel, schedule, workflow,
and workflow-run definitions in the same local metadata store used by desktop
and TUI.
Rust TUI clients can use `/sync status`, `/sync ensure`, `/sync pull [limit]`,
and `/sync push`; direct JSON-RPC remains the canonical path for clients that
need structured sync payloads.
`/mcp` manages configured MCP server records and exposes `available`, `inspect`,
and `call` command shapes. Environment-backed app-server runs live streamable
HTTP and stdio MCP inspect/call through the shared Rust adapter; SSE execution
is still reserved.
Product settings commands route through authenticated HTTP adapters for account,
notifications, personalization, subscription, data, and connected-app views.
`/login` and `/upgrade` remain client adapter responsibilities because they
need browser/device-flow handling outside the app-server process.

`/mock` starts and stops the local SDK mock API server on
`http://localhost:4321/api/v1/developer`, matching the current developer API surface.
The server exposes `POST /api/v1/developer/run`,
`GET /api/v1/developer/status/:taskId`, and
`GET /api/v1/developer/results/:taskId`.

Computer Use is treated as an approved app/plugin adapter boundary. The
app-server can report support and setup guidance, but it must not automate
desktop UI directly or bypass macOS Screen Recording, Accessibility, app
approval, or locked-use safeguards.

The in-app browser is also treated as a plugin/app adapter boundary. App-server
can report browser support and scope guidance, but page operation, screenshots,
visual comments, and browser-use automation belong to an approved Browser
adapter. The in-app browser path is for unauthenticated local routes,
file-backed previews, and public pages, not signed-in browser state.

The closest Rust reuse source is `apps/desktop`: its API gateway, SQLite
conversation/message storage, sync commands, MCP commands, keyring auth, and
observability modules should move into shared app-server-compatible crates or be
adapted directly into this process.

Desktop alignment is an explicit migration goal. We should avoid ending with a
Rust desktop runtime and a separate Rust app-server runtime that solve the same
problems differently. For each runtime capability, choose one of two shapes:

1. Desktop calls the local app-server for that capability.
2. Desktop and app-server both depend on a shared Rust runtime crate.
