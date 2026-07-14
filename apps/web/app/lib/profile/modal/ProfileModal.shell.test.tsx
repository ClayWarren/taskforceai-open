import { describe, expect, it, vi } from 'bun:test';

import {
  act,
  clickFoundRole,
  clickFoundText,
  fireEvent,
  installProfileModalTestHooks,
  inputByLabel,
  loadProfileData,
  mockConversationStore,
  mockLogout,
  mockProfileError,
  mockRefreshUser,
  mockUser,
  ProfileModal,
  render,
  renderOpenProfile,
  screen,
  useAuth,
  waitFor,
} from './ProfileModal.test-harness';

installProfileModalTestHooks();

describe('ProfileModal', () => {
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

  it('filters settings tabs from the sidebar search', async () => {
    await renderOpenProfile();

    await inputByLabel('Search settings', 'usage');

    expect(screen.getByRole('button', { name: 'Usage' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'General' })).toBeNull();
  });

  it('shows desktop settings sections and routes to backed desktop pages', async () => {
    const platformProvider = require('../../platform/PlatformProvider');
    platformProvider.usePlatformRuntime.mockReturnValue('desktop');

    await renderOpenProfile();

    await inputByLabel('Search settings', 'computer');
    await clickFoundRole('Computer Use');
    expect(screen.getByRole('heading', { name: 'Computer Use' })).toBeDefined();
    expect(screen.getByText('Computer Use settings')).toBeDefined();

    await inputByLabel('Search settings', 'browser');
    await clickFoundRole('Browser');
    expect(screen.getByRole('heading', { name: 'Browser' })).toBeDefined();
    expect(screen.getByText('Browser use settings')).toBeDefined();

    await inputByLabel('Search settings', 'worktrees');
    await clickFoundRole('Worktrees');
    expect(screen.getByRole('heading', { name: 'Worktrees' })).toBeDefined();
    expect(screen.getByText('Worktrees settings')).toBeDefined();
  });

  it('opens archived chats from the settings sidebar', async () => {
    await renderOpenProfile();

    await inputByLabel('Search settings', 'archived');
    await clickFoundRole('Archived chats');
    expect(screen.getByRole('heading', { name: 'Archived chats' })).toBeDefined();

    await clickFoundText('Manage Archived Chats');
    await waitFor(() => expect(mockConversationStore.listArchivedConversations).toHaveBeenCalled());
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

  it('handles loadProfile failure', async () => {
    mockProfileError({ message: 'Load failed' });
    await renderOpenProfile();
    await waitFor(() => expect(loadProfileData).toHaveBeenCalled());
  });

  it('uses userRef for loadProfile logging to prevent stale closures (Hardening TF-0230)', async () => {
    const { logger } = require('../../logger');
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
