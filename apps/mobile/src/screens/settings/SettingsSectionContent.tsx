import React from 'react';
import { View } from 'react-native';

import {
  AppearanceSection,
  GeneralSection,
} from './sections/GeneralSection';
import { NotificationsSection } from './sections/NotificationsSection';
import { PersonalizationSection } from './sections/PersonalizationSection';
import { AutomationSection } from './sections/AutomationSection';
import {
  SubscriptionActions,
  SubscriptionSection,
} from './sections/SubscriptionSection';
import { StorageSection } from './sections/StorageSection';
import { DataControlsSection } from './sections/DataControlsSection';
import { IntegrationsSection } from './sections/IntegrationsSection';
import { SecuritySection } from './sections/SecuritySection';
import { DataAccountActions } from './DataAccountActions';
import type {
  PersonalizationKey,
  PersonalizationState,
  SettingsSectionId,
} from './types';
import type { SettingsMemoriesState } from './useSettingsMemories';

type ProductPlan = 'pro' | 'super';

interface SettingsSectionContentProps {
  activeSection: SettingsSectionId;
  profileEmail: string;
  editableFullName: string;
  updatingFullName: boolean;
  onEditableNameChange: (_value: string) => void;
  onSaveFullName: () => Promise<void>;
  onRefreshUser: () => Promise<void>;
  isDarkMode: boolean;
  updatingTheme: boolean;
  onThemeToggle: () => Promise<void>;
  notificationsEnabled: boolean;
  updatingNotifications: boolean;
  onNotificationsToggle: (_value: boolean) => Promise<void>;
  personalization: PersonalizationState;
  updatingPersonalization: PersonalizationKey | null;
  onPersonalizationToggle: (_key: PersonalizationKey, _value: boolean) => Promise<void>;
  memorySummary: SettingsMemoriesState;
  user: any;
  billingBalanceQuery: { data: any; isFetching: boolean };
  subscriptionQuery: { data: any; isFetching: boolean };
  storageQuery: { data: any; isFetching: boolean; error: unknown; refetch: () => unknown };
  isProcessing: boolean;
  proPriceLabel: string | null;
  superPriceLabel: string | null;
  onPurchasePlan: (_plan: ProductPlan) => void;
  onRestorePurchases: () => void;
  onManageBilling: () => void;
  onClearCache: () => void;
  onForceSync: () => Promise<void>;
  onResetDatabase: () => void;
  isAdmin: boolean;
  accountActionsTitle: string;
  exportLabel: string;
  deleteLabel: string;
  logoutLabel: string;
  isAccountActionLoading: boolean;
  onExportData: () => void;
  onDeleteAccount: () => void;
  onLogout: () => void;
  onPrivacyPolicy: () => void;
  onTermsOfService: () => void;
  onContactSupport: () => void;
  integrations: Array<{ provider: string; connected: boolean }>;
  mcpServers: Array<{ name: string; endpoint: string; enabled: boolean }>;
  loadingIntegrations: boolean;
  integrationActionProvider: string | null;
  pendingMcpName: string;
  pendingMcpEndpoint: string;
  mcpActionServer: string | null;
  onConnectIntegration: (_provider: string) => void;
  onDisconnectIntegration: (_provider: string) => void;
  onPendingMcpNameChange: (_value: string) => void;
  onPendingMcpEndpointChange: (_value: string) => void;
  onAddMcpServer: () => void;
  onInspectMcpServer: (_serverName: string) => void;
  onRemoveMcpServer: (_serverName: string) => void;
  desktopPairingPayload?: string | null;
}

