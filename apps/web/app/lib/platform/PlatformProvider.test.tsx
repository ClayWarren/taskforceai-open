import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
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

const mockDesktopStore = {
  kind: 'desktop-store',
  subscribe: vi.fn(() => vi.fn()),
  ensureConversation: vi.fn(),
};
const mockBrowserConversation = {
  id: 2,
  conversationId: 'browser-conv-1',
  title: 'Browser conversation',
  createdAt: 1710000003000,
  updatedAt: 1710000004000,
  lastMessagePreview: null,
  syncVersion: 2,
  lastSyncedAt: 1710000005000,
  deviceId: 'browser-device-1',
  isDeleted: false,
  isArchived: false,
};
const mockBrowserStore = {
  kind: 'browser-store',
  subscribe: vi.fn(() => vi.fn()),
  listConversations: vi.fn(async () => [mockBrowserConversation]),
};
mock.module('./desktop/conversation-store', () => ({
  createDesktopConversationStore: () => mockDesktopStore,
}));
mock.module('./browser/conversation-store', () => ({
  createBrowserConversationStore: () => mockBrowserStore,
}));

const mockDesktopRuntime = {
  kind: 'desktop-runtime',
  startStreaming: vi.fn(async () => undefined),
  stopStreaming: vi.fn(),
};
const mockBrowserRuntime = { kind: 'browser-runtime' };
mock.module('./desktop/streaming-runtime', () => ({
  createDesktopStreamingRuntime: () => mockDesktopRuntime,
}));
mock.module('./browser/streaming-runtime', () => ({
  createBrowserStreamingRuntime: () => mockBrowserRuntime,
}));

const mockDesktopConversation = {
  id: 1,
  conversationId: 'conv-1',
  title: 'Desktop conversation',
  createdAt: 1710000000000,
  updatedAt: 1710000001000,
  lastMessagePreview: null,
  syncVersion: 1,
  lastSyncedAt: 1710000002000,
  deviceId: 'device-1',
  isDeleted: false,
  isArchived: false,
};
const mockTauriStorage = {
  kind: 'tauri-storage',
  getConversations: vi.fn(async () => [mockDesktopConversation]),
};
const mockDexieStorage = {
  kind: 'dexie-storage',
  getConversations: vi.fn(async () => [mockBrowserConversation]),
};
mock.module('../storage/tauri-adapter', () => ({
  tauriStorage: mockTauriStorage,
}));
mock.module('../storage/dexie-adapter', () => ({
  dexieStorage: mockDexieStorage,
}));

describe('PlatformProvider', () => {
  beforeEach(() => {
    mockDetectRuntime.mockClear();
    mockBrowserStore.subscribe.mockClear();
    mockBrowserStore.listConversations.mockClear();
    mockDesktopStore.subscribe.mockClear();
    mockDesktopStore.ensureConversation.mockClear();
    mockDesktopRuntime.startStreaming.mockClear();
    mockDesktopRuntime.stopStreaming.mockClear();
    mockDexieStorage.getConversations.mockClear();
    mockTauriStorage.getConversations.mockClear();
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

  it('provides browser implementations when runtime is browser', async () => {
    mockDetectRuntime.mockReturnValue('browser');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PlatformProvider>{children}</PlatformProvider>
    );

    const { result: platform } = renderHook(() => usePlatformRuntime(), { wrapper });
    const { result: store } = renderHook(() => useConversationStore(), { wrapper });
    const { result: runtime } = renderHook(() => useStreamingRuntime(), { wrapper });
    const { result: storage } = renderHook(() => useStorageAdapter(), { wrapper });

    expect(platform.current).toBe('browser');
    expect(runtime.current).toEqual(mockBrowserRuntime as any);
    expect(store.current).not.toEqual(mockBrowserStore as any);
    expect(typeof store.current.listConversations).toBe('function');
    await expect(store.current.listConversations(5, 1)).resolves.toEqual([mockBrowserConversation]);
    expect(mockBrowserStore.listConversations).toHaveBeenCalledWith(5, 1);

    expect(storage.current).not.toEqual(mockDexieStorage as any);
    expect(typeof storage.current.getConversations).toBe('function');
    await expect(storage.current.getConversations(5, 1)).resolves.toEqual([
      mockBrowserConversation,
    ]);
    expect(mockDexieStorage.getConversations).toHaveBeenCalledWith(5, 1);
  });

  it('forwards browser subscribe once the lazy store resolves and cleans up the inner subscription', async () => {
    mockDetectRuntime.mockReturnValue('browser');
    const innerUnsubscribe = vi.fn();
    mockBrowserStore.subscribe.mockReturnValue(innerUnsubscribe);
    const listener = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PlatformProvider>{children}</PlatformProvider>
    );
    const { result } = renderHook(() => useConversationStore(), { wrapper });

    const unsubscribe = result.current.subscribe(listener);

    await waitFor(() => {
      expect(mockBrowserStore.subscribe).toHaveBeenCalledWith(listener);
    });

    unsubscribe();

    expect(innerUnsubscribe).toHaveBeenCalled();
  });

  // Note: To test desktop, we ideally reset modules, but bun's mock.module is static.
  // However, PlatformProvider memoizes based on detectRuntime result, so changing the mock return value
  // and re-rendering *should* work if the component calls detectRuntime() on mount.
  it('provides desktop implementations when runtime is desktop', async () => {
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
    await expect(storage.current.getConversations(5, 1)).resolves.toEqual([
      mockDesktopConversation,
    ]);
    expect(mockTauriStorage.getConversations).toHaveBeenCalledWith(5, 1);
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

  it('forwards desktop subscribe once the lazy store resolves and cleans up the inner subscription', async () => {
    mockDetectRuntime.mockReturnValue('desktop');
    const innerUnsubscribe = vi.fn();
    mockDesktopStore.subscribe.mockReturnValue(innerUnsubscribe);
    const listener = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PlatformProvider>{children}</PlatformProvider>
    );
    const { result } = renderHook(() => useConversationStore(), { wrapper });

    const unsubscribe = result.current.subscribe(listener);

    await waitFor(() => {
      expect(mockDesktopStore.subscribe).toHaveBeenCalledWith(listener);
    });

    unsubscribe();

    expect(innerUnsubscribe).toHaveBeenCalled();
  });

  it('forwards desktop streaming stop only after the lazy runtime has resolved', async () => {
    mockDetectRuntime.mockReturnValue('desktop');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PlatformProvider>{children}</PlatformProvider>
    );
    const { result } = renderHook(() => useStreamingRuntime(), { wrapper });

    result.current.stopStreaming();
    expect(mockDesktopRuntime.stopStreaming).not.toHaveBeenCalled();

    await result.current.startStreaming('task-1', {});
    result.current.stopStreaming();

    expect(mockDesktopRuntime.startStreaming).toHaveBeenCalledWith('task-1', {});
    expect(mockDesktopRuntime.stopStreaming).toHaveBeenCalledTimes(1);
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

  it('stays in browser runtime after the desktop promotion probe times out', async () => {
    vi.useFakeTimers();
    mockDetectRuntime.mockReturnValue('browser');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PlatformProvider>{children}</PlatformProvider>
    );

    const { result } = renderHook(() => usePlatformRuntime(), { wrapper });

    await act(async () => {
      vi.advanceTimersByTime(16_000);
    });

    expect(result.current).toBe('browser');
  });
});
