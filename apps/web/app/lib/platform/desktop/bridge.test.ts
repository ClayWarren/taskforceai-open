import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';

import { invokeTauri, waitForTauriBridge } from './bridge';

type TauriTestWindow = Window & {
  __TAURI__?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
};

describe('Desktop Bridge', () => {
  // Preserve original window object if needed, though bun:test environment usually resets.
  // We'll manage window.__TAURI__ manually.

  beforeEach(() => {
    vi.useFakeTimers();
    // Clear __TAURI__ on window
    if (typeof window !== 'undefined') {
      Reflect.deleteProperty(window as TauriTestWindow, '__TAURI__');
    }
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

    it('resolves false immediately if window is undefined', async () => {
      // Skipped as discussed (hard to mock absent window in jsdom/happydom)
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
  });
});
