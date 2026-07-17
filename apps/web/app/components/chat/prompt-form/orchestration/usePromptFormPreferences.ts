import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  applyStoredOrchestrationConfig,
  buildOrchestrationConfig,
  usePersistedOrchestrationConfig,
} from '@taskforceai/react-core';

import { upsertAgent, fetchAgents, type Agent } from '../../../../lib/api/agents';
import { logger } from '../../../../lib/logger';
import {
  getDesktopAppServerComputerUseMode,
  setDesktopAppServerComputerUseMode,
} from '../../../../lib/platform/desktop-api';
import type { PlatformRuntime } from '../../../../lib/platform/platform-interfaces';
import {
  COMPUTER_USE_SESSION_MODE_EVENT,
  COMPUTER_USE_SESSION_MODE_STORAGE_KEY,
  persistComputerUseSessionMode,
  readStoredComputerUseSessionMode,
  type ComputerUseSessionMode,
} from '../../../../lib/prompt/computer-use-session-mode';
import {
  readStoredOrchestrationConfig,
  persistOrchestrationConfig,
} from '../../../../lib/prompt/orchestration-selection';
import type { OrchestrationConfig } from '@taskforceai/persistence/preferences/orchestration-storage';
import type { DesktopTaskMode } from '../../../../lib/desktop/task-mode';

type PromptFormUser = {
  email?: string | null;
  full_name?: string | null;
  quick_mode_enabled?: boolean | null;
} | null;

type UsePromptFormPreferencesParams = {
  isAuthenticated: boolean;
  platformRuntime: PlatformRuntime;
  user: PromptFormUser;
  setErrorMessage: (_message: string) => void;
  desktopTaskMode?: DesktopTaskMode;
};

type UsePromptFormPreferencesResult = {
  computerUseEnabled: boolean;
  setComputerUseEnabled: Dispatch<SetStateAction<boolean>>;
  computerUseSessionMode: ComputerUseSessionMode;
  setComputerUseSessionMode: (_mode: ComputerUseSessionMode) => void;
  quickModeEnabled: boolean;
  setQuickModeEnabled: Dispatch<SetStateAction<boolean>>;
  autonomyEnabled: boolean;
  setAutonomyEnabled: Dispatch<SetStateAction<boolean>>;
  customRoleModels: Record<string, string>;
  setCustomRoleModels: Dispatch<SetStateAction<Record<string, string>>>;
  budget: number | undefined;
  setBudget: Dispatch<SetStateAction<number | undefined>>;
  agentCount: number;
  setAgentCount: Dispatch<SetStateAction<number>>;
};

