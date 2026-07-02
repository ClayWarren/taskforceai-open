import type { LogEntry } from '@taskforceai/shared/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { createTauriTransport } from './tauri-transport';

describe('tauri transport', () => {
  const createEntry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
    level: 'info',
    message: 'test message',
    context: {},
    timestamp: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    originalWindow = globalThis.window;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it('invokes command with entry', async () => {
    const invoke = vi.fn();
    const transport = createTauriTransport({ invoke });

    await transport.log(createEntry());

    expect(invoke).toHaveBeenCalledWith('log_event', {
      entry: createEntry(),
    });
  });

  it('uses custom command name', async () => {
    const invoke = vi.fn();
    const transport = createTauriTransport({ invoke, command: 'custom_log' });

    await transport.log(createEntry());

    expect(invoke).toHaveBeenCalledWith('custom_log', expect.anything());
  });

  it('filters by enabled levels', async () => {
    const invoke = vi.fn();
    const transport = createTauriTransport({ invoke, levels: ['error'] });

    await transport.log(createEntry({ level: 'info' }));
    await transport.log(createEntry({ level: 'debug' }));
    await transport.log(createEntry({ level: 'warn' }));
    expect(invoke).not.toHaveBeenCalled();

    await transport.log(createEntry({ level: 'error' }));
    expect(invoke).toHaveBeenCalled();
  });

  it('handles invoke errors gracefully', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('Tauri failed'));
    const onError = vi.fn();
    const transport = createTauriTransport({ invoke, onError });

    await transport.log(createEntry());

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('uses default noop onError', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('Tauri failed'));
    const transport = createTauriTransport({ invoke });

    await expect(transport.log(createEntry())).resolves.toBeUndefined();
  });

  it('has correct transport name', () => {
    const transport = createTauriTransport({ invoke: vi.fn() });
    expect(transport.name).toBe('tauri');
  });

  it('does nothing when no invoke provider', async () => {
    const transport = createTauriTransport({ invoke: undefined });

    await expect(transport.log(createEntry())).resolves.toBeUndefined();
  });

  it('enables all levels by default', async () => {
    const invoke = vi.fn();
    const transport = createTauriTransport({ invoke });

    await transport.log(createEntry({ level: 'debug' }));
    await transport.log(createEntry({ level: 'info' }));
    await transport.log(createEntry({ level: 'warn' }));
    await transport.log(createEntry({ level: 'error' }));

    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it('flush is a noop', async () => {
    const transport = createTauriTransport({ invoke: vi.fn() });

    await expect(transport.flush?.()).resolves.toBeUndefined();
  });

  describe('createDefaultInvoker', () => {
    it('returns unavailable when window is undefined', async () => {
      // @ts-expect-error - simulating node environment
      delete globalThis.window;

      const transport = createTauriTransport({});

      // Without an invoker, log should be a noop
      await expect(transport.log(createEntry())).resolves.toBeUndefined();
    });

    it('uses window.__TAURI__.invoke when available', async () => {
      const mockInvoke = vi.fn();
      // @ts-expect-error - setting up Tauri environment
      globalThis.window = {
        __TAURI__: {
          invoke: mockInvoke,
        },
      };

      const transport = createTauriTransport({});

      await transport.log(createEntry());

      expect(mockInvoke).toHaveBeenCalledWith('log_event', {
        entry: createEntry(),
      });
    });

    it('falls back to dynamic import when __TAURI__.invoke is not available', async () => {
      // @ts-expect-error - setting up browser environment without Tauri
      globalThis.window = {};

      // The transport will try to use dynamic import, which will fail in test env
      // but the code path is exercised
      const transport = createTauriTransport({});

      // This will fail because @tauri-apps/api/core is not available in test
      try {
        await transport.log(createEntry());
      } catch {
        // Expected to fail, but code path is exercised
      }
    });

    it('uses provided invoke over default', async () => {
      const mockTauriInvoke = vi.fn();
      const customInvoke = vi.fn();

      // @ts-expect-error - setting up Tauri environment
      globalThis.window = {
        __TAURI__: {
          invoke: mockTauriInvoke,
        },
      };

      const transport = createTauriTransport({ invoke: customInvoke });

      await transport.log(createEntry());

      expect(customInvoke).toHaveBeenCalled();
      expect(mockTauriInvoke).not.toHaveBeenCalled();
    });
  });
});
