import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import type { ComponentProps } from 'react';

import '../../../../../tests/setup/dom';

import {
  AppsIcon,
  CancelSubscriptionDialog,
  ConnectedAppsSection,
  DataIcon,
  DataControlsSection,
  DeleteAccountDialog,
  FeedbackBanner,
  GeneralIcon,
  KeyboardIcon,
  KeyboardShortcutsSection,
  McpServersSection,
  MemorySummaryDialog,
  NotificationsIcon,
  NotificationsSection,
  PersonalizationIcon,
  PersonalizationSection,
  ProfileDetailsSection,
  SettingsSection,
  StorageIcon,
  StorageSection,
  SubscriptionIcon,
  SubscriptionSection,
  UpgradeSection,
} from './ProfileModalSections';

describe('ProfileModalSections', () => {
  afterEach(() => cleanup());

  describe('FeedbackBanner', () => {
    it('renders success message', () => {
      render(<FeedbackBanner message="Saved!" kind="success" />);
      expect(screen.getByText('Saved!')).toBeDefined();
      expect(screen.getByRole('status')).toBeDefined();
    });

    it('renders error message', () => {
      render(<FeedbackBanner message="Failed!" kind="error" />);
      expect(screen.getByText('Failed!')).toBeDefined();
    });

    it('returns null if no message', () => {
      const { container } = render(<FeedbackBanner message={null} kind="success" />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('ProfileDetailsSection', () => {
    it('renders profile information', () => {
      render(<ProfileDetailsSection fullName="testuser" email="test@example.com" />);
      expect(screen.getByText('testuser')).toBeDefined();
      expect(screen.getByText('test@example.com')).toBeDefined();
    });

    it('falls back when the profile name is missing', () => {
      render(<ProfileDetailsSection fullName="" email="test@example.com" />);
      expect(screen.getByText('Not set')).toBeDefined();
      expect(screen.getByText('test@example.com')).toBeDefined();
    });
  });

  describe('McpServersSection', () => {
    const renderMcpServers = (props: Partial<ComponentProps<typeof McpServersSection>> = {}) =>
      render(
        <McpServersSection
          servers={[]}
          pendingName=""
          pendingEndpoint=""
          busyServerName={null}
          onPendingNameChange={vi.fn()}
          onPendingEndpointChange={vi.fn()}
          onAddServer={vi.fn()}
          onInspectServer={vi.fn()}
          onRemoveServer={vi.fn()}
          {...props}
        />
      );

    it('adds and inspects servers through the provided handlers', () => {
      const onAddServer = vi.fn();
      const onInspectServer = vi.fn();
      const onRemoveServer = vi.fn();
      const onPendingNameChange = vi.fn();
      const onPendingEndpointChange = vi.fn();

      renderMcpServers({
        servers: [{ name: 'Docs', endpoint: 'https://example.com/mcp', enabled: true }],
        pendingName: 'Docs',
        pendingEndpoint: 'https://example.com/mcp',
        onPendingNameChange,
        onPendingEndpointChange,
        onAddServer,
        onInspectServer,
        onRemoveServer,
      });

      fireEvent.input(screen.getByLabelText('MCP server name'), { target: { value: 'New' } });
      fireEvent.input(screen.getByLabelText('MCP server endpoint'), {
        target: { value: 'https://new.example/mcp' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save MCP Server' }));
      fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

      expect(onAddServer).toHaveBeenCalled();
      expect(onInspectServer).toHaveBeenCalledWith({
        name: 'Docs',
        endpoint: 'https://example.com/mcp',
        enabled: true,
      });
      expect(onRemoveServer).toHaveBeenCalledWith('Docs');
    });

    it('renders empty and busy server states', () => {
      const { rerender } = renderMcpServers();

      expect(screen.getByText('No MCP servers saved yet.')).toBeDefined();

      rerender(
        <McpServersSection
          servers={[
            { name: 'Disabled Docs', endpoint: 'https://disabled.example', enabled: false },
          ]}
          pendingName=""
          pendingEndpoint=""
          busyServerName="Disabled Docs"
          onPendingNameChange={vi.fn()}
          onPendingEndpointChange={vi.fn()}
          onAddServer={vi.fn()}
          onInspectServer={vi.fn()}
          onRemoveServer={vi.fn()}
        />
      );

      expect(screen.getByText('Disabled')).toBeDefined();
      const inspectButton = screen.getByRole('button', { name: 'Inspecting...' });
      expect(inspectButton.hasAttribute('disabled')).toBe(true);
    });
  });

  describe('UpgradeSection', () => {
    const upgradeOptions = [
      { plan: 'pro' as const, price_id: 'p1', price_amount: 2000 },
      { plan: 'super' as const, price_id: null, price_amount: 5000 },
    ];
    const planMeta = {
      pro: { label: 'Pro', throughput: '100 req/hr' },
      super: { label: 'Super', throughput: '500 req/hr' },
    };
    const formatPriceLabel = vi.fn((p) => (p === 'pro' ? '$20' : '$50'));
    const onUpgrade = vi.fn();
    const renderUpgrade = (props: Partial<ComponentProps<typeof UpgradeSection>> = {}) =>
      render(
        <UpgradeSection
          upgradeOptions={upgradeOptions}
          planMeta={planMeta}
          formatPriceLabel={formatPriceLabel}
          pendingUpgradePlan={null}
          onUpgrade={onUpgrade}
          {...props}
        />
      );

    it('renders upgrade options', () => {
      renderUpgrade();
      expect(screen.getByText('Pro · $20')).toBeDefined();
      expect(screen.getByText('Super · $50')).toBeDefined();
      expect(screen.getByText('100 req/hr')).toBeDefined();
    });

    it('calls onUpgrade when clicking button', () => {
      renderUpgrade();
      fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
      expect(onUpgrade).toHaveBeenCalledWith('pro', 'p1');
    });

    it('shows "Preparing checkout..." when plan is pending', () => {
      renderUpgrade({ pendingUpgradePlan: 'pro' });
      expect(screen.getByText('Preparing checkout...')).toBeDefined();
    });

    it('shows unavailable message when price_id is null', () => {
      renderUpgrade();
      expect(screen.getByText(/Checkout link unavailable/)).toBeDefined();
    });
    it('returns null if no upgrade options', () => {
      const { container } = renderUpgrade({ upgradeOptions: [] });
      expect(container.firstChild).toBeNull();
    });
  });

  describe('SubscriptionSection', () => {
    const subscription = {
      status: 'active',
      current_period_start: 1704067200,
      current_period_end: 1706745600,
      cancel_at_period_end: false,
    };
    const onOpenCancelConfirm = vi.fn();
    const onReactivate = vi.fn();
    const renderSubscription = (props: Partial<ComponentProps<typeof SubscriptionSection>> = {}) =>
      render(
        <SubscriptionSection
          creditBalanceLabel="$12.50"
          plan="pro"
          messageUsageLabel="100 used · 2 per hour"
          resetLabel="Resets Jan 1, 2025"
          subscription={subscription}
          loading={false}
          onOpenCancelConfirm={onOpenCancelConfirm}
          onReactivate={onReactivate}
          {...props}
        />
      );
    const cancelingSubscription = { ...subscription, cancel_at_period_end: true };

    it('renders active subscription', () => {
      renderSubscription();
      expect(screen.getByText('active')).toBeDefined();
      expect(screen.getByText('Cancel Subscription')).toBeDefined();
      expect(screen.getByText('Current Plan:')).toBeDefined();
      expect(screen.getByText('pro')).toBeDefined();
      expect(screen.getByText('Messages:')).toBeDefined();
      expect(screen.getByText('100 used · 2 per hour')).toBeDefined();
      expect(screen.getByText('Credits:')).toBeDefined();
      expect(screen.getByText('$12.50')).toBeDefined();
      expect(screen.getByText('Usage Window:')).toBeDefined();
      expect(screen.getByText('Resets Jan 1, 2025')).toBeDefined();
    });

    it('renders canceling subscription', () => {
      renderSubscription({ subscription: cancelingSubscription });
      expect(screen.getByText(/Subscription will be canceled/)).toBeDefined();
      expect(screen.getByText('Reactivate Subscription')).toBeDefined();
    });

    it('calls onOpenCancelConfirm when clicking cancel', () => {
      renderSubscription();
      fireEvent.click(screen.getByText('Cancel Subscription'));
      expect(onOpenCancelConfirm).toHaveBeenCalled();
    });

    it('calls onReactivate and supports loading state', () => {
      const { rerender } = renderSubscription({ subscription: cancelingSubscription });

      fireEvent.click(screen.getByText('Reactivate Subscription'));
      expect(onReactivate).toHaveBeenCalled();

      rerender(
        <SubscriptionSection
          plan="pro"
          messageUsageLabel="100 used · 2 per hour"
          subscription={cancelingSubscription}
          loading={true}
          onOpenCancelConfirm={onOpenCancelConfirm}
          onReactivate={onReactivate}
        />
      );

      const processingButton = screen.getByRole('button', { name: 'Processing...' });
      expect(processingButton.hasAttribute('disabled')).toBe(true);
    });

    it('shows processing state on cancel button when loading', () => {
      renderSubscription({ loading: true });

      const processingButton = screen.getByRole('button', { name: 'Processing...' });
      expect(processingButton.hasAttribute('disabled')).toBe(true);
    });

    it('renders free plan without subscription details', () => {
      renderSubscription({
        plan: 'free',
        messageUsageLabel: '0 used · 1 remaining this week',
        subscription: null,
      });

      expect(screen.getByText('free')).toBeDefined();
      expect(screen.getByText('0 used · 1 remaining this week')).toBeDefined();
      expect(screen.queryByText('Status:')).toBeNull();
    });
  });

  describe('DataControlsSection', () => {
    const onExport = vi.fn();
    const onOpenDeleteConfirm = vi.fn();
    const onOpenArchivedManager = vi.fn();
    const onRestoreConversation = vi.fn();
    const onDeleteConversation = vi.fn();
    const onArchiveAllConversations = vi.fn();
    const onDeleteAllConversations = vi.fn();

    it('renders data control buttons', () => {
      render(
        <DataControlsSection
          loading={false}
          archiveManagementSupported={true}
          archivedManagerOpen={false}
          archivedConversations={[]}
          onExport={onExport}
          onOpenArchivedManager={onOpenArchivedManager}
          onRestoreConversation={onRestoreConversation}
          onDeleteConversation={onDeleteConversation}
          onArchiveAllConversations={onArchiveAllConversations}
          onDeleteAllConversations={onDeleteAllConversations}
          onOpenDeleteConfirm={onOpenDeleteConfirm}
        />
      );
      expect(screen.getByRole('button', { name: /Export/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Manage/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Archive all/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Delete all/i })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Delete Account' })).toBeDefined();
    });

    it('calls onExport', () => {
      render(
        <DataControlsSection
          loading={false}
          archiveManagementSupported={true}
          archivedManagerOpen={false}
          archivedConversations={[]}
          onExport={onExport}
          onOpenArchivedManager={onOpenArchivedManager}
          onRestoreConversation={onRestoreConversation}
          onDeleteConversation={onDeleteConversation}
          onArchiveAllConversations={onArchiveAllConversations}
          onDeleteAllConversations={onDeleteAllConversations}
          onOpenDeleteConfirm={onOpenDeleteConfirm}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /Export/i }));
      expect(onExport).toHaveBeenCalled();
    });

    it('renders archived conversations and handles row actions', () => {
      render(
        <DataControlsSection
          loading={false}
          archiveManagementSupported={true}
          archivedManagerOpen={true}
          archivedConversations={[
            {
              conversationId: 'archived-1',
              title: 'Archived Research',
              createdAt: 1710000000000,
              updatedAt: 1710000005000,
            },
          ]}
          onExport={onExport}
          onOpenArchivedManager={onOpenArchivedManager}
          onRestoreConversation={onRestoreConversation}
          onDeleteConversation={onDeleteConversation}
          onArchiveAllConversations={onArchiveAllConversations}
          onDeleteAllConversations={onDeleteAllConversations}
          onOpenDeleteConfirm={onOpenDeleteConfirm}
        />
      );

      expect(screen.getByText('Archived Research')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Restore Archived Research' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete Archived Research' }));

      expect(onRestoreConversation).toHaveBeenCalledWith('archived-1');
      expect(onDeleteConversation).toHaveBeenCalledWith('archived-1');
    });

    it('renders loading labels and disabled controls while processing', () => {
      render(
        <DataControlsSection
          loading={true}
          archiveManagementSupported={true}
          archivedManagerOpen={false}
          archivedConversations={[]}
          onExport={onExport}
          onOpenArchivedManager={onOpenArchivedManager}
          onRestoreConversation={onRestoreConversation}
          onDeleteConversation={onDeleteConversation}
          onArchiveAllConversations={onArchiveAllConversations}
          onDeleteAllConversations={onDeleteAllConversations}
          onOpenDeleteConfirm={onOpenDeleteConfirm}
        />
      );

      const exportButton = screen.getByRole('button', { name: 'Exporting...' });
      const deleteButton = screen.getByRole('button', { name: 'Processing...' });
      expect(exportButton.hasAttribute('disabled')).toBe(true);
      expect(deleteButton.hasAttribute('disabled')).toBe(true);
    });
  });

  describe('StorageSection', () => {
    it('renders quota usage and category rows', () => {
      const onRetry = vi.fn();
      const onManageCategory = vi.fn();

      render(
        <StorageSection
          summary={{
            usedBytes: 19_000_000,
            quotaBytes: 40_000_000_000,
            categories: [
              { id: 'files', label: 'Files', bytes: 103_000, count: 1 },
              { id: 'images', label: 'Images', bytes: 18_900_000, count: 45 },
              { id: 'generated_artifacts', label: 'Generated artifacts', bytes: 0, count: 0 },
            ],
          }}
          loading={false}
          error={null}
          onRetry={onRetry}
          onManageCategory={onManageCategory}
        />
      );

      expect(screen.getByText('19 MB of 40 GB used')).toBeDefined();
      expect(screen.getByText('103 KB · 1 file')).toBeDefined();
      expect(screen.getByText('18.9 MB · 45 images')).toBeDefined();

      fireEvent.click(screen.getByRole('button', { name: /Files/ }));
      expect(onManageCategory).toHaveBeenCalledWith('files');
    });

    it('renders retry state when storage fails to load', () => {
      const onRetry = vi.fn();
      render(
        <StorageSection
          summary={null}
          loading={false}
          error="Failed to load storage usage"
          onRetry={onRetry}
          onManageCategory={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalled();
    });
  });

  describe('DeleteAccountDialog', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    const onDeleteInputChange = vi.fn();

    it('enables delete button only when username matches', () => {
      const { rerender } = render(
        <DeleteAccountDialog
          open={true}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
          loading={false}
          deleteInput="wrong"
          onDeleteInputChange={onDeleteInputChange}
          expectedEmail="testuser"
        />
      );

      const deleteBtn = screen.getByRole('button', { name: /Delete account/i });
      expect(deleteBtn.hasAttribute('disabled')).toBe(true);

      rerender(
        <DeleteAccountDialog
          open={true}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
          loading={false}
          deleteInput="testuser"
          onDeleteInputChange={onDeleteInputChange}
          expectedEmail="testuser"
        />
      );

      expect(deleteBtn.hasAttribute('disabled')).toBe(false);
    });

    it('calls onConfirm when clicked', () => {
      render(
        <DeleteAccountDialog
          open={true}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
          loading={false}
          deleteInput="testuser"
          onDeleteInputChange={onDeleteInputChange}
          expectedEmail="testuser"
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /Delete account/i }));
      expect(onConfirm).toHaveBeenCalled();
    });

    it('clears delete input when keeping account', () => {
      render(
        <DeleteAccountDialog
          open={true}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
          loading={true}
          deleteInput="testuser"
          onDeleteInputChange={onDeleteInputChange}
          expectedEmail="testuser"
        />
      );

      const deleteBtn = screen.getByRole('button', { name: /Deleting\.\.\.|Delete account/i });
      expect(deleteBtn.hasAttribute('disabled')).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: 'Keep my account' }));
      expect(onDeleteInputChange).toHaveBeenCalledWith('');
    });
  });

  describe('SettingsSection', () => {
    const onThemeChange = vi.fn();

    it('renders settings', () => {
      render(<SettingsSection theme="system" onThemeChange={onThemeChange} />);
      expect(screen.getByText('Theme')).toBeDefined();
      expect(screen.getByText('Version')).toBeDefined();
    });

    it('calls onThemeChange from the embedded theme toggle', () => {
      render(<SettingsSection theme="light" onThemeChange={onThemeChange} />);
      fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
      expect(onThemeChange).toHaveBeenCalledWith('dark');
      expect(screen.getByLabelText('application-version')).toBeDefined();
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
  });

  describe('MemorySummaryDialog', () => {
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
