import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const useSyncManagerMock = vi.fn();
const sharedSyncProviderMock = vi.fn();

vi.mock('../hooks/useSyncManager', () => ({
  useSyncManager: useSyncManagerMock,
}));

vi.mock('@taskforceai/ui-kit/sync/SyncProvider', () => ({
  SyncProvider: ({ children, syncManager, enabled }: any) => {
    sharedSyncProviderMock({ syncManager, enabled });
    return <div data-testid="shared-sync-provider">{children}</div>;
  },
  useSync: vi.fn(),
}));

import { SyncProvider } from './SyncProvider';

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
});
