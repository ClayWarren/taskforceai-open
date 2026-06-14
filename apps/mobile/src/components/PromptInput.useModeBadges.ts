import {
  buildPromptModeBadges,
  type PromptModeBadgeKey,
} from '@taskforceai/shared';
import { useMemo } from 'react';

import type { ModeBadge } from './PromptInput.ModeBadges';

interface UsePromptInputModeBadgesOptions {
  quickModeEnabled: boolean;
  autonomousModeEnabled: boolean;
  computerUseEnabled: boolean;
  roleModels?: Record<string, string>;
  onCustomizeOrchestration?: () => void;
  onQuickModeToggle: () => void;
  onAutonomousModeToggle: () => void;
  onComputerUseToggle: () => void;
}

export function usePromptInputModeBadges({
  quickModeEnabled,
  autonomousModeEnabled,
  computerUseEnabled,
  roleModels,
  onCustomizeOrchestration,
  onQuickModeToggle,
  onAutonomousModeToggle,
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
        autonomous: { id: 'autonomous', iconName: 'Activity', onDismiss: onAutonomousModeToggle },
        quickMode: { id: 'quickMode', iconName: 'Zap', onDismiss: onQuickModeToggle },
        computerUse: { id: 'computerUse', iconName: 'Cpu', onDismiss: onComputerUseToggle },
        computerAuthMode: { id: 'computerAuthMode', iconName: 'Monitor' },
      };

      return buildPromptModeBadges(
        {
          quickModeEnabled,
          autonomousModeEnabled,
          computerUseEnabled,
          roleModels,
        },
        badgeByKey
      );
    },
    [
      autonomousModeEnabled,
      computerUseEnabled,
      onAutonomousModeToggle,
      onComputerUseToggle,
      onCustomizeOrchestration,
      onQuickModeToggle,
      quickModeEnabled,
      roleModels,
    ]
  );
}
