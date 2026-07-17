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
5. Type a prompt and press Enter to submit through app-server. In an active Work
   or Code turn, Enter steers the turn and Alt-Enter queues a follow-up for
   after the current response.
6. Use Shift-Enter for a newline, Up/Down for prompt history, and paste multiline
   content directly into the composer. Large pastes collapse to a compact marker
   and expand before submission. Ctrl-V can ingest clipboard text or upload a
   clipboard image as an attachment.
7. Type `/help` to browse the full command catalog. Common commands include
   `/status`, `/inspect`, `/usage`, `/search <query>`, `/resume`, `/fork`,
   `/rename`, `/archive`, `/rollback`, `/diff`, `/review`, `/attach`, `/copy`,
   `/raw`, `/ps`, `/stop`, `/agent`, `/agents`, `/skills`, `/permissions`,
   `/pending`, and `/prompt-queue`.
8. Use arrow keys to select runs, or to select file suggestions after typing
   `@` in Code mode. Paths containing whitespace are inserted with the
   `@{path with spaces}` form.
9. Type `/` to see slash-command suggestions in the prompt.
   Suggestions are fuzzy-matched against both command names and descriptions.
10. Use mouse wheel selection, row clicks, and footer clicks by default. Use
    your terminal's mouse reporting selection modifier, usually Shift-drag, to
    select text.
11. Use footer actions for submit, cancel, delete, and quit, or use the
    matching keyboard shortcuts.
12. Press Ctrl-X or use `/stop` to interrupt the active turn or cancel the
    selected run through app-server.
13. Press Ctrl-R or use `/raw` to toggle a plain transcript suitable for native
    terminal selection and copying.
14. Apply `event` notifications through the UI reducer.
15. Press Esc or Ctrl-C to shut down cleanly.
16. Use Page Up and Page Down to inspect long approval or user-input dialogs
    before responding.

## Local Runtime Commands

The interactive TUI has three distinct task modes. Planning is not a fourth
mode; `/plan` is an orthogonal, temporary read-only collaboration state that
works with Chat, Work, or Code:

- `/chat` is direct conversation.
- `/work` starts goal-oriented work. It uses the same execution behavior as
  Code while hiding coding-specific UI and commands. It does **not** enable
  Agent Teams by default; teams remain a separate, explicit setting.
- `/code [project-directory]` enables workspace-scoped coding tools for the
  selected project.
- `/model` opens the model picker. Its Effort and Agent Mode rows open nested
  selectors; choosing Agent Teams also exposes the persisted parallel-agent
  count and a custom role-model orchestration editor.

Thread lifecycle and transcript controls work across modes:

- `/resume` opens a searchable saved-conversation picker across Chat, Work, and
  Code. `/resume <thread-id|last>` keeps direct scripting shortcuts.
  `/fork [thread-id]`, `/rename <title>`, and `/archive [thread-id]` manage the
  selected app-server thread.
- `/rollback` opens an earlier-turn timeline with prompt previews;
  `/rollback <turn-id>` remains available for direct use. Confirming a turn
  keeps that turn and removes newer turns.
- `/attach <path>`, `/attach list`, and `/attach clear` manage structured
  attachments. In Code mode, type `@query` or use `/mention <query>` to insert
  workspace-file context.
- Work and Code automatically load applicable `AGENTS.md` and `CLAUDE.md`
  instructions from the repository root through the active workspace. Work
  keeps this capability hidden and does not expose Code-only file, diff, or
  review UI.
- `/skills` lists the cached skill catalog. Use `$skill-name` in any mode to
  load a skill explicitly; the TUI also loads one strongly relevant enabled
  skill automatically. `/skills enable|disable <name>` updates the catalog.
- `/plugins browse` lists discovered plugins with status, source, and
  description. `/plugins install <path|git-url|github:owner/repo>` installs a
  managed plugin, `/plugins update <id>` refreshes it from its recorded source,
  and `/plugins uninstall <id>` removes managed installs. Enable and disable
  remain available in Chat, Work, and Code with `/plugins enable|disable <id>`.
