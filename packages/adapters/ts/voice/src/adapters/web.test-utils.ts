/* c8 ignore file */
/* istanbul ignore file -- shared test environment fixture */
import { vi } from 'bun:test';

export type RecognitionListener = (...args: unknown[]) => void;
export type MockRecognitionInstance = {
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  addEventListener: ReturnType<
    typeof vi.fn<(event: string, listener: RecognitionListener) => void>
  >;
  start: ReturnType<typeof vi.fn<() => void>>;
  stop: ReturnType<typeof vi.fn<() => void>>;
};

const originalGlobals = new Map(
  ['window', 'navigator', 'SpeechSynthesisUtterance', 'FileReader', 'MediaRecorder'].map((key) => [
    key,
    {
      descriptor: Object.getOwnPropertyDescriptor(globalThis, key),
      value: Reflect.get(globalThis, key),
    },
  ])
);

export const setTestGlobal = (key: string, value: unknown) => {
  Object.defineProperty(globalThis, key, {
    value,
    writable: true,
    configurable: true,
  });
};

const restoreGlobals = () => {
  for (const [key, { descriptor, value }] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else if (value !== undefined) setTestGlobal(key, value);
    else Reflect.deleteProperty(globalThis, key);
  }
};

export const installWebVoiceTestEnvironment = () => {
  const mockRecognitionInstance: MockRecognitionInstance = {
    interimResults: false,
    maxAlternatives: 1,
    lang: 'en-US',
    addEventListener: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const mockSpeechRecognition = vi.fn(() => mockRecognitionInstance);
  const mockSpeechSynthesis = { speak: vi.fn(), cancel: vi.fn() };
  const mockGetUserMedia = vi
    .fn<() => Promise<{ getTracks: () => Array<{ stop: () => void }> }>>()
    .mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });

  setTestGlobal('window', {
    SpeechRecognition: mockSpeechRecognition,
    speechSynthesis: mockSpeechSynthesis,
  });
  setTestGlobal('navigator', {
    language: 'en-US',
    mediaDevices: { getUserMedia: mockGetUserMedia },
  });
  return {
    mockGetUserMedia,
    mockRecognitionInstance,
    mockSpeechRecognition,
    mockSpeechSynthesis,
    cleanup() {
      vi.useRealTimers();
      restoreGlobals();
      vi.restoreAllMocks();
    },
  };
};
