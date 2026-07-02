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
} from '@taskforceai/shared/profile/view-model';
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
} from './ProfileModalSections';
import { DesktopLocalSection } from './ProfileDesktopLocalSection';
import { useConversationStore, usePlatformRuntime } from '../platform/PlatformProvider';
import { ProfileModalSidebar } from './ProfileModalSidebar';
import { useProfileModalController } from './useProfileModalController';
import { logger } from '../logger';

interface ProfileModalProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onModalOpen?: () => void;
}

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
  const [preferenceOverrides, setPreferenceOverrides] = React.useState<
    Partial<
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
    >
  >({});
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
    integrations,
    loading,
    products,
    pendingUpgradePlan,
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
    storageSummary,
    storageLoading,
    storageError,
    mcpServers,
    pendingMcpName,
    setPendingMcpName,
    pendingMcpEndpoint,
    setPendingMcpEndpoint,
    mcpBusyServerName,
    handleUpgrade,
    handleMemoryToggle,
    handleWebSearchToggle,
    handleCodeExecutionToggle,
    handleTrustLayerToggle,
    handleNotificationsToggle,
    handleThemeChange,
    openMemorySummary,
    loadMemories,
    loadStorage,
    handleCreateMemory,
    handleUpdateMemory,
    handleDeleteMemory,
    handleConnect,
    handleDisconnect,
    handleSaveMcpServer,
    handleRemoveMcpServer,
    handleInspectMcpServer,
    handleReactivateSubscription,
    handleDataExport,
    handleManageStorageCategory,
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

  const plan = normalizeProfilePlan(user.plan);
  const messageUsageLabel = resolveProfileMessageUsageLabel({
    plan,
    messageCount: user.message_count,
  });
  const creditBalanceLabel = formatProfileCreditBalanceLabel(balance?.creditBalance);
  const resetLabel = formatProfileUsageResetLabel({
    currentPeriodStart: balance?.currentPeriodStart ?? subscription?.current_period_start,
    currentPeriodEnd: balance?.currentPeriodEnd ?? subscription?.current_period_end,
  });
  const upgradeOptions = buildProfileUpgradeOptions({
    currentPlan: plan,
    products,
  });

  const planMeta: Record<'pro' | 'super', { label: string; throughput: string }> = {
    pro: { label: 'Pro', throughput: '2 messages per hour' },
    super: { label: 'Super', throughput: '20 messages per hour' },
  };

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
        />

        <div className="flex flex-1 flex-col overflow-y-auto bg-background/50 p-6 sm:p-8">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-xl font-semibold capitalize">
              {activeTab === 'security' ? 'Security and login' : activeTab.replace('-', ' ')}
            </h3>
          </div>

          <FeedbackBanner message={feedbackMessage} kind={feedbackKind} />

          <div className="flex-1">
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
                      void handleThemeChange(theme);
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
                  void handleNotificationsToggle(enabled);
                }}
              />
            )}

            {activeTab === 'personalization' && (
              <PersonalizationSection
                memoryEnabled={profileUser.memory_enabled}
                onMemoryToggle={(enabled) => {
                  setPreferenceOverrides((current) => ({ ...current, memory_enabled: enabled }));
                  void handleMemoryToggle(enabled);
                }}
                onManageMemories={openMemorySummary}
                memoryCount={memories.length}
                webSearchEnabled={profileUser.web_search_enabled}
                onWebSearchToggle={(enabled) => {
                  setPreferenceOverrides((current) => ({
                    ...current,
                    web_search_enabled: enabled,
                  }));
                  void handleWebSearchToggle(enabled);
                }}
                codeExecutionEnabled={profileUser.code_execution_enabled}
                onCodeExecutionToggle={(enabled) => {
                  setPreferenceOverrides((current) => ({
                    ...current,
                    code_execution_enabled: enabled,
                  }));
                  void handleCodeExecutionToggle(enabled);
                }}
                trustLayerEnabled={profileUser.trust_layer_enabled}
                onTrustLayerToggle={(enabled) => {
                  setPreferenceOverrides((current) => ({
                    ...current,
                    trust_layer_enabled: enabled,
                  }));
                  void handleTrustLayerToggle(enabled);
                }}
              />
            )}

            {activeTab === 'subscription' && (
              <div className="space-y-8">
                <SubscriptionSection
                  creditBalanceLabel={creditBalanceLabel}
                  plan={plan}
                  messageUsageLabel={messageUsageLabel}
                  resetLabel={resetLabel}
                  subscription={subscription}
                  loading={loading}
                  onOpenCancelConfirm={() => setConfirmCancelOpen(true)}
                  onReactivate={() => {
                    void handleReactivateSubscription();
                  }}
                />
                {upgradeOptions.length > 0 && (
                  <div className="border-t border-border pt-8">
                    <UpgradeSection
                      upgradeOptions={upgradeOptions}
                      planMeta={planMeta}
                      formatPriceLabel={(targetPlan, amount) =>
                        formatProfilePriceLabel({ plan: targetPlan, amount })
                      }
                      pendingUpgradePlan={pendingUpgradePlan}
                      onUpgrade={(targetPlan, priceId) => {
                        void handleUpgrade(targetPlan, priceId);
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {activeTab === 'storage' && (
              <StorageSection
                summary={storageSummary}
                loading={storageLoading}
                error={storageError}
                onRetry={() => void loadStorage()}
                onManageCategory={handleManageStorageCategory}
              />
            )}

            {activeTab === 'data' && (
              <DataControlsSection
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
            )}

            {activeTab === 'finance' && <ProfileFinanceSection />}

            {activeTab === 'apps' && (
              <div className="space-y-6">
                <ConnectedAppsSection
                  integrations={integrations}
                  onConnect={handleConnect}
                  onDisconnect={(provider) => {
                    void handleDisconnect(provider);
                  }}
                />
                <McpServersSection
                  servers={mcpServers}
                  pendingName={pendingMcpName}
                  pendingEndpoint={pendingMcpEndpoint}
                  busyServerName={mcpBusyServerName}
                  onPendingNameChange={setPendingMcpName}
                  onPendingEndpointChange={setPendingMcpEndpoint}
                  onAddServer={handleSaveMcpServer}
                  onInspectServer={(server) => {
                    void handleInspectMcpServer(server);
                  }}
                  onRemoveServer={handleRemoveMcpServer}
                />
                {platformRuntime === 'desktop' ? <DesktopLocalSection /> : null}
              </div>
            )}
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
