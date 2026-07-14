'use client';

import type {
  BalanceResponse,
  Memory,
  ProductSummary,
  SubscriptionSummary,
} from '@taskforceai/contracts/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createMemory as createProfileMemory,
  deleteMemory as deleteProfileMemory,
  fetchMemories,
  updateMemory as updateProfileMemory,
} from '@taskforceai/api-client/api/memories';
import {
  deleteProfileAccount,
  disconnectProfileIntegration,
  exportProfileData,
  loadIntegrations,
  loadProfileData,
} from '@taskforceai/api-client/services/profile-service';
import { downloadBlob, navigateTo } from '@taskforceai/browser-runtime/browser-actions';

import { fetchStorageSummary, type StorageSummary } from '../../api/storage';
import { logger } from '../../logger';
import type { ProfileTab } from './ProfileModalSections';
import { useProfileMcpServers } from '../integrations/useProfileMcpServers';
import { useProfilePreferenceActions } from '../preferences/useProfilePreferenceActions';
import { useProfileSubscriptionActions } from '../billing/useProfileSubscriptionActions';

type ProfileUser = {
  email?: string | null;
};

interface ProfileModalControllerOptions {
  open: boolean;
  user: ProfileUser | null | undefined;
  logout: () => Promise<void> | void;
  onModalOpen?: () => void;
}

