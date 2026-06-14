export interface SlashCommandSuggestion {
  command: string;
  description: string;
}

export const SLASH_COMMAND_SUGGESTIONS: SlashCommandSuggestion[] = [
  { command: '/login', description: 'Sign in with your TaskForceAI account.' },
  { command: '/logout', description: 'Sign out of this client.' },
  { command: '/upgrade', description: 'Open billing and upgrade options.' },
  { command: '/update', description: 'Check for a client update.' },
  { command: '/status', description: 'Show app-server, auth, and mode status.' },
  { command: '/inspect', description: 'Inspect local diagnostics.' },
  { command: '/doctor', description: 'Run local health checks.' },
  { command: '/sync', description: 'Inspect or trigger sync.' },
  { command: '/settings', description: 'Open or update local settings.' },
  { command: '/model', description: 'Choose the model for new prompts.' },
  { command: '/ollama', description: 'Check or configure local Ollama models.' },
  { command: '/hybrid', description: 'Use a local reviewer alongside the cloud model.' },
  { command: '/search', description: 'Toggle or run web search.' },
  { command: '/usage', description: 'Show usage and plan limits.' },
  { command: '/mcp', description: 'Manage or call MCP tools.' },
  { command: '/mock', description: 'Toggle mock runtime behavior.' },
  { command: '/attach', description: 'Attach files to the next prompt.' },
  { command: '/direct', description: 'Toggle direct single-model mode.' },
  { command: '/voice', description: 'Use voice input.' },
  { command: '/orchestrate', description: 'Configure multi-agent orchestration.' },
  { command: '/project', description: 'View or select project context.' },
  { command: '/clear', description: 'Clear the current view.' },
  { command: '/new', description: 'Start a new prompt.' },
  { command: '/help', description: 'Show available commands.' },
  { command: '/quit', description: 'Exit the client.' },
  { command: '/goal', description: 'Create or inspect a long-running goal.' },
  { command: '/agents', description: 'Manage agent sessions.' },
  { command: '/pet', description: 'Show, hide, or update the companion.' },
  { command: '/context', description: 'Show context-window usage.' },
  { command: '/memory', description: 'Show loaded memory sources.' },
  { command: '/skills', description: 'List available skills.' },
  { command: '/plugins', description: 'List and toggle plugins.' },
  { command: '/computer', description: 'Check computer-use availability.' },
  { command: '/browser', description: 'Check browser-use availability.' },
  { command: '/channel', description: 'Manage channels.' },
  { command: '/schedule', description: 'Manage scheduled work.' },
  { command: '/pending', description: 'Show pending prompts.' },
  { command: '/prompt-queue', description: 'Manage queued prompts.' },
  { command: '/pending-changes', description: 'Review local pending changes.' },
  { command: '/reset-local', description: 'Clear local app-server metadata.' },
];

export const slashCommandSuggestionsForPrompt = (prompt: string): SlashCommandSuggestion[] => {
  const trimmedStart = prompt.trimStart();
  if (!trimmedStart.startsWith('/')) {
    return [];
  }

  const token = trimmedStart.split(/\s+/, 1)[0] ?? '';
  if (token.length === 0) {
    return SLASH_COMMAND_SUGGESTIONS;
  }

  return SLASH_COMMAND_SUGGESTIONS.filter((item) => item.command.startsWith(token));
};

export const applySlashCommandSuggestion = (
  prompt: string,
  suggestion: SlashCommandSuggestion
): string => {
  const leadingWhitespace = prompt.match(/^\s*/)?.[0] ?? '';
  const trimmedStart = prompt.trimStart();
  const firstWhitespace = trimmedStart.search(/\s/);
  const remainder = firstWhitespace === -1 ? '' : trimmedStart.slice(firstWhitespace).trimStart();
  return `${leadingWhitespace}${suggestion.command}${remainder ? ` ${remainder}` : ''}`;
};
