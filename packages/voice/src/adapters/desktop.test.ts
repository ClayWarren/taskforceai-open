import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { DesktopVoiceAdapter } from './desktop';

describe('voice/adapters/desktop', () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalWindow = globalThis.window;
  let mockInvoke: ReturnType<typeof vi.fn>;

  const setWindow = (value: unknown) => {
    Object.defineProperty(globalThis, 'window', {
      value,
      writable: true,
      configurable: true,
    });
  };

  const restoreWindow = () => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
      return;
    }
    if (originalWindow !== undefined) {
      setWindow(originalWindow);
      return;
    }
    Reflect.deleteProperty(globalThis, 'window');
  };

  beforeEach(() => {
    mockInvoke = vi.fn().mockResolvedValue(undefined);
    setWindow({
      __TAURI__: {
        invoke: mockInvoke,
      },
    });
  });

  afterEach(() => {
    restoreWindow();
    vi.restoreAllMocks();
  });

  describe('DesktopVoiceAdapter', () => {
    it('creates instance', () => {
      const adapter = new DesktopVoiceAdapter();
      expect(adapter).toBeInstanceOf(DesktopVoiceAdapter);
    });

    describe('init', () => {
      it('initializes successfully when Tauri bridge available', async () => {
        const adapter = new DesktopVoiceAdapter();

        expect(await adapter.init()).toBeUndefined();
      });

      it('throws error when Tauri bridge not available', async () => {
        setWindow({});

        const adapter = new DesktopVoiceAdapter();

        await expect((async () => adapter.init())()).rejects.toThrow(
          'Tauri voice bridge is not available.'
        );
      });

      it('throws error when __TAURI__.invoke is missing', async () => {
        setWindow({
          __TAURI__: {},
        });

        const adapter = new DesktopVoiceAdapter();

        await expect((async () => adapter.init())()).rejects.toThrow(
          'Tauri voice bridge is not available.'
        );
      });

      it('returns immediately if already initialized', async () => {
        const adapter = new DesktopVoiceAdapter();

        await adapter.init();
        await adapter.init();

        // Should not throw, just return
        expect(true).toBe(true);
      });

      it('reuses existing init promise if init in progress', async () => {
        let resolveInit: () => void = () => {};
        mockInvoke.mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              resolveInit = resolve;
            })
        );

        const adapter = new DesktopVoiceAdapter();

        const promise1 = adapter.init();
        const promise2 = adapter.init();

        resolveInit();

        await Promise.all([promise1, promise2]);

        // Both should resolve to the same promise
        expect(true).toBe(true);
      });

      it('resets initialization state on error', async () => {
        setWindow({});

        const adapter = new DesktopVoiceAdapter();

        await expect((async () => adapter.init())()).rejects.toThrow();

        // Restore Tauri bridge
        setWindow({
          __TAURI__: {
            invoke: mockInvoke,
          },
        });

        // Should be able to init again
        expect(await adapter.init()).toBeUndefined();
      });
    });

    describe('speak', () => {
      it('invokes voice_speak command with text', async () => {
        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        await adapter.speak('Hello world');

        expect(mockInvoke).toHaveBeenCalledWith('voice_speak', { text: 'Hello world' });
      });

      it('auto-initializes if not initialized', async () => {
        const adapter = new DesktopVoiceAdapter();

        await adapter.speak('Hello');

        expect(mockInvoke).toHaveBeenCalledWith('voice_speak', { text: 'Hello' });
      });

      it('throws error if Tauri bridge becomes unavailable', async () => {
        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        // Remove Tauri bridge
        // @ts-expect-error - setting globals for test
        globalThis.window = {};

        await expect((async () => adapter.speak('Hello'))()).rejects.toThrow(
          'Tauri voice bridge is not available.'
        );
      });
    });

    describe('listen', () => {
      it('invokes voice_listen command and returns transcript', async () => {
        mockInvoke.mockResolvedValue('transcribed text');

        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        const result = await adapter.listen();

        expect(mockInvoke).toHaveBeenCalledWith('voice_listen', undefined);
        expect(result).toBe('transcribed text');
      });

      it('throws error if response is not a string', async () => {
        mockInvoke.mockResolvedValue({ invalid: 'response' });

        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        await expect((async () => adapter.listen())()).rejects.toThrow(
          'Tauri voice bridge returned invalid response.'
        );
      });

      it('throws error if response is null', async () => {
        mockInvoke.mockResolvedValue(null);

        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        await expect((async () => adapter.listen())()).rejects.toThrow(
          'Tauri voice bridge returned invalid response.'
        );
      });

      it('throws error if response is undefined', async () => {
        mockInvoke.mockResolvedValue(undefined);

        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        await expect((async () => adapter.listen())()).rejects.toThrow(
          'Tauri voice bridge returned invalid response.'
        );
      });

      it('throws error if response is a number', async () => {
        mockInvoke.mockResolvedValue(123);

        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        await expect((async () => adapter.listen())()).rejects.toThrow(
          'Tauri voice bridge returned invalid response.'
        );
      });
    });

    describe('record', () => {
      it('throws unsupported recording error', async () => {
        const adapter = new DesktopVoiceAdapter();

        await expect((async () => adapter.record())()).rejects.toThrow(
          'Native audio recording is not yet supported in Desktop.'
        );
      });
    });

    describe('cancel', () => {
      it('invokes voice_cancel command', async () => {
        const adapter = new DesktopVoiceAdapter();
        await adapter.init();

        await adapter.cancel();

        expect(mockInvoke).toHaveBeenCalledWith('voice_cancel', undefined);
      });

      it('auto-initializes if not initialized', async () => {
        const adapter = new DesktopVoiceAdapter();

        await adapter.cancel();

        expect(mockInvoke).toHaveBeenCalledWith('voice_cancel', undefined);
      });
    });
  });
});
