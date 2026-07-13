import type { ModelOptionSummary } from '@taskforceai/contracts/contracts';

import { PromptFormPanels } from './PromptFormPanels';

interface PromptFormFooterProps {
  agentCount: number;
  autonomyEnabled: boolean;
  budget?: number;
  budgetLimit: number | null;
  currentSpend: number;
  defaultModelId: string | null;
  defaultModelLabel: string | null;
  isAutonomousPanelOpen: boolean;
  isListening: boolean;
  isOrchestrationModalOpen: boolean;
  isStreaming: boolean;
  models: ModelOptionSummary[];
  roleModels: Record<string, string>;
  userPlan?: string;
  onAgentCountChange: (agentCount: number) => void;
  onBudgetChange: (budget: number | undefined) => void;
  onCloseAutonomousPanel: () => void;
  onCloseOrchestrationModal: () => void;
  onRoleModelChange: (role: string, modelId: string) => void;
}

export function PromptFormFooter({
  agentCount,
  autonomyEnabled,
  budget,
  budgetLimit,
  currentSpend,
  defaultModelId,
  defaultModelLabel,
  isAutonomousPanelOpen,
  isListening,
  isOrchestrationModalOpen,
  isStreaming,
  models,
  roleModels,
  userPlan,
  onAgentCountChange,
  onBudgetChange,
  onCloseAutonomousPanel,
  onCloseOrchestrationModal,
  onRoleModelChange,
}: PromptFormFooterProps) {
  return (
    <>
      {isListening && (
        <div className="mt-2 text-xs text-blue-300" aria-live="polite">
          Listening… tap the mic to stop.
        </div>
      )}
      <PromptFormPanels
        isOrchestrationModalOpen={isOrchestrationModalOpen}
        onCloseOrchestrationModal={onCloseOrchestrationModal}
        models={models}
        roleModels={roleModels}
        onRoleModelChange={onRoleModelChange}
        budget={budget}
        onBudgetChange={onBudgetChange}
        autonomyEnabled={autonomyEnabled}
        defaultModelId={defaultModelId}
        defaultModelLabel={defaultModelLabel}
        userPlan={userPlan}
        agentCount={agentCount}
        onAgentCountChange={onAgentCountChange}
        isAutonomousPanelOpen={isAutonomousPanelOpen}
        onCloseAutonomousPanel={onCloseAutonomousPanel}
        currentSpend={currentSpend}
        budgetLimit={budgetLimit}
        isStreaming={isStreaming}
      />
    </>
  );
}
