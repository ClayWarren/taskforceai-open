import '../../../../../../tests/setup/dom';

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { createRef } from 'react';

import { usePromptTextareaAutofocus } from './usePromptTextareaAutofocus';

const setUserAgent = (userAgent: string) => {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  });
};

const mockTextareaFocus = (textarea: HTMLTextAreaElement) => {
  const originalFocus = textarea.focus.bind(textarea);
  const focus = vi.fn((options?: FocusOptions) => {
    originalFocus(options);
  });
  Object.defineProperty(textarea, 'focus', {
    configurable: true,
    value: focus,
  });
  return focus;
};

describe('usePromptTextareaAutofocus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('focuses the textarea after a short desktop delay', () => {
    const textarea = document.createElement('textarea');
    const focus = mockTextareaFocus(textarea);
    document.body.append(textarea);
    const textareaRef = createRef<HTMLTextAreaElement>();
    textareaRef.current = textarea;

    renderHook(() =>
      usePromptTextareaAutofocus({
        controlsDisabled: false,
        interactionsDisabled: false,
        textareaRef,
      })
    );

    vi.advanceTimersByTime(149);
    expect(focus).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('does not focus on mobile or while controls are disabled', () => {
    const textarea = document.createElement('textarea');
    const focus = mockTextareaFocus(textarea);
    const textareaRef = createRef<HTMLTextAreaElement>();
    textareaRef.current = textarea;

    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile');
    const mobile = renderHook(() =>
      usePromptTextareaAutofocus({
        controlsDisabled: false,
        interactionsDisabled: false,
        textareaRef,
      })
    );
    vi.advanceTimersByTime(150);
    mobile.unmount();

    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    renderHook(() =>
      usePromptTextareaAutofocus({
        controlsDisabled: true,
        interactionsDisabled: false,
        textareaRef,
      })
    );
    vi.advanceTimersByTime(150);

    expect(focus).not.toHaveBeenCalled();
  });

  it('does not focus while interactions are disabled', () => {
    const textarea = document.createElement('textarea');
    const focus = mockTextareaFocus(textarea);
    const textareaRef = createRef<HTMLTextAreaElement>();
    textareaRef.current = textarea;

    renderHook(() =>
      usePromptTextareaAutofocus({
        controlsDisabled: false,
        interactionsDisabled: true,
        textareaRef,
      })
    );
    vi.advanceTimersByTime(150);

    expect(focus).not.toHaveBeenCalled();
  });

  it('tolerates a missing textarea ref when the focus timer fires', () => {
    const textareaRef = createRef<HTMLTextAreaElement>();

    renderHook(() =>
      usePromptTextareaAutofocus({
        controlsDisabled: false,
        interactionsDisabled: false,
        textareaRef,
      })
    );

    expect(() => vi.advanceTimersByTime(150)).not.toThrow();
  });

  it('skips focusing when the textarea is already active or unmounted before the timer fires', () => {
    const textarea = document.createElement('textarea');
    const focus = mockTextareaFocus(textarea);
    document.body.append(textarea);
    textarea.focus();
    const textareaRef = createRef<HTMLTextAreaElement>();
    textareaRef.current = textarea;

    const alreadyActive = renderHook(() =>
      usePromptTextareaAutofocus({
        controlsDisabled: false,
        interactionsDisabled: false,
        textareaRef,
      })
    );
    vi.advanceTimersByTime(150);
    expect(focus).toHaveBeenCalledTimes(1);
    alreadyActive.unmount();

    focus.mockClear();
    const pending = renderHook(() =>
      usePromptTextareaAutofocus({
        controlsDisabled: false,
        interactionsDisabled: false,
        textareaRef,
      })
    );
    pending.unmount();
    vi.advanceTimersByTime(150);
    expect(focus).not.toHaveBeenCalled();
  });
});
