const hasCustomRoleModels = (roleModels?: Record<string, string> | null): boolean =>
  Object.keys(roleModels ?? {}).length > 0;

export type PromptModeKey = 'autonomous' | 'quickMode' | 'computerUse';

export interface PromptModeDefinition {
  key: PromptModeKey;
  label: string;
  description: string;
}

export const PROMPT_MODE_DEFINITIONS: Record<PromptModeKey, PromptModeDefinition> = {
  autonomous: {
    key: 'autonomous',
    label: 'Autonomous',
    description: 'Self-directed task execution',
  },
  quickMode: {
    key: 'quickMode',
    label: 'Direct Chat',
    description: 'Standard single-assistant responses',
  },
  computerUse: {
    key: 'computerUse',
    label: 'Computer Use',
    description: 'Enable desktop automation',
  },
};

export const PROMPT_OPTION_LABELS = {
  agentTeams: 'Agent Teams',
  agentTeamConfig: 'Agent Team Config',
  agentTeamConfigMenu: 'Agent Team Config',
  autonomousMode: 'Autonomous Mode',
  quickModeDirect: 'Direct Chat',
  useLoggedInServices: 'Use Logged-In Services',
  customModels: 'Custom Models',
  assignAgentModels: 'Assign models to agent roles',
  setBudget: 'Set Budget',
  configureSpendingLimit: 'Configure spending limit',
  parallelAgents: 'Parallel Agents',
} as const;

export type PromptModeBadgeKey =
  | 'agentTeams'
  | 'customOrchestration'
  | 'autonomous'
  | 'quickMode'
  | 'computerUse'
  | 'computerAuthMode';

export interface PromptModeBadgeDescriptor {
  key: PromptModeBadgeKey;
  label: string;
  enabled: boolean;
}

export interface BuildPromptModeBadgeDescriptorsOptions {
  quickModeEnabled: boolean;
  autonomousModeEnabled: boolean;
  computerUseEnabled: boolean;
  computerUseSessionMode?: 'logged_in' | 'logged_out';
  roleModels?: Record<string, string> | null;
  isAutonomyAllowed?: boolean;
  isComputerUseAllowed?: boolean;
  includeLoggedInServices?: boolean;
}

export const buildPromptModeBadgeDescriptors = ({
  quickModeEnabled,
  autonomousModeEnabled,
  computerUseEnabled,
  computerUseSessionMode = 'logged_out',
  roleModels,
  isAutonomyAllowed = true,
  isComputerUseAllowed = true,
  includeLoggedInServices = false,
}: BuildPromptModeBadgeDescriptorsOptions): PromptModeBadgeDescriptor[] => {
  const baseDescriptors: Array<PromptModeBadgeDescriptor | false> = [
    {
      key: 'agentTeams',
      label: PROMPT_OPTION_LABELS.agentTeams,
      enabled: !quickModeEnabled,
    },
    {
      key: 'customOrchestration',
      label: PROMPT_OPTION_LABELS.agentTeamConfig,
      enabled: !quickModeEnabled && hasCustomRoleModels(roleModels),
    },
    isAutonomyAllowed && {
      key: 'autonomous',
      label: PROMPT_MODE_DEFINITIONS.autonomous.label,
      enabled: autonomousModeEnabled,
    },
    isComputerUseAllowed && {
      key: 'computerUse',
      label: PROMPT_MODE_DEFINITIONS.computerUse.label,
      enabled: computerUseEnabled,
    },
    includeLoggedInServices && {
      key: 'computerAuthMode',
      label: 'Logged-In Services',
      enabled: computerUseEnabled && computerUseSessionMode === 'logged_in',
    },
  ];

  return baseDescriptors.filter((descriptor) => descriptor !== false);
};

export const buildPromptModeBadges = <TBadge>(
  options: BuildPromptModeBadgeDescriptorsOptions,
  badgeByKey: Record<PromptModeBadgeKey, TBadge>
): Array<PromptModeBadgeDescriptor & TBadge> =>
  buildPromptModeBadgeDescriptors(options).map((descriptor) =>
    Object.assign({}, descriptor, badgeByKey[descriptor.key])
  );
