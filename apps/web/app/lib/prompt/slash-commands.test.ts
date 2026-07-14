import { describe, expect, it } from 'bun:test';

import { applySlashCommandSuggestion, slashCommandSuggestionsForPrompt } from './slash-commands';

describe('slash command suggestions', () => {
  it('returns no suggestions until the prompt begins with a slash command', () => {
    expect(slashCommandSuggestionsForPrompt('hello /model')).toEqual([]);
  });

  it('filters suggestions by the first token after leading whitespace', () => {
    expect(slashCommandSuggestionsForPrompt('  /mo').map((item) => item.command)).toEqual([
      '/model',
      '/mock',
    ]);
  });

  it('applies a selected command while preserving leading whitespace and arguments', () => {
    expect(
      applySlashCommandSuggestion('  /mo gpt-5', {
        command: '/model',
        description: 'Choose a model.',
      })
    ).toBe('  /model gpt-5');
  });
});
