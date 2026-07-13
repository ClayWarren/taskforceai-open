import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { renderHook, waitFor } from '@testing-library/react';

import '../../../../../tests/setup/dom';

const mockLoadAvailableWebMcpTools = mock(async () => ({
  serverCount: 1,
  toolCount: 1,
  items: [
    {
      source: 'mcp',
      serverName: 'docs',
      toolName: 'lookup',
      title: 'Lookup',
      description: 'Find docs',
    },
  ],
}));
mock.module('./inventory', () => ({
  loadAvailableWebMcpTools: mockLoadAvailableWebMcpTools,
}));

import { WebMcpToolRegistry } from './registry';
import { useWebMcpToolCatalog } from './useMcpToolCatalog';

describe('web mcp registry', () => {
  beforeEach(() => {
    mockLoadAvailableWebMcpTools.mockClear();
  });

  it('refreshes and stores the latest inventory snapshot', async () => {
    const registry = new WebMcpToolRegistry('browser', {} as never);

    const snapshot = await registry.refresh();

    expect(snapshot).toEqual({
      toolSummary: 'MCP tools available: 1 across 1 server.',
      items: [
        {
          source: 'mcp',
          serverName: 'docs',
          toolName: 'lookup',
          title: 'Lookup',
          description: 'Find docs',
        },
      ],
    });
    expect(registry.getSnapshot()).toEqual(snapshot);
  });

  it('notifies subscribers immediately and on refresh', async () => {
    const registry = new WebMcpToolRegistry('browser', {} as never);
    const listener = mock(() => {});

    const unsubscribe = registry.subscribe(listener);
    await registry.refresh();
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('binds browser refresh events and cleans them up', async () => {
    const registry = new WebMcpToolRegistry('browser', {} as never);
    const unsubscribe = registry.bindWindowEvents();

    expect(unsubscribe).toBeTypeOf('function');
    window.dispatchEvent(new StorageEvent('storage', { key: 'activeConversationId' }));
    await Promise.resolve();
    expect(mockLoadAvailableWebMcpTools).not.toHaveBeenCalled();

    window.dispatchEvent(new StorageEvent('storage', { key: 'taskforceai:mcp-servers' }));
    window.dispatchEvent(new Event('taskforceai:mcp-servers-changed'));
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();

    expect(mockLoadAvailableWebMcpTools).toHaveBeenCalledTimes(3);

    unsubscribe?.();
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(mockLoadAvailableWebMcpTools).toHaveBeenCalledTimes(3);
  });

  it('keeps hook registry stable across snapshot rerenders', async () => {
    const { result, rerender, unmount } = renderHook(() => useWebMcpToolCatalog('browser'));

    await waitFor(() => expect(result.current.snapshot.items).toHaveLength(1));
    expect(mockLoadAvailableWebMcpTools).toHaveBeenCalledTimes(1);

    rerender();
    await Promise.resolve();

    expect(mockLoadAvailableWebMcpTools).toHaveBeenCalledTimes(1);
    unmount();
  });
});
