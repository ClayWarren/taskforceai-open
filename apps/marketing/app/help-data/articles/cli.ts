import type { HelpArticle } from './types';

export const cliArticles: HelpArticle[] = [
  {
    slug: 'installing-the-cli',
    categoryId: 'cli',
    title: 'Installing the CLI',
    description: 'Get TaskForceAI in your terminal.',
    lastUpdated: '2026-01-26',
    content:
      '\n# Installing the CLI\n\nUse TaskForceAI directly from your terminal.\n\n## Installation Methods\n\n### curl (Recommended)\n\n```bash\ncurl -fsSL https://taskforceai.dev/install.sh | bash\n```\n\nNative installations automatically update in the background. To opt out, set:\n\n```bash\nexport TASKFORCEAI_DISABLE_AUTOUPDATE=1\n```\n\n### Homebrew (macOS/Linux)\n\n```bash\nbrew install ClayWarren/taskforceai/taskforceai-cli\n```\n\n## Verify Installation\n\n```bash\ntaskforceai --version\n```\n\n## First Run\n\n```bash\ntaskforceai login\n```\n\nThis opens your browser to authenticate.\n\n## Quick Start\n\n```bash\n# Start interactive chat\ntaskforceai chat\n\n# Send a single message\ntaskforceai "What is the capital of France?"\n\n# Pipe input\necho "Explain this code" | taskforceai\n```\n    ',
  },
  {
    slug: 'authentication-and-configuration',
    categoryId: 'cli',
    title: 'Authentication and configuration',
    description: 'Configure your CLI credentials and settings.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Authentication and Configuration\n\nSet up your CLI for daily use.\n\n## Authentication\n\n### Browser Login\n\n```bash\ntaskforceai login\n```\n\nOpens your browser to complete authentication.\n\n### API Key\n\nFor automation, use an API key:\n\n```bash\nexport TASKFORCEAI_API_KEY="your-api-key"\n```\n\nOr add to your shell profile:\n\n```bash\necho \'export TASKFORCEAI_API_KEY="your-api-key"\' >> ~/.bashrc\n```\n\n## Configuration File\n\nConfig is stored in `~/.taskforceai/config.json`:\n\n```json\n{\n  "defaultModel": "auto",\n  "theme": "dark",\n  "historyEnabled": true\n}\n```\n\n## Configure Settings\n\n```bash\n# View current config\ntaskforceai config list\n\n# Set a value\ntaskforceai config set defaultModel gpt-4\n\n# Reset to defaults\ntaskforceai config reset\n```\n\n## Multiple Profiles\n\nFor different accounts:\n\n```bash\ntaskforceai login --profile work\ntaskforceai --profile work chat\n```\n    ',
  },
  {
    slug: 'common-commands',
    categoryId: 'cli',
    title: 'Common commands',
    description: 'Essential CLI commands for daily use.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Common Commands\n\nEssential commands for the TaskForceAI CLI.\n\n## Chat Commands\n\n```bash\n# Interactive chat\ntaskforceai chat\n\n# Single message\ntaskforceai "Your question here"\n\n# Continue previous conversation\ntaskforceai chat --continue\n\n# Select model\ntaskforceai chat --model claude-3\n```\n\n## Conversation Management\n\n```bash\n# List conversations\ntaskforceai conversations list\n\n# Open specific conversation\ntaskforceai conversations open <id>\n\n# Delete conversation\ntaskforceai conversations delete <id>\n```\n\n## Utility Commands\n\n```bash\n# Check status\ntaskforceai status\n\n# View usage\ntaskforceai usage\n\n# Get help\ntaskforceai --help\ntaskforceai chat --help\n```\n\n## Piping and Files\n\n```bash\n# Pipe input\ncat file.txt | taskforceai "Summarize this"\n\n# Save output\ntaskforceai "Write a poem" > poem.txt\n\n# Process files\ntaskforceai "Review this code" < script.py\n```\n    ',
  },
  {
    slug: 'scripting-with-cli',
    categoryId: 'cli',
    title: 'Scripting with TaskForceAI CLI',
    description: 'Automate workflows with CLI scripts.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Scripting with TaskForceAI CLI\n\nIntegrate TaskForceAI into your automation workflows.\n\n## Non-Interactive Mode\n\nFor scripts, use non-interactive mode:\n\n```bash\ntaskforceai --non-interactive "Your prompt"\n```\n\n## JSON Output\n\nGet structured output for parsing:\n\n```bash\ntaskforceai --json "List 3 colors"\n```\n\nOutput:\n\n```json\n{\n  "response": "1. Red\\n2. Blue\\n3. Green",\n  "model": "gpt-4",\n  "usage": {"tokens": 42}\n}\n```\n\n## Example Scripts\n\n### Code Review Script\n\n```bash\n#!/bin/bash\nfor file in *.py; do\n  echo "Reviewing $file..."\n  taskforceai "Review this Python code for bugs:" < "$file"\ndone\n```\n\n### Git Commit Message\n\n```bash\n#!/bin/bash\ngit diff --staged | taskforceai "Write a commit message for these changes"\n```\n\n## Environment Variables\n\n- `TASKFORCEAI_API_KEY`: Authentication\n- `TASKFORCEAI_MODEL`: Default model\n- `TASKFORCEAI_CONFIG`: Config file path\n    ',
  },
];
