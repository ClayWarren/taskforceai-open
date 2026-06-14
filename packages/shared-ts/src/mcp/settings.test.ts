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
  });

  it('upserts and removes servers case-insensitively by name', () => {
    const servers = [{ name: 'Docs', endpoint: 'old', enabled: true }];

    expect(
      upsertMcpServerByName(servers, {
        name: 'docs',
        endpoint: 'new',
        enabled: true,
      })
    ).toEqual([{ name: 'docs', endpoint: 'new', enabled: true }]);
    expect(removeMcpServerByName(servers, 'docs')).toEqual([]);
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
  });
});
