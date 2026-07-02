import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { ComponentProps } from 'react';

import '../../../../../tests/setup/dom';
import {
  mockCloseAllMcpServers,
  mockCloseMcpServer,
  mockConversationStore,
  mockDiscoverMcpServer,
  mockInspectDesktopMcpServer,
  mockPersistWebMcpServers,
  mockReadStoredWebMcpServers,
  mockWaitForTauriBridge,
} from './ProfileModal.test-utils';
import { downloadBlob, navigateTo } from '@taskforceai/shared/utils/browser-actions';
import { useAuth } from '../providers/AuthProvider';
import { startUpgradeCheckout } from '@taskforceai/contracts/services/upgrade-flow';
import {
  cancelProfileSubscription,
  deleteProfileAccount,
  disconnectProfileIntegration,
  exportProfileData,
  loadIntegrations,
  loadProfileData,
  reactivateProfileSubscription,
} from '@taskforceai/contracts/services/profile-service';
import ProfileModal from './ProfileModal';

vi.mock('../platform/PlatformProvider', () => ({
  usePlatformRuntime: vi.fn(() => 'browser'),
  useConversationStore: vi.fn(() => mockConversationStore),
}));

vi.mock('../providers/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@taskforceai/contracts/services/profile-service', () => ({
  loadProfileData: vi.fn(),
  cancelProfileSubscription: vi.fn(),
  deleteProfileAccount: vi.fn(),
  exportProfileData: vi.fn(),
  reactivateProfileSubscription: vi.fn(),
  loadIntegrations: vi.fn(),
  disconnectProfileIntegration: vi.fn(),
}));

vi.mock('@taskforceai/contracts/services/upgrade-flow', () => ({
  startUpgradeCheckout: vi.fn(),
}));

vi.mock('@taskforceai/shared/utils/browser-actions', () => ({
  navigateTo: vi.fn(() => ({ ok: true })),
  downloadBlob: vi.fn(() => ({ ok: true })),
}));

vi.mock('../mcp/manager', () => ({
  WebMcpManager: vi.fn(() => ({
    close: mockCloseMcpServer,
    closeAll: mockCloseAllMcpServers,
    discover: mockDiscoverMcpServer,
  })),
}));

vi.mock('../mcp/store', () => ({
  readStoredWebMcpServers: mockReadStoredWebMcpServers,
  persistWebMcpServers: mockPersistWebMcpServers,
}));

vi.mock('../platform/desktop/bridge', () => ({
  waitForTauriBridge: mockWaitForTauriBridge,
}));

vi.mock('../platform/desktop/mcp', () => ({
  inspectDesktopMcpServer: mockInspectDesktopMcpServer,
}));

