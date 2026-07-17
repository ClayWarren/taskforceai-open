import type { ModelOptionSummary } from '@taskforceai/contracts/contracts';

import { AutonomousPanel } from './AutonomousPanel';
import { OrchestrationModal } from './OrchestrationModal';

interface PromptFormPanelsProps {
  isOrchestrationModalOpen: boolean;
  onCloseOrchestrationModal: () => void;
  models: ModelOptionSummary[];
  roleModels: Record<string, string>;
  onRoleModelChange: (_role: string, _modelId: string) => void;
  budget: number | undefined;
  onBudgetChange: (_budget: number | undefined) => void;
  autonomyEnabled: boolean;
  defaultModelId: string | null;
  defaultModelLabel: string | null;
  userPlan?: string;
  agentCount: number;
  onAgentCountChange: (_count: number) => void;
  isAutonomousPanelOpen: boolean;
  onCloseAutonomousPanel: () => void;
  currentSpend: number;
  budgetLimit: number | null;
  isStreaming: boolean;
}

export function PromptFormPanels(props: PromptFormPanelsProps) {
  return (
    <>
      <OrchestrationModal
        isOpen={props.isOrchestrationModalOpen}
        onClose={props.onCloseOrchestrationModal}
        models={props.models}
        roleModels={props.roleModels}
        onRoleModelChange={props.onRoleModelChange}
        budget={props.budget}
        onBudgetChange={props.onBudgetChange}
        autonomyEnabled={props.autonomyEnabled}
        defaultModelId={props.defaultModelId}
        defaultModelLabel={props.defaultModelLabel}
        userPlan={props.userPlan}
        agentCount={props.agentCount}
        onAgentCountChange={props.onAgentCountChange}
      />

      <AutonomousPanel
        isOpen={props.isAutonomousPanelOpen}
        onClose={props.onCloseAutonomousPanel}
        budget={props.budget}
        onBudgetChange={props.onBudgetChange}
        currentSpend={props.currentSpend}
        budgetLimit={props.budgetLimit}
        isStreaming={props.isStreaming}
      />
    </>
  );
}
