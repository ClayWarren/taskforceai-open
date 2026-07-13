import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';
import '../../../../../tests/setup/dom';

import { usePrivateChatMode } from './privateChat';

describe('usePrivateChatMode', () => {
  it('toggles private chat while authenticated', () => {
    const { result } = renderHook(() =>
      usePrivateChatMode({ isAuthenticated: true, isAuthLoading: false })
    );

    expect(result.current.shouldRenderPrivateChatToggle).toBe(true);
    expect(result.current.isPrivateChat).toBe(false);

    act(() => {
      result.current.togglePrivateChat();
    });

    expect(result.current.isPrivateChat).toBe(true);

    act(() => {
      result.current.disablePrivateChat();
    });

    expect(result.current.isPrivateChat).toBe(false);
  });

  it('hides and clears private chat when signed out', () => {
    const { result, rerender } = renderHook(
      ({ isAuthenticated }) => usePrivateChatMode({ isAuthenticated, isAuthLoading: false }),
      { initialProps: { isAuthenticated: true } }
    );

    act(() => {
      result.current.setPrivateChat(true);
    });
    expect(result.current.isPrivateChat).toBe(true);

    rerender({ isAuthenticated: false });

    expect(result.current.shouldRenderPrivateChatToggle).toBe(false);
    expect(result.current.isPrivateChat).toBe(false);

    rerender({ isAuthenticated: true });
    expect(result.current.isPrivateChat).toBe(false);
  });

  it('does not toggle while streaming', () => {
    const { result } = renderHook(() =>
      usePrivateChatMode({
        isAuthenticated: true,
        isAuthLoading: false,
        isStreaming: true,
      })
    );

    act(() => {
      result.current.togglePrivateChat();
    });

    expect(result.current.isPrivateChatToggleDisabled).toBe(true);
    expect(result.current.isPrivateChat).toBe(false);
  });
});
