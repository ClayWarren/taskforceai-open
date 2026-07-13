import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { voiceManager } from '@taskforceai/voice';
import { useVoice } from './useVoice';
import type { VoiceAdapter } from '@taskforceai/voice/types';

// Mock React hooks before importing useVoice
type StoreSubscribe = (onStoreChange: () => void) => () => void;
type StoreSnapshot<T> = () => T;
const storeSubscriptions: StoreSubscribe[] = [];

vi.mock('react', () => ({
  useCallback: <T>(fn: T) => fn,
  useMemo: <T>(fn: () => T) => fn(),
  useSyncExternalStore: <T>(subscribe: StoreSubscribe, getSnapshot: StoreSnapshot<T>) => {
    storeSubscriptions.push(subscribe);
    return getSnapshot();
  },
}));

const createStubAdapter = (): VoiceAdapter => ({
  init: vi.fn(async () => undefined),
  speak: vi.fn(async () => undefined),
  listen: vi.fn(async () => ''),
  record: vi.fn(async () => ({ data: '', format: 'wav' })),
  cancel: vi.fn(async () => undefined),
});

const resetVoiceManager = () => {
  voiceManager.setAdapter(createStubAdapter());
};

describe('voice/useVoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeSubscriptions.length = 0;
    resetVoiceManager();
  });

  afterEach(() => {
    resetVoiceManager();
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

  it('subscribes to manager state through useSyncExternalStore', () => {
    const subscribeSpy = vi.spyOn(voiceManager, 'subscribe');

    useVoice();

    expect(storeSubscriptions).toHaveLength(2);
    storeSubscriptions.forEach((subscribe) => subscribe(vi.fn()));
    expect(subscribeSpy).toHaveBeenCalledTimes(2);
  });

  it('returns unsubscribe callbacks from store subscriptions', () => {
    const mockUnsubscribe = vi.fn();
    vi.spyOn(voiceManager, 'subscribe').mockReturnValue(mockUnsubscribe);

    useVoice();

    storeSubscriptions.forEach((subscribe) => {
      subscribe(vi.fn())();
    });

    expect(mockUnsubscribe).toHaveBeenCalledTimes(2);
  });

  it('reads current manager snapshots during render', async () => {
    const testError = new Error('Test error');
    voiceManager.setAdapter({
      init: vi.fn().mockRejectedValue(testError),
      speak: vi.fn(),
      listen: vi.fn(),
      record: vi.fn(),
      cancel: vi.fn(),
    });
    await expect(voiceManager.init()).rejects.toThrow('Test error');

    const result = useVoice();

    expect(result.status).toBe('error');
    expect(result.error).toBe(testError);
  });
});
