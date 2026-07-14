import type { HelpArticle } from './types';

export const cliArticles: HelpArticle[] = [
  {
    slug: 'installing-the-cli',
    categoryId: 'cli',
    title: 'Installing the CLI',
    description: 'Get TaskForceAI in your terminal.',
    lastUpdated: '2026-07-14',
    content: `
# Installing the CLI

Use TaskForceAI directly from your terminal.

## Installation Methods

### curl (Recommended)

\`\`\`bash
curl -fsSL https://taskforceai.chat/install.sh | bash
\`\`\`

### PowerShell

\`\`\`powershell
irm https://taskforceai.chat/install.ps1 | iex
\`\`\`

### Homebrew (macOS/Linux)

\`\`\`bash
brew install ClayWarren/taskforceai/taskforceai-cli
\`\`\`

## Verify Installation

\`\`\`bash
taskforceai --version
\`\`\`

## First Run

Start the terminal UI:

\`\`\`bash
taskforceai
\`\`\`

At the TaskForceAI prompt, enter \`/login\`. The CLI opens the browser-based device login flow and returns to the terminal after approval.

## Run One Prompt Without the TUI

\`\`\`bash
taskforceai --prompt "What is the capital of France?"
\`\`\`

Native installations check for updates automatically. To opt out, set \`TASKFORCEAI_DISABLE_AUTOUPDATE=1\`.
    `,
  },
  {
    slug: 'authentication-and-configuration',
    categoryId: 'cli',
    title: 'Authentication and settings',
    description: 'Sign in and manage CLI settings.',
    lastUpdated: '2026-07-14',
    content: `
# Authentication and Settings

Start the terminal UI with \`taskforceai\`, then use slash commands at the prompt.

## Sign In

\`\`\`text
/login
\`\`\`

The CLI starts a device login, opens your browser, and waits for approval. Use \`/logout\` to remove the current session.

## Inspect and Change Settings

\`\`\`text
/settings
/settings theme dark
/settings logging level info
/model
/effort high
\`\`\`

Use \`/help\` for the command catalog available in your installed version. Local settings are managed by the TaskForceAI runtime; do not create the legacy \`~/.taskforceai/config.json\` file described by older guides.
    `,
  },
  {
    slug: 'common-commands',
    categoryId: 'cli',
    title: 'Common commands',
    description: 'Essential terminal UI commands for daily use.',
    lastUpdated: '2026-07-14',
    content: `
# Common Commands

Run \`taskforceai\` to open the terminal UI. Enter prompts as plain text and use slash commands for actions.

## Conversations and Modes

\`\`\`text
/new
/resume last
/fork
/rename focused work
/archive
/chat
/work
\`\`\`

## Model and Usage

\`\`\`text
/model
/effort high
/usage
/status
\`\`\`

## Local Coding

\`\`\`text
/code /path/to/workspace
/diff
/review
/attach path/to/file
\`\`\`

Use \`/help\` to see the complete catalog and \`/quit\` to exit.
    `,
  },
  {
    slug: 'scripting-with-cli',
    categoryId: 'cli',
    title: 'Scripting with the TaskForceAI CLI',
    description: 'Run authenticated prompts in headless workflows.',
    lastUpdated: '2026-07-14',
    content: `
# Scripting with the TaskForceAI CLI

Use \`--prompt\` to run without the terminal UI. Complete \`/login\` in an interactive session first.

## Text Output

\`\`\`bash
taskforceai --prompt "Summarize the release notes"
\`\`\`

## JSON Output

\`\`\`bash
taskforceai --prompt "List three deployment risks" --output-format json
\`\`\`

Use \`--output-format streaming-json\` when a script needs each run update as it arrives.

## Local Coding Context

\`\`\`bash
taskforceai \\
  --prompt "Review the current workspace for regressions" \\
  --local-coding \\
  --workspace "$PWD" \\
  --output-format json
\`\`\`

## Agent Teams

\`\`\`bash
taskforceai \\
  --prompt "Investigate this failure from multiple angles" \\
  --agent-teams \\
  --agent-count 4 \\
  --output-format streaming-json
\`\`\`

The current CLI does not accept a positional prompt or the legacy \`--non-interactive\` and \`--json\` flags.
    `,
  },
];
