import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';

const mockListen = vi.fn();
const mockCoreInvoke = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockCoreInvoke,
}));

import { invokeTauri, listenTauriEvent, waitForTauriBridge } from './bridge';

type TauriTestWindow = Window & {
  __TAURI__?: {
    core?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
    invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
  __TAURI_INTERNALS__?: {
    invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
  __TAURI_IPC__?: unknown;
};

describe('Desktop Bridge', () => {
  // Preserve original window object if needed, though bun:test environment usually resets.
  // We'll manage window.__TAURI__ manually.

  beforeEach(() => {
    vi.useFakeTimers();
    // Clear __TAURI__ on window
    if (typeof window !== 'undefined') {
      Reflect.deleteProperty(window as TauriTestWindow, '__TAURI__');
      Reflect.deleteProperty(window as TauriTestWindow, '__TAURI_INTERNALS__');
      Reflect.deleteProperty(window as TauriTestWindow, '__TAURI_IPC__');
    }
    mockListen.mockReset();
    mockCoreInvoke.mockReset();
    // Reset the module-level promise cache if possible?
    // The module `bridge.ts` has `let bridgePromise`.
    // We cannot easily reset top-level variables in ES modules without reloading execution.
    // However, waitForTauriBridge resets bridgePromise to null when it resolves/rejects/times out.
    // So as long as previous tests awaited it, it should be null.
    // But if we want to ensure fresh state, we rely on the fact that `bridgePromise` is null after completion.
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('waitForTauriBridge', () => {
    it('resolves immediately if window.__TAURI__ is present', async () => {
      const mockInvoke = vi.fn();
      Object.defineProperty(window, '__TAURI__', {
        writable: true,
        configurable: true,
        value: { invoke: mockInvoke },
      });

      const result = await waitForTauriBridge(50);
      expect(result).toBe(true);
    });

    it('polls and resolves when __TAURI__ appears', async () => {
      // Should be initially missing (deleted in beforeEach)
      const waitPromise = waitForTauriBridge(400);

      // Advance time a bit, still not there
      vi.advanceTimersByTime(100);

      // Inject Tauri
      const mockInvoke = vi.fn();
      Object.defineProperty(window, '__TAURI__', {
        writable: true,
        configurable: true,
        value: { invoke: mockInvoke },
      });

      // Advance again to hit next poll
      vi.advanceTimersByTime(100);

      const result = await waitPromise;
      expect(result).toBe(true);
    });

    it('times out and returns false if __TAURI__ never appears', async () => {
      const waitPromise = waitForTauriBridge(1000); // 1 sec timeout for test

      vi.advanceTimersByTime(1100);

      const result = await waitPromise;
      expect(result).toBe(false);
    });
    it('returns the same promise when called repeatedly with the same timeout', async () => {
      const p1 = waitForTauriBridge(600);
      const p2 = waitForTauriBridge(600);
      expect(p1).toBe(p2);

      vi.advanceTimersByTime(700);
      await expect(p1).resolves.toBe(false);
    });

    it('does not share cached promises across different timeout values', async () => {
      const p1 = waitForTauriBridge(25);
      const p2 = waitForTauriBridge(1000);
      expect(p1).not.toBe(p2);

      vi.advanceTimersByTime(1100);
      await expect(p1).resolves.toBe(false);
      await expect(p2).resolves.toBe(false);
    });

    it('resolves false if window is undefined (SSR fallback)', async () => {
      const originalWindow = global.window;
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: undefined,
      });
      try {
        const result = await waitForTauriBridge(75);
        expect(result).toBe(false);
      } finally {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          writable: true,
          value: originalWindow,
        });
      }
    });

    it('resolves when the Tauri IPC marker allows loading the core module', async () => {
      Object.defineProperty(window, '__TAURI_IPC__', {
        writable: true,
        configurable: true,
        value: {},
      });

      await expect(waitForTauriBridge(75)).resolves.toBe(true);
    });
  });

  describe('invokeTauri', () => {
    it('calls the underlying invoke function when ready', async () => {
      const mockInvoke = vi.fn().mockResolvedValue('success');
      Object.defineProperty(window, '__TAURI__', {
        writable: true,
        configurable: true,
        value: { invoke: mockInvoke },
      });

      const result = await invokeTauri('test_command', { foo: 'bar' });
      expect(result).toBe('success');
      expect(mockInvoke).toHaveBeenCalledWith('test_command', { foo: 'bar' });
    });

    it('uses the core invoke fallback and parses results', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({ count: 3 });
      Object.defineProperty(window, '__TAURI__', {
        writable: true,
        configurable: true,
        value: { core: { invoke: mockInvoke } },
      });

      const result = await invokeTauri(
        ' app_server_status ',
        undefined,
        (value) => (value as { count: number }).count
      );

      expect(result).toBe(3);
      expect(mockInvoke).toHaveBeenCalledWith('app_server_status', undefined);
    });

    it('uses the internals invoke fallback when present', async () => {
      const mockInvoke = vi.fn().mockResolvedValue('internal-success');
      Object.defineProperty(window, '__TAURI_INTERNALS__', {
        writable: true,
        configurable: true,
        value: { invoke: mockInvoke },
      });

      const result = await invokeTauri('internal_cmd');

      expect(result).toBe('internal-success');
      expect(mockInvoke).toHaveBeenCalledWith('internal_cmd', undefined);
    });

    it('rejects invalid command names before waiting for the bridge', async () => {
      await expect(invokeTauri('bad command; rm -rf')).rejects.toThrow('Invalid Tauri command');
    });

    it('throws if bridge times out', async () => {
      // ensure global is empty
      Reflect.deleteProperty(window as TauriTestWindow, '__TAURI__');

      const invokePromise = invokeTauri('fail_cmd');

      vi.advanceTimersByTime(16000);

      await expect(invokePromise).rejects.toThrow('Tauri bridge not ready');
    });

    it('throws if global object has structure but no invoke function', async () => {
      // Edge case: __TAURI__ exists but no invoke
      Object.defineProperty(window, '__TAURI__', {
        writable: true,
        configurable: true,
        value: {}, // no invoke
      });

      const invokePromise = invokeTauri('fail_cmd');
      vi.advanceTimersByTime(16000);
      await expect(invokePromise).rejects.toThrow('Tauri bridge not ready');
    });

    it('uses the imported core invoke fallback when Tauri globals are not populated yet', async () => {
      mockCoreInvoke.mockResolvedValue({ ok: true });
      Object.defineProperty(window, '__TAURI_IPC__', {
        writable: true,
        configurable: true,
        value: {},
      });

      const result = await invokeTauri('plugin:desktop.ready');

      expect(result).toEqual({ ok: true });
      expect(mockCoreInvoke).toHaveBeenCalledWith('plugin:desktop.ready', undefined);

      mockCoreInvoke.mockResolvedValueOnce({ cached: true });
      await expect(invokeTauri('plugin:desktop.cached')).resolves.toEqual({ cached: true });
      expect(mockCoreInvoke).toHaveBeenCalledWith('plugin:desktop.cached', undefined);
    });
  });

  describe('listenTauriEvent', () => {
    it('registers an event listener and unwraps event payloads', async () => {
      const mockInvoke = vi.fn().mockResolvedValue('ready');
      const unlisten = vi.fn();
      mockListen.mockImplementation(
        async (_event: string, callback: (event: { payload: { status: string } }) => void) => {
          callback({ payload: { status: 'started' } });
          return unlisten;
        }
      );
      Object.defineProperty(window, '__TAURI__', {
        writable: true,
        configurable: true,
        value: { invoke: mockInvoke },
      });
      const handler = vi.fn();

      const result = await listenTauriEvent(' app-server:status ', handler);

      expect(result).toBe(unlisten);
      expect(mockListen).toHaveBeenCalledWith('app-server:status', expect.any(Function));
      expect(handler).toHaveBeenCalledWith({ status: 'started' });
    });

    it('rejects invalid event names before waiting for the bridge', async () => {
      await expect(listenTauriEvent('bad event name', vi.fn())).rejects.toThrow(
        'Invalid Tauri event'
      );
    });

    it('throws when the event bridge is not ready', async () => {
      const listenPromise = listenTauriEvent('app_event', vi.fn());

      vi.advanceTimersByTime(16000);

      await expect(listenPromise).rejects.toThrow('Tauri bridge not ready');
      expect(mockListen).not.toHaveBeenCalled();
    });

    it('propagates listener registration failures', async () => {
      mockListen.mockRejectedValue(new Error('listen failed'));
      Object.defineProperty(window, '__TAURI__', {
        writable: true,
        configurable: true,
        value: { invoke: vi.fn() },
      });

      await expect(listenTauriEvent('app_event', vi.fn())).rejects.toThrow('listen failed');
    });

    it('normalizes non-Error listener registration failures', async () => {
      mockListen.mockRejectedValue('listen failed');
      Object.defineProperty(window, '__TAURI__', {
        writable: true,
        configurable: true,
        value: { invoke: vi.fn() },
      });

      await expect(listenTauriEvent('app_event', vi.fn())).rejects.toThrow(
        'Tauri event API is unavailable'
      );
    });
  });
});
