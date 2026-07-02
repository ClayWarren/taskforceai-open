import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { useVoice } from './useVoice';
import type { VoiceStatus } from './types';

// Mock React hooks before importing useVoice
let useEffectCallback: (() => (() => void) | void) | null = null;
let setStatusFn: ((status: VoiceStatus) => void) | null = null;
let setErrorFn: ((error: Error | null) => void) | null = null;

vi.mock('react', () => ({
  useMemo: <T>(fn: () => T) => fn(),
  useState: (initial: unknown) => {
    if (initial === 'idle' || initial === 'ready' || initial === 'error') {
      const setState = vi.fn();
      setStatusFn = setState;
      return [initial, setState];
    }
    // For error state (null initial)
    const setError = vi.fn();
    setErrorFn = setError;
    return [initial, setError];
  },
  useEffect: (callback: () => (() => void) | void) => {
    useEffectCallback = callback;
  },
}));

// Mock the VoiceManager
type VoiceListener = (status: VoiceStatus, error: Error | null) => void;
const mockSubscribe = vi.fn<(listener: VoiceListener) => () => void>(() => vi.fn());
const mockGetStatus = vi.fn(() => 'idle');
const mockGetError = vi.fn(() => null);
const mockSetAdapter = vi.fn();
const mockInit = vi.fn(async () => undefined);
const mockSpeak = vi.fn(async () => undefined);
const mockListen = vi.fn(async () => '');
const mockRecord = vi.fn(async () => ({ data: '', format: 'wav' }));
const mockCancel = vi.fn(async () => undefined);

vi.mock('./VoiceManager', () => ({
  voiceManager: {
    subscribe: mockSubscribe,
    getStatus: mockGetStatus,
    getError: mockGetError,
    setAdapter: mockSetAdapter,
    init: mockInit,
    speak: mockSpeak,
    listen: mockListen,
    record: mockRecord,
    cancel: mockCancel,
  },
}));

describe('voice/useVoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEffectCallback = null;
    setStatusFn = null;
    setErrorFn = null;
  });

  it('is a function', () => {
    expect(typeof useVoice).toBe('function');
  });

  it('returns manager, status, and error', () => {
    const result = useVoice();

    expect(result).toHaveProperty('manager');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('error');
  });

  it('returns idle status initially', () => {
    const result = useVoice();

    expect(result.status).toBe('idle');
  });

  it('returns null error initially', () => {
    const result = useVoice();

    expect(result.error).toBeNull();
  });

  it('exposes record on the manager', () => {
    const result = useVoice();

    expect(typeof result.manager.record).toBe('function');
  });

  it('subscribes to manager on mount', () => {
    useVoice();

    // Execute the useEffect callback
    if (useEffectCallback) {
      useEffectCallback();
    }

    expect(mockSubscribe).toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const mockUnsubscribe = vi.fn();
    mockSubscribe.mockReturnValue(mockUnsubscribe);

    useVoice();

    // Execute the useEffect callback and get cleanup function
    if (useEffectCallback) {
      const cleanup = useEffectCallback();
      if (typeof cleanup === 'function') {
        cleanup();
      }
    }

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('updates status and error when subscription callback fires', () => {
    useVoice();

    // Execute useEffect to capture the subscribe callback
    if (useEffectCallback) {
      useEffectCallback();
    }

    // Get the callback passed to subscribe
    const subscribeCallback = mockSubscribe.mock.calls[0]?.[0];
    expect(subscribeCallback).toBeDefined();

    // Simulate status change
    if (subscribeCallback && setStatusFn && setErrorFn) {
      const testError = new Error('Test error');
      subscribeCallback('error', testError);

      expect(setStatusFn).toHaveBeenCalledWith('error');
      expect(setErrorFn).toHaveBeenCalledWith(testError);
    }
  });
});
