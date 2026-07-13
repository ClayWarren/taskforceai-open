'use client';

import React from 'react';
import { createPortal } from 'react-dom';

import type { AuthenticatedUser } from '@taskforceai/contracts/contracts';
import {
  buildProfileUpgradeOptions,
  formatProfileCreditBalanceLabel,
  formatProfilePriceLabel,
  formatProfileUsageResetLabel,
  normalizeProfilePlan,
  resolveProfileMessageUsageLabel,
} from '@taskforceai/presenters/profile/view-model';
import { useAuth } from '../providers/AuthProvider';
import {
  CancelSubscriptionDialog,
  ConnectedAppsSection,
  DataControlsSection,
  DeleteAccountDialog,
  FeedbackBanner,
  KeyboardShortcutsSection,
  MemorySummaryDialog,
  NotificationsSection,
  PersonalizationSection,
  McpServersSection,
  ProfileFinanceSection,
  ProfileDetailsSection,
  SecuritySection,
  SettingsSection,
  StorageSection,
  SubscriptionSection,
  UpgradeSection,
  UsageLimitsSection,
} from './ProfileModalSections';
import {
  DesktopAppshotsSection,
  DesktopBrowserUseSection,
  DesktopComputerUseSection,
  DesktopEnvironmentsSection,
  DesktopLocalSection,
  DesktopWorktreesSection,
} from './ProfileDesktopLocalSection';
import { useConversationStore, usePlatformRuntime } from '../platform/PlatformProvider';
import { ProfileModalSidebar } from './ProfileModalSidebar';
import { PairingSections } from './ProfileDesktopPairingSection';
import { useProfileModalController } from './useProfileModalController';
import { logger } from '../logger';

interface ProfileModalProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onModalOpen?: () => void;
}

type ProfileController = ReturnType<typeof useProfileModalController>;

type PreferenceOverrides = Partial<
  Pick<
    AuthenticatedUser,
    | 'memory_enabled'
    | 'web_search_enabled'
    | 'code_execution_enabled'
    | 'trust_layer_enabled'
    | 'notifications_enabled'
    | 'theme_preference'
    | 'mfa_enabled'
  >
>;

const PLAN_META: Record<'pro' | 'super', { label: string; throughput: string }> = {
  pro: { label: 'Pro', throughput: '2 messages per hour' },
  super: { label: 'Super', throughput: '20 messages per hour' },
};

const ACTIVE_TAB_TITLES: Record<string, string> = {
  general: 'General',
  keyboard: 'Keyboard',
  security: 'Security and login',
  notifications: 'Notifications',
  personalization: 'Personalization',
  subscription: 'Subscription',
  usage: 'Usage',
  storage: 'Storage',
  data: 'Data controls',
  finance: 'Finance',
  apps: 'Connected Apps',
  mcp: 'MCP servers',
  browser: 'Browser',
  'computer-use': 'Computer Use',
  connections: 'Connections',
  appshots: 'Appshots',
  environments: 'Environments',
  worktrees: 'Worktrees',
  'archived-chats': 'Archived chats',
};

const DESKTOP_TAB_SECTIONS: Record<string, React.FC> = {
  connections: PairingSections,
  browser: DesktopBrowserUseSection,
  'computer-use': DesktopComputerUseSection,
  appshots: DesktopAppshotsSection,
  environments: DesktopEnvironmentsSection,
  worktrees: DesktopWorktreesSection,
};

const buildProfileLabels = (
  user: AuthenticatedUser,
  balance: ProfileController['balance'],
  subscription: ProfileController['subscription'],
  products: ProfileController['products']
) => {
  const plan = normalizeProfilePlan(user.plan);
  return {
    plan,
    messageUsageLabel: resolveProfileMessageUsageLabel({
      plan,
      messageCount: user.message_count,
    }),
    creditBalanceLabel: formatProfileCreditBalanceLabel(balance?.creditBalance),
    resetLabel: formatProfileUsageResetLabel({
      currentPeriodStart: balance?.currentPeriodStart ?? subscription?.current_period_start,
      currentPeriodEnd: balance?.currentPeriodEnd ?? subscription?.current_period_end,
    }),
    usageResetAt:
      balance?.currentPeriodEnd ?? subscription?.current_period_end ?? user.current_period_end,
    upgradeOptions: buildProfileUpgradeOptions({ currentPlan: plan, products }),
  };
};

