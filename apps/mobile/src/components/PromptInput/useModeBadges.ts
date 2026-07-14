import {
  buildPromptModeBadges,
  type PromptModeBadgeKey,
} from '@taskforceai/presenters';
import { useMemo } from 'react';

import type { ModeBadge } from './ModeBadges';

interface UsePromptInputModeBadgesOptions {
  quickModeEnabled: boolean;
  computerUseEnabled: boolean;
  roleModels?: Record<string, string>;
  onCustomizeOrchestration?: () => void;
  onQuickModeToggle: () => void;
  onComputerUseToggle: () => void;
}

export function usePromptInputModeBadges({
  quickModeEnabled,
  computerUseEnabled,
  roleModels,
  onCustomizeOrchestration,
  onQuickModeToggle,
  onComputerUseToggle,
}: UsePromptInputModeBadgesOptions): ModeBadge[] {
  return useMemo(
    () => {
      const badgeByKey: Record<
        PromptModeBadgeKey,
        Pick<ModeBadge, 'iconName' | 'id' | 'onDismiss' | 'onPress'>
      > = {
        agentTeams: { id: 'agentTeams', iconName: 'Users', onPress: onCustomizeOrchestration },
        customOrchestration: {
          id: 'customOrchestration',
          iconName: 'SlidersHorizontal',
          onPress: onCustomizeOrchestration,
        },
        autonomous: { id: 'autonomous', iconName: 'Activity' },
        quickMode: { id: 'quickMode', iconName: 'Zap', onDismiss: onQuickModeToggle },
        computerUse: { id: 'computerUse', iconName: 'Cpu', onDismiss: onComputerUseToggle },
        computerAuthMode: { id: 'computerAuthMode', iconName: 'Monitor' },
      };

      return buildPromptModeBadges(
        {
          quickModeEnabled,
          autonomousModeEnabled: false,
          computerUseEnabled,
          roleModels,
        },
        badgeByKey
      );
    },
    [
      computerUseEnabled,
      onComputerUseToggle,
      onCustomizeOrchestration,
      onQuickModeToggle,
      quickModeEnabled,
      roleModels,
    ]
  );
}
