import { beforeEach, describe, expect, it, mock } from 'bun:test';

type Listener = (event?: any) => void;

const speechState = {
  speakCalls: [] as Array<{ text: string; options?: Record<string, unknown> }>,
  stopCalls: 0,
  stopError: null as Error | null,
};

const recognitionState = {
  listeners: new Map<string, Set<Listener>>(),
  permissionsGranted: true,
  recognitionAvailable: true,
  servicesCalls: 0,
  startCalls: [] as Record<string, unknown>[],
  abortCalls: 0,
  stopCalls: 0,
  startError: null as Error | null,
};

const audioState = {
  permissionsGranted: true,
  modeCalls: [] as Record<string, unknown>[],
  recorderInstances: [] as Array<{
    prepared: boolean;
    recorded: boolean;
    stopped: boolean;
    uri: string | null;
  }>,
  recorderUri: 'file:///tmp/recording.m4a',
  readBase64Calls: [] as string[],
};

const metricsState = {
  timers: [] as string[],
  timerStops: 0,
  counters: [] as Array<{ name: string; tags?: Record<string, string> }>,
};

const resetState = () => {
  speechState.speakCalls = [];
  speechState.stopCalls = 0;
  speechState.stopError = null;
  recognitionState.listeners = new Map();
  recognitionState.permissionsGranted = true;
  recognitionState.recognitionAvailable = true;
  recognitionState.servicesCalls = 0;
  recognitionState.startCalls = [];
  recognitionState.abortCalls = 0;
  recognitionState.stopCalls = 0;
  recognitionState.startError = null;
  audioState.permissionsGranted = true;
  audioState.modeCalls = [];
  audioState.recorderInstances = [];
  audioState.recorderUri = 'file:///tmp/recording.m4a';
  audioState.readBase64Calls = [];
  metricsState.timers = [];
  metricsState.timerStops = 0;
  metricsState.counters = [];
};

const emitRecognitionEvent = (event: string, payload?: unknown) => {
  for (const listener of recognitionState.listeners.get(event) ?? []) {
    listener(payload);
  }
};

const waitForListenSetup = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

mock.module('expo-speech', () => ({
  __esModule: true,
  stop: async () => {
    speechState.stopCalls += 1;
    if (speechState.stopError) throw speechState.stopError;
  },
  speak: (text: string, options?: { onDone?: () => void }) => {
    speechState.speakCalls.push({ text, options: options as Record<string, unknown> });
    options?.onDone?.();
  },
}));

mock.module('expo-speech-recognition', () => ({
  __esModule: true,
  ExpoSpeechRecognitionModule: {
    getSpeechRecognitionServices: () => {
      recognitionState.servicesCalls += 1;
      return ['mock-service'];
    },
    requestPermissionsAsync: async () => ({ granted: recognitionState.permissionsGranted }),
    isRecognitionAvailable: () => recognitionState.recognitionAvailable,
    addListener: (event: string, listener: Listener) => {
      const listeners = recognitionState.listeners.get(event) ?? new Set<Listener>();
      listeners.add(listener);
      recognitionState.listeners.set(event, listeners);
      return {
        remove: () => listeners.delete(listener),
      };
    },
    abort: () => {
      recognitionState.abortCalls += 1;
    },
    stop: () => {
      recognitionState.stopCalls += 1;
    },
    start: (options: Record<string, unknown>) => {
      recognitionState.startCalls.push(options);
      if (recognitionState.startError) throw recognitionState.startError;
    },
  },
}));

mock.module('expo-audio', () => ({
  __esModule: true,
  RecordingPresets: {
    HIGH_QUALITY: { extension: '.m4a' },
  },
  requestRecordingPermissionsAsync: async () => ({ granted: audioState.permissionsGranted }),
  setAudioModeAsync: async (mode: Record<string, unknown>) => {
    audioState.modeCalls.push(mode);
  },
}));

mock.module('expo-audio/build/AudioModule', () => ({
  __esModule: true,
  default: {
    AudioRecorder: class MockAudioRecorder {
      uri: string | null = null;
      private state = {
        prepared: false,
        recorded: false,
        stopped: false,
        uri: null as string | null,
      };

      constructor() {
        audioState.recorderInstances.push(this.state);
      }

      async prepareToRecordAsync() {
        this.state.prepared = true;
      }

      record() {
        this.state.recorded = true;
      }

      async stop() {
        this.state.stopped = true;
        this.uri = audioState.recorderUri;
        this.state.uri = this.uri;
      }
    },
  },
}));