vi.mock('@taskforceai/contracts/api/account', () => ({
  updateUserSettings: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@taskforceai/contracts/api/memories', () => ({
  fetchMemories: vi.fn().mockResolvedValue({
    ok: true,
    value: [
      {
        id: 1,
        content: 'User prefers concise updates',
        type: 'preference',
        metadata: null,
        created_at: '2026-06-04T19:00:00Z',
        updated_at: '2026-06-04T20:00:00Z',
      },
    ],
  }),
  createMemory: vi.fn().mockResolvedValue({ ok: true, value: true }),
  updateMemory: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      id: 1,
      content: 'Updated memory',
      type: 'fact',
      metadata: null,
      created_at: '2026-06-04T19:00:00Z',
      updated_at: '2026-06-04T21:00:00Z',
    },
  }),
  deleteMemory: vi.fn().mockResolvedValue({ ok: true, value: true }),
}));

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('ProfileModal', () => {
  const mockUser = {
    email: 'test@example.com',
    plan: 'free',
    message_count: 0,
    theme_preference: 'system',
    notifications_enabled: true,
    memory_enabled: true,
    web_search_enabled: true,
    code_execution_enabled: true,
  };

  const mockLogout = vi.fn();
  const mockRefreshUser = vi.fn();
  const proProduct = { plan: 'pro', price_id: 'price_pro', price_amount: 2000 };
  const activeSubscription = { id: 'sub_123', status: 'active', cancel_at_period_end: false };
  const mockProfileData = (value: Record<string, unknown>) => {
    (loadProfileData as any).mockResolvedValue({ ok: true, value });
  };
  const mockProfileError = (error: unknown) => {
    (loadProfileData as any).mockResolvedValue({ ok: false, error });
  };
  const mockPaidProfile = () =>
    mockProfileData({
      subscription: activeSubscription,
      products: [proProduct],
    });

  beforeEach(() => {
    vi.resetAllMocks();
    const platformProvider = require('../platform/PlatformProvider');
    platformProvider.usePlatformRuntime.mockReturnValue('browser');
    platformProvider.useConversationStore.mockReturnValue(mockConversationStore);
    mockConversationStore.listArchivedConversations.mockResolvedValue([
      {
        conversationId: 'archived-1',
        title: 'Archived Research',
        createdAt: 1710000000000,
        updatedAt: 1710000005000,
        lastMessagePreview: 'Saved for later',
      },
    ]);
    mockConversationStore.restoreConversation.mockResolvedValue(undefined);
    mockConversationStore.clearConversation.mockResolvedValue(undefined);
    mockConversationStore.archiveAllConversations.mockResolvedValue(undefined);
    mockConversationStore.deleteAllConversations.mockResolvedValue(undefined);
    const memoriesApi = require('@taskforceai/contracts/api/memories');
    memoriesApi.fetchMemories.mockResolvedValue({
      ok: true,
      value: [
        {
          id: 1,
          content: 'User prefers concise updates',
          type: 'preference',
          metadata: null,
          created_at: '2026-06-04T19:00:00Z',
          updated_at: '2026-06-04T20:00:00Z',
        },
      ],
    });
    memoriesApi.createMemory.mockResolvedValue({ ok: true, value: true });
    memoriesApi.updateMemory.mockResolvedValue({
      ok: true,
      value: {
        id: 1,
        content: 'Updated memory',
        type: 'fact',
        metadata: null,
        created_at: '2026-06-04T19:00:00Z',
        updated_at: '2026-06-04T21:00:00Z',
      },
    });
    memoriesApi.deleteMemory.mockResolvedValue({ ok: true, value: true });
    (useAuth as any).mockReturnValue({
      user: mockUser,
      logout: mockLogout,
      refreshUser: mockRefreshUser,
    });
    mockProfileData({
      subscription: null,
      products: [proProduct, { plan: 'super', price_id: 'price_super', price_amount: 20000 }],
    });
    (loadIntegrations as any).mockResolvedValue({ ok: true, value: [] });
    (disconnectProfileIntegration as any).mockResolvedValue({ ok: true, value: undefined });
    mockReadStoredWebMcpServers.mockReturnValue([]);
    mockPersistWebMcpServers.mockImplementation((servers: any[]) => servers);
    mockWaitForTauriBridge.mockResolvedValue(false);
    mockDiscoverMcpServer.mockResolvedValue({
      serverName: 'Docs',
      tools: [{ name: 'search' }],
      prompts: [],
      resources: [],
    });
    mockInspectDesktopMcpServer.mockResolvedValue({
      server_name: 'Desktop Docs',
      tools: [],
      prompts: [{ name: 'summarize' }],
      resources: [{ uri: 'file:///tmp/a' }],
    });
    (downloadBlob as any).mockReturnValue({ ok: true });
    (navigateTo as any).mockReturnValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  const renderOpenProfile = async (props: Partial<ComponentProps<typeof ProfileModal>> = {}) => {
    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(<ProfileModal open={true} onOpenChange={() => {}} {...props} />);
    });
    await screen.findByText('General');
    return view as ReturnType<typeof render>;
  };

  const openProfileTab = async (name: string) => {
    await clickText(name);
  };

  const clickElement = async (element: Element) => {
    await act(async () => {
      fireEvent.click(element);
    });
  };

  const clickText = async (name: string | RegExp) => clickElement(screen.getByText(name));
  const clickFoundText = async (name: string | RegExp) =>
    clickElement(await screen.findByText(name));
  const clickFoundRole = async (name: string | RegExp) =>
    clickElement(await screen.findByRole('button', { name }));
  const inputByLabel = async (label: string, value: string) => {
    await act(async () => {
      fireEvent.input(await screen.findByLabelText(label), { target: { value } });
    });
  };

  it('renders nothing when closed', () => {
    render(<ProfileModal open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText('Profile')).toBeNull();
  });

  it('renders nothing when there is no authenticated user', () => {
    (useAuth as any).mockReturnValue({
      user: null,
      logout: mockLogout,
      refreshUser: mockRefreshUser,
    });
    const { container } = render(<ProfileModal open={true} onOpenChange={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders content when open', async () => {
    await renderOpenProfile();
    expect(screen.getByText('test@example.com')).toBeDefined();
  });

  it('calls onOpenChange(false) when close button clicked', async () => {
    const onOpenChange = vi.fn();
    await renderOpenProfile({ onOpenChange });

    const closeButton = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes from the overlay and logs out from the sidebar action', async () => {
    const onOpenChange = vi.fn();
    const { container } = await renderOpenProfile({ onOpenChange });

    const overlay = container.ownerDocument.querySelector('.profile-modal-overlay');
    if (!(overlay instanceof HTMLElement)) {
      throw new Error('Expected profile modal overlay');
    }

    await act(async () => {
      fireEvent.click(overlay);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    });
    expect(mockLogout).toHaveBeenCalled();
  });

  it('handles upgrade checkout', async () => {
    (startUpgradeCheckout as any).mockResolvedValue({
      ok: true,
      value: { checkoutUrl: 'https://stripe.com' },
    });
    await renderOpenProfile();
    await openProfileTab('Subscription');

    expect(screen.getByText('$20.00 / month')).toBeDefined();

    await clickFoundRole(/Upgrade to pro/i);

    await waitFor(() => expect(startUpgradeCheckout).toHaveBeenCalled());
    expect(navigateTo).toHaveBeenCalledWith('https://stripe.com');
  });

  it('handles data export', async () => {
    (exportProfileData as any).mockResolvedValue({
      ok: true,
      value: { blob: new Blob(), filename: 'data.json' },
    });
    await renderOpenProfile();
    await openProfileTab('Data controls');

    await clickFoundText('Export My Data');

    await waitFor(() => expect(exportProfileData).toHaveBeenCalled());
    expect(downloadBlob).toHaveBeenCalled();
    expect(screen.getByText(/Your data has been downloaded successfully/i)).toBeDefined();
  });

  it('manages archived conversations from data controls', async () => {
    await renderOpenProfile();
    await openProfileTab('Data controls');

    await clickFoundText('Manage Archived Chats');
    await waitFor(() => expect(mockConversationStore.listArchivedConversations).toHaveBeenCalled());
    expect(screen.getByText('Archived Research')).toBeDefined();

    await clickFoundText('Restore Archived Research');
    await waitFor(() =>
      expect(mockConversationStore.restoreConversation).toHaveBeenCalledWith('archived-1')
    );

    await clickFoundText('Delete Archived Research');
    await waitFor(() =>
      expect(mockConversationStore.clearConversation).toHaveBeenCalledWith('archived-1')
    );
  });

  it('reloads and reports failures while opening archived conversations', async () => {
    mockConversationStore.listArchivedConversations
      .mockRejectedValueOnce(new Error('archive list failed'))
      .mockResolvedValueOnce([
        {
          conversationId: 'archived-2',
          title: '',
          createdAt: 1710000000000,
          updatedAt: 1710000005000,
          lastMessagePreview: null,
        },
      ]);

    await renderOpenProfile();
    await openProfileTab('Data controls');

    await clickFoundText('Manage Archived Chats');
    expect(await screen.findByText('Failed to load archived chats.')).toBeDefined();

    await clickFoundText('Reopen Archived Chats');

    await waitFor(() =>
      expect(mockConversationStore.listArchivedConversations).toHaveBeenCalledTimes(2)
    );
    expect(screen.getByText('Untitled conversation')).toBeDefined();
  });

  it('handles archive all and guarded delete all chats', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await renderOpenProfile();
    await openProfileTab('Data controls');
    await clickFoundText('Manage Archived Chats');
    await waitFor(() => expect(mockConversationStore.listArchivedConversations).toHaveBeenCalled());

    await clickFoundText('Archive All Chats');
    await waitFor(() => expect(mockConversationStore.archiveAllConversations).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockConversationStore.listArchivedConversations).toHaveBeenCalledTimes(2)
    );

    await clickFoundText('Delete All Chats');
    await waitFor(() => expect(mockConversationStore.deleteAllConversations).toHaveBeenCalled());
  });

  it('shows archive management unavailable when the runtime cannot list archived chats', async () => {
    const platformProvider = require('../platform/PlatformProvider');
    platformProvider.useConversationStore.mockReturnValue({
      clearConversation: vi.fn(),
    });

    await renderOpenProfile();
    await openProfileTab('Data controls');

    expect(screen.getByText('Archive unsupported')).toBeDefined();
    await clickFoundText('Manage Archived Chats');

    expect(
      await screen.findByText('Archive management is unavailable in this runtime.')
    ).toBeDefined();
  });

  it('surfaces unavailable archive actions when only archived listing is supported', async () => {
    const platformProvider = require('../platform/PlatformProvider');
    platformProvider.useConversationStore.mockReturnValue({
      listArchivedConversations: vi.fn().mockResolvedValue([
        {
          conversationId: 'archived-1',
          title: 'Archived Research',
          createdAt: 1710000000000,
          updatedAt: 1710000005000,
          lastMessagePreview: 'Saved for later',
        },
      ]),
      clearConversation: vi.fn(),
    });

    await renderOpenProfile();
    await openProfileTab('Data controls');
    await clickFoundText('Manage Archived Chats');
    await screen.findByText('Archived Research');

    await clickFoundText('Restore Archived Research');
    expect(await screen.findByText('Restore is unavailable in this runtime.')).toBeDefined();

    await clickFoundText('Archive All Chats');
    expect(await screen.findByText('Archive all is unavailable in this runtime.')).toBeDefined();

    await clickFoundText('Delete All Chats');
    expect(
      await screen.findByText('Delete all chats is unavailable in this runtime.')
    ).toBeDefined();
  });

  it('surfaces archive management operation failures', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockConversationStore.restoreConversation.mockRejectedValueOnce(new Error('restore failed'));
    mockConversationStore.clearConversation.mockRejectedValueOnce(new Error('delete failed'));
    mockConversationStore.archiveAllConversations.mockRejectedValueOnce(
      new Error('archive failed')
    );
    mockConversationStore.deleteAllConversations.mockRejectedValueOnce(
      new Error('delete all failed')
    );

    await renderOpenProfile();
    await openProfileTab('Data controls');
    await clickFoundText('Manage Archived Chats');
    await waitFor(() => expect(mockConversationStore.listArchivedConversations).toHaveBeenCalled());

    await clickFoundText('Restore Archived Research');
    expect(await screen.findByText('Failed to restore archived chat.')).toBeDefined();

    await clickFoundText('Delete Archived Research');
    expect(await screen.findByText('Failed to delete archived chat.')).toBeDefined();

    await clickFoundText('Archive All Chats');
    expect(await screen.findByText('Failed to archive all chats.')).toBeDefined();

    await clickFoundText('Delete All Chats');
    expect(await screen.findByText('Failed to delete all chats.')).toBeDefined();
  });

  it('does not delete all chats when confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    await renderOpenProfile();
    await openProfileTab('Data controls');
    await clickFoundText('Delete All Chats');

    expect(mockConversationStore.deleteAllConversations).not.toHaveBeenCalled();
  });

  it('renders storage usage and opens artifact library from storage management', async () => {
    await renderOpenProfile();

    await openProfileTab('Storage');
    expect(screen.getByText('Storage summary')).toBeDefined();
    expect(screen.getByText('19000000/40000000000')).toBeDefined();

    await clickFoundRole('Manage Files');
    expect(navigateTo).toHaveBeenCalledWith('/artifacts');
  });

  it('handles account deletion', async () => {
    const localUser = { ...mockUser, email: 'other@example.com' };
    (useAuth as any).mockReturnValue({
      user: localUser,
      logout: mockLogout,
      refreshUser: mockRefreshUser,
    });
    (deleteProfileAccount as any).mockResolvedValue({ ok: true, value: { message: 'Deleted' } });

    await renderOpenProfile();
    await openProfileTab('Data controls');

    await clickFoundRole(/Delete Account/i);

    await inputByLabel('Confirm email', 'other@example.com');

    await clickFoundRole('Permanently Delete Account');

    await waitFor(() => expect(deleteProfileAccount).toHaveBeenCalledWith('other@example.com'));
    expect(mockLogout).toHaveBeenCalled();
  });

  it('shows error if username confirmation fails during deletion', async () => {
    await renderOpenProfile();
    await openProfileTab('Data controls');

    await clickFoundRole(/Delete Account/i);

    await inputByLabel('Confirm email', 'wrong@example.com');

    await clickFoundRole('Permanently Delete Account');

    await waitFor(() => expect(screen.getByText(/Email confirmation failed/i)).toBeDefined());
  });

  it('handles subscription cancellation', async () => {
    (cancelProfileSubscription as any).mockResolvedValue({
      ok: true,
      value: { message: 'Cancelled' },
    });
    mockPaidProfile();

    await renderOpenProfile();
    await openProfileTab('Subscription');

    await clickFoundText('Cancel Subscription');

    await clickFoundRole('Confirm Cancellation');

    await waitFor(() => expect(cancelProfileSubscription).toHaveBeenCalled());
    expect(screen.getByText('Cancelled')).toBeDefined();
  });

  it('handles upgrade checkout failure', async () => {
    (startUpgradeCheckout as any).mockResolvedValue({
      ok: false,
      error: { message: 'Network error' },
    });
    await renderOpenProfile();
    await openProfileTab('Subscription');

    await clickFoundRole(/Upgrade to pro/i);

    await waitFor(() => expect(startUpgradeCheckout).toHaveBeenCalled());
  });

  it('handles subscription cancellation failure', async () => {
    (cancelProfileSubscription as any).mockResolvedValue({
      ok: false,
      error: { message: 'Server error' },
    });
    mockPaidProfile();

    await renderOpenProfile();
    await openProfileTab('Subscription');

    await clickFoundText('Cancel Subscription');

    await clickFoundRole('Confirm Cancellation');

    await waitFor(() => expect(screen.getByText(/Failed to cancel subscription/i)).toBeDefined());
  });

  it('handles subscription reactivation', async () => {
    (reactivateProfileSubscription as any).mockResolvedValue({
      ok: true,
      value: { message: 'Reactivated' },
    });
    await renderOpenProfile();
    await openProfileTab('Subscription');

    await clickFoundText('Reactivate Subscription');

    await waitFor(() => expect(reactivateProfileSubscription).toHaveBeenCalled());
    expect(screen.getByText('Reactivated')).toBeDefined();
  });

  it('handles reactivation failure', async () => {
    (reactivateProfileSubscription as any).mockResolvedValue({
      ok: false,
      error: { message: 'Error' },
    });
    await renderOpenProfile();
    await openProfileTab('Subscription');

    await clickFoundText('Reactivate Subscription');

    await waitFor(() =>
      expect(screen.getByText(/Failed to reactivate subscription/i)).toBeDefined()
    );
  });

  it('handles export failure', async () => {
    (exportProfileData as any).mockResolvedValue({
      ok: false,
      error: { message: 'Export failed' },
    });
    await renderOpenProfile();
    await openProfileTab('Data controls');

    await clickFoundText('Export My Data');

    await waitFor(() => expect(screen.getByText(/Failed to export data/i)).toBeDefined());
  });

  it('calls onModalOpen once when opened', async () => {
    const onModalOpen = vi.fn();
    const { rerender } = render(
      <ProfileModal open={false} onOpenChange={() => {}} onModalOpen={onModalOpen} />
    );

    await act(async () => {
      rerender(<ProfileModal open={true} onOpenChange={() => {}} onModalOpen={onModalOpen} />);
    });

    await waitFor(() => expect(onModalOpen).toHaveBeenCalledTimes(1));

    // Re-render open should NOT call again
    await act(async () => {
      rerender(<ProfileModal open={true} onOpenChange={() => {}} onModalOpen={onModalOpen} />);
    });
    expect(onModalOpen).toHaveBeenCalledTimes(1);
  });

  it('shows error if priceId is missing during upgrade', async () => {
    mockProfileData({
      subscription: null,
      products: [{ ...proProduct, price_id: null }],
    });

    await renderOpenProfile();
    await openProfileTab('Subscription');

    await clickFoundRole(/Upgrade to pro/i);

    await waitFor(() =>
      expect(screen.getByText(/Upgrade link is temporarily unavailable/i)).toBeDefined()
    );
  });

  it('handles navigateTo failure during upgrade', async () => {
    (startUpgradeCheckout as any).mockResolvedValue({
      ok: true,
      value: { checkoutUrl: 'https://failure.com' },
    });
    (navigateTo as any).mockReturnValue({ ok: false, error: { message: 'Nav failed' } });

    await renderOpenProfile();
    await openProfileTab('Subscription');

    await clickFoundRole(/Upgrade to pro/i);

    await waitFor(() => expect(navigateTo).toHaveBeenCalled());
  });

  it('handles profile preference tabs and setting failures', async () => {
    const { updateUserSettings } = await import('@taskforceai/contracts/api/account');
    (updateUserSettings as any).mockResolvedValue({
      ok: false,
      error: { message: 'nope' },
    });

    await renderOpenProfile();

    await clickText('Notifications');
    await clickText('Toggle Notifications');

    await waitFor(() =>
      expect(screen.getByText('Failed to update notifications setting.')).toBeDefined()
    );

    await clickText('Personalization');
    await clickText('Toggle Memory');

    await waitFor(() => expect(screen.getByText('Failed to update memory setting.')).toBeDefined());

    await clickText('Toggle Web Search');
    await waitFor(() =>
      expect(screen.getByText('Failed to update web search setting.')).toBeDefined()
    );

    await clickText('Toggle Code Execution');
    await waitFor(() =>
      expect(screen.getByText('Failed to update code execution setting.')).toBeDefined()
    );

    await clickText('Toggle Trust Layer');
    await waitFor(() =>
      expect(screen.getByText('Failed to update trust layer setting.')).toBeDefined()
    );

    await clickText('General');
    await clickText('Set Dark Theme');
    await waitFor(() =>
      expect(screen.getByText('Failed to update theme preference.')).toBeDefined()
    );
  });

  it('applies the authenticator status override in the security tab', async () => {
    await renderOpenProfile();

    await clickText('Security and login');
    await clickText('Toggle Authenticator');

    expect(screen.getByRole('heading', { name: 'Security and login' })).toBeDefined();
  });

  it('clears optimistic preference overrides when the modal closes', async () => {
    (useAuth as any).mockReturnValue({
      user: { ...mockUser, notifications_enabled: false },
      logout: mockLogout,
      refreshUser: mockRefreshUser,
    });
    const { updateUserSettings } = await import('@taskforceai/contracts/api/account');
    (updateUserSettings as any).mockResolvedValue({ ok: true, value: true });

    const view = await renderOpenProfile();
    await clickText('Notifications');
    expect(screen.getByText('Notifications disabled')).toBeDefined();

    await clickText('Toggle Notifications');
    await waitFor(() => expect(screen.getByText('Notifications enabled')).toBeDefined());

    await act(async () => {
      view.rerender(<ProfileModal open={false} onOpenChange={() => {}} />);
    });
    await act(async () => {
      view.rerender(<ProfileModal open={true} onOpenChange={() => {}} />);
    });
    await clickText('Notifications');

    expect(screen.getByText('Notifications disabled')).toBeDefined();
  });

  it('opens the keyboard settings tab', async () => {
    await renderOpenProfile();
    await clickText('Keyboard');
    expect(screen.getByText('Keyboard shortcuts')).toBeDefined();
  });

  it('opens and manages memory summary from personalization', async () => {
    const memoriesApi = await import('@taskforceai/contracts/api/memories');

    await renderOpenProfile();
    await clickText('Personalization');
    await clickText('Manage Memories');

    await waitFor(() => expect(memoriesApi.fetchMemories).toHaveBeenCalled());
    expect(screen.getByText('Memory summary dialog')).toBeDefined();

    await clickText('Add Memory');
    await waitFor(() =>
      expect(memoriesApi.createMemory).toHaveBeenCalledWith({
        content: 'New memory',
        type: 'preference',
      })
    );

    await clickText('Update Memory');
    await waitFor(() =>
      expect(memoriesApi.updateMemory).toHaveBeenCalledWith(1, {
        content: 'Updated memory',
        type: 'fact',
      })
    );

    await clickText('Delete Memory');
    await waitFor(() => expect(memoriesApi.deleteMemory).toHaveBeenCalledWith(1));
  });

  it('handles connected app connect and disconnect flows', async () => {
    (loadIntegrations as any).mockResolvedValue({
      ok: true,
      value: [{ provider: 'github', connected: true }],
    });
    const location = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/' },
    });

    try {
      await renderOpenProfile();
      await openProfileTab('Connected Apps');

      await clickText('Connect Google Drive');
      expect(window.location.href).toBe('/api/auth/signin/google-drive');

      await clickText('Connect GitHub');
      expect(window.location.href).toBe('/api/auth/signin/github');

      await clickText('Connect Unknown');
      expect(window.location.href).toBe('/api/auth/signin/github');

      await clickText('Disconnect GitHub');

      await waitFor(() => expect(disconnectProfileIntegration).toHaveBeenCalledWith('github'));
      expect(screen.getByText('github disconnected successfully.')).toBeDefined();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: location });
    }
  });

  it('shows an error when disconnecting an integration fails', async () => {
    (disconnectProfileIntegration as any).mockResolvedValue({
      ok: false,
      error: { message: 'disconnect failed' },
    });

    await renderOpenProfile();
    await openProfileTab('Connected Apps');
    await clickText('Disconnect GitHub');

    await waitFor(() => expect(screen.getByText('Failed to disconnect github.')).toBeDefined());
  });

  it('validates MCP server form input before saving', async () => {
    await renderOpenProfile();
    await openProfileTab('Connected Apps');
    await clickText('Save MCP Server');

    expect(mockPersistWebMcpServers).not.toHaveBeenCalled();
    expect(screen.getByText('MCP server name and endpoint are required.')).toBeDefined();
  });

  it('replaces saved MCP servers case-insensitively by name', async () => {
    mockReadStoredWebMcpServers.mockReturnValue([
      { name: 'Docs', endpoint: 'https://old.example.com/mcp', enabled: true },
    ]);

    await renderOpenProfile();
    await openProfileTab('Connected Apps');
    await inputByLabel('MCP name', 'docs');
    await inputByLabel('MCP endpoint', 'https://new.example.com/mcp');
    await clickText('Save MCP Server');

    expect(mockPersistWebMcpServers).toHaveBeenCalledWith([
      { name: 'docs', endpoint: 'https://new.example.com/mcp', enabled: true },
    ]);
  });

  it('shows an error when MCP inspection fails', async () => {
    mockReadStoredWebMcpServers.mockReturnValue([
      { name: 'Docs', endpoint: 'https://example.com/mcp', enabled: true },
    ]);
    mockDiscoverMcpServer.mockRejectedValue(new Error('offline'));

    await renderOpenProfile();
    await openProfileTab('Connected Apps');
    await clickText('Inspect Docs');

    await waitFor(() =>
      expect(screen.getByText('Failed to inspect MCP server Docs.')).toBeDefined()
    );
  });

  it('saves, inspects, removes, and closes MCP servers', async () => {
    mockReadStoredWebMcpServers.mockReturnValue([
      { name: 'Docs', endpoint: 'https://example.com/mcp', enabled: true },
    ]);

    const { rerender } = await renderOpenProfile();
    await openProfileTab('Connected Apps');
    await screen.findByText('Docs');

    await inputByLabel('MCP name', 'Research');
    await inputByLabel('MCP endpoint', 'https://research.example.com/mcp');
    await clickText('Save MCP Server');

    expect(mockPersistWebMcpServers).toHaveBeenCalledWith([
      { name: 'Docs', endpoint: 'https://example.com/mcp', enabled: true },
      { name: 'Research', endpoint: 'https://research.example.com/mcp', enabled: true },
    ]);
    expect(screen.getByText('Saved MCP server Research.')).toBeDefined();

    await clickText('Inspect Docs');

    await waitFor(() => expect(mockDiscoverMcpServer).toHaveBeenCalled());
    expect(screen.getByText('Docs: 1 tools, 0 prompts, 0 resources.')).toBeDefined();

    await clickText('Remove Docs');
    expect(mockCloseMcpServer).toHaveBeenCalledWith('Docs');
    expect(screen.getByText('Removed MCP server Docs.')).toBeDefined();

    await act(async () => {
      rerender(<ProfileModal open={false} onOpenChange={() => {}} />);
    });
    expect(mockCloseAllMcpServers).toHaveBeenCalled();
  });

  it('uses desktop MCP inspection when the Tauri bridge is available', async () => {
    mockReadStoredWebMcpServers.mockReturnValue([
      { name: 'Local', endpoint: 'stdio://local', enabled: true },
    ]);
    mockWaitForTauriBridge.mockResolvedValue(true);

    await renderOpenProfile();
    await openProfileTab('Connected Apps');
    await clickText('Inspect Local');

    await waitFor(() => expect(mockInspectDesktopMcpServer).toHaveBeenCalled());
    expect(screen.getByText('Desktop Docs: 0 tools, 1 prompts, 1 resources.')).toBeDefined();
  });

  it('handles downloadBlob failure during export', async () => {
    (exportProfileData as any).mockResolvedValue({
      ok: true,
      value: { blob: new Blob(), filename: 'abc.json' },
    });
    (downloadBlob as any).mockReturnValue({ ok: false, error: { message: 'Download blocked' } });

    await renderOpenProfile();
    await openProfileTab('Data controls');

    await clickFoundText('Export My Data');

    await waitFor(() => expect(screen.getByText(/Failed to export data/i)).toBeDefined());
  });

  it('handles loadProfile failure', async () => {
    mockProfileError({ message: 'Load failed' });
    await renderOpenProfile();
    await waitFor(() => expect(loadProfileData).toHaveBeenCalled());
  });

  it('handles account deletion failure', async () => {
    (deleteProfileAccount as any).mockResolvedValue({
      ok: false,
      error: { message: 'Delete failed' },
    });
    await renderOpenProfile();
    await openProfileTab('Data controls');

    await clickFoundRole(/Delete Account/i);

    await inputByLabel('Confirm email', 'test@example.com');

    await clickFoundRole('Permanently Delete Account');

    await waitFor(() => expect(screen.getByText(/Failed to delete account/i)).toBeDefined());
  });

  it('uses userRef for loadProfile logging to prevent stale closures (Hardening TF-0230)', async () => {
    const { logger } = require('../logger');
    mockProfileError(new Error('Initial fail'));

    const { rerender } = render(<ProfileModal open={true} onOpenChange={() => {}} />);

    // Wait for first call
    await waitFor(() => expect(logger.error).toHaveBeenCalled());
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ user: { email: 'test@example.com' } })
    );

    // Update user prop and trigger loadProfile again (e.g. by re-opening)
    const updatedUser = { ...mockUser, email: 'updated@example.com' };
    (useAuth as any).mockReturnValue({
      user: updatedUser,
      logout: mockLogout,
      refreshUser: mockRefreshUser,
    });
    (loadProfileData as any).mockResolvedValueOnce({
      ok: false,
      error: new Error('Updated fail'),
    });

    await act(async () => {
      rerender(<ProfileModal open={false} onOpenChange={() => {}} />);
    });
    await act(async () => {
      rerender(<ProfileModal open={true} onOpenChange={() => {}} />);
    });

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ user: { email: 'updated@example.com' } })
      )
    );
  });
});