type ProfileLabels = ReturnType<typeof buildProfileLabels>;

const GeneralTabContent = ({
  activeTab,
  user,
  profileUser,
  controller,
  setPreferenceOverrides,
}: {
  activeTab: string;
  user: AuthenticatedUser;
  profileUser: AuthenticatedUser;
  controller: ProfileController;
  setPreferenceOverrides: React.Dispatch<React.SetStateAction<PreferenceOverrides>>;
}) => (
  <>
    {activeTab === 'general' && (
      <div className="space-y-8">
        <ProfileDetailsSection fullName={user.full_name ?? ''} email={user.email ?? ''} />
        <div className="border-t border-border pt-8">
          <SettingsSection
            theme={profileUser.theme_preference}
            onThemeChange={(theme) => {
              setPreferenceOverrides((current) => ({
                ...current,
                theme_preference: theme,
              }));
              void controller.handleThemeChange(theme);
            }}
          />
        </div>
      </div>
    )}

    {activeTab === 'keyboard' && <KeyboardShortcutsSection />}

    {activeTab === 'security' && (
      <SecuritySection
        initialAuthenticatorEnabled={profileUser.mfa_enabled}
        onAuthenticatorStatusChange={(enabled) => {
          setPreferenceOverrides((current) => ({ ...current, mfa_enabled: enabled }));
        }}
      />
    )}

    {activeTab === 'notifications' && (
      <NotificationsSection
        enabled={profileUser.notifications_enabled}
        onToggle={(enabled) => {
          setPreferenceOverrides((current) => ({
            ...current,
            notifications_enabled: enabled,
          }));
          void controller.handleNotificationsToggle(enabled);
        }}
      />
    )}

    {activeTab === 'personalization' && (
      <PersonalizationSection
        memoryEnabled={profileUser.memory_enabled}
        onMemoryToggle={(enabled) => {
          setPreferenceOverrides((current) => ({ ...current, memory_enabled: enabled }));
          void controller.handleMemoryToggle(enabled);
        }}
        onManageMemories={controller.openMemorySummary}
        memoryCount={controller.memories.length}
        webSearchEnabled={profileUser.web_search_enabled}
        onWebSearchToggle={(enabled) => {
          setPreferenceOverrides((current) => ({
            ...current,
            web_search_enabled: enabled,
          }));
          void controller.handleWebSearchToggle(enabled);
        }}
        codeExecutionEnabled={profileUser.code_execution_enabled}
        onCodeExecutionToggle={(enabled) => {
          setPreferenceOverrides((current) => ({
            ...current,
            code_execution_enabled: enabled,
          }));
          void controller.handleCodeExecutionToggle(enabled);
        }}
        trustLayerEnabled={profileUser.trust_layer_enabled}
        onTrustLayerToggle={(enabled) => {
          setPreferenceOverrides((current) => ({
            ...current,
            trust_layer_enabled: enabled,
          }));
          void controller.handleTrustLayerToggle(enabled);
        }}
      />
    )}
  </>
);

const BillingTabContent = ({
  activeTab,
  controller,
  labels,
  messageCount,
}: {
  activeTab: string;
  controller: ProfileController;
  labels: ProfileLabels;
  messageCount: AuthenticatedUser['message_count'];
}) => (
  <>
    {activeTab === 'subscription' && (
      <div className="space-y-8">
        <SubscriptionSection
          creditBalanceLabel={labels.creditBalanceLabel}
          plan={labels.plan}
          messageUsageLabel={labels.messageUsageLabel}
          resetLabel={labels.resetLabel}
          subscription={controller.subscription}
          loading={controller.loading}
          onOpenCancelConfirm={() => controller.setConfirmCancelOpen(true)}
          onReactivate={() => {
            void controller.handleReactivateSubscription();
          }}
        />
        {labels.upgradeOptions.length > 0 && (
          <div className="border-t border-border pt-8">
            <UpgradeSection
              upgradeOptions={labels.upgradeOptions}
              planMeta={PLAN_META}
              formatPriceLabel={(targetPlan, amount) =>
                formatProfilePriceLabel({ plan: targetPlan, amount })
              }
              pendingUpgradePlan={controller.pendingUpgradePlan}
              onUpgrade={(targetPlan, priceId) => {
                void controller.handleUpgrade(targetPlan, priceId);
              }}
            />
          </div>
        )}
      </div>
    )}

    {activeTab === 'usage' && (
      <UsageLimitsSection
        plan={labels.plan}
        messageCount={messageCount}
        resetAt={labels.usageResetAt}
        upgradeOptions={labels.upgradeOptions}
        pendingUpgradePlan={controller.pendingUpgradePlan}
        formatPriceLabel={(targetPlan, amount) =>
          formatProfilePriceLabel({ plan: targetPlan, amount })
        }
        onUpgrade={(targetPlan, priceId) => {
          void controller.handleUpgrade(targetPlan, priceId);
        }}
      />
    )}
  </>
);

