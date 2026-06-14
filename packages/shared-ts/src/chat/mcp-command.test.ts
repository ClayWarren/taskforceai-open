import { describe, expect, it } from 'bun:test';

import { isMcpCallCommand, parseMcpCallCommand } from './mcp-command';

describe('mcp-command', () => {
  it('detects mcp call commands', () => {
    expect(isMcpCallCommand('/mcp call docs search')).toBe(true);
    expect(isMcpCallCommand(' /MCP call docs search ')).toBe(true);
    expect(isMcpCallCommand('/mcp list')).toBe(false);
  });

  it('parses commands without arguments', () => {
    expect(parseMcpCallCommand('/mcp call docs search')).toEqual({
      serverName: 'docs',
      toolName: 'search',
      argumentsObject: {},
    });
  });

  it('parses commands with json arguments', () => {
    expect(parseMcpCallCommand('/mcp call docs search {"query":"bun"}')).toEqual({
      serverName: 'docs',
      toolName: 'search',
      argumentsObject: { query: 'bun' },
    });
  });

  it('returns null for non-mcp prompts', () => {
    expect(parseMcpCallCommand('hello')).toBeNull();
  });

  it('rejects invalid usage', () => {
    expect(() => parseMcpCallCommand('/mcp call docs')).toThrow(
      'Usage: /mcp call <server> <tool> [json-arguments]'
    );
    expect(() => parseMcpCallCommand('/mcp call docs search []')).toThrow(
      'MCP arguments must be a JSON object.'
    );
    expect(() => parseMcpCallCommand('/mcp call docs search null')).toThrow(
      'MCP arguments must be a JSON object.'
    );
  });

  it('wraps invalid JSON parse failures with context', () => {
    expect(() => parseMcpCallCommand('/mcp call docs search {"query"')).toThrow(
      'Invalid MCP arguments JSON:'
    );
  });
});
