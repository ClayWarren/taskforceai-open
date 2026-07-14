import { useMemo } from 'react';
import { buildPromptModeBadges, type PromptModeBadgeKey } from '@taskforceai/presenters';

import type { ModeBadge } from '../presentation/ModeBadges';

interface UsePromptModeBadgesOptions {
  quickModeEnabled: boolean;
  autonomyEnabled: boolean;
  computerUseEnabled: boolean;
  computerUseSessionMode: 'logged_in' | 'logged_out';
  customRoleModels: Record<string, string>;
  isAutonomyAllowed: boolean;
  isComputerUseAllowed: boolean;
  onOpenOrchestration: () => void;
  onOpenAutonomousPanel: () => void;
  onSetAutonomyEnabled: (_enabled: boolean) => void;
  onSetComputerUseEnabled: (_enabled: boolean) => void;
  onSetComputerUseSessionMode: (_mode: 'logged_in' | 'logged_out') => void;
  onSetCustomRoleModels: (_roleModels: Record<string, string>) => void;
  onSetQuickModeEnabled: (_enabled: boolean | ((_previous: boolean) => boolean)) => void;
}

export function usePromptModeBadges({
  quickModeEnabled,
  autonomyEnabled,
  computerUseEnabled,
  computerUseSessionMode,
  customRoleModels,
  isAutonomyAllowed,
  isComputerUseAllowed,
  onOpenOrchestration,
  onOpenAutonomousPanel,
  onSetAutonomyEnabled,
  onSetComputerUseEnabled,
  onSetComputerUseSessionMode,
  onSetCustomRoleModels,
  onSetQuickModeEnabled,
}: UsePromptModeBadgesOptions): ModeBadge[] {
  return useMemo(() => {
    const badgeByKey: Record<
      PromptModeBadgeKey,
      Pick<ModeBadge, 'icon' | 'onClick' | 'onDismiss'> & { id: string }
    > = {
      agentTeams: { id: 'agent-teams', icon: '👥', onClick: onOpenOrchestration },
      customOrchestration: {
        id: 'custom-models',
        icon: '⚙️',
        onClick: onOpenOrchestration,
        onDismiss: () => onSetCustomRoleModels({}),
      },
      autonomous: {
        id: 'autonomous',
        icon: '🤖',
        onClick: onOpenAutonomousPanel,
        onDismiss: () => onSetAutonomyEnabled(false),
      },
      quickMode: {
        id: 'quick-mode',
        icon: '⚡',
        onClick: () => onSetQuickModeEnabled((previous) => !previous),
        onDismiss: () => onSetQuickModeEnabled(false),
      },
      computerUse: {
        id: 'computer-use',
        icon: '💻',
        onClick: () => {},
        onDismiss: () => onSetComputerUseEnabled(false),
      },
      computerAuthMode: {
        id: 'computer-auth-mode',
        icon: '🔐',
        onClick: () => {},
        onDismiss: () => onSetComputerUseSessionMode('logged_out'),
      },
    };

    return buildPromptModeBadges(
      {
        quickModeEnabled,
        autonomousModeEnabled: autonomyEnabled,
        computerUseEnabled,
        computerUseSessionMode,
        roleModels: customRoleModels,
        isAutonomyAllowed,
        isComputerUseAllowed,
        includeLoggedInServices: true,
      },
      badgeByKey
    );
  }, [
    autonomyEnabled,
    computerUseEnabled,
    computerUseSessionMode,
    customRoleModels,
    isAutonomyAllowed,
    isComputerUseAllowed,
    onOpenAutonomousPanel,
    onOpenOrchestration,
    onSetAutonomyEnabled,
    onSetComputerUseEnabled,
    onSetComputerUseSessionMode,
    onSetCustomRoleModels,
    onSetQuickModeEnabled,
    quickModeEnabled,
  ]);
}
