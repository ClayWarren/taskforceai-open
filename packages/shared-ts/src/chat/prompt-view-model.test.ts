import { describe, expect, it } from 'bun:test';

import {
  hasCustomRoleModels,
  hasPromptText,
  insertMcpToolCommandIntoPrompt,
  resolvePromptPrimaryAction,
} from './prompt-view-model';

describe('prompt view model helpers', () => {
  it('detects prompt text and custom role models', () => {
    expect(hasPromptText('   ')).toBe(false);
    expect(hasPromptText('hello')).toBe(true);
    expect(hasCustomRoleModels()).toBe(false);
    expect(hasCustomRoleModels({ planner: 'gpt-5' })).toBe(true);
  });

  it('resolves primary prompt action state', () => {
    expect(
      resolvePromptPrimaryAction({
        prompt: '',
        controlsDisabled: false,
        interactionsDisabled: false,
        loading: false,
        isListening: false,
      })
    ).toEqual({
      mode: 'voice',
      disabled: false,
      title: 'Dictate with your microphone',
    });

    expect(
      resolvePromptPrimaryAction({
        prompt: 'hello',
        controlsDisabled: true,
        interactionsDisabled: false,
        loading: false,
        isListening: false,
        isAuthenticated: false,
      })
    ).toEqual({
      mode: 'send',
      disabled: true,
      title: 'Login required to send messages',
    });
  });

  it('treats attachments as sendable prompt content', () => {
    expect(
      resolvePromptPrimaryAction({
        prompt: '',
        hasAttachments: true,
        controlsDisabled: false,
        interactionsDisabled: false,
        loading: false,
        isListening: false,
      }).mode
    ).toBe('send');
  });

  it('prioritizes stopping an active stream over sending or dictating', () => {
    expect(
      resolvePromptPrimaryAction({
        prompt: 'hello',
        controlsDisabled: true,
        interactionsDisabled: true,
        loading: true,
        isListening: false,
        isStreaming: true,
      })
    ).toEqual({
      mode: 'stop',
      disabled: false,
      title: 'Stop run',
    });
  });

  it('inserts MCP tool commands without duplicating an exact command', () => {
    expect(
      insertMcpToolCommandIntoPrompt({
        prompt: '',
        serverName: 'docs',
        toolName: 'lookup',
      })
    ).toBe('/mcp call docs lookup ');
    expect(
      insertMcpToolCommandIntoPrompt({
        prompt: 'Question',
        serverName: 'docs',
        toolName: 'lookup',
      })
    ).toBe('Question\n/mcp call docs lookup ');
    expect(
      insertMcpToolCommandIntoPrompt({
        prompt: '/mcp call docs lookup ',
        serverName: 'docs',
        toolName: 'lookup',
      })
    ).toBe('/mcp call docs lookup ');
  });
});
