import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

import {
  PlatformProvider,
  useConversationStore,
  usePlatformRuntime,
  useStorageAdapter,
  useStreamingRuntime,
} from './PlatformProvider';

// Mocks
const mockDetectRuntime = mock(() => 'browser');

mock.module('@taskforceai/shared/utils/runtime', () => ({
  detectRuntime: mockDetectRuntime,
}));

const mockDesktopStore = { kind: 'desktop-store' };
const mockBrowserStore = { kind: 'browser-store' };
mock.module('./desktop/conversation-store', () => ({
  createDesktopConversationStore: () => mockDesktopStore,
}));
mock.module('./browser/conversation-store', () => ({
  createBrowserConversationStore: () => mockBrowserStore,
}));

const mockDesktopRuntime = { kind: 'desktop-runtime' };
const mockBrowserRuntime = { kind: 'browser-runtime' };
mock.module('./desktop/streaming-runtime', () => ({
  createDesktopStreamingRuntime: () => mockDesktopRuntime,
}));
mock.module('./browser/streaming-runtime', () => ({
  createBrowserStreamingRuntime: () => mockBrowserRuntime,
}));

const mockTauriStorage = { kind: 'tauri-storage' };
const mockDexieStorage = { kind: 'dexie-storage' };
mock.module('../storage/tauri-adapter', () => ({
  tauriStorage: mockTauriStorage,
}));
mock.module('../storage/dexie-adapter', () => ({
  dexieStorage: mockDexieStorage,
}));

describe('PlatformProvider', () => {
  beforeEach(() => {
    mockDetectRuntime.mockClear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children', () => {
    mockDetectRuntime.mockReturnValue('browser');
    render(
      <PlatformProvider>
        <div data-testid="child">Child</div>
      </PlatformProvider>
    );
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('provides browser implementations when runtime is browser', () => {
    mockDetectRuntime.mockReturnValue('browser');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PlatformProvider>{children}</PlatformProvider>
    );

    const { result: platform } = renderHook(() => usePlatformRuntime(), { wrapper });
    const { result: store } = renderHook(() => useConversationStore(), { wrapper });
    const { result: runtime } = renderHook(() => useStreamingRuntime(), { wrapper });
    const { result: storage } = renderHook(() => useStorageAdapter(), { wrapper });

    expect(platform.current).toBe('browser');
    expect(store.current).toEqual(mockBrowserStore as any);
    expect(runtime.current).toEqual(mockBrowserRuntime as any);
    expect(storage.current).toEqual(mockDexieStorage as any);
  });

  // Note: To test desktop, we ideally reset modules, but bun's mock.module is static.
  // However, PlatformProvider memoizes based on detectRuntime result, so changing the mock return value
  // and re-rendering *should* work if the component calls detectRuntime() on mount.
  it('provides desktop implementations when runtime is desktop', () => {
    mockDetectRuntime.mockReturnValue('desktop');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PlatformProvider>{children}</PlatformProvider>
    );

    const { result: platform } = renderHook(() => usePlatformRuntime(), { wrapper });
    const { result: store } = renderHook(() => useConversationStore(), { wrapper });
    const { result: runtime } = renderHook(() => useStreamingRuntime(), { wrapper });
    const { result: storage } = renderHook(() => useStorageAdapter(), { wrapper });

    expect(platform.current).toBe('desktop');
    // Desktop uses lazy proxies that wrap the actual implementations,
    // so we verify the proxy shape rather than comparing to the mock directly.
    expect(store.current).not.toEqual(mockBrowserStore as any);
    expect(typeof store.current.ensureConversation).toBe('function');
    expect(typeof store.current.listConversations).toBe('function');
    expect(runtime.current).not.toEqual(mockBrowserRuntime as any);
    expect(typeof runtime.current.startStreaming).toBe('function');
    expect(storage.current).not.toEqual(mockDexieStorage as any);
    expect(typeof storage.current.getConversations).toBe('function');
  });

  it('safely handles subscribe calls and returns unsubscribe without crashing on desktop', () => {
    mockDetectRuntime.mockReturnValue('desktop');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PlatformProvider>{children}</PlatformProvider>
    );
    const { result: store } = renderHook(() => useConversationStore(), { wrapper });

    // This verifies that invoking subscribe immediately returns an unsubscribe function
    // and correctly registers the attemptSubscribe logic internally without throwing.
    const unsubscribe = store.current.subscribe(() => {});
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('throws error when hooks are used outside provider', () => {
    // Suppress console.error for this test as React logs errors for uncaught exceptions
    const originalError = console.error;
    console.error = () => {};

    expect(() => renderHook(() => useConversationStore())).toThrow('within PlatformProvider');
    expect(() => renderHook(() => useStreamingRuntime())).toThrow('within PlatformProvider');
    expect(() => renderHook(() => useStorageAdapter())).toThrow('within PlatformProvider');

    console.error = originalError;
  });

  it('promotes from browser to desktop when runtime changes after mount', async () => {
    vi.useFakeTimers();
    mockDetectRuntime
      .mockReturnValueOnce('browser')
      .mockReturnValueOnce('browser')
      .mockReturnValue('desktop');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PlatformProvider>{children}</PlatformProvider>
    );

    const { result } = renderHook(() => usePlatformRuntime(), { wrapper });
    expect(result.current).toBe('browser');

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe('desktop');
  });
});
