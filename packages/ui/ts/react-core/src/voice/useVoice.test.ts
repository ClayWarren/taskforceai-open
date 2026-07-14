import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../../../../tests/setup/dom';

import { voiceManager } from '@taskforceai/voice';
import { useVoice } from './useVoice';
import type { VoiceAdapter } from '@taskforceai/voice/types';

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
    resetVoiceManager();
  });

  afterEach(() => {
    cleanup();
    resetVoiceManager();
  });

  it('is a function', () => {
    expect(typeof useVoice).toBe('function');
  });

  it('returns manager, status, and error', () => {
    const { result } = renderHook(() => useVoice());

    expect(result.current).toHaveProperty('manager');
    expect(result.current).toHaveProperty('status');
    expect(result.current).toHaveProperty('error');
  });

  it('returns idle status initially', () => {
    const { result } = renderHook(() => useVoice());

    expect(result.current.status).toBe('idle');
  });

  it('returns null error initially', () => {
    const { result } = renderHook(() => useVoice());

    expect(result.current.error).toBeNull();
  });

  it('exposes record on the manager', () => {
    const { result } = renderHook(() => useVoice());

    expect(typeof result.current.manager.record).toBe('function');
  });

  it('subscribes to manager state through useSyncExternalStore', () => {
    const subscribeSpy = vi.spyOn(voiceManager, 'subscribe');

    renderHook(() => useVoice());

    expect(subscribeSpy).toHaveBeenCalledTimes(2);
  });

  it('returns unsubscribe callbacks from store subscriptions', () => {
    const mockUnsubscribe = vi.fn();
    vi.spyOn(voiceManager, 'subscribe').mockReturnValue(mockUnsubscribe);

    const { unmount } = renderHook(() => useVoice());
    unmount();

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
    await act(async () => {
      await expect(voiceManager.init()).rejects.toThrow('Test error');
    });

    const { result } = renderHook(() => useVoice());

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(testError);
  });
});
