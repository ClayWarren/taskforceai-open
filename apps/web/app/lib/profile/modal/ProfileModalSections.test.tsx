import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import type { ComponentProps } from 'react';

import '../../../../../../tests/setup/dom';

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
  DataControlsSection,
  DeleteAccountDialog,
  FeedbackBanner,
  McpServersSection,
  ProfileDetailsSection,
  SecuritySection,
  StorageSection,
  SubscriptionSection,
  UpgradeSection,
  UsageLimitsSection,
} from './ProfileModalSections';

describe('ProfileModalSections', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

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

  describe('SecuritySection', () => {
    const renderSecurity = (props: Partial<ComponentProps<typeof SecuritySection>> = {}) =>
      render(
        <SecuritySection
          initialAuthenticatorEnabled={false}
          onAuthenticatorStatusChange={vi.fn()}
          {...props}
        />
      );

    it('starts authenticator setup, verifies a code, and copies the setup key', async () => {
      const user = userEvent.setup({ document: globalThis.document });
      const onAuthenticatorStatusChange = vi.fn();
      const clipboardWrite = vi.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: clipboardWrite },
      });
      profileSectionsClient.setupAuthenticatorMFA.mockResolvedValue({
        secret: 'SECRET-123',
        otpauth_uri: 'otpauth://totp/TaskForceAI:user@example.com',
      });
      profileSectionsClient.verifyAuthenticatorMFA.mockResolvedValue(undefined);
      qrCodeToDataURL.mockResolvedValue('data:image/png;base64,qr');

      renderSecurity({ onAuthenticatorStatusChange });

      fireEvent.click(screen.getByRole('switch'));

      expect(await screen.findByText('SECRET-123')).toBeDefined();
      expect(screen.getByAltText('Authenticator setup QR code')).toHaveAttribute(
        'src',
        'data:image/png;base64,qr'
      );
      expect(qrCodeToDataURL).toHaveBeenCalledWith(
        'otpauth://totp/TaskForceAI:user@example.com',
        expect.objectContaining({ errorCorrectionLevel: 'M' })
      );

      fireEvent.click(screen.getByRole('button', { name: 'Copy setup key' }));
      expect(clipboardWrite).toHaveBeenCalledWith('SECRET-123');

      await user.type(screen.getByLabelText('Verification code'), '123456');
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

      await waitFor(() =>
        expect(profileSectionsClient.verifyAuthenticatorMFA).toHaveBeenCalledWith('123456')
      );
      expect(onAuthenticatorStatusChange).toHaveBeenCalledWith(true);
      expect(await screen.findByText('Authenticator app enabled.')).toBeDefined();
    });

    it('validates setup codes and reports setup or verification failures', async () => {
      const user = userEvent.setup({ document: globalThis.document });
      profileSectionsClient.setupAuthenticatorMFA.mockResolvedValue({
        secret: 'SECRET-123',
        otpauth_uri: 'otpauth://totp/TaskForceAI:user@example.com',
      });
      profileSectionsClient.verifyAuthenticatorMFA.mockRejectedValue(new Error('bad code'));
      qrCodeToDataURL.mockResolvedValue('data:image/png;base64,qr');

      renderSecurity();

      fireEvent.click(screen.getByRole('switch'));
      await screen.findByText('SECRET-123');

      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
      expect(
        await screen.findByText('Enter the 6-digit code from your authenticator app.')
      ).toBeDefined();
      expect(profileSectionsClient.verifyAuthenticatorMFA).not.toHaveBeenCalled();

      await user.type(screen.getByLabelText('Verification code'), '654321');
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

      expect(await screen.findByText('Invalid authenticator code.')).toBeDefined();
    });

    it('reports setup failures and leaves setup UI closed', async () => {
      profileSectionsClient.setupAuthenticatorMFA.mockRejectedValue(new Error('setup failed'));

      renderSecurity();

      fireEvent.click(screen.getByRole('switch'));

      expect(await screen.findByText('Failed to start authenticator setup.')).toBeDefined();
      expect(screen.queryByText('Setup key')).toBeNull();
    });

    it('disables authenticator MFA after validating the current code', async () => {
      const user = userEvent.setup({ document: globalThis.document });
      const onAuthenticatorStatusChange = vi.fn();
      profileSectionsClient.disableAuthenticatorMFA.mockResolvedValue(undefined);

      renderSecurity({
        initialAuthenticatorEnabled: true,
        onAuthenticatorStatusChange,
      });

      fireEvent.click(screen.getByRole('switch'));
      fireEvent.click(screen.getByRole('button', { name: 'Disable authenticator' }));
      expect(
        await screen.findByText('Enter the 6-digit code from your authenticator app.')
      ).toBeDefined();
      expect(profileSectionsClient.disableAuthenticatorMFA).not.toHaveBeenCalled();

      await user.type(screen.getByLabelText('Current authenticator code'), '987654');
      fireEvent.click(screen.getByRole('button', { name: 'Disable authenticator' }));

      await waitFor(() =>
        expect(profileSectionsClient.disableAuthenticatorMFA).toHaveBeenCalledWith('987654')
      );
      expect(onAuthenticatorStatusChange).toHaveBeenCalledWith(false);
      expect(await screen.findByText('Authenticator app disabled.')).toBeDefined();
    });

    it('reports disable failures and supports canceling disable mode', async () => {
      const user = userEvent.setup({ document: globalThis.document });
      profileSectionsClient.disableAuthenticatorMFA.mockRejectedValue(new Error('bad code'));

      renderSecurity({ initialAuthenticatorEnabled: true });

      fireEvent.click(screen.getByRole('switch'));
      await user.type(screen.getByLabelText('Current authenticator code'), '111111');
      fireEvent.click(screen.getByRole('button', { name: 'Disable authenticator' }));

      expect(await screen.findByText('Invalid authenticator code.')).toBeDefined();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByLabelText('Current authenticator code')).toBeNull();
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

  describe('UsageLimitsSection', () => {
    const onUpgrade = vi.fn();
    const formatPriceLabel = vi.fn(() => '$20.00 / month');

    const renderUsage = (props: Partial<ComponentProps<typeof UsageLimitsSection>> = {}) =>
      render(
        <UsageLimitsSection
          plan="free"
          messageCount={1}
          resetAt="2026-07-12T23:00:00.000Z"
          upgradeOptions={[
            {
              plan: 'pro',
              price_id: 'price_pro',
              price_amount: 2000,
              price_currency: 'USD',
            },
          ]}
          pendingUpgradePlan={null}
          formatPriceLabel={formatPriceLabel}
          onUpgrade={onUpgrade}
          {...props}
        />
      );

    it('renders capped weekly usage and model cost tiers', () => {
      renderUsage();

      expect(screen.getByText('Plan usage limits')).toBeDefined();
      expect(screen.getByText('Free')).toBeDefined();
      expect(screen.getByText('Weekly task credits')).toBeDefined();
      expect(screen.getByText('1 of 1 used')).toBeDefined();
      expect(screen.getByText('100% used')).toBeDefined();
      expect(screen.getByText('Resets Jul 12, 2026')).toBeDefined();
      expect(screen.getByRole('progressbar', { name: 'Weekly task credits' })).toHaveAttribute(
        'aria-valuenow',
        '100'
      );
      expect(screen.getByText('Sentinel')).toBeDefined();
      expect(screen.getByText('Claude Fable 5')).toBeDefined();
      expect(screen.getAllByText('$$').length).toBeGreaterThan(0);
    });

    it('starts upgrade checkout from the usage upsell row', () => {
      renderUsage();

      fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }));

      expect(onUpgrade).toHaveBeenCalledWith('pro', 'price_pro');
      expect(formatPriceLabel).toHaveBeenCalledWith('pro', 2000);
    });

    it('renders paid throughput when no hard weekly cap is available', () => {
      renderUsage({
        plan: 'pro',
        messageCount: 42,
        upgradeOptions: [],
      });

      expect(screen.getAllByText('Pro').length).toBeGreaterThan(0);
      expect(screen.getByText('Plan throughput')).toBeDefined();
      expect(screen.getByText('2 task credits per hour')).toBeDefined();
      expect(screen.getByText('42 task credits used')).toBeDefined();
      expect(screen.getByText('Metered by throughput')).toBeDefined();
      expect(screen.getByText('No fixed weekly cap is shown for this plan.')).toBeDefined();
      expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('disables upgrade checkout when the price id is not available', () => {
      renderUsage({
        upgradeOptions: [
          {
            plan: 'pro',
            price_id: null,
            price_amount: 2000,
            price_currency: 'USD',
          },
        ],
      });

      expect(
        screen.getByText('Checkout link unavailable. Please try again shortly.')
      ).toBeDefined();
      expect(screen.getByRole('button', { name: 'Upgrade' }).hasAttribute('disabled')).toBe(true);
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

    it('renders loading state before storage is available', () => {
      render(
        <StorageSection
          summary={null}
          loading={true}
          error={null}
          onRetry={vi.fn()}
          onManageCategory={vi.fn()}
        />
      );

      expect(screen.getByText('Loading storage...')).toBeDefined();
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
});
