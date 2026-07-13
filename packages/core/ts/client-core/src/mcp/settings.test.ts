import { describe, expect, it } from 'bun:test';

import {
  formatMcpServerInspectionSummary,
  normalizeMcpServerInput,
  removeMcpServerByName,
  upsertMcpServerByName,
} from './settings';

describe('mcp settings helpers', () => {
  it('normalizes and validates server input', () => {
    expect(
      normalizeMcpServerInput({ name: ' Docs ', endpoint: ' https://example.com/mcp ' })
    ).toEqual({
      ok: true,
      value: {
        name: 'Docs',
        endpoint: 'https://example.com/mcp',
        enabled: true,
      },
    });
    expect(normalizeMcpServerInput({ name: '', endpoint: 'https://example.com/mcp' })).toEqual({
      ok: false,
      message: 'MCP server name and endpoint are required.',
    });
    expect(
      normalizeMcpServerInput({
        name: 'Docs',
        endpoint: '   ',
        missingMessage: 'Provide both fields.',
      })
    ).toEqual({
      ok: false,
      message: 'Provide both fields.',
    });
  });

  it('upserts and removes servers case-insensitively by name', () => {
    const servers = [
      { name: 'Docs', endpoint: 'old', enabled: true },
      { name: 'Search', endpoint: 'search', enabled: false },
    ];

    expect(
      upsertMcpServerByName(servers, {
        name: 'docs',
        endpoint: 'new',
        enabled: true,
      })
    ).toEqual([
      { name: 'Search', endpoint: 'search', enabled: false },
      { name: 'docs', endpoint: 'new', enabled: true },
    ]);
    expect(removeMcpServerByName(servers, 'docs')).toEqual([
      { name: 'Search', endpoint: 'search', enabled: false },
    ]);
  });

  it('formats inspection summaries', () => {
    expect(
      formatMcpServerInspectionSummary({
        serverName: 'Remote Docs',
        fallbackName: 'Docs',
        tools: 2,
        prompts: 1,
        resources: 3,
      })
    ).toBe('Remote Docs: 2 tools, 1 prompts, 3 resources.');
    expect(
      formatMcpServerInspectionSummary({
        serverName: null,
        fallbackName: 'Docs',
        tools: 0,
        prompts: 0,
        resources: 0,
      })
    ).toBe('Docs: 0 tools, 0 prompts, 0 resources.');
  });
});