export function SettingsSectionContent(props: SettingsSectionContentProps) {
  if (props.activeSection === 'general') {
    return (
      <View className="gap-4">
        <GeneralSection
          profileEmail={props.profileEmail}
          editableName={props.editableFullName}
          isAuthenticated={!!props.user}
          isSavingName={props.updatingFullName}
          onEditableNameChange={props.onEditableNameChange}
          onSaveName={props.onSaveFullName}
        />
        <AppearanceSection
          isDarkMode={props.isDarkMode}
          updatingTheme={props.updatingTheme}
          onThemeToggle={props.onThemeToggle}
        />
      </View>
    );
  }

  if (props.activeSection === 'notifications') {
    return (
      <NotificationsSection
        notificationsEnabled={props.notificationsEnabled}
        updatingNotifications={props.updatingNotifications}
        onNotificationsToggle={props.onNotificationsToggle}
      />
    );
  }

  if (props.activeSection === 'security') {
    return (
      <SecuritySection
        authenticatorEnabled={Boolean(props.user?.mfa_enabled)}
        onStatusChange={props.onRefreshUser}
      />
    );
  }

  if (props.activeSection === 'personalization') {
    return (
      <PersonalizationSection
        personalization={props.personalization}
        updatingKey={props.updatingPersonalization}
        onToggle={props.onPersonalizationToggle}
        memorySummary={props.memorySummary}
      />
    );
  }

  if (props.activeSection === 'subscription') {
    return (
      <View className="gap-4">
        <SubscriptionSection
          billingBalanceQuery={props.billingBalanceQuery}
          user={props.user}
          subscriptionQuery={props.subscriptionQuery}
        />
        <SubscriptionActions
          userPlan={props.user?.plan}
          isProcessing={props.isProcessing}
          proPriceLabel={props.proPriceLabel}
          superPriceLabel={props.superPriceLabel}
          onPurchasePlan={props.onPurchasePlan}
          onRestorePurchases={props.onRestorePurchases}
          onManageBilling={props.onManageBilling}
        />
      </View>
    );
  }

  if (props.activeSection === 'storage') {
    return (
      <StorageSection
        summary={props.storageQuery.data ?? null}
        loading={props.storageQuery.isFetching}
        error={
          props.storageQuery.error instanceof Error
            ? props.storageQuery.error.message
            : props.storageQuery.error
              ? 'Failed to load storage usage'
              : null
        }
        onRetry={() => {
          void props.storageQuery.refetch();
        }}
      />
    );
  }

  if (props.activeSection === 'data') {
    return (
      <View className="gap-4">
        <DataControlsSection
          onClearCache={props.onClearCache}
          onForceSync={props.onForceSync}
          onResetDatabase={props.onResetDatabase}
          isAdmin={props.isAdmin}
        />
        <DataAccountActions
          title={props.accountActionsTitle}
          isAuthenticated={!!props.user}
          exportLabel={props.exportLabel}
          deleteLabel={props.deleteLabel}
          logoutLabel={props.logoutLabel}
          isLoading={props.isAccountActionLoading}
          onExport={props.onExportData}
          onDelete={props.onDeleteAccount}
          onLogout={props.onLogout}
          onPrivacyPolicy={props.onPrivacyPolicy}
          onTermsOfService={props.onTermsOfService}
          onContactSupport={props.onContactSupport}
        />
      </View>
    );
  }

  if (props.activeSection === 'automation') {
    return <AutomationSection />;
  }

  if (props.activeSection === 'apps') {
    return (
      <IntegrationsSection
        integrations={props.integrations}
        mcpServers={props.mcpServers}
        loading={props.loadingIntegrations}
        actionProvider={props.integrationActionProvider}
        pendingMcpName={props.pendingMcpName}
        pendingMcpEndpoint={props.pendingMcpEndpoint}
        mcpActionServer={props.mcpActionServer}
        onConnect={props.onConnectIntegration}
        onDisconnect={props.onDisconnectIntegration}
        onPendingMcpNameChange={props.onPendingMcpNameChange}
        onPendingMcpEndpointChange={props.onPendingMcpEndpointChange}
        onAddMcpServer={props.onAddMcpServer}
        onInspectMcpServer={props.onInspectMcpServer}
        onRemoveMcpServer={props.onRemoveMcpServer}
        desktopPairingPayload={props.desktopPairingPayload}
      />
    );
  }

  return null;
}
