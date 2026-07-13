import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../../../tests/setup/dom';
import { usePromptSubmission, type UsePromptSubmissionProps } from './usePromptSubmission';
import { ok } from '@taskforceai/client-core/result';

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

describe('usePromptSubmission', () => {
  const mockProps: UsePromptSubmissionProps = {
    prompt: 'hello',
    files: [],
    modelSelectorEnabled: true,
    selectedModelId: 'gpt-4',
    ensureConversationId: vi.fn().mockResolvedValue('conv-123'),
    setErrorMessage: vi.fn(),
    clearErrorMessage: vi.fn(),
    resetFormState: vi.fn(),
    hasRateLimitError: false,
    isListening: false,
    isAuthenticated: true,
    userPlan: 'pro',
    enqueuePrompt: vi.fn().mockResolvedValue(undefined),
    startStreaming: vi.fn().mockResolvedValue(undefined),
    submitPrompt: vi.fn().mockResolvedValue(ok({ type: 'streaming_started' })),
    uploadAttachment: vi.fn().mockResolvedValue('file-123'),
    getRateLimitMessage: vi.fn().mockReturnValue('Rate limited'),
    getRateLimitResetTime: vi.fn().mockReturnValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('handles unauthenticated submission with setTimeout (Hardening TF-0023)', async () => {
    const { result } = renderHook(() =>
      usePromptSubmission({
        ...mockProps,
        isAuthenticated: false,
      })
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    // Error message should NOT be set immediately
    expect(mockProps.setErrorMessage).not.toHaveBeenCalled();

    // Advance timers
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(mockProps.setErrorMessage).toHaveBeenCalledWith('Please sign in to start chatting.');
  });

  it('allows host-approved unauthenticated prompts through submission', async () => {
    const allowUnauthenticatedPrompt = vi.fn((value: string) => value.startsWith('/'));
    const submitPrompt = vi.fn().mockResolvedValue(ok({ type: 'streaming_started' }));

    const { result } = renderHook(() =>
      usePromptSubmission({
        ...mockProps,
        isAuthenticated: false,
        submitPrompt,
        allowUnauthenticatedPrompt,
      })
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(allowUnauthenticatedPrompt).toHaveBeenCalledWith('hello');
    expect(submitPrompt).not.toHaveBeenCalled();

    const { result: slashResult } = renderHook(() =>
      usePromptSubmission({
        ...mockProps,
        prompt: '/status',
        isAuthenticated: false,
        submitPrompt,
        allowUnauthenticatedPrompt,
      })
    );

    await act(async () => {
      await slashResult.current.handleSubmit();
    });

    expect(submitPrompt).toHaveBeenCalled();
  });

  it('does not submit while rate-limited or listening', async () => {
    const rateLimitedSubmitPrompt = vi.fn().mockResolvedValue(ok({ type: 'streaming_started' }));
    const listeningSubmitPrompt = vi.fn().mockResolvedValue(ok({ type: 'streaming_started' }));

    const { result: rateLimited } = renderHook(() =>
      usePromptSubmission({
        ...mockProps,
        hasRateLimitError: true,
        submitPrompt: rateLimitedSubmitPrompt,
      })
    );
    const { result: listening } = renderHook(() =>
      usePromptSubmission({
        ...mockProps,
        isListening: true,
        submitPrompt: listeningSubmitPrompt,
      })
    );

    await act(async () => {
      await rateLimited.current.handleSubmit();
      await listening.current.handleSubmit();
    });

    expect(rateLimitedSubmitPrompt).not.toHaveBeenCalled();
    expect(listeningSubmitPrompt).not.toHaveBeenCalled();
    expect(mockProps.clearErrorMessage).not.toHaveBeenCalled();
  });

  it('does not submit blank prompts without attachments', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(ok({ type: 'streaming_started' }));

    const { result } = renderHook(() =>
      usePromptSubmission({
        ...mockProps,
        prompt: '   ',
        submitPrompt,
      })
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(submitPrompt).not.toHaveBeenCalled();
    expect(mockProps.clearErrorMessage).not.toHaveBeenCalled();
  });

  it('catches and handles submission errors (Hardening TF-0020)', async () => {
    (mockProps.submitPrompt as any).mockRejectedValue(new Error('Network failure'));

    const { result } = renderHook(() => usePromptSubmission(mockProps));

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mockProps.setErrorMessage).toHaveBeenCalledWith(
      'Something went wrong while sending your message. Please try again.'
    );
  });

  it('handles rate limit results', async () => {
    (mockProps.submitPrompt as any).mockResolvedValue(
      ok({
        type: 'rate_limit',
        message: 'Too many requests',
        resetTime: 123456789,
      })
    );

    const { result } = renderHook(() => usePromptSubmission(mockProps));

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mockProps.setErrorMessage).toHaveBeenCalledWith('Too many requests', '123456789');
  });

  it('ignores overlapping submissions while a request is in flight', async () => {
    const deferredResult =
      createDeferred<Awaited<ReturnType<UsePromptSubmissionProps['submitPrompt']>>>();
    const submitPrompt = vi.fn().mockImplementation(async () => deferredResult.promise);
    const resetFormState = vi.fn();

    const { result } = renderHook(() =>
      usePromptSubmission({
        ...mockProps,
        submitPrompt,
        resetFormState,
      })
    );

    await act(async () => {
      const firstSubmit = result.current.handleSubmit();
      const secondSubmit = result.current.handleSubmit();

      await Promise.resolve();
      expect(submitPrompt).toHaveBeenCalledTimes(1);

      deferredResult.resolve(ok({ type: 'streaming_started' }));
      await Promise.all([firstSubmit, secondSubmit]);
    });

    expect(submitPrompt).toHaveBeenCalledTimes(1);
    expect(resetFormState).toHaveBeenCalledTimes(1);
  });
});
