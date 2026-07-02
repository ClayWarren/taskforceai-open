import { SyncStatus } from '@taskforceai/sync-client';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';
import { SyncStatusIndicator } from './SyncStatusIndicator';

const mockLogger = {
  error: vi.fn(),
  warn: vi.fn(),
};

// Mock hook
const mockSyncState = {
  isSyncing: false,
  status: SyncStatus.IDLE,
  lastSyncTime: Date.now() - 1000 * 60, // 1 min ago
  error: null as Error | null,
  lastStats: null,
};

const mockSync = vi.fn();
let mockIsOnline = true;

vi.mock('../../lib/logger', () => ({
  logger: mockLogger,
}));

vi.mock('../../lib/providers/SyncProvider', () => ({
  useSync: () => ({
    syncState: mockSyncState,
    sync: mockSync,
    isOnline: mockIsOnline,
  }),
}));

describe('SyncStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncState.isSyncing = false;
    mockSyncState.status = SyncStatus.IDLE;
    mockSyncState.error = null;
    mockIsOnline = true;
    mockSync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('renders synced status correctly', () => {
    render(<SyncStatusIndicator />);
    expect(screen.getByText('Synced')).toBeTruthy();
  });

  it('renders syncing status correctly', () => {
    mockSyncState.isSyncing = true;
    render(<SyncStatusIndicator />);
    expect(screen.getByText('Syncing...')).toBeTruthy();
  });

  it('renders offline status correctly', () => {
    mockIsOnline = false;
    render(<SyncStatusIndicator />);
    expect(screen.getByText('Offline')).toBeTruthy();
  });

  it('renders error status correctly', () => {
    mockSyncState.status = SyncStatus.ERROR;
    mockSyncState.error = new Error('Sync failed');
    render(<SyncStatusIndicator />);
    expect(screen.getByText('Sync error')).toBeTruthy();
    expect(screen.getByText('⚠️')).toBeTruthy();
  });

  it('triggers sync on button click', async () => {
    render(<SyncStatusIndicator />);
    await act(async () => {
      fireEvent.click(screen.getByText('Sync'));
      await Promise.resolve();
    });
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('retries failed sync with exponential backoff', async () => {
    vi.useFakeTimers();

    const syncFailure = new Error('Sync failed');
    mockSync.mockImplementation(async () => {
      mockSyncState.status = SyncStatus.ERROR;
      mockSyncState.error = syncFailure;
      throw syncFailure;
    });

    render(<SyncStatusIndicator />);
    fireEvent.click(screen.getByText('Sync'));

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSync).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(mockSync).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSync).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(mockSync).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSync).toHaveBeenCalledTimes(3);

    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(mockSync).toHaveBeenCalledTimes(3);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSync).toHaveBeenCalledTimes(4);

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(mockSync).toHaveBeenCalledTimes(4);
  });

  it('cancels pending retry when user manually syncs again', async () => {
    vi.useFakeTimers();

    let callCount = 0;
    mockSync.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        const syncFailure = new Error('First sync failed');
        mockSyncState.status = SyncStatus.ERROR;
        mockSyncState.error = syncFailure;
        throw syncFailure;
      }

      mockSyncState.status = SyncStatus.IDLE;
      mockSyncState.error = null;
      return undefined;
    });

    render(<SyncStatusIndicator />);

    const syncButton = screen.getByText('Sync');
    fireEvent.click(syncButton);

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSync).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Sync'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSync).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSync).toHaveBeenCalledTimes(2);
  });

  it('disables sync button when offline', () => {
    mockIsOnline = false;
    render(<SyncStatusIndicator />);
    const button = screen.getByText('Sync');
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables sync button when syncing', () => {
    mockSyncState.isSyncing = true;
    render(<SyncStatusIndicator />);
    const button = screen.getByText('Syncing').closest('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
