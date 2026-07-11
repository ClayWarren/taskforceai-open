import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { WebVoiceAdapter } from './web';

describe('voice/adapters/web recording', () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  const originalUtteranceDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'SpeechSynthesisUtterance'
  );

  const originalWindow = globalThis.window;

  const originalNavigator = globalThis.navigator;

  const setGlobal = (key: string, value: unknown) => {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  };

  const restoreGlobal = (
    key: string,
    descriptor: PropertyDescriptor | undefined,
    fallback: unknown
  ) => {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
      return;
    }
    if (fallback !== undefined) {
      setGlobal(key, fallback);
      return;
    }
    Reflect.deleteProperty(globalThis, key);
  };

  type RecognitionListener = (...args: unknown[]) => void;

  type UtteranceListener = (event?: { error?: string }) => void;

  type MockRecognitionInstance = {
    interimResults: boolean;
    maxAlternatives: number;
    lang: string;
    addEventListener: ReturnType<
      typeof vi.fn<(event: string, listener: RecognitionListener) => void>
    >;
    start: ReturnType<typeof vi.fn<() => void>>;
    stop: ReturnType<typeof vi.fn<() => void>>;
  };

  let mockSpeechRecognition: ReturnType<typeof vi.fn>;

  let mockSpeechSynthesis: {
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };

  let mockGetUserMedia: ReturnType<typeof vi.fn>;

  let mockRecognitionInstance: MockRecognitionInstance;

  beforeEach(() => {
    const addEventListener = vi.fn<(event: string, listener: RecognitionListener) => void>();
    const start = vi.fn<() => void>();
    const stop = vi.fn<() => void>();

    mockRecognitionInstance = {
      interimResults: false,
      maxAlternatives: 1,
      lang: 'en-US',
      addEventListener,
      start,
      stop,
    };

    mockSpeechRecognition = vi.fn<() => typeof mockRecognitionInstance>(
      () => mockRecognitionInstance
    );

    mockSpeechSynthesis = {
      speak: vi.fn(),
      cancel: vi.fn(),
    };

    mockGetUserMedia = vi
      .fn<() => Promise<{ getTracks: () => Array<{ stop: () => void }> }>>()
      .mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }],
      });

    setGlobal('window', {
      SpeechRecognition: mockSpeechRecognition,
      speechSynthesis: mockSpeechSynthesis,
    });

    setGlobal('navigator', {
      language: 'en-US',
      mediaDevices: {
        getUserMedia: mockGetUserMedia,
      },
    });

    setGlobal(
      'SpeechSynthesisUtterance',
      class {
        text: string;
        listeners: Record<string, UtteranceListener[]> = {};

        constructor(text: string) {
          this.text = text;
        }

        addEventListener(event: string, listener: UtteranceListener) {
          if (!this.listeners[event]) this.listeners[event] = [];
          this.listeners[event].push(listener);
        }
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreGlobal('window', originalWindowDescriptor, originalWindow);
    restoreGlobal('navigator', originalNavigatorDescriptor, originalNavigator);
    restoreGlobal('SpeechSynthesisUtterance', originalUtteranceDescriptor, undefined);
    vi.restoreAllMocks();
  });

  describe('WebVoiceAdapter', () => {
    describe('record', () => {
      let mockMediaRecorder: {
        ondataavailable: ((e: { data: Blob }) => void) | null;
        onstop: (() => void) | null;
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        state: string;
        mimeType: string;
      };

      const installSuccessfulFileReader = (base64: string) => {
        setGlobal(
          'FileReader',
          class {
            result: string | null = null;
            error: DOMException | null = null;
            private listeners: Record<string, Array<() => void>> = {};

            addEventListener(event: string, listener: () => void) {
              this.listeners[event] = [...(this.listeners[event] ?? []), listener];
            }

            readAsDataURL(_blob: Blob) {
              this.result = `data:audio/webm;base64,${base64}`;
              setTimeout(() => {
                for (const listener of this.listeners['load'] ?? []) listener();
                for (const listener of this.listeners['loadend'] ?? []) listener();
              }, 0);
            }
          }
        );
      };

      const setupMediaRecorder = (mimeType: string) => {
        mockMediaRecorder = {
          ondataavailable: null,
          onstop: null,
          start: vi.fn().mockImplementation(() => {
            // Simulate data available then stop after start
            setTimeout(() => {
              mockMediaRecorder.ondataavailable?.({
                data: new Blob(['audio-data'], { type: mimeType }),
              });
              mockMediaRecorder.onstop?.();
            }, 0);
          }),
          stop: vi.fn(),
          state: 'inactive',
          mimeType,
        };

        setGlobal(
          'MediaRecorder',
          vi.fn(() => mockMediaRecorder)
        );

        installSuccessfulFileReader('dGVzdA==');

        const mockStream = {
          getTracks: () => [{ stop: vi.fn() }],
        };
        mockGetUserMedia.mockResolvedValue(mockStream);
      };

      it('maps recorder MIME types to output formats', async () => {
        for (const [mimeType, format] of [
          ['audio/webm;codecs=opus', 'webm'],
          ['audio/mp3', 'mp3'],
          ['audio/mpeg', 'mp3'],
          ['audio/wav', 'wav'],
          ['audio/ogg', 'webm'],
        ] as const) {
          setupMediaRecorder(mimeType);
          const adapter = new WebVoiceAdapter();
          await adapter.init();
          const result = await adapter.record();
          expect(result.format).toBe(format);
          expect(result.data).toBeDefined();
        }
      });

      it('records without speech recognition or synthesis support', async () => {
        setupMediaRecorder('audio/webm;codecs=opus');
        setGlobal('window', {});

        const adapter = new WebVoiceAdapter();

        await expect(adapter.init()).resolves.toBeUndefined();
        await expect(adapter.record()).resolves.toEqual({ data: 'dGVzdA==', format: 'webm' });
      });

      it('finishes an active recording without cancelling it', async () => {
        const stopTrack = vi.fn();
        mockMediaRecorder = {
          ondataavailable: null,
          onstop: null,
          start: vi.fn(() => {
            mockMediaRecorder.state = 'recording';
          }),
          stop: vi.fn(() => {
            mockMediaRecorder.state = 'inactive';
            mockMediaRecorder.ondataavailable?.({
              data: new Blob(['audio-data'], { type: 'audio/webm' }),
            });
            mockMediaRecorder.onstop?.();
          }),
          state: 'inactive',
          mimeType: 'audio/webm',
        };

        setGlobal(
          'MediaRecorder',
          vi.fn(() => mockMediaRecorder)
        );
        installSuccessfulFileReader('dGVzdA==');
        mockGetUserMedia.mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }],
        });

        const adapter = new WebVoiceAdapter();
        await adapter.init();
        stopTrack.mockClear();

        const recordPromise = adapter.record();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await adapter.finishListening();

        await expect(recordPromise).resolves.toEqual({ data: 'dGVzdA==', format: 'webm' });
        expect(mockMediaRecorder.stop).toHaveBeenCalledTimes(1);
        expect(stopTrack).toHaveBeenCalledTimes(1);
      });

      it('rejects with cancelled error when recording is cancelled', async () => {
        const mockRecorder = {
          ondataavailable: null as ((e: { data: Blob }) => void) | null,
          onstop: null as (() => void) | null,
          start: vi.fn(),
          stop: vi.fn(),
          state: 'recording',
          mimeType: 'audio/webm',
        };

        mockRecorder.stop.mockImplementation(() => {
          mockRecorder.state = 'inactive';
          mockRecorder.onstop?.();
        });

        setGlobal(
          'MediaRecorder',
          vi.fn(() => mockRecorder)
        );

        mockGetUserMedia.mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        });

        const adapter = new WebVoiceAdapter();
        await adapter.init();

        const recordPromise = adapter.record();
        const recordOutcome = recordPromise.catch((error) => error);
        await Promise.resolve();
        await adapter.cancel();

        const error = await recordOutcome;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Voice input cancelled.');
      });

      it('waits for recorder stop before resolving cancel', async () => {
        const mockRecorder = {
          ondataavailable: null as ((e: { data: Blob }) => void) | null,
          onstop: null as (() => void) | null,
          start: vi.fn(() => {
            mockRecorder.state = 'recording';
          }),
          stop: vi.fn(() => {
            mockRecorder.state = 'inactive';
          }),
          state: 'inactive',
          mimeType: 'audio/webm',
        };

        setGlobal(
          'MediaRecorder',
          vi.fn(() => mockRecorder)
        );

        mockGetUserMedia.mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        });

        const adapter = new WebVoiceAdapter();
        await adapter.init();

        const recordPromise = adapter.record();
        const recordOutcome = recordPromise.catch((error) => error);
        await Promise.resolve();

        let cancelResolved = false;
        const cancelPromise = adapter.cancel().then(() => {
          cancelResolved = true;
        });
        await Promise.resolve();

        expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
        expect(cancelResolved).toBe(false);

        mockRecorder.onstop?.();
        await cancelPromise;

        const error = await recordOutcome;
        expect(cancelResolved).toBe(true);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Voice input cancelled.');
      });

      it('waits for stale recording cancellation before replacing the session', async () => {
        const firstStopTrack = vi.fn();
        const secondStopTrack = vi.fn();
        const firstRecorder = {
          ondataavailable: null as ((e: { data: Blob }) => void) | null,
          onstop: null as (() => void) | null,
          start: vi.fn(() => {
            firstRecorder.state = 'recording';
          }),
          stop: vi.fn(() => {
            firstRecorder.state = 'inactive';
          }),
          state: 'inactive',
          mimeType: 'audio/webm',
        };
        const secondRecorder = {
          ondataavailable: null as ((e: { data: Blob }) => void) | null,
          onstop: null as (() => void) | null,
          start: vi.fn(() => {
            secondRecorder.state = 'recording';
          }),
          stop: vi.fn(() => {
            secondRecorder.state = 'inactive';
          }),
          state: 'inactive',
          mimeType: 'audio/webm',
        };
        const recorders = [firstRecorder, secondRecorder];
        const mediaRecorderCtor = vi.fn(() => {
          const next = recorders.shift();
          if (!next) {
            throw new Error('Unexpected MediaRecorder allocation');
          }
          return next;
        });

        setGlobal('MediaRecorder', mediaRecorderCtor);
        installSuccessfulFileReader('bmV3');
        mockGetUserMedia
          .mockResolvedValueOnce({
            getTracks: () => [{ stop: firstStopTrack }],
          })
          .mockResolvedValueOnce({
            getTracks: () => [{ stop: secondStopTrack }],
          });

        const adapter = new WebVoiceAdapter();
        const firstPromise = adapter.record();
        const firstOutcome = firstPromise.catch((error) => error);
        await Promise.resolve();
        await Promise.resolve();

        const secondPromise = adapter.record();
        await Promise.resolve();
        await Promise.resolve();

        expect(firstRecorder.stop).toHaveBeenCalledTimes(1);
        expect(mediaRecorderCtor).toHaveBeenCalledTimes(1);

        firstRecorder.onstop?.();
        for (
          let attempt = 0;
          attempt < 10 && mediaRecorderCtor.mock.calls.length < 2;
          attempt += 1
        ) {
          await Promise.resolve();
        }

        expect(mediaRecorderCtor).toHaveBeenCalledTimes(2);
        secondRecorder.ondataavailable?.({
          data: new Blob(['audio-data'], { type: 'audio/webm' }),
        });
        secondRecorder.onstop?.();

        const firstError = await firstOutcome;
        expect(firstError).toBeInstanceOf(Error);
        expect((firstError as Error).message).toBe('Voice input cancelled.');
        await expect(secondPromise).resolves.toEqual({ data: 'bmV3', format: 'webm' });
        expect(firstStopTrack).toHaveBeenCalledTimes(1);
        expect(secondStopTrack).toHaveBeenCalledTimes(1);
      });

      it('cancels promptly while microphone access is still pending', async () => {
        mockGetUserMedia.mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(
                () =>
                  resolve({
                    getTracks: () => [{ stop: vi.fn() }],
                  }),
                25
              );
            })
        );

        const adapter = new WebVoiceAdapter();
        await adapter.init();

        const recordPromise = adapter.record();
        await adapter.cancel();

        const outcome = await Promise.race([
          recordPromise
            .then(() => 'resolved')
            .catch((error) => (error instanceof Error ? error.message : String(error))),
          new Promise<string>((resolve) => setTimeout(() => resolve('timed-out'), 100)),
        ]);

        expect(outcome).toBe('Voice input cancelled.');
      });

      it('stops acquired stream when MediaRecorder setup fails', async () => {
        const stopTrack = vi.fn();
        mockGetUserMedia.mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }],
        });

        function FailingMediaRecorder() {
          throw new Error('MediaRecorder constructor failed');
        }

        setGlobal('MediaRecorder', FailingMediaRecorder);

        const adapter = new WebVoiceAdapter();

        await expect(adapter.record()).rejects.toThrow(
          'Failed to start recording: MediaRecorder constructor failed'
        );
        expect(stopTrack).toHaveBeenCalledTimes(1);
      });

      it('rejects when recorded audio cannot be read', async () => {
        setupMediaRecorder('audio/webm');

        setGlobal(
          'FileReader',
          class {
            result: string | null = null;

            addEventListener(event: string, listener: () => void) {
              if (event === 'error') {
                setTimeout(listener, 0);
              }
            }

            readAsDataURL(_blob: Blob) {}
          }
        );

        const adapter = new WebVoiceAdapter();
        await adapter.init();

        await expect(adapter.record()).rejects.toThrow('Failed to read recorded audio');
      });

      it('rejects when FileReader load completes without string data', async () => {
        setupMediaRecorder('audio/webm');

        setGlobal(
          'FileReader',
          class {
            result: string | null = null;
            error: DOMException | null = null;
            private listeners: Record<string, Array<() => void>> = {};

            addEventListener(event: string, listener: () => void) {
              this.listeners[event] = [...(this.listeners[event] ?? []), listener];
            }

            readAsDataURL(_blob: Blob) {
              setTimeout(() => {
                for (const listener of this.listeners['loadend'] ?? []) listener();
              }, 0);
            }
          }
        );

        const adapter = new WebVoiceAdapter();
        await adapter.init();

        await expect(adapter.record()).rejects.toThrow('Failed to read recorded audio');
      });

      it('rejects when automatic recording stop fails', async () => {
        vi.useFakeTimers();
        const mockRecorder = {
          ondataavailable: null as ((e: { data: Blob }) => void) | null,
          onstop: null as (() => void) | null,
          start: vi.fn(),
          stop: vi.fn(() => {
            throw new Error('Stop failed');
          }),
          state: 'recording',
          mimeType: 'audio/webm',
        };

        setGlobal(
          'MediaRecorder',
          vi.fn(() => mockRecorder)
        );

        mockGetUserMedia.mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        });

        const adapter = new WebVoiceAdapter();
        await adapter.init();

        const recordPromise = adapter.record();
        await Promise.resolve();
        vi.advanceTimersByTime(60_000);

        await expect(recordPromise).rejects.toThrow('Failed to stop recording');
      });
    });

    describe('cancel', () => {
      it('cancels speech, active recognition, and tolerates missing speech synthesis', async () => {
        const adapter = new WebVoiceAdapter();
        await adapter.init();

        await adapter.cancel();

        expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();

        mockRecognitionInstance.addEventListener.mockImplementation(() => {});
        adapter.listen().catch(() => {}); // Don't await
        await adapter.cancel();
        expect(mockRecognitionInstance.stop).toHaveBeenCalled();

        setGlobal('window', {
          SpeechRecognition: mockSpeechRecognition,
        });
        expect(await adapter.cancel()).toBeUndefined();
      });

      it('handles stop() throwing error', async () => {
        const adapter = new WebVoiceAdapter();
        await adapter.init();

        mockRecognitionInstance.addEventListener.mockImplementation(
          (_event: string, _listener: RecognitionListener) => {}
        );

        mockRecognitionInstance.stop.mockImplementation(() => {
          throw new Error('Stop failed');
        });

        const listenPromise = adapter.listen();

        // Should not throw
        expect(await adapter.cancel()).toBeUndefined();
        await expect(listenPromise).rejects.toThrow('Voice input cancelled.');
      });

      it('does not require window when cancelling idle adapter state', async () => {
        const adapter = new WebVoiceAdapter();
        Reflect.deleteProperty(globalThis, 'window');

        expect(await adapter.cancel()).toBeUndefined();
      });
    });
  });
});
