import type { OrchestrationConfig } from '@taskforceai/persistence/preferences/orchestration-storage';

export const DEFAULT_ORCHESTRATION_AGENT_COUNT = 4;
export const MIN_ORCHESTRATION_AGENT_COUNT = 1;
export const MAX_ORCHESTRATION_AGENT_COUNT = 20;

export const clampOrchestrationAgentCount = (count: number): number =>
  Math.max(MIN_ORCHESTRATION_AGENT_COUNT, Math.min(MAX_ORCHESTRATION_AGENT_COUNT, count));

export const buildOrchestrationConfig = ({
  roleModels,
  budget,
  agentCount,
}: {
  roleModels: Record<string, string>;
  budget?: number;
  agentCount: number;
}): OrchestrationConfig => ({
  roleModels,
  budget,
  agentCount,
});

export const applyStoredOrchestrationConfig = (
  config: OrchestrationConfig,
  handlers: {
    setRoleModels?: (roleModels: Record<string, string>) => void;
    setRoleModel?: (role: string, modelId: string) => void;
    setBudget?: (budget: number | undefined) => void;
    setAgentCount?: (agentCount: number) => void;
    onRoleModelError?: (error: unknown, context: { role: string; modelId: string }) => void;
  }
): void => {
  if (config.roleModels) {
    if (handlers.setRoleModels) {
      handlers.setRoleModels(config.roleModels);
    } else if (handlers.setRoleModel) {
      for (const [role, modelId] of Object.entries(config.roleModels)) {
        if (typeof modelId !== 'string') {
          continue;
        }
        try {
          handlers.setRoleModel(role, modelId);
        } catch (error) {
          handlers.onRoleModelError?.(error, { role, modelId });
        }
      }
    }
  }

  if (config.budget !== undefined) {
    handlers.setBudget?.(config.budget);
  }

  if (config.agentCount !== undefined) {
    handlers.setAgentCount?.(clampOrchestrationAgentCount(config.agentCount));
  }
};