- `/permissions` lists persistent approval rules. Use
  `/permissions allow|ask|deny <command|file|permission|all> <pattern>
[project|user]`; `*` is the wildcard. Approval dialogs can also persist an
  exact matching allow or deny rule. Only user-owned configuration can persist
  automatic allow rules; repository-owned project rules can require a prompt or
  deny a request, but cannot auto-approve one.
- `/diff [uncommitted|staged|unstaged|branch]` and `/review` are available in
  Code mode. Code's session header also shows the compact repository name and
  current branch, with `*` when the working tree is dirty.
- `/copy` copies the selected transcript, `/raw [on|off]` toggles plain output,
  `/ps` lists active tool calls, and `/stop` interrupts active work.
- In Code mode, Ctrl-E expands or collapses individual tool names, statuses,
  arguments, command output, file-change statistics, and inline diffs under the
  compact activity summary. Chat and Work keep their existing transcript
  presentation.
- `/plan [on|off|status]` controls read-only planning without changing the task
  mode. Plan prompts prohibit edits, mutating commands, tools, and external
  changes until implementation is approved.
- Prefix an input with `!` to run it directly in the current workspace shell,
  for example `!git status --short`. Direct shell execution is disabled while
  Plan is enabled.
- `/compact [focus instructions]` replaces older completed turns with a durable
  summary while preserving the two most recent turns. It refuses to run while
  a turn is active.
- Agent messages render Markdown, including structured tables, ordered and
  unordered lists, emphasis, strikethrough, links, and fenced code blocks.
  Fenced code uses language-aware syntax highlighting; `diff`/`patch` fences
  and `/diff` output highlight additions, removals, and hunk headers. Mouse
  clicks open both visible URLs and semantic Markdown link labels, including
  `file://` links.
- `/theme` opens a searchable chooser with live preview and cancel restoration.
  Confirmed themes persist in `~/.config/taskforceai/tui.json` and are restored
  at startup. `/theme [list|taskforce-dark|light|nord|high-contrast|path.json]`
  keeps direct selection support. Custom theme JSON defines `background`, `panel`, `panel_alt`,
  `border`, `focus`, `text`, `text_muted`, `text_faint`, `accent`, `action`,
  `warn`, `danger`, and `ok` as `#RRGGBB` values.
- `/hooks` shows configured lifecycle hooks; `/hooks run <event>` runs one
  explicitly. User-owned hooks load from `~/.config/taskforceai/hooks.json`.
  Repository hooks in `.taskforceai/hooks.json` remain blocked until you run
  `/hooks trust` for the active Work or Code workspace; `/hooks untrust` revokes
  that decision. Trust is stored outside the repository in
  `~/.config/taskforceai/hook-trust.json`. Hook files use this shape:

```json
{
  "hooks": {
    "session_start": ["./scripts/session-start.sh"],
    "prompt_submit": ["./scripts/check-prompt.sh"],
    "pre_tool": ["./scripts/pre-tool.sh"],
    "post_tool": ["./scripts/post-tool.sh"],
    "run_complete": ["./scripts/task-complete.sh"],
    "run_failed": ["./scripts/task-failed.sh"],
    "run_stop": ["./scripts/task-stopped.sh"],
    "pre_compact": ["./scripts/pre-compact.sh"],
    "post_compact": ["./scripts/post-compact.sh"]
  }
}
```

Hook commands receive `TASKFORCE_HOOK_EVENT`, `TASKFORCE_TASK_MODE`, and
`TASKFORCE_THREAD_ID`. When the terminal is unfocused, completed, failed, and
attention-required events emit OSC 9 terminal notifications. Set
`TASKFORCE_TUI_NOTIFICATIONS=bel` for an audible bell or `off` to disable them.

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
- `/agent` lists the active parent/child agent family; `/agent next`,
  `/agent previous`, `/agent parent`, and `/agent <thread-id>` open the child
  transcript directly. Ctrl-G cycles the related transcripts.
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
