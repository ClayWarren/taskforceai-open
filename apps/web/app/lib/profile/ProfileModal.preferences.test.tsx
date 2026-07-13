import { describe, expect, it } from 'bun:test';

import {
  act,
  clickFoundRole,
  clickText,
  installProfileModalTestHooks,
  mockLogout,
  mockRefreshUser,
  mockUser,
  ProfileModal,
  renderOpenProfile,
  screen,
  useAuth,
  waitFor,
} from './ProfileModal.test-harness';

installProfileModalTestHooks();

describe('ProfileModal', () => {
  it('handles profile preference tabs and setting failures', async () => {
    const { updateUserSettings } = await import('@taskforceai/api-client/api/account');
    (updateUserSettings as any).mockResolvedValue({
      ok: false,
      error: { message: 'nope' },
    });

    await renderOpenProfile();

    await clickFoundRole('Notifications');
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
    const { updateUserSettings } = await import('@taskforceai/api-client/api/account');
    (updateUserSettings as any).mockResolvedValue({ ok: true, value: true });

    const view = await renderOpenProfile();
    await clickFoundRole('Notifications');
    expect(screen.getByText('Notifications disabled')).toBeDefined();

    await clickText('Toggle Notifications');
    await waitFor(() => expect(screen.getByText('Notifications enabled')).toBeDefined());

    await act(async () => {
      view.rerender(<ProfileModal open={false} onOpenChange={() => {}} />);
    });
    await act(async () => {
      view.rerender(<ProfileModal open={true} onOpenChange={() => {}} />);
    });
    await clickFoundRole('Notifications');

    expect(screen.getByText('Notifications disabled')).toBeDefined();
  });

  it('opens the keyboard settings tab', async () => {
    await renderOpenProfile();
    await clickText('Keyboard');
    expect(screen.getByText('Keyboard shortcuts')).toBeDefined();
  });

  it('opens and manages memory summary from personalization', async () => {
    const memoriesApi = await import('@taskforceai/api-client/api/memories');

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
});
