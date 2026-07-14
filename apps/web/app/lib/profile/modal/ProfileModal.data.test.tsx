import { describe, expect, it, vi } from 'bun:test';

import {
  clickFoundRole,
  clickFoundText,
  deleteProfileAccount,
  downloadBlob,
  exportProfileData,
  installProfileModalTestHooks,
  inputByLabel,
  mockConversationStore,
  mockLogout,
  mockRefreshUser,
  mockUser,
  navigateTo,
  openProfileTab,
  renderOpenProfile,
  screen,
  useAuth,
  waitFor,
} from './ProfileModal.test-harness';

installProfileModalTestHooks();

describe('ProfileModal', () => {
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
    const platformProvider = require('../../platform/PlatformProvider');
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
    const platformProvider = require('../../platform/PlatformProvider');
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
});
