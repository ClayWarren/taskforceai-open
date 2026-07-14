import { beforeEach, describe, expect, it, vi } from 'bun:test';

const mockInitializeDesktopRuntime = vi.fn((callback: () => void) => {
  callback();
});

vi.mock('@taskforceai/browser-runtime/runtime', () => ({
  initializeDesktopRuntime: (callback: () => void) => mockInitializeDesktopRuntime(callback),
  isDesktopRuntime: () => false,
}));

describe('disableDesktopConsoleLogs', () => {
  beforeEach(() => {
    mockInitializeDesktopRuntime.mockClear();
  });

  it('initializes desktop runtime and touches the logger module', async () => {
    const { disableDesktopConsoleLogs } = await import('./disableDesktopConsoleLogs');

    disableDesktopConsoleLogs();

    expect(mockInitializeDesktopRuntime).toHaveBeenCalledTimes(1);
    expect(typeof mockInitializeDesktopRuntime.mock.calls[0]?.[0]).toBe('function');
  });
});