mock.module('../../utils/file-system', () => ({
  EncodingType: {
    Base64: 'base64',
  },
  readAsStringAsync: async (uri: string) => {
    audioState.readBase64Calls.push(uri);
    return 'YXVkaW8=';
  },
}));

mock.module('../../observability/metrics', () => ({
  mobileMetrics: {
    startTimer: (name: string) => {
      metricsState.timers.push(name);
      return () => {
        metricsState.timerStops += 1;
      };
    },
    incrementCounter: (name: string, tags?: Record<string, string>) => {
      metricsState.counters.push({ name, tags });
    },
  },
}));

mock.module('../../i18n', () => ({
  __esModule: true,
  default: {
    resolvedLanguage: 'es-MX',
    language: 'en-US',
  },
}));

mock.module('../../logger', () => ({
  createModuleLogger: () => ({
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {},
  }),
}));

describe('MobileVoiceAdapter', () => {
  beforeEach(() => {
    resetState();
  });

  it('creates adapter instances', () => {
    const { MobileVoiceAdapter } = require('../../voice/mobileAdapter');

    expect(new MobileVoiceAdapter()).toBeDefined();
  });

  it('speaks text after stopping any active speech', async () => {
    const { MobileVoiceAdapter } = require('../../voice/mobileAdapter');
    const adapter = new MobileVoiceAdapter();

    await adapter.speak('Read this aloud');

    expect(recognitionState.servicesCalls).toBe(1);
    expect(speechState.stopCalls).toBe(1);
    expect(speechState.speakCalls[0]?.text).toBe('Read this aloud');
  });

  it('resolves the final speech recognition transcript', async () => {
    const { MobileVoiceAdapter } = require('../../voice/mobileAdapter');
    const adapter = new MobileVoiceAdapter();

    const listenPromise = adapter.listen();
    await waitForListenSetup();
    emitRecognitionEvent('result', {
      isFinal: true,
      results: [{ transcript: 'mock transcript' }],
    });

    await expect(listenPromise).resolves.toBe('mock transcript');
    expect(recognitionState.startCalls).toEqual([
      {
        lang: 'es-MX',
        interimResults: false,
        continuous: false,
        maxAlternatives: 1,
      },
    ]);
    expect(metricsState.counters).toContainEqual({ name: 'voice.recognition.success' });
    expect(metricsState.timerStops).toBe(1);
  });

  it('ignores empty interim recognition results until a final result arrives', async () => {
    const { MobileVoiceAdapter } = require('../../voice/mobileAdapter');
    const adapter = new MobileVoiceAdapter();

    const listenPromise = adapter.listen();
    await waitForListenSetup();
    emitRecognitionEvent('result', { isFinal: false, results: [] });
    emitRecognitionEvent('result', {
      isFinal: true,
      results: [{ transcript: 'final transcript' }],
    });

    await expect(listenPromise).resolves.toBe('final transcript');
    expect(metricsState.counters).toContainEqual({ name: 'voice.recognition.success' });
  });

  it('rejects when speech recognition permission is denied', async () => {
    recognitionState.permissionsGranted = false;
    const { MobileVoiceAdapter } = require('../../voice/mobileAdapter');
    const adapter = new MobileVoiceAdapter();

    await expect(adapter.listen()).rejects.toThrow('permission was not granted');
    expect(metricsState.counters).toContainEqual({
      name: 'voice.recognition.failure',
      tags: { error: 'not-allowed' },
    });
  });

  it('rejects when recognition service is unavailable', async () => {
    recognitionState.recognitionAvailable = false;
    const { MobileVoiceAdapter } = require('../../voice/mobileAdapter');
    const adapter = new MobileVoiceAdapter();

    await expect(adapter.listen()).rejects.toThrow('not available on this device');
    expect(metricsState.counters).toContainEqual({
      name: 'voice.recognition.failure',
      tags: { error: 'service-not-allowed' },
    });
  });

  it('rejects recognition error events with cancellation messages', async () => {
    const { MobileVoiceAdapter } = require('../../voice/mobileAdapter');
    const adapter = new MobileVoiceAdapter();

    const listenPromise = adapter.listen();
    await waitForListenSetup();
    emitRecognitionEvent('error', { error: 'aborted' });

    await expect(listenPromise).rejects.toThrow('Voice input cancelled');
    expect(metricsState.counters).toContainEqual({
      name: 'voice.recognition.failure',
      tags: { error: 'aborted' },
    });
  });

  it('rejects when recognition ends without a result', async () => {
    const { MobileVoiceAdapter } = require('../../voice/mobileAdapter');
    const adapter = new MobileVoiceAdapter();

    const listenPromise = adapter.listen();
    await waitForListenSetup();
    emitRecognitionEvent('end');

    await expect(listenPromise).rejects.toThrow('ended without a result');
    expect(metricsState.counters).toContainEqual({
      name: 'voice.recognition.failure',
      tags: { error: 'no-result' },
    });
  });

  it('rejects and cleans up when recognition start throws', async () => {
    recognitionState.startError = new Error('microphone busy');
    const { MobileVoiceAdapter } = require('../../voice/mobileAdapter');
    const adapter = new MobileVoiceAdapter();

    await expect(adapter.listen()).rejects.toThrow('microphone busy');
    expect(metricsState.counters).toContainEqual({
      name: 'voice.recognition.failure',
      tags: { error: 'microphone busy' },
    });
  });

  it('cancels active recognition and stops speech', async () => {
    const { MobileVoiceAdapter } = require('../../voice/mobileAdapter');
    const adapter = new MobileVoiceAdapter();

    const listenPromise = adapter.listen();
    await waitForListenSetup();
    await adapter.cancel();

    await expect(listenPromise).rejects.toThrow('Voice input cancelled');
    expect(recognitionState.abortCalls).toBe(2);
    expect(speechState.stopCalls).toBe(1);
    expect(metricsState.counters).toContainEqual({ name: 'voice.recognition.cancelled' });
  });

  it('stops active recognition without cancelling when finishListening is called', async () => {
    const { MobileVoiceAdapter } = require('../../voice/mobileAdapter');
    const adapter = new MobileVoiceAdapter();

    const listenPromise = adapter.listen();
    await waitForListenSetup();
    await adapter.finishListening();
    emitRecognitionEvent('result', {
      isFinal: true,
      results: [{ transcript: 'accepted transcript' }],
    });

    await expect(listenPromise).resolves.toBe('accepted transcript');
    expect(recognitionState.stopCalls).toBe(1);
    expect(recognitionState.abortCalls).toBe(0);
    expect(metricsState.counters).toContainEqual({ name: 'voice.recognition.success' });
  });

  it('records native audio until finishListening is called', async () => {
    const { MobileVoiceAdapter } = require('../../voice/mobileAdapter');
    const adapter = new MobileVoiceAdapter();

    const recordPromise = adapter.record();
    await waitForListenSetup();
    await adapter.finishListening();

    await expect(recordPromise).resolves.toEqual({
      data: 'YXVkaW8=',
      filename: 'recording.m4a',
      format: 'm4a',
      mimeType: 'audio/mp4',
      uri: 'file:///tmp/recording.m4a',
    });
    expect(audioState.recorderInstances[0]).toMatchObject({
      prepared: true,
      recorded: true,
      stopped: true,
      uri: 'file:///tmp/recording.m4a',
    });
    expect(audioState.readBase64Calls).toEqual(['file:///tmp/recording.m4a']);
    expect(metricsState.counters).toContainEqual({ name: 'voice.recording.success' });
  });

  it('rejects native recording when microphone permission is denied', async () => {
    audioState.permissionsGranted = false;
    const { MobileVoiceAdapter } = require('../../voice/mobileAdapter');
    const adapter = new MobileVoiceAdapter();

    await expect(adapter.record()).rejects.toThrow('Microphone permission was not granted');
    expect(metricsState.counters).toContainEqual({
      name: 'voice.recording.failure',
      tags: { error: 'not-allowed' },
    });
  });

  it('cancels active native recording', async () => {
    const { MobileVoiceAdapter } = require('../../voice/mobileAdapter');
    const adapter = new MobileVoiceAdapter();

    const recordPromise = adapter.record();
    await waitForListenSetup();
    await adapter.cancel();

    await expect(recordPromise).rejects.toThrow('Voice input cancelled');
    expect(audioState.recorderInstances[0]).toMatchObject({ stopped: true });
    expect(metricsState.counters).toContainEqual({ name: 'voice.recording.cancelled' });
  });
});