const ServicesTabContent = ({
  activeTab,
  controller,
  platformRuntime,
  renderDataControls,
}: {
  activeTab: string;
  controller: ProfileController;
  platformRuntime: string;
  renderDataControls: (mode?: 'all' | 'archived') => React.ReactNode;
}) => (
  <>
    {activeTab === 'storage' && (
      <StorageSection
        summary={controller.storageSummary}
        loading={controller.storageLoading}
        error={controller.storageError}
        onRetry={() => void controller.loadStorage()}
        onManageCategory={controller.handleManageStorageCategory}
      />
    )}

    {activeTab === 'data' && renderDataControls()}

    {activeTab === 'finance' && <ProfileFinanceSection />}

    {activeTab === 'apps' && (
      <div className="space-y-6">
        <ConnectedAppsSection
          integrations={controller.integrations}
          onConnect={controller.handleConnect}
          onDisconnect={(provider) => {
            void controller.handleDisconnect(provider);
          }}
        />
        <ProfileMcpServers controller={controller} />
        {platformRuntime === 'desktop' ? <DesktopLocalSection /> : null}
      </div>
    )}

    {activeTab === 'mcp' && <ProfileMcpServers controller={controller} />}

    {activeTab === 'archived-chats' && renderDataControls('archived')}
  </>
);

const ProfileMcpServers = ({ controller }: { controller: ProfileController }) => (
  <McpServersSection
    servers={controller.mcpServers}
    pendingName={controller.pendingMcpName}
    pendingEndpoint={controller.pendingMcpEndpoint}
    busyServerName={controller.mcpBusyServerName}
    onPendingNameChange={controller.setPendingMcpName}
    onPendingEndpointChange={controller.setPendingMcpEndpoint}
    onAddServer={controller.handleSaveMcpServer}
    onInspectServer={(server) => void controller.handleInspectMcpServer(server)}
    onRemoveServer={controller.handleRemoveMcpServer}
  />
);

const DesktopTabContent = ({
  activeTab,
  platformRuntime,
}: {
  activeTab: string;
  platformRuntime: string;
}) => {
  const Section = DESKTOP_TAB_SECTIONS[activeTab];
  if (!Section || platformRuntime !== 'desktop') {
    return null;
  }
  return <Section />;
};

