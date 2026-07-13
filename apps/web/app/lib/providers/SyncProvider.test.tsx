import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { SyncStatus } from '@taskforceai/sync-client';

import '../../../../../tests/setup/dom';

const useSyncManagerMock = vi.fn();
const sharedSyncProviderMock = vi.fn();
const useSharedSyncMock = vi.fn();
const useSharedOptionalSyncMock = vi.fn();

vi.mock('../hooks/useSyncManager', () => ({
  useSyncManager: useSyncManagerMock,
}));

vi.mock('@taskforceai/ui-kit/sync/SyncProvider', () => ({
  SyncProvider: ({ children, syncManager, enabled }: any) => {
    sharedSyncProviderMock({ syncManager, enabled });
    return <div data-testid="shared-sync-provider">{children}</div>;
  },
  useOptionalSync: useSharedOptionalSyncMock,
  useSync: useSharedSyncMock,
}));

import { SyncProvider, useOptionalSync, useSync } from './SyncProvider';

describe('SyncProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSyncManagerMock.mockReturnValue({ status: 'ready' });
  });

  it('provides the sync manager to the shared provider by default', () => {
    render(
      <SyncProvider>
        <span>Child</span>
      </SyncProvider>
    );

    expect(screen.getByTestId('shared-sync-provider')).toBeTruthy();
    expect(screen.getByText('Child')).toBeTruthy();
    expect(useSyncManagerMock).toHaveBeenCalledWith(true);
    expect(sharedSyncProviderMock).toHaveBeenCalledWith({
      syncManager: { status: 'ready' },
      enabled: true,
    });
  });

  it('passes disabled state through to the hook and shared provider', () => {
    render(
      <SyncProvider enabled={false}>
        <span>Disabled Child</span>
      </SyncProvider>
    );

    expect(useSyncManagerMock).toHaveBeenCalledWith(false);
    expect(sharedSyncProviderMock).toHaveBeenCalledWith({
      syncManager: { status: 'ready' },
      enabled: false,
    });
  });

  it('delegates useSync to the shared sync hook', () => {
    const syncValue = {
      enabled: true,
      sync: vi.fn(),
      syncState: {
        error: null,
        isSyncing: false,
        lastStats: null,
        lastSyncTime: 0,
        status: SyncStatus.IDLE,
      },
      isOnline: true,
    };
    useSharedSyncMock.mockReturnValue(syncValue);

    expect(useSync()).toBe(syncValue);
    expect(useSharedSyncMock).toHaveBeenCalledTimes(1);
  });

  it('delegates useOptionalSync to the shared optional sync hook', () => {
    const syncValue = {
      enabled: false,
      sync: vi.fn(),
      syncState: {
        error: null,
        isSyncing: false,
        lastStats: null,
        lastSyncTime: 0,
        status: SyncStatus.IDLE,
      },
      isOnline: null,
    };
    useSharedOptionalSyncMock.mockReturnValue(syncValue);

    expect(useOptionalSync()).toBe(syncValue);
    expect(useSharedOptionalSyncMock).toHaveBeenCalledTimes(1);
  });
});
