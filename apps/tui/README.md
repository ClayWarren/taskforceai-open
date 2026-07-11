# TaskForceAI Rust TUI

Rust terminal UI for TaskForceAI.

This is a first-party app client like web, desktop, and mobile. It should not
own product runtime behavior directly; that behavior belongs in
`apps/app-server` and shared Rust runtime crates.

This app is intentionally a thin client over `apps/app-server`. It should own
terminal concerns only:

- input mapping
- mouse hit testing
- focus/view state
- rendering
- translating user intent into app-server commands
- applying app-server events to UI state

Runtime concerns belong in `apps/app-server`, not here:

- auth/token management
- remote API calls
- run streaming
- local persistence
- queued prompts
- sync
- MCP sessions/tool calls

Desktop Rust code is the closest existing implementation source for runtime
adapters. Prefer lifting or sharing the `apps/desktop` API, storage, sync, MCP,
and observability boundaries into app-server-compatible crates instead of
re-implementing those behaviors inside the TUI.

## Options

- `--app-server <PATH>` runs a specific app-server binary.
- `--run-store <PATH>` points the app-server at a specific SQLite run store.
- `--prompt <PROMPT>` submits one prompt without launching the terminal UI.
- `--output-format <text|json|streaming-json>` controls `--prompt` output.
- `--agent-teams` submits a headless prompt with Agent Teams enabled.
- `--agent-count <COUNT>` sets the headless Agent Teams agent count.
- `--computer-use` submits a headless prompt with Computer Use enabled.
- `--use-logged-in-services` lets a headless Computer Use run use logged-in
  browser/session services.
- `--mock` runs the local SDK mock API server without launching the TUI.
- Mouse capture is enabled by default so wheel scrolling and clicks stay inside
  the TUI instead of exposing shell scrollback. Use your terminal's mouse
  reporting selection modifier, usually Shift-drag, to select text.
- `--no-mouse` disables mouse capture when you need native terminal selection.
- `--mouse` is kept as a compatibility alias for the default behavior.

## Current Flow

1. Spawn app-server over stdio.
2. Call `initialize`.
3. Load `history.list`.
4. Render runs with ratatui.
5. Type a prompt and press Enter to submit through app-server.
6. Type `/help`, `/status`, `/inspect`, `/usage`, `/search <query>`,
   `/agents`, `/channel`, `/schedule`, `/pending`, `/prompt-queue`,
   `/upgrade`, `/clear`, `/reset`, `/new`, or `/reset-local` and press Enter
   to execute local app-server commands.
7. Use arrow keys to select runs.
8. Type `/` to see slash-command suggestions in the prompt.
9. Use mouse wheel selection, row clicks, and footer clicks by default. Use
   your terminal's mouse reporting selection modifier, usually Shift-drag, to
   select text.
10. Use footer actions for submit, cancel, delete, and quit, or use the
    matching keyboard shortcuts.
11. Press Ctrl-X to cancel the selected run through app-server.
12. Apply `event` notifications through the UI reducer.
13. Press Esc or Ctrl-C to shut down cleanly.

## Local Runtime Commands

- `/pending` or `/queue` lists queued prompts.
- `/pending add <prompt>` queues a prompt through app-server.
- `/pending delete <pending-prompt-id>` removes a queued prompt.
- `/pending replay` submits the next replayable prompt; the TUI also asks
  app-server to replay one queued prompt periodically.
- `/prompt-queue` lists queued prompts with dispatch steering.
- `/prompt-queue add <immediate|after_response> <conversation-id> <prompt>`
  queues a prompt to dispatch now or after the model responds.
- `/prompt-queue delete <id>` removes one queued prompt.
- `/prompt-queue clear` clears queued prompts.
- `/pending-changes` lists local sync change records.
- `/pending-changes delete <id>` removes one local sync change record.
- `/pending-changes clear` clears local sync change records.
- `/agents` lists local background agent sessions.
- `/agents create <objective>` creates a local background session definition.
- `/agents pause|resume|cancel|message|fork <session-id> [...]` steers local
  agent session state.
- `/inspect` or `/doctor` shows runtime, account, model, extension, and local
  automation diagnostics.
- `/channel` lists local automation channels.
- `/channel add <name> [session-id]` creates a local channel.
- `/channel push <channel-id> <message>` sends a message through a channel and
  into its target agent session when configured.
- `/channel delete <channel-id>` removes a channel.
- `/schedule` lists local scheduled task definitions.
- `/schedule add <name> <cadence> <prompt>` creates a local schedule record.
- `/schedule enable|disable|delete <schedule-id>` updates a local schedule.
- `/sync poll [last-event-id]` polls the app-server realtime sync cursor; the
  TUI also runs the same poll periodically and pulls updates when reported.
- `/voice status` shows terminal voice configuration.
- `/voice listen` appends a transcript from the command configured in
  `TASKFORCEAI_TUI_VOICE_LISTEN_COMMAND`.
- `/voice replace` replaces the prompt with a transcript from the configured
  listen command.
- `/voice speak [text]` speaks explicit text, or the selected run/output when
  no text is provided.
- `/voice cancel` asks the platform speech command to stop.
- `/clear` clears the current TUI view, `/new` starts a fresh prompt view, and
  `/reset-local` clears local conversations, messages, pending queues, and
  metadata through app-server. `/reset` remains a hidden alias for
  `/reset-local`.

When a completed run event arrives, the TUI asks app-server to dispatch the next
matching `/prompt-queue add after_response ...` item for that conversation.

Terminal dictation is intentionally command-backed so users can choose their
local speech-to-text tool. For example:

```bash
TASKFORCEAI_TUI_VOICE_LISTEN_COMMAND='your-transcriber --single-utterance' make tui
```

Speech playback uses the platform command when available: `say` on macOS,
`spd-say` on Linux, and Windows SpeechSynthesizer through PowerShell.

New runtime behavior should land in app-server or shared Rust runtime crates
before it is exposed through the TUI.

## Headless Mock Server

Run the Go-compatible mock API without the terminal UI:

```bash
taskforceai --mock
```

This starts `http://localhost:4321/api/v1/developer` through app-server and blocks
until Ctrl+C.

## Headless Prompt

Submit a prompt through app-server without launching ratatui. Headless prompts
require an authenticated app-server session. For local placeholder runs, set
`TASKFORCEAI_ALLOW_LOCAL_RUNS=1`.

```bash
taskforceai --prompt "summarize the latest run" --output-format text
TASKFORCEAI_ALLOW_LOCAL_RUNS=1 taskforceai --prompt "summarize the latest run" --output-format streaming-json
taskforceai --prompt "research today's AI news" --agent-teams --agent-count 4 --output-format streaming-json
taskforceai --prompt "take one screenshot and describe it" --computer-use --output-format streaming-json
taskforceai --prompt "create an image of a launch control room" --output-format streaming-json
taskforceai --prompt "generate a two second video of a red circle moving left to right" --output-format streaming-json
```

Image and video generation prompts are routed by app-server to the same
generation models used by web and mobile.

## Updates

Check for or apply a published CLI update without launching the TUI:

```bash
taskforceai update check
taskforceai update
taskforceai update apply
```
