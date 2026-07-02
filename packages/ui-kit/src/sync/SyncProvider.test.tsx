import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../../tests/setup/dom';

import { type UseSyncManagerReturn, SyncProvider, useOptionalSync, useSync } from './SyncProvider';

const syncManager: UseSyncManagerReturn = {
  syncState: {
    status: 'idle',
    lastSyncTime: 123,
    isSyncing: false,
    lastStats: { pushed: 0 },
    error: null,
  },
  sync: vi.fn(async () => {}),
  isOnline: true,
};

function SyncConsumer() {
  const sync = useSync();
  return (
    <span>
      {sync.enabled ? 'enabled' : 'disabled'}:{String(sync.isOnline)}:
      {String(sync.syncState.lastSyncTime)}
    </span>
  );
}

function OptionalSyncConsumer() {
  const sync = useOptionalSync();
  return <span>{sync ? 'has-sync' : 'no-sync'}</span>;
}

describe('SyncProvider', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('provides sync state and defaults enabled to true', () => {
    render(
      <SyncProvider syncManager={syncManager}>
        <SyncConsumer />
      </SyncProvider>
    );

    expect(screen.getByText('enabled:true:123')).toBeInTheDocument();
  });

  it('passes through disabled sync state', () => {
    render(
      <SyncProvider syncManager={syncManager} enabled={false}>
        <SyncConsumer />
      </SyncProvider>
    );

    expect(screen.getByText('disabled:true:123')).toBeInTheDocument();
  });

  it('throws when useSync is called outside SyncProvider', () => {
    expect(() => render(<SyncConsumer />)).toThrow('useSync must be used within SyncProvider');
  });

  it('returns null from optional sync hook outside SyncProvider', () => {
    render(<OptionalSyncConsumer />);

    expect(screen.getByText('no-sync')).toBeInTheDocument();
  });
});
