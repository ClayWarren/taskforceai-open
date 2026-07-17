import { vi } from 'bun:test';

void vi.mock('./ProfileModalSections', () => {
  const Icon = () => <svg />;
  const Button = ({ label, onClick }: any) => <button onClick={onClick}>{label}</button>;
  return {
    FeedbackBanner: ({ message }: any) => (message ? <div>{message}</div> : null),
    ProfileDetailsSection: ({ email }: any) => <span>{email}</span>,
    UpgradeSection: ({ formatPriceLabel, onUpgrade, upgradeOptions }: any) => (
      <div>
        {upgradeOptions.map((opt: any) => (
          <div key={opt.plan}>
            <span>{formatPriceLabel?.(opt.plan, opt.price_amount)}</span>
            <Button
              label={`Upgrade to ${opt.plan}`}
              onClick={() => onUpgrade(opt.plan, opt.price_id)}
            />
          </div>
        ))}
      </div>
    ),
    SubscriptionSection: ({ onOpenCancelConfirm, onReactivate }: any) => (
      <div>
        <Button label="Cancel Subscription" onClick={onOpenCancelConfirm} />
        <Button label="Reactivate Subscription" onClick={onReactivate} />
      </div>
    ),
    UsageLimitsSection: ({ formatPriceLabel, messageCount, onUpgrade, upgradeOptions }: any) => (
      <div>
        <span>Usage limits</span>
        <span>{`${messageCount ?? 0} messages used`}</span>
        {upgradeOptions?.map((option: any) => (
          <div key={option.plan}>
            <span>{formatPriceLabel?.(option.plan, option.price_amount)}</span>
            <Button
              label={`Usage upgrade to ${option.plan}`}
              onClick={() => onUpgrade(option.plan, option.price_id)}
            />
          </div>
        ))}
      </div>
    ),
    StorageSection: ({ summary, onRetry, onManageCategory }: any) => (
      <div>
        <span>Storage summary</span>
        <span>{summary ? `${summary.usedBytes}/${summary.quotaBytes}` : 'No storage'}</span>
        <Button label="Retry Storage" onClick={onRetry} />
        <Button label="Manage Files" onClick={() => onManageCategory('files')} />
      </div>
    ),
    DataControlsSection: ({
      archiveControlsError,
      archiveManagementSupported,
      archivedConversations,
      onArchiveAllConversations,
      onDeleteAllConversations,
      onDeleteConversation,
      onExport,
      onArchivedManagerOpenChange,
      onOpenArchivedManager,
      onOpenDeleteConfirm,
      onRestoreConversation,
    }: any) => (
      <div>
        <span>{archiveManagementSupported ? 'Archive supported' : 'Archive unsupported'}</span>
        {archiveControlsError ? <div>{archiveControlsError}</div> : null}
        <Button label="Export My Data" onClick={onExport} />
        <Button label="Manage Archived Chats" onClick={onOpenArchivedManager} />
        <Button label="Reopen Archived Chats" onClick={() => onArchivedManagerOpenChange?.(true)} />
        <Button label="Archive All Chats" onClick={onArchiveAllConversations} />
        <Button label="Delete All Chats" onClick={onDeleteAllConversations} />
        {archivedConversations?.map((conversation: any) => (
          <div key={conversation.conversationId}>
            <span>{conversation.title}</span>
            <Button
              label={`Restore ${conversation.title}`}
              onClick={() => onRestoreConversation(conversation.conversationId)}
            />
            <Button
              label={`Delete ${conversation.title}`}
              onClick={() => onDeleteConversation(conversation.conversationId)}
            />
          </div>
        ))}
        <Button label="Delete Account" onClick={onOpenDeleteConfirm} />
      </div>
    ),
    CancelSubscriptionDialog: ({ open, onConfirm }: any) =>
      open ? <Button label="Confirm Cancellation" onClick={onConfirm} /> : null,
    DeleteAccountDialog: (props: any) =>
      props.open ? (
        <div data-testid="delete-dialog">
          <span data-testid="expected-email-label">{props.expectedEmail}</span>
          <input
            aria-label="Confirm email"
            onInput={(e: any) => props.onDeleteInputChange(e.target.value)}
          />
          <Button label="Permanently Delete Account" onClick={props.onConfirm} />
        </div>
      ) : null,
    SettingsSection: ({ onThemeChange }: any) => (
      <div>
        <span>Settings</span>
        <Button label="Set Dark Theme" onClick={() => onThemeChange('dark')} />
      </div>
    ),
    KeyboardShortcutsSection: () => <span>Keyboard shortcuts</span>,
    SecuritySection: ({ onAuthenticatorStatusChange }: any) => (
      <Button label="Toggle Authenticator" onClick={() => onAuthenticatorStatusChange?.(true)} />
    ),
    ConnectedAppsSection: ({ onConnect, onDisconnect }: any) => (
      <div>
        <Button label="Connect Google Drive" onClick={() => onConnect('google-drive')} />
        <Button label="Connect GitHub" onClick={() => onConnect('github')} />
        <Button label="Connect Unknown" onClick={() => onConnect('unknown')} />
        <Button label="Disconnect GitHub" onClick={() => onDisconnect('github')} />
      </div>
    ),
    ProfileFinanceSection: () => <span>Finance settings</span>,
    McpServersSection: (props: any) => (
      <div>
        <div>MCP Servers</div>
        {[
          { label: 'MCP name', value: props.pendingName, onChange: props.onPendingNameChange },
          {
            label: 'MCP endpoint',
            value: props.pendingEndpoint,
            onChange: props.onPendingEndpointChange,
          },
        ].map((field) => (
          <input
            key={field.label}
            aria-label={field.label}
            value={field.value}
            onInput={(event: any) => field.onChange(event.target.value)}
          />
        ))}
        <Button label="Save MCP Server" onClick={props.onAddServer} />
        {props.servers.map((server: any) => (
          <div key={server.name}>
            <span>{server.name}</span>
            <Button
              label={`Inspect ${server.name}`}
              onClick={() => props.onInspectServer(server)}
            />
            <Button
              label={`Remove ${server.name}`}
              onClick={() => props.onRemoveServer(server.name)}
            />
          </div>
        ))}
      </div>
    ),
    GeneralIcon: Icon,
    KeyboardIcon: Icon,
    SecurityIcon: Icon,
    NotificationsIcon: Icon,
    PersonalizationIcon: Icon,
    StorageIcon: Icon,
    SubscriptionIcon: Icon,
    UsageIcon: Icon,
    DataIcon: Icon,
    FinanceIcon: Icon,
    AppsIcon: Icon,
    McpIcon: Icon,
    BrowserIcon: Icon,
    ComputerUseIcon: Icon,
    AppshotsIcon: Icon,
    EnvironmentsIcon: Icon,
    WorktreesIcon: Icon,
    ArchivedChatsIcon: Icon,
    NotificationsSection: ({ enabled, onToggle }: any) => (
      <div>
        <span>{enabled ? 'Notifications enabled' : 'Notifications disabled'}</span>
        <Button label="Toggle Notifications" onClick={() => onToggle(true)} />
      </div>
    ),
    PersonalizationSection: (props: any) => (
      <div>
        <Button label="Toggle Memory" onClick={() => props.onMemoryToggle(true)} />
        <Button label="Manage Memories" onClick={props.onManageMemories} />
        <Button label="Toggle Web Search" onClick={() => props.onWebSearchToggle(true)} />
        <Button label="Toggle Code Execution" onClick={() => props.onCodeExecutionToggle(true)} />
        <Button label="Toggle Trust Layer" onClick={() => props.onTrustLayerToggle(true)} />
      </div>
    ),
    MemorySummaryDialog: (props: any) =>
      props.open ? (
        <div>
          <span>Memory summary dialog</span>
          <Button label="Add Memory" onClick={() => props.onCreate('New memory', 'preference')} />
          <Button
            label="Update Memory"
            onClick={() => props.onUpdate(props.memories[0]?.id ?? 1, 'Updated memory', 'fact')}
          />
          <Button
            label="Delete Memory"
            onClick={() => props.onDelete(props.memories[0]?.id ?? 1)}
          />
          <Button label="Refresh Memories" onClick={props.onRefresh} />
        </div>
      ) : null,
  };
});

export const mockConversationStore = {
  listArchivedConversations: vi.fn(),
  restoreConversation: vi.fn(),
  clearConversation: vi.fn(),
  archiveAllConversations: vi.fn(),
  deleteAllConversations: vi.fn(),
};

export const defaultStorageSummaryResult = {
  ok: true as const,
  value: {
    usedBytes: 19_000_000,
    quotaBytes: 40_000_000_000,
    categories: [
      { id: 'files', label: 'Files', bytes: 1000, count: 1 },
      { id: 'images', label: 'Images', bytes: 18_999_000, count: 45 },
    ],
  },
};

export const mockFetchStorageSummary = vi.fn().mockResolvedValue(defaultStorageSummaryResult);

void vi.mock('../../api/storage', () => ({
  fetchStorageSummary: mockFetchStorageSummary,
}));

export const mockCloseMcpServer = vi.fn();
export const mockCloseAllMcpServers = vi.fn();
export const mockDiscoverMcpServer = vi.fn();

export const mockReadStoredWebMcpServers = vi.fn();
export const mockPersistWebMcpServers = vi.fn((servers: any[]) => servers);

export const mockWaitForTauriBridge = vi.fn();

export const mockInspectDesktopMcpServer = vi.fn();
