import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const profileSectionsClient = {
  setupAuthenticatorMFA: vi.fn(),
  verifyAuthenticatorMFA: vi.fn(),
  disableAuthenticatorMFA: vi.fn(),
};
const qrCodeToDataURL = vi.fn();

vi.mock('@taskforceai/api-client/browserClient', () => ({
  getBrowserClient: () => profileSectionsClient,
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: qrCodeToDataURL,
  },
}));

import {
  AppsIcon,
  CancelSubscriptionDialog,
  ConnectedAppsSection,
  DataIcon,
  GeneralIcon,
  KeyboardIcon,
  KeyboardShortcutsSection,
  MemorySummaryDialog,
  NotificationsIcon,
  NotificationsSection,
  PersonalizationIcon,
  PersonalizationSection,
  SettingsSection,
  StorageIcon,
  SubscriptionIcon,
} from './ProfileModalSections';

describe('ProfileModalSections settings', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('SettingsSection', () => {
    const onThemeChange = vi.fn();

    it('renders settings', () => {
      render(<SettingsSection theme="system" onThemeChange={onThemeChange} />);
      expect(screen.getByText('Theme')).toBeDefined();
      expect(screen.queryByText('Version')).toBeNull();
    });

    it('calls onThemeChange from the embedded theme toggle', () => {
      render(<SettingsSection theme="light" onThemeChange={onThemeChange} />);
      fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
      expect(onThemeChange).toHaveBeenCalledWith('dark');
      expect(screen.queryByLabelText('application-version')).toBeNull();
    });
  });

  describe('KeyboardShortcutsSection', () => {
    it('renders grouped keyboard shortcuts', () => {
      render(<KeyboardShortcutsSection />);
      expect(screen.getByText('Composer')).toBeDefined();
      expect(screen.getByText('Slash commands')).toBeDefined();
      expect(screen.getByText('Send message')).toBeDefined();
      expect(screen.getByText('Add a new line')).toBeDefined();
      expect(screen.getAllByText('Enter').length).toBeGreaterThan(0);
    });
  });

  describe('CancelSubscriptionDialog', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    it('renders cancel declaration', () => {
      render(
        <CancelSubscriptionDialog
          open={true}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
          loading={false}
        />
      );
      expect(screen.getByText('Cancel subscription?')).toBeDefined();
    });

    it('calls onConfirm', () => {
      render(
        <CancelSubscriptionDialog
          open={true}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
          loading={false}
        />
      );
      const confirmBtn = screen.getByText(/^Cancel subscription$/);
      if (confirmBtn) fireEvent.click(confirmBtn);
      expect(onConfirm).toHaveBeenCalled();
    });

    it('renders loading state for confirmation action', () => {
      render(
        <CancelSubscriptionDialog
          open={true}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
          loading={true}
        />
      );

      const processingButton = screen.getByRole('button', { name: 'Processing...' });
      expect(processingButton.hasAttribute('disabled')).toBe(true);
    });
  });

  describe('KeyboardIcon', () => {
    it('renders', () => {
      const { container } = render(<KeyboardIcon />);
      expect(container.querySelector('svg')).toBeDefined();
    });
  });

  describe('NotificationsSection', () => {
    it('renders applicable TaskForceAI notification categories', () => {
      render(<NotificationsSection enabled={true} onToggle={vi.fn()} />);

      expect(screen.getByLabelText('TaskForceAI notification delivery')).toBeDefined();
      expect(screen.getByLabelText('Responses notification delivery')).toBeDefined();
      expect(screen.getByLabelText('Tasks notification delivery')).toBeDefined();
      expect(screen.getByLabelText('Projects notification delivery')).toBeDefined();
      expect(screen.getByLabelText('Usage notification delivery')).toBeDefined();
      expect(screen.queryByText('Marketing')).toBeNull();
      expect(screen.queryByText('Personalized tips')).toBeNull();
      expect(screen.queryByText('Group chats')).toBeNull();
      expect(screen.queryByText('Pulse daily updates')).toBeNull();
    });

    it('maps row delivery changes to the persisted push preference', () => {
      const onToggle = vi.fn();
      const { rerender } = render(<NotificationsSection enabled={false} onToggle={onToggle} />);

      fireEvent.change(screen.getByLabelText('Tasks notification delivery'), {
        target: { value: 'push' },
      });
      expect(onToggle).toHaveBeenCalledWith(true);

      rerender(<NotificationsSection enabled={true} onToggle={onToggle} />);
      fireEvent.change(screen.getByLabelText('Responses notification delivery'), {
        target: { value: 'off' },
      });
      expect(onToggle).toHaveBeenCalledWith(false);
    });
  });

  describe('PersonalizationSection', () => {
    it('calls each toggle handler', () => {
      const onMemoryToggle = vi.fn();
      const onManageMemories = vi.fn();
      const onWebSearchToggle = vi.fn();
      const onCodeExecutionToggle = vi.fn();
      const onTrustLayerToggle = vi.fn();

      render(
        <PersonalizationSection
          memoryEnabled={false}
          onMemoryToggle={onMemoryToggle}
          onManageMemories={onManageMemories}
          webSearchEnabled={false}
          onWebSearchToggle={onWebSearchToggle}
          codeExecutionEnabled={false}
          onCodeExecutionToggle={onCodeExecutionToggle}
          trustLayerEnabled={false}
          onTrustLayerToggle={onTrustLayerToggle}
        />
      );

      const switches = screen.getAllByRole('switch');
      fireEvent.click(switches[0] as HTMLElement);
      fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
      fireEvent.click(switches[1] as HTMLElement);
      fireEvent.click(switches[2] as HTMLElement);
      fireEvent.click(switches[3] as HTMLElement);

      expect(onMemoryToggle).toHaveBeenCalledWith(true);
      expect(onManageMemories).toHaveBeenCalled();
      expect(onWebSearchToggle).toHaveBeenCalledWith(true);
      expect(onCodeExecutionToggle).toHaveBeenCalledWith(true);
      expect(onTrustLayerToggle).toHaveBeenCalledWith(true);
    });

    it('renders the memory helper and singular memory count', () => {
      const { rerender } = render(
        <PersonalizationSection
          memoryEnabled={true}
          onMemoryToggle={vi.fn()}
          onManageMemories={vi.fn()}
          memoryCount={1}
          webSearchEnabled={true}
          onWebSearchToggle={vi.fn()}
          codeExecutionEnabled={true}
          onCodeExecutionToggle={vi.fn()}
          trustLayerEnabled={true}
          onTrustLayerToggle={vi.fn()}
        />
      );

      expect(
        screen.getByTitle('Memory stores user-approved facts and preferences for personalization.')
      ).toBeDefined();
      expect(screen.getByText('1 saved memory')).toBeDefined();

      rerender(
        <PersonalizationSection
          memoryEnabled={true}
          onMemoryToggle={vi.fn()}
          onManageMemories={vi.fn()}
          memoryCount={3}
          webSearchEnabled={true}
          onWebSearchToggle={vi.fn()}
          codeExecutionEnabled={true}
          onCodeExecutionToggle={vi.fn()}
          trustLayerEnabled={true}
          onTrustLayerToggle={vi.fn()}
        />
      );
      expect(screen.getByText('3 saved memories')).toBeDefined();
    });
  });

  describe('MemorySummaryDialog', () => {
    it('renders nothing while closed', () => {
      const { container } = render(
        <MemorySummaryDialog
          open={false}
          memories={[]}
          loading={false}
          error={null}
          actionId={null}
          onOpenChange={vi.fn()}
          onRefresh={vi.fn()}
          onCreate={vi.fn(async () => true)}
          onUpdate={vi.fn(async () => true)}
          onDelete={vi.fn(async () => true)}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('adds, edits, and deletes memories', async () => {
      const onCreate = vi.fn(async () => true);
      const onUpdate = vi.fn(async () => true);
      const onDelete = vi.fn(async () => true);

      render(
        <MemorySummaryDialog
          open={true}
          memories={[
            {
              id: 1,
              content: 'User prefers concise updates',
              type: 'preference',
              metadata: null,
              created_at: '2026-06-04T19:00:00Z',
              updated_at: '2026-06-04T20:00:00Z',
            },
          ]}
          loading={false}
          error={null}
          actionId={null}
          onOpenChange={vi.fn()}
          onRefresh={vi.fn()}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      );

      await act(async () => {
        fireEvent.input(screen.getByLabelText('Add or update memory'), {
          target: { value: 'User works in TaskForceAI' },
        });
      });
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Save memory' }).hasAttribute('disabled')).toBe(
          false
        )
      );
      fireEvent.click(screen.getByRole('button', { name: 'Save memory' }));
      await waitFor(() =>
        expect(onCreate).toHaveBeenCalledWith('User works in TaskForceAI', 'preference')
      );

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      await act(async () => {
        fireEvent.input(screen.getByLabelText('Edit memory 1'), {
          target: { value: 'User prefers terse updates' },
        });
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(onUpdate).toHaveBeenCalledWith(1, 'User prefers terse updates', 'preference')
      );

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(onDelete).toHaveBeenCalledWith(1));
    });

    it('formats the newest memory label without native toSorted support', () => {
      const arrayPrototype = Array.prototype as unknown as {
        toSorted?: (...args: unknown[]) => unknown;
      };
      const originalToSorted = arrayPrototype.toSorted;
      const dateNow = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-04T20:05:00Z'));
      Object.defineProperty(arrayPrototype, 'toSorted', {
        configurable: true,
        value: () => {
          throw new Error('native toSorted unavailable');
        },
      });

      try {
        render(
          <MemorySummaryDialog
            open={true}
            memories={[
              {
                id: 1,
                content: 'Older preference',
                type: 'preference',
                metadata: null,
                created_at: '2026-06-04T18:00:00Z',
                updated_at: '2026-06-04T18:00:00Z',
              },
              {
                id: 2,
                content: 'Newest preference',
                type: 'preference',
                metadata: null,
                created_at: '2026-06-04T19:00:00Z',
                updated_at: '2026-06-04T20:00:00Z',
              },
            ]}
            loading={false}
            error={null}
            actionId={null}
            onOpenChange={vi.fn()}
            onRefresh={vi.fn()}
            onCreate={vi.fn(async () => true)}
            onUpdate={vi.fn(async () => true)}
            onDelete={vi.fn(async () => true)}
          />
        );

        expect(screen.getByText('Updated 5m ago')).toBeDefined();
        expect(screen.getByText('Newest preference')).toBeDefined();
      } finally {
        dateNow.mockRestore();
        if (originalToSorted) {
          Object.defineProperty(arrayPrototype, 'toSorted', {
            configurable: true,
            value: originalToSorted,
          });
        } else {
          delete arrayPrototype.toSorted;
        }
      }
    });

    it('renders loading, error, and empty states', () => {
      const baseProps = {
        open: true,
        memories: [],
        actionId: null,
        onOpenChange: vi.fn(),
        onRefresh: vi.fn(),
        onCreate: vi.fn(async () => true),
        onUpdate: vi.fn(async () => true),
        onDelete: vi.fn(async () => true),
      };

      const { rerender } = render(
        <MemorySummaryDialog {...baseProps} loading={true} error={null} />
      );
      expect(screen.getByText('Loading memories...')).toBeDefined();

      rerender(<MemorySummaryDialog {...baseProps} loading={false} error="Failed to load" />);
      expect(screen.getByText('Failed to load')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(baseProps.onRefresh).toHaveBeenCalled();

      rerender(<MemorySummaryDialog {...baseProps} loading={false} error={null} />);
      expect(screen.getByText(/No saved memories yet/)).toBeDefined();
    });

    it('formats very recent memory updates as just now', () => {
      const dateNow = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-04T20:00:30Z'));

      render(
        <MemorySummaryDialog
          open={true}
          memories={[
            {
              id: 1,
              content: 'Recent preference',
              type: 'preference',
              metadata: null,
              created_at: '2026-06-04T20:00:00Z',
              updated_at: '2026-06-04T20:00:00Z',
            },
          ]}
          loading={false}
          error={null}
          actionId={null}
          onOpenChange={vi.fn()}
          onRefresh={vi.fn()}
          onCreate={vi.fn(async () => true)}
          onUpdate={vi.fn(async () => true)}
          onDelete={vi.fn(async () => true)}
        />
      );

      expect(screen.getByText('Updated just now')).toBeDefined();
      dateNow.mockRestore();
    });
  });

  describe('ConnectedAppsSection', () => {
    it('filters disconnected CLI entry and supports connect/disconnect actions', () => {
      const onConnect = vi.fn();
      const onDisconnect = vi.fn();
      render(
        <ConnectedAppsSection
          integrations={[
            { provider: 'taskforce-cli', connected: false },
            { provider: 'google-drive', connected: false },
            { provider: 'github', connected: true },
          ]}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
        />
      );

      expect(screen.queryByText('TaskForceAI CLI')).toBeNull();
      expect(screen.getByText('google drive')).toBeDefined();
      expect(screen.getByText('GitHub')).toBeDefined();

      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      expect(onConnect).toHaveBeenCalledWith('google-drive');

      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
      expect(onDisconnect).toHaveBeenCalledWith('github');
    });

    it('shows connected CLI entry with disconnect button', () => {
      const onConnect = vi.fn();
      const onDisconnect = vi.fn();
      render(
        <ConnectedAppsSection
          integrations={[{ provider: 'taskforce-cli', connected: true }]}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
        />
      );

      expect(screen.getByText('TaskForceAI CLI')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
      expect(onDisconnect).toHaveBeenCalledWith('taskforce-cli');
      expect(onConnect).not.toHaveBeenCalled();
    });
  });

  describe('icons', () => {
    it('renders all profile navigation icons', () => {
      const icons = [
        <GeneralIcon key="general" />,
        <NotificationsIcon key="notifications" />,
        <PersonalizationIcon key="personalization" />,
        <SubscriptionIcon key="subscription" />,
        <StorageIcon key="storage" />,
        <DataIcon key="data" />,
        <AppsIcon key="apps" />,
      ];

      const { container } = render(<div>{icons}</div>);

      expect(container.querySelectorAll('svg')).toHaveLength(icons.length);
    });
  });
});