export const useProfileModalController = ({
  open,
  user,
  logout,
  onModalOpen,
}: ProfileModalControllerOptions) => {
  const userRef = useRef(user);
  userRef.current = user;
  const [activeTab, setActiveTab] = useState<ProfileTab>('general');
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [integrations, setIntegrations] = useState<Array<{ provider: string; connected: boolean }>>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [pendingUpgradePlan, setPendingUpgradePlan] = useState<'pro' | 'super' | null>(null);
  const hasCalledOnOpenRef = useRef(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [feedbackKind, setFeedbackKind] = useState<'success' | 'error'>('success');
  const [memorySummaryOpen, setMemorySummaryOpen] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [memoriesError, setMemoriesError] = useState<string | null>(null);
  const [memoryActionId, setMemoryActionId] = useState<number | 'new' | null>(null);
  const [storageSummary, setStorageSummary] = useState<StorageSummary | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const lastFetchedUserEmail = useRef<string | null>(null);
  const {
    handleMemoryToggle,
    handleWebSearchToggle,
    handleCodeExecutionToggle,
    handleTrustLayerToggle,
    handleNotificationsToggle,
    handleThemeChange,
  } = useProfilePreferenceActions({
    setFeedbackKind,
    setFeedbackMessage,
  });
  const {
    handleInspectMcpServer,
    handleRemoveMcpServer,
    handleSaveMcpServer,
    mcpBusyServerName,
    mcpServers,
    pendingMcpEndpoint,
    pendingMcpName,
    setPendingMcpEndpoint,
    setPendingMcpName,
  } = useProfileMcpServers({
    open,
    setFeedbackKind,
    setFeedbackMessage,
    userEmail: user?.email ?? null,
  });

  const loadProfile = useCallback(async () => {
    const [profileResult, integrationsResult] = await Promise.all([
      loadProfileData(),
      loadIntegrations(),
    ]);

    if (profileResult.ok) {
      setBalance(profileResult.value.balance);
      setSubscription(profileResult.value.subscription);
      setProducts(profileResult.value.products);
    } else {
      logger.error('Failed to load profile data', {
        error: profileResult.error,
        user: userRef.current ? { email: userRef.current.email } : 'null',
      });
    }

    if (integrationsResult.ok) {
      setIntegrations(integrationsResult.value);
    }
  }, []);

  const loadMemories = useCallback(async () => {
    setMemoriesLoading(true);
    setMemoriesError(null);
    const result = await fetchMemories();
    if (result.ok) {
      setMemories(result.value);
    } else {
      setMemoriesError(result.error.message);
      logger.error('Failed to load memories for profile modal', { error: result.error });
    }
    setMemoriesLoading(false);
  }, []);

  const loadStorage = useCallback(async () => {
    setStorageLoading(true);
    setStorageError(null);
    const result = await fetchStorageSummary();
    if (result.ok) {
      setStorageSummary(result.value);
    } else {
      setStorageError(result.error.message);
      logger.error('Failed to load storage summary for profile modal', { error: result.error });
    }
    setStorageLoading(false);
  }, []);

  const openMemorySummary = useCallback(() => {
    setMemorySummaryOpen(true);
    void loadMemories();
  }, [loadMemories]);

  const handleCreateMemory = useCallback(
    async (content: string, memoryType: string) => {
      setMemoryActionId('new');
      const result = await createProfileMemory({ content, type: memoryType });
      if (!result.ok) {
        setFeedbackKind('error');
        setFeedbackMessage('Failed to add memory.');
        setMemoryActionId(null);
        return false;
      }
      await loadMemories();
      setFeedbackKind('success');
      setFeedbackMessage('Memory added.');
      setMemoryActionId(null);
      return true;
    },
    [loadMemories]
  );

  const handleUpdateMemory = useCallback(
    async (id: number, content: string, memoryType: string) => {
      setMemoryActionId(id);
      const result = await updateProfileMemory(id, { content, type: memoryType });
      if (!result.ok) {
        setFeedbackKind('error');
        setFeedbackMessage('Failed to update memory.');
        setMemoryActionId(null);
        return false;
      }
      setMemories((current) => current.map((memory) => (memory.id === id ? result.value : memory)));
      setFeedbackKind('success');
      setFeedbackMessage('Memory updated.');
      setMemoryActionId(null);
      return true;
    },
    []
  );

  const handleDeleteMemory = useCallback(async (id: number) => {
    setMemoryActionId(id);
    const result = await deleteProfileMemory(id);
    if (!result.ok) {
      setFeedbackKind('error');
      setFeedbackMessage('Failed to delete memory.');
      setMemoryActionId(null);
      return false;
    }
    setMemories((current) => current.filter((memory) => memory.id !== id));
    setFeedbackKind('success');
    setFeedbackMessage('Memory deleted.');
    setMemoryActionId(null);
    return true;
  }, []);

  useEffect(() => {
    if (open && user) {
      const currentEmail = user.email ?? null;

      if (currentEmail !== lastFetchedUserEmail.current) {
        void loadProfile();
        void loadStorage();
        lastFetchedUserEmail.current = currentEmail;
      }

      if (onModalOpen && !hasCalledOnOpenRef.current) {
        onModalOpen();
        hasCalledOnOpenRef.current = true;
      }
    }

    if (!open) {
      setLoading(false);
      setPendingUpgradePlan(null);
      setMemorySummaryOpen(false);
      setMemories([]);
      setMemoriesError(null);
      setMemoryActionId(null);
      setStorageSummary(null);
      setStorageError(null);
      setStorageLoading(false);
      hasCalledOnOpenRef.current = false;
      lastFetchedUserEmail.current = null;
    }
  }, [open, user, onModalOpen, loadProfile, loadStorage]);

  const { handleCancelSubscription, handleReactivateSubscription, handleUpgrade } =
    useProfileSubscriptionActions({
      loadProfile,
      products,
      setFeedbackKind,
      setFeedbackMessage,
      setLoading,
      setPendingUpgradePlan,
    });

  const handleConnect = (provider: string) => {
    if (provider === 'google-drive') {
      window.location.href = '/api/auth/signin/google-drive';
    }
    if (provider === 'github') {
      window.location.href = '/api/auth/signin/github';
    }
  };

  const handleDisconnect = async (provider: string) => {
    try {
      const result = await disconnectProfileIntegration(provider);
      if (!result.ok) {
        throw result.error;
      }
      await loadProfile();
      setFeedbackKind('success');
      setFeedbackMessage(`${provider.replace('-', ' ')} disconnected successfully.`);
    } catch (error) {
      logger.error('Failed to disconnect integration', { error, provider });
      setFeedbackKind('error');
      setFeedbackMessage(`Failed to disconnect ${provider.replace('-', ' ')}.`);
    }
    setLoading(false);
  };

  const handleDataExport = async () => {
    setLoading(true);
    try {
      const exportResult = await exportProfileData(user?.email);
      if (!exportResult.ok) {
        throw new Error(exportResult.error.message);
      }

      const downloadResult = downloadBlob({
        blob: exportResult.value.blob,
        filename: exportResult.value.filename,
      });
      if (!downloadResult.ok) {
        throw new Error(downloadResult.error.message);
      }

      setFeedbackKind('success');
      setFeedbackMessage('Your data has been downloaded successfully.');
    } catch (error) {
      logger.error('Failed to export data', error);
      setFeedbackKind('error');
      setFeedbackMessage('Failed to export data. Please try again.');
    }
    setLoading(false);
  };

  const handleManageStorageCategory = (_categoryId: string) => {
    const navigationResult = navigateTo('/artifacts');
    if (!navigationResult.ok) {
      setFeedbackKind('error');
      setFeedbackMessage('Failed to open artifact library.');
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteInput !== user?.email) {
      setFeedbackKind('error');
      setFeedbackMessage('Email confirmation failed. Account not deleted.');
      return;
    }

    setLoading(true);
    try {
      const result = await deleteProfileAccount(deleteInput);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      setFeedbackKind('success');
      setFeedbackMessage(result.value.message);

      await logout();
      const navigationResult = navigateTo('/');
      if (!navigationResult.ok) {
        throw new Error(navigationResult.error.message);
      }
      return;
    } catch (error) {
      logger.error('Failed to delete account', error);
      setFeedbackKind('error');
      setFeedbackMessage('Failed to delete account. Please contact support.');
    }
    setLoading(false);
  };

  const confirmAndCancelSubscription = async () => {
    await handleCancelSubscription();
    setConfirmCancelOpen(false);
  };

  const confirmAndDeleteAccount = async () => {
    await handleDeleteAccount();
    setConfirmDeleteOpen(false);
    setDeleteInput('');
  };

  return {
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
  };
};
