/**
 * Settings Screen - App settings and preferences
 * 
 * Shell component that delegates to specialized sections for each settings area.
 * Each section handles its own state and logic, following SRP.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../contexts/AuthContext';
import { usePreferences } from '../contexts/PreferencesContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  useBillingBalanceQuery,
  useProductsQuery,
  useSubscriptionQuery,
} from '../hooks/api/subscription';
import { useStorageSummaryQuery } from '../hooks/api/storage';
import { useProfileActions } from '../hooks/useProfileActions';
import { usePurchases } from '../hooks/usePurchases';
import { SettingsFrame } from './settings/SettingsFrame';
import { SettingsHome } from './settings/SettingsHome';
import { SettingsSectionContent } from './settings/SettingsSectionContent';
import { useSettingsIntegrations } from './settings/useSettingsIntegrations';
import { useSettingsMaintenanceActions } from './settings/useSettingsMaintenanceActions';
import { useSettingsMemories } from './settings/useSettingsMemories';
import { useSettingsPreferenceActions } from './settings/useSettingsPreferenceActions';
import { useSettingsScreenViewState } from './settings/useSettingsScreenViewState';
import type { SettingsSectionId } from './settings/types';

interface SettingsScreenProps {
  visible: boolean;
  onClose: () => void;
  onClearCache?: () => Promise<void>;
  desktopPairingPayload?: string | null;
}

export function SettingsScreen({
  visible,
  onClose,
  onClearCache,
  desktopPairingPayload,
}: SettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useAuth();
  const { theme, isDarkMode, setThemeMode } = useTheme();
  const { notificationsEnabled, setNotificationsEnabled } =
    usePreferences();
  const { purchasePlan, restorePurchases, isProcessing } = usePurchases();
  const {
    handleLogout,
    handleDataExport,
    handleDeleteAccount,
    openBillingPortal,
    openPrivacyPolicy,
    openTermsOfService,
    openSupportContact,
    isAccountActionLoading,
  } = useProfileActions(onClose);
  const { t } = useTranslation();

  const [activeSection, setActiveSection] = React.useState<SettingsSectionId | null>(null);
  const {
    editableFullName,
    handleNotificationsToggle,
    handlePersonalizationToggle,
    handleSaveFullName,
    handleThemeToggle,
    personalization,
    setEditableFullName,
    updatingFullName,
    updatingNotifications,
    updatingPersonalization,
    updatingTheme,
  } = useSettingsPreferenceActions({
    isDarkMode,
    refreshUser,
    setNotificationsEnabled,
    setThemeMode,
    t,
    user,
  });

  const subscriptionQuery = useSubscriptionQuery({
    enabled: visible && activeSection === 'subscription' && !!user,
  });
  const billingBalanceQuery = useBillingBalanceQuery({
    enabled: visible && activeSection === 'subscription' && !!user,
  });
  const productsQuery = useProductsQuery({
    enabled: visible && activeSection === 'subscription' && user?.plan === 'free',
  });
  const storageQuery = useStorageSummaryQuery({
    enabled: visible && activeSection === 'storage' && !!user,
  });
  const {
    integrations,
    loadingIntegrations,
    integrationActionProvider,
    mcpServers,
    pendingMcpName,
    setPendingMcpName,
    pendingMcpEndpoint,
    setPendingMcpEndpoint,
    mcpActionServer,
    handleConnectIntegration,
    handleDisconnectIntegration,
    handleAddMcpServer,
    handleRemoveMcpServer,
    handleInspectMcpServer,
  } = useSettingsIntegrations({ visible, activeSection, t });
  const { handleClearCache, handleForceSync, handleResetDatabase } =
    useSettingsMaintenanceActions({
      onClearCache,
      t,
    });
  const memorySummary = useSettingsMemories({ t });

  React.useEffect(() => {
    if (!visible) return;
    Keyboard.dismiss();
    setActiveSection(desktopPairingPayload ? 'apps' : null);
  }, [desktopPairingPayload, visible]);

  const {
    activeSectionLabel,
    isAdmin,
    planLabel,
    proPriceLabel,
    profileEmail,
    profileHandle,
    profileInitials,
    profileName,
    superPriceLabel,
  } = useSettingsScreenViewState({
    activeSection,
    products: productsQuery.data?.products,
    t,
    user,
  });

  return (
    <SettingsFrame
      visible={visible}
      onClose={onClose}
      onBack={() => setActiveSection(null)}
      activeSectionLabel={activeSectionLabel}
      isHome={activeSection === null}
      insets={insets}
      theme={theme}
      backLabel={t('mobile.settings.back', { defaultValue: 'Back' })}
      closeLabel={t('mobile.settings.close', { defaultValue: 'Close settings' })}
    >
      {activeSection === null ? (
          <SettingsHome
            insets={insets}
            theme={theme}
            t={t}
            profileInitials={profileInitials}
            profileName={profileName}
            profileHandle={profileHandle}
            planLabel={planLabel}
            isAuthenticated={!!user}
            onSelectSection={setActiveSection}
          />
        ) : (
          <SettingsSectionContent
            activeSection={activeSection}
            profileEmail={profileEmail}
            editableFullName={editableFullName}
            updatingFullName={updatingFullName}
            onEditableNameChange={setEditableFullName}
            onSaveFullName={handleSaveFullName}
            onRefreshUser={() => refreshUser({ force: true })}
            isDarkMode={isDarkMode}
            updatingTheme={updatingTheme}
            onThemeToggle={handleThemeToggle}
            notificationsEnabled={notificationsEnabled}
            updatingNotifications={updatingNotifications}
            onNotificationsToggle={handleNotificationsToggle}
            personalization={personalization}
            updatingPersonalization={updatingPersonalization}
            onPersonalizationToggle={handlePersonalizationToggle}
            memorySummary={memorySummary}
            user={user}
            subscriptionQuery={{
              data: subscriptionQuery.data,
              isFetching: subscriptionQuery.isFetching,
            }}
            billingBalanceQuery={{
              data: billingBalanceQuery.data,
              isFetching: billingBalanceQuery.isFetching,
            }}
            storageQuery={{
              data: storageQuery.data,
              isFetching: storageQuery.isFetching,
              error: storageQuery.error,
              refetch: storageQuery.refetch,
            }}
            isProcessing={isProcessing}
            proPriceLabel={proPriceLabel}
            superPriceLabel={superPriceLabel}
            onPurchasePlan={(plan) => void purchasePlan(plan)}
            onRestorePurchases={() => void restorePurchases()}
            onManageBilling={() => void openBillingPortal()}
            onClearCache={handleClearCache}
            onForceSync={handleForceSync}
            onResetDatabase={handleResetDatabase}
            isAdmin={isAdmin}
            accountActionsTitle={t('mobile.settings.accountActions', { defaultValue: 'Account actions' })}
            exportLabel={t('mobile.profile.exportData', { defaultValue: 'Export my data' })}
            deleteLabel={t('mobile.profile.deleteAccount', { defaultValue: 'Delete account' })}
            logoutLabel={t('mobile.profile.logoutButton', { defaultValue: 'Logout' })}
            isAccountActionLoading={isAccountActionLoading}
            onExportData={() => { void handleDataExport(); }}
            onDeleteAccount={handleDeleteAccount}
            onLogout={handleLogout}
            onPrivacyPolicy={openPrivacyPolicy}
            onTermsOfService={openTermsOfService}
            onContactSupport={openSupportContact}
            integrations={integrations}
            mcpServers={mcpServers}
            loadingIntegrations={loadingIntegrations}
            integrationActionProvider={integrationActionProvider}
            pendingMcpName={pendingMcpName}
            pendingMcpEndpoint={pendingMcpEndpoint}
            mcpActionServer={mcpActionServer}
            onConnectIntegration={(provider) => void handleConnectIntegration(provider)}
            onDisconnectIntegration={(provider) => void handleDisconnectIntegration(provider)}
            onPendingMcpNameChange={setPendingMcpName}
            onPendingMcpEndpointChange={setPendingMcpEndpoint}
            onAddMcpServer={() => void handleAddMcpServer()}
            onInspectMcpServer={(serverName) => void handleInspectMcpServer(serverName)}
            onRemoveMcpServer={(serverName) => void handleRemoveMcpServer(serverName)}
            desktopPairingPayload={desktopPairingPayload}
          />
        )}
    </SettingsFrame>
  );
}