export function usePromptFormPreferences({
  isAuthenticated,
  platformRuntime,
  user,
  setErrorMessage,
  desktopTaskMode,
}: UsePromptFormPreferencesParams): UsePromptFormPreferencesResult {
  const [computerUseEnabled, setComputerUseEnabled] = useState(false);
  const [computerUseSessionModeState, setComputerUseSessionModeState] =
    useState<ComputerUseSessionMode>('logged_out');
  const [quickModeEnabled, setQuickModeEnabled] = useState(true);
  const [autonomyEnabled, setAutonomyEnabled] = useState(false);
  const [agentHydrationRequest, setAgentHydrationRequest] = useState(0);
  const [agentHydrationVersion, setAgentHydrationVersion] = useState(0);
  const [customRoleModels, setCustomRoleModels] = useState<Record<string, string>>({});
  const [budget, setBudget] = useState<number | undefined>(undefined);
  const [agentCount, setAgentCount] = useState<number>(4);
  const userEmail = user?.email ?? '';
  const userFullName = user?.full_name ?? '';
  const shouldSyncAgentPreferences =
    platformRuntime === 'browser' && isAuthenticated && userEmail.length > 0;

  const firstAutonomySyncRef = useRef(true);
  const suppressNextAutonomySyncRef = useRef(false);
  const syncedAgentIdRef = useRef<string | null>(null);
  const syncedAgentNameRef = useRef<string | null>(null);
  const agentPreferenceOwnerRef = useRef<string | null>(null);
  const pendingAutonomyRef = useRef<boolean | null>(null);
  const quickModeInitRef = useRef(false);
  const agentFetchedRef = useRef(false);
  const agentSettingsHydratedRef = useRef(false);
  const computerUseModeHydratedRef = useRef(false);

  const orchestrationConfig = useMemo(
    () =>
      buildOrchestrationConfig({
        roleModels: customRoleModels,
        budget,
        agentCount,
      }),
    [agentCount, budget, customRoleModels]
  );

  const applyStoredConfig = useCallback((config: OrchestrationConfig) => {
    applyStoredOrchestrationConfig(config, {
      setRoleModels: setCustomRoleModels,
      setBudget,
      setAgentCount,
    });
  }, []);

  usePersistedOrchestrationConfig({
    currentConfig: orchestrationConfig,
    loadStoredConfig: readStoredOrchestrationConfig,
    persistConfig: persistOrchestrationConfig,
    applyStoredConfig,
  });

  useEffect(() => {
    setComputerUseSessionModeState(readStoredComputerUseSessionMode());

    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === COMPUTER_USE_SESSION_MODE_STORAGE_KEY) {
        setComputerUseSessionModeState(readStoredComputerUseSessionMode());
      }
    };

    const handleSessionModeChange = (event: Event) => {
      const customEvent = event as CustomEvent<{
        mode?: ComputerUseSessionMode;
      }>;
      const mode = customEvent.detail?.mode;
      if (mode === 'logged_in' || mode === 'logged_out') {
        setComputerUseSessionModeState(mode);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener(COMPUTER_USE_SESSION_MODE_EVENT, handleSessionModeChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(COMPUTER_USE_SESSION_MODE_EVENT, handleSessionModeChange);
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      if (!quickModeInitRef.current && user !== undefined && user !== null) {
        quickModeInitRef.current = true;
        setQuickModeEnabled(true);
      }
      return;
    }

    quickModeInitRef.current = false;
  }, [isAuthenticated, user]);

  useEffect(() => {
    if (platformRuntime !== 'desktop' || computerUseModeHydratedRef.current) {
      return;
    }

    computerUseModeHydratedRef.current = true;
    void (async () => {
      try {
        const result = await getDesktopAppServerComputerUseMode();
        setComputerUseEnabled(result.enabled);
      } catch (error) {
        logger.error('Failed to hydrate desktop computer use mode', { error });
      }
    })();
  }, [platformRuntime]);

  useEffect(() => {
    if (agentPreferenceOwnerRef.current !== userEmail) {
      agentPreferenceOwnerRef.current = userEmail || null;
      agentFetchedRef.current = false;
      syncedAgentIdRef.current = null;
      syncedAgentNameRef.current = null;
      pendingAutonomyRef.current = null;
      agentSettingsHydratedRef.current = false;
    }

    if (shouldSyncAgentPreferences && !agentFetchedRef.current) {
      agentFetchedRef.current = true;
      void (async () => {
        try {
          const result = await fetchAgents();
          if (!result.ok) {
            agentFetchedRef.current = false;
            setErrorMessage('Failed to load agent settings. Changes will retry before saving.');
            return;
          }

          const primaryAgent =
            result.value.find((agent: Agent) => agent.autonomy_enabled) ?? result.value[0];
          if (primaryAgent?.name) {
            syncedAgentIdRef.current = primaryAgent.id;
            syncedAgentNameRef.current = primaryAgent.name;
          }

          const hasAutonomyEnabled = result.value.some((agent: Agent) => agent.autonomy_enabled);
          if (pendingAutonomyRef.current === null) {
            setAutonomyEnabled((previous) => {
              if (previous === hasAutonomyEnabled) {
                return previous;
              }

              suppressNextAutonomySyncRef.current = true;
              return hasAutonomyEnabled;
            });
          }
          agentSettingsHydratedRef.current = true;
          if (pendingAutonomyRef.current !== null) {
            setAgentHydrationVersion((version) => version + 1);
          }
        } catch (error) {
          agentFetchedRef.current = false;
          logger.error('Failed to fetch agent settings', { error });
          setErrorMessage('Failed to load agent settings. Changes will retry before saving.');
        }
      })();
    }

    if (!shouldSyncAgentPreferences) {
      agentFetchedRef.current = false;
      firstAutonomySyncRef.current = true;
      suppressNextAutonomySyncRef.current = false;
      syncedAgentIdRef.current = null;
      syncedAgentNameRef.current = null;
      agentPreferenceOwnerRef.current = null;
      pendingAutonomyRef.current = null;
      agentSettingsHydratedRef.current = false;
    }
  }, [agentHydrationRequest, setErrorMessage, shouldSyncAgentPreferences, userEmail]);

  useEffect(() => {
    if (firstAutonomySyncRef.current) {
      firstAutonomySyncRef.current = false;
      return;
    }

    if (suppressNextAutonomySyncRef.current) {
      suppressNextAutonomySyncRef.current = false;
      return;
    }

    if (!shouldSyncAgentPreferences || !agentSettingsHydratedRef.current) {
      return;
    }

    const snapshotUserFullName = userFullName;
    const snapshotUserEmail = userEmail;

    void (async () => {
      try {
        const fallbackName = `${snapshotUserFullName || snapshotUserEmail}'s Team`;
        const result = await upsertAgent({
          id: syncedAgentIdRef.current ?? undefined,
          name: syncedAgentNameRef.current?.trim() || fallbackName,
          autonomyEnabled,
        });

        if (!result.ok) {
          setErrorMessage('Failed to sync agent settings. Your changes might not be saved.');
          return;
        }

        if (result.value.name) {
          syncedAgentIdRef.current = result.value.id;
          syncedAgentNameRef.current = result.value.name;
        }
        pendingAutonomyRef.current = null;
      } catch (error) {
        logger.error('Failed to upsert agent settings', { error });
        setErrorMessage('Failed to sync agent settings. Your changes might not be saved.');
      }
    })();
  }, [
    agentHydrationVersion,
    autonomyEnabled,
    setErrorMessage,
    shouldSyncAgentPreferences,
    userEmail,
    userFullName,
  ]);

  const updateAutonomyEnabled: Dispatch<SetStateAction<boolean>> = useCallback(
    (nextValue) => {
      if (shouldSyncAgentPreferences && !agentSettingsHydratedRef.current) {
        setAgentHydrationRequest((request) => request + 1);
      }
      setAutonomyEnabled((previous) => {
        const next = typeof nextValue === 'function' ? nextValue(previous) : nextValue;
        pendingAutonomyRef.current = next;
        return next;
      });
    },
    [shouldSyncAgentPreferences]
  );

  const updateComputerUseEnabled: Dispatch<SetStateAction<boolean>> = useCallback(
    (nextValue) => {
      setComputerUseEnabled((previous) => {
        const next =
          typeof nextValue === 'function'
            ? (nextValue as (_previous: boolean) => boolean)(previous)
            : nextValue;

        if (next !== previous && platformRuntime === 'desktop') {
          void setDesktopAppServerComputerUseMode(next).catch((error) => {
            logger.error('Failed to persist desktop computer use mode', {
              error,
            });
            setErrorMessage('Failed to save Computer Use mode. Your next run might not use it.');
          });
        }

        return next;
      });
    },
    [platformRuntime, setErrorMessage]
  );

  return {
    computerUseEnabled,
    setComputerUseEnabled: updateComputerUseEnabled,
    computerUseSessionMode: computerUseSessionModeState,
    setComputerUseSessionMode: (mode) => {
      setComputerUseSessionModeState(mode);
      persistComputerUseSessionMode(mode);
    },
    quickModeEnabled,
    setQuickModeEnabled,
    autonomyEnabled: desktopTaskMode
      ? desktopTaskMode === 'work' && autonomyEnabled
      : autonomyEnabled,
    setAutonomyEnabled: updateAutonomyEnabled,
    customRoleModels,
    setCustomRoleModels,
    budget,
    setBudget,
    agentCount,
    setAgentCount,
  };
}