const ProfileModal: React.FC<ProfileModalProps> = ({ open, onOpenChange, onModalOpen }) => {
  const { user, logout } = useAuth();
  const platformRuntime = usePlatformRuntime();
  const conversationStore = useConversationStore();
  const [archivedManagerOpen, setArchivedManagerOpen] = React.useState(false);
  const [archivedConversations, setArchivedConversations] = React.useState<
    Array<{
      conversationId: string;
      title: string;
      createdAt: number;
      updatedAt: number;
      lastMessagePreview?: string | null;
    }>
  >([]);
  const [archivedConversationsLoading, setArchivedConversationsLoading] = React.useState(false);
  const [archiveControlsError, setArchiveControlsError] = React.useState<string | null>(null);
  const [archiveActionId, setArchiveActionId] = React.useState<string | null>(null);
  const [preferenceOverrides, setPreferenceOverrides] = React.useState<PreferenceOverrides>({});
  const controller = useProfileModalController({
    open,
    user,
    logout,
    onModalOpen,
  });
  const {
    activeTab,
    setActiveTab,
    balance,
    subscription,
    loading,
    products,
    confirmCancelOpen,
    setConfirmCancelOpen,
    confirmDeleteOpen,
    setConfirmDeleteOpen,
    deleteInput,
    setDeleteInput,
    feedbackMessage,
    feedbackKind,
    memorySummaryOpen,
    setMemorySummaryOpen,
    memories,
    memoriesLoading,
    memoriesError,
    memoryActionId,
    loadMemories,
    handleCreateMemory,
    handleUpdateMemory,
    handleDeleteMemory,
    handleDataExport,
    confirmAndCancelSubscription,
    confirmAndDeleteAccount,
  } = controller;

  React.useEffect(() => {
    if (!open) {
      setPreferenceOverrides({});
      setArchivedManagerOpen(false);
      setArchiveControlsError(null);
      setArchiveActionId(null);
    }
  }, [open, user?.email]);

  if (!user) return null;

  const profileUser = { ...user, ...preferenceOverrides };
  const labels = buildProfileLabels(user, balance, subscription, products);

  if (!open) return null;

  const loadArchivedConversations = async () => {
    if (!conversationStore.listArchivedConversations) {
      setArchiveControlsError('Archive management is unavailable in this runtime.');
      setArchivedConversations([]);
      return;
    }

    setArchivedConversationsLoading(true);
    setArchiveControlsError(null);
    try {
      const conversations = await conversationStore.listArchivedConversations(100, 0);
      setArchivedConversations(
        conversations.map((conversation) => ({
          conversationId: conversation.conversationId,
          title: conversation.title || 'Untitled conversation',
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          lastMessagePreview: conversation.lastMessagePreview,
        }))
      );
    } catch (error) {
      logger.error('Failed to load archived conversations', { error });
      setArchiveControlsError('Failed to load archived chats.');
    } finally {
      setArchivedConversationsLoading(false);
    }
  };

  const openArchivedManager = () => {
    setArchivedManagerOpen(true);
    void loadArchivedConversations();
  };

  const handleArchivedManagerOpenChange = (nextOpen: boolean) => {
    setArchivedManagerOpen(nextOpen);
    if (nextOpen) {
      void loadArchivedConversations();
    }
  };

  const handleRestoreConversation = async (conversationId: string) => {
    if (!conversationStore.restoreConversation) {
      setArchiveControlsError('Restore is unavailable in this runtime.');
      return;
    }

    setArchiveActionId(`restore:${conversationId}`);
    setArchiveControlsError(null);
    try {
      await conversationStore.restoreConversation(conversationId);
      await loadArchivedConversations();
    } catch (error) {
      logger.error('Failed to restore archived conversation', { conversationId, error });
      setArchiveControlsError('Failed to restore archived chat.');
    } finally {
      setArchiveActionId(null);
    }
  };

  const handleDeleteArchivedConversation = async (conversationId: string) => {
    setArchiveActionId(`delete:${conversationId}`);
    setArchiveControlsError(null);
    try {
      await conversationStore.clearConversation(conversationId);
      await loadArchivedConversations();
    } catch (error) {
      logger.error('Failed to delete archived conversation', { conversationId, error });
      setArchiveControlsError('Failed to delete archived chat.');
    } finally {
      setArchiveActionId(null);
    }
  };

  const handleArchiveAllConversations = async () => {
    if (!conversationStore.archiveAllConversations) {
      setArchiveControlsError('Archive all is unavailable in this runtime.');
      return;
    }

    setArchiveActionId('archive-all');
    setArchiveControlsError(null);
    try {
      await conversationStore.archiveAllConversations();
      if (archivedManagerOpen) {
        await loadArchivedConversations();
      }
    } catch (error) {
      logger.error('Failed to archive all conversations', { error });
      setArchiveControlsError('Failed to archive all chats.');
    } finally {
      setArchiveActionId(null);
    }
  };

  const handleDeleteAllConversations = async () => {
    if (!conversationStore.deleteAllConversations) {
      setArchiveControlsError('Delete all chats is unavailable in this runtime.');
      return;
    }
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Permanently delete all chats? This cannot be undone.')
    ) {
      return;
    }

    setArchiveActionId('delete-all');
    setArchiveControlsError(null);
    try {
      await conversationStore.deleteAllConversations();
      setArchivedConversations([]);
    } catch (error) {
      logger.error('Failed to delete all conversations', { error });
      setArchiveControlsError('Failed to delete all chats.');
    } finally {
      setArchiveActionId(null);
    }
  };

  const renderDataControlsSection = (mode: 'all' | 'archived' = 'all') => (
    <DataControlsSection
      mode={mode}
      loading={loading}
      archiveManagementSupported={'listArchivedConversations' in conversationStore}
      archivedManagerOpen={archivedManagerOpen}
      archivedConversations={archivedConversations}
      archivedConversationsLoading={archivedConversationsLoading}
      archiveActionId={archiveActionId}
      archiveControlsError={archiveControlsError}
      onExport={() => {
        void handleDataExport();
      }}
      onOpenArchivedManager={openArchivedManager}
      onArchivedManagerOpenChange={handleArchivedManagerOpenChange}
      onRestoreConversation={(conversationId) => {
        void handleRestoreConversation(conversationId);
      }}
      onDeleteConversation={(conversationId) => {
        void handleDeleteArchivedConversation(conversationId);
      }}
      onArchiveAllConversations={() => {
        void handleArchiveAllConversations();
      }}
      onDeleteAllConversations={() => {
        void handleDeleteAllConversations();
      }}
      onOpenDeleteConfirm={() => setConfirmDeleteOpen(true)}
    />
  );

  const modalContent = (
    <>
      <div className="profile-modal-overlay" onClick={() => onOpenChange(false)} />

      <div
        className="profile-modal !flex !max-h-[min(640px,90vh)] !w-[min(800px,95vw)] !flex-row !overflow-hidden !p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <ProfileModalSidebar
          activeTab={activeTab}
          onClose={() => onOpenChange(false)}
          onLogout={() => {
            void logout();
          }}
          onSelectTab={setActiveTab}
          platformRuntime={platformRuntime === 'desktop' ? 'desktop' : 'browser'}
        />

        <div className="flex flex-1 flex-col overflow-y-auto bg-background/50 p-6 sm:p-8">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-xl font-semibold">{ACTIVE_TAB_TITLES[activeTab] ?? activeTab}</h3>
          </div>

          <FeedbackBanner message={feedbackMessage} kind={feedbackKind} />

          <div className="flex-1">
            <GeneralTabContent
              activeTab={activeTab}
              user={user}
              profileUser={profileUser}
              controller={controller}
              setPreferenceOverrides={setPreferenceOverrides}
            />
            <BillingTabContent
              activeTab={activeTab}
              controller={controller}
              labels={labels}
              messageCount={user.message_count}
            />
            <ServicesTabContent
              activeTab={activeTab}
              controller={controller}
              platformRuntime={platformRuntime}
              renderDataControls={renderDataControlsSection}
            />
            <DesktopTabContent activeTab={activeTab} platformRuntime={platformRuntime} />
          </div>
        </div>

        <MemorySummaryDialog
          open={memorySummaryOpen}
          memories={memories}
          loading={memoriesLoading}
          error={memoriesError}
          actionId={memoryActionId}
          onOpenChange={setMemorySummaryOpen}
          onRefresh={() => void loadMemories()}
          onCreate={handleCreateMemory}
          onUpdate={handleUpdateMemory}
          onDelete={handleDeleteMemory}
        />

        <CancelSubscriptionDialog
          open={confirmCancelOpen}
          onOpenChange={setConfirmCancelOpen}
          onConfirm={() => {
            void confirmAndCancelSubscription();
          }}
          loading={loading}
        />

        <DeleteAccountDialog
          open={confirmDeleteOpen}
          onOpenChange={setConfirmDeleteOpen}
          onConfirm={() => {
            void confirmAndDeleteAccount();
          }}
          loading={loading}
          deleteInput={deleteInput}
          onDeleteInputChange={setDeleteInput}
          expectedEmail={user.email ?? ''}
        />
      </div>
    </>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};

export default ProfileModal;
